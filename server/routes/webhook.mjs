/**
 * server/routes/webhook.mjs - Domaine WEBHOOK FedaPay (dépôts + payouts).
 *
 * Renvoie `true` dès qu'il a écrit la réponse, `false` sinon.
 *
 * Ordre des gardes : raw body (1 Mo) -> secret webhook présent -> signature
 * `X-FEDAPAY-SIGNATURE` via `Webhook.constructEvent` (corps BRUT) ->
 * classification de l'événement -> relecture API (jamais le corps de la
 * requête) -> action idempotente.
 *
 * INVARIANT : la vérité est RELUE chez FedaPay, jamais le corps du webhook.
 *   Le webhook n'est qu'un signal « va voir » : le montant, le statut et la
 *   propriété sont réévalués via `Transaction.retrieve` / `Payout.retrieve`
 *   (cohérent avec l'invariant payment-engine déjà en place).
 * INVARIANT : signature OBLIGATOIRE, fail-closed. Secret absent
 *   (`FEDAPAY_WEBHOOK_SECRET` `wh_...`) -> 503, jamais de traitement sans
 *   vérification. Horodatage vérifié par le SDK (tolérance 300 s, anti-
 *   rejeu) : impossible de le modifier sans invalider la signature.
 * INVARIANT : un dépôt n'est crédité qu'une fois et seulement à son
 *   titulaire — `verifyFedaPayTransactionAndCredit` (claim atomique +
 *   `ZOYD:<userId>` ou email) est réutilisé tel quel, sous
 *   `withWalletMutex` comme la route `verify-fedapay`.
 * INVARIANT : un retrait `pending_review` n'est jamais remboursé sur la
 *   seule parole du webhook : on rejoue `reconcilePendingWithdrawals`
 *   (relecture du payout + remboursement idempotent sur refus
 *   définitif). Le webhook accélère le cron 30 min, il ne le remplace pas.
 * INVARIANT : réponse 200 `{received:true}` pour tout événement vérifié
 *   traité (y compris « ignoré » / « déjà traité ») pour arrêter les
 *   retries FedaPay ; 503 seulement sur une panne transitoire
 *   (`SERVER_BUSY`, `FEDAPAY_API_ERROR`, `PAYOUT_LOOKUP_FAILED`) où un
 *   retry peut réussir.
 * PIEGE : `X-FEDAPAY-SIGNATURE` porte `t=<ts>,s=<hmac>`, le SDK exige le
 *   corps BRUT (pas `parseRequestBody` qui re-sérialise). Lire le corps
 *   via `parseRequestBody` casserait la vérification (ordre des clés,
 *   espaces).
 * PIEGE : pas de `rateLimitGuard` ici, volontairement : limiter par IP
 *   bloquerait les retries FedaPay si leurs IPs partagent un bucket
 *   (cf. `TRUST_PROXY`). L'anti-flood est la signature + l'idempotence.
 * PIEGE : le CSRF du pipeline ne rejette que si `Origin` est PRÉSENT et
 *   hors liste (webhook serveur-à-serveur sans Origin = accepté), et que
 *   si `Content-Type` est présent et non-JSON. FedaPay envoie
 *   `application/json` sans Origin : passe.
 * PIEGE : `io` peut être absent en test : la notification dépôt est
 *   best-effort elle aussi (l'argent est déjà crédité).
 *
 * Invariants détaillés : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { Webhook } from 'fedapay';
import { respondJson } from '../http-utils.mjs';
import { BODY_SIZE_LIMIT } from '../http-utils.mjs';
import {
  getUserById,
  listUserIds,
  tagWalletTransaction,
  forgetWithdrawalKey,
} from '../persistence.mjs';
import {
  verifyFedaPayTransactionAndCredit,
  retrieveFedaPayPayout,
  payoutSucceeded,
  payoutFailed,
} from '../payment-engine.mjs';
import {
  reconcilePendingWithdrawals,
  refundRejectedWithdrawal,
} from '../wallet-engine.mjs';
import { withWalletMutex } from '../mutex.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { formatZcForNotification } from '../utils.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('webhook-routes');

/**
 * Lit le corps BRUT (Buffer) pour la vérification de signature.
 * Même plafond que `parseRequestBody` (1 Mo), même destruction du
 * socket au-delà — sinon un seul client sature la mémoire.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
const readRawBody = async (req) => {
  const chunks = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > BODY_SIZE_LIMIT) {
      req.destroy?.();
      throw Object.assign(new Error('Payload trop volumineux (max 1MB).'), { code: 'PAYLOAD_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/** Extrait l'entité (transaction ou payout) d'un événement vérifié.
 *  `event.entity` peut être une chaîne ('transaction') — le vrai objet est
 *  alors `event.object` (Event SDK). On ne prend que des objets. */
export const extractWebhookEntity = (event) => {
  if (!event || typeof event !== 'object') return {};
  const candidats = [
    event.object,
    event.entity,
    event.data?.entity,
    event.data,
    event,
  ];
  for (const candidat of candidats) {
    if (candidat && typeof candidat === 'object') return candidat;
  }
  return {};
};

/** Nom canonique de l'événement (FedaPay : `transaction.approved`...). */
export const extractWebhookEventName = (event) => {
  const raw = event?.name || event?.type || event?.event || '';
  return String(raw || '').trim().toLowerCase();
};

/**
 * Résout le bénéficiaire d'un dépôt sans session.
 * 1. Description `ZOYD:<userId>` gravée par le widget (source de vérité).
 * 2. À défaut, email du client FedaPay (unicité email, pas de collision
 *    téléphonique — cf. `isTransactionOwnedBy`).
 * @param {object} transaction - entité relue chez FedaPay
 * @returns {object|null}
 */
export const resolveDepositUserFromTransaction = (transaction) => {
  const description = String(transaction?.description || '');
  const m = /ZOYD:([A-Za-z0-9-]+)/.exec(description);
  if (m) {
    const byId = getUserById(m[1]);
    if (byId) return byId;
  }
  const customer = transaction?.customer || {};
  const txEmail = String(customer.email || transaction?.email || '').trim().toLowerCase();
  if (txEmail) {
    for (const userId of listUserIds()) {
      const candidate = getUserById(userId);
      if (candidate && String(candidate.email || '').trim().toLowerCase() === txEmail) {
        return candidate;
      }
    }
  }
  return null;
};

/**
 * Rejoue la réconciliation des retraits douteux (même câblage que le
 * cron `sweepPendingWithdrawals`). Injecté en paramètres pour être
 * testable sans réseau.
 */
export const reconcileWithdrawalsForWebhook = async (deps = {}) => {
  const {
    succeeded = payoutSucceeded,
    failed = payoutFailed,
    retrieve = retrieveFedaPayPayout,
    listIds = listUserIds,
    getWallet = (userId) => getUserById(userId)?.wallet,
    tagTx = (userId, txId, patch) => tagWalletTransaction(userId, txId, patch),
    refund = (userId, amount, extra) => refundRejectedWithdrawal(
      userId,
      amount,
      extra?.idempotencyKey
        ? `refund:${extra.idempotencyKey}`
        : (extra?.payoutId != null ? `refund:payout:${extra.payoutId}` : null),
      {
        description: 'Remboursement - retrait rejete par le prestataire',
        metadata: { reason: 'PAYOUT_REJECTED', payoutId: extra?.payoutId ?? null },
      },
    ),
    forgetKey = (userId, key) => forgetWithdrawalKey(userId, key),
    warn = (message, detail) => log.warn(message, detail),
  } = deps;
  return reconcilePendingWithdrawals(
    succeeded, failed, retrieve,
    () => listIds(), getWallet, tagTx, refund, forgetKey, warn,
  );
};

/** Erreurs transitoires : un retry FedaPay peut les résorber. */
const isTransientError = (error) => ['SERVER_BUSY', 'FEDAPAY_API_ERROR', 'PAYOUT_LOOKUP_FAILED']
  .includes(error?.code);

/**
 * Traite un événement déjà vérifié. Extrait pour test sans HTTP.
 * @param {object} event - événement vérifié par `Webhook.constructEvent`
 * @param {object} ctx
 * @param {import('socket.io').Server} [ctx.io]
 * @param {object} [ctx.deps] - injections réseau (tests)
 * @returns {Promise<{received: true, action: string}>}
 */
export const handleVerifiedWebhookEvent = async (event, ctx = {}) => {
  const { io, deps = {} } = ctx;
  const name = extractWebhookEventName(event);
  const entity = extractWebhookEntity(event);
  const transactionId = entity?.id != null ? String(entity.id) : (event?.object_id != null ? String(event.object_id) : '');
  const status = String(entity?.status || '').toLowerCase();

  // Dépôt : transaction approuvée (ou statut approuvé même si le nom varie).
  const isDeposit = name.includes('transaction')
    || String(entity?.description || '').startsWith('ZOYD:');
  if (isDeposit) {
    if (!/^\d{1,20}$/.test(transactionId)) {
      log.warn('Webhook depot sans transactionId exploitable', { name });
      return { received: true, action: 'ignored_no_tx_id' };
    }
    const approved = name.includes('approved') || status === 'approved';
    if (!approved) {
      // created/canceled/failed : rien à créditer. On accuse pour arrêter
      // les retries, le cron de réconciliation n'a pas de dépôt à y voir.
      return { received: true, action: name.includes('canceled') || name.includes('failed') ? 'ignored_not_approved' : 'ignored_pending' };
    }
    const depositUser = resolveDepositUserFromTransaction(entity);
    if (!depositUser) {
      log.error('Webhook depot : beneficiaire introuvable', { transactionId });
      return { received: true, action: 'ignored_unknown_user' };
    }
    try {
      const outcome = await withWalletMutex(depositUser.id, async () =>
        (deps.verifyCredit || verifyFedaPayTransactionAndCredit)(transactionId, depositUser),
      );
      if (io && outcome?.amountZC != null) {
        await deliverNotification(io, depositUser.id, {
          title: 'Depot credite',
          body: `${formatZcForNotification(outcome.amountZC)} ajoutes a ton portefeuille via FedaPay.`,
          url: '/wallet',
          tag: `deposit-${transactionId}`,
          type: 'wallet_update',
          requireInteraction: false,
        }).catch((notifyError) => {
          log.error('Deposit notification failed (webhook)', {
            userId: depositUser.id, transactionId, error: notifyError.message,
          });
        });
      }
      return { received: true, action: 'deposit_credited', amountZC: outcome?.amountZC ?? null };
    } catch (error) {
      if (error?.code === 'TRANSACTION_ALREADY_PROCESSED') {
        return { received: true, action: 'already_processed' };
      }
      if (error?.code === 'TRANSACTION_NOT_OWNED' || error?.code === 'TRANSACTION_NOT_APPROVED'
        || error?.code === 'INVALID_AMOUNT' || error?.code === 'PAYMENT_NOT_CONFIGURED') {
        log.warn('Webhook depot ignore (etat definitif)', {
          transactionId, code: error.code,
        });
        return { received: true, action: 'ignored_definitif' };
      }
      if (isTransientError(error)) throw error;
      throw error;
    }
  }

  // Payout : tout événement retrait déclenche la réconciliation ciblée
  // (relecture chez FedaPay, jamais la parole du webhook).
  const merchantRef = String(entity?.merchant_reference || entity?.reference || '');
  const isPayout = name.includes('payout') || merchantRef.startsWith('ZOYD-WITHDRAW');
  if (isPayout) {
    const result = await reconcileWithdrawalsForWebhook(deps);
    return { received: true, action: 'payout_reconciled', result };
  }

  log.warn('Webhook événement ignoré (type inconnu)', { name });
  return { received: true, action: 'ignored_unknown_type' };
};

export const handleWebhookRoutes = async ({ req, res, pathname, io }) => {
  if (req.method !== 'POST' || pathname !== '/api/webhooks/fedapay') return false;

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    respondJson(res, 400, { ok: false, error: 'Corps de requête invalide.', code: 'INVALID_JSON' }, req);
    return true;
  }
  if (!rawBody || rawBody.length === 0) {
    respondJson(res, 400, { ok: false, error: 'Corps vide.', code: 'INVALID_JSON' }, req);
    return true;
  }

  const secret = process.env.FEDAPAY_WEBHOOK_SECRET;
  if (!secret) {
    log.error('Webhook FedaPay sans secret configure — refuse (fail-closed)');
    respondJson(res, 503, { ok: false, error: 'Webhook non configure.', code: 'WEBHOOK_NOT_CONFIGURED' }, req);
    return true;
  }
  const sig = req.headers['x-fedapay-signature'] || '';
  if (!sig) {
    respondJson(res, 401, { ok: false, error: 'Signature absente.', code: 'WEBHOOK_SIGNATURE_INVALID' }, req);
    return true;
  }

  let event;
  try {
    event = Webhook.constructEvent(rawBody, sig, secret);
  } catch (error) {
    const isSignature = /signature/i.test(String(error?.message || '')) || error?.name?.includes('Signature');
    log.warn('Webhook signature invalide', { error: error?.message });
    respondJson(res, isSignature ? 401 : 400, {
      ok: false,
      error: 'Signature webhook invalide.',
      code: isSignature ? 'WEBHOOK_SIGNATURE_INVALID' : 'INVALID_JSON',
    }, req);
    return true;
  }

  try {
    const outcome = await handleVerifiedWebhookEvent(event, { io });
    respondJson(res, 200, { received: true, action: outcome.action }, req);
    return true;
  } catch (error) {
    if (isTransientError(error)) {
      log.error('Webhook FedaPay transitoire (retry)', { error: error?.message, code: error?.code });
      respondJson(res, 503, { ok: false, error: 'Traitement transitoire, reessaye.', code: error.code || 'SERVER_BUSY' }, req);
      return true;
    }
    log.error('Webhook FedaPay erreur', { error: error?.message, code: error?.code });
    respondJson(res, 500, { ok: false, error: 'Erreur serveur inattendue.', code: 'INTERNAL_ERROR' }, req);
    return true;
  }
};
