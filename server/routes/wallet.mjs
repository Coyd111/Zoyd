import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  paginate,
  parseQueryParams,
  parseRequestBody,
  readBearerToken,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import {
  findUsersByPseudo,
  forgetWithdrawalKey,
  getAuthSession,
  getPublicStats,
  getStateCollection,
  getUserById,
  hasActiveWithdrawalKey,
  tagWalletTransaction,
  trackWithdrawalKey,
} from '../persistence.mjs';
import {
  MIN_WITHDRAWAL_ZC,
  WITHDRAWAL_FEE_RATE,
  MAX_WITHDRAWAL_DAILY_ZC,
  getWindowedWithdrawalTotal,
  buildWithdrawalAmounts,
  calcWithdrawNet,
  depositToWallet,
  getServerWallet,
  withdrawFromWallet,
} from '../wallet-engine.mjs';
import { requireAdmin2fa } from '../admin-totp.mjs';
import { withWalletMutex } from '../mutex.mjs';
import {
  PAYOUT_COUNTRY_CONFIG,
  initiateFedaPayPayout,
  normalizePayoutCountry,
  parsePhoneForFedaPay,
  verifyFedaPayTransactionAndCredit,
} from '../payment-engine.mjs';
import { getPublicMatchesForUser } from '../match-engine.mjs';
import {
  getStoredTournaments,
  sanitizeMatchForBroadcast,
  sanitizeTournamentForBroadcast,
} from '../state-helpers.mjs';
import { buildMatchActionPayload, saveMatches } from '../state-helpers.mjs';
import { formatZcForNotification, roundAmount } from '../utils.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('wallet-routes');

export const handleWalletRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/wallet/history') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  try {
    const wallet = getServerWallet(session.user.id);
    const { limit, offset } = parseQueryParams(req.url);
    const all = wallet.transactions || [];
    const { items: transactions, hasMore } = paginate(all, { limit: Math.min(limit, 200), offset });
    respondJson(res, 200, { ok: true, transactions, hasMore });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/wallet/me') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const user = getUserById(session.user.id);
    const wallet = user?.wallet || getServerWallet(session.user.id);
    respondJson(res, 200, {
      ok: true,
      wallet,
      user,
      // Politique de retrait publiee par le serveur : le front ne doit plus
      // coder `0.02` en dur (il l'avait en dur a deux endroits, et la
      // notification « X net » etait recalculee localement).
      withdrawal: {
        feeRate: WITHDRAWAL_FEE_RATE,
        minAmount: MIN_WITHDRAWAL_ZC,
        // Publie pour que le front affiche la regle au lieu de decouvrir le refus.
        dailyLimit: MAX_WITHDRAWAL_DAILY_ZC,
        dailyWindowHours: 24,
        remainingToday: getWindowedWithdrawalTotal(wallet),
      },
    });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du wallet.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/wallet/deposit') {
  // Deposit endpoint admin-only (deposits go through /api/wallet/verify-fedapay in production).
  // requireAdmin2fa repond LUI-MEME (401/403 + code) : ne pas re-repondre
  // derriere, sinon double ecriture d'en-tetes, avalee en ERR_HTTP_HEADERS_SENT.
  const adminSession = requireAdmin2fa(req, res);
  if (!adminSession) { return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'wallet')) { return true; }
  let body;
  try {
    body = await parseRequestBody(req);
  } catch {
    respondJson(res, 400, { ok: false, error: 'Corps de requete invalide.', code: 'INVALID_JSON' });
    return true;
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 5_000_000) {
    respondJson(res, 400, { ok: false, error: 'Montant invalide (max 5 000 000 ZC).', code: 'INVALID_AMOUNT' });
    return true;
  }
  if (!body.userId) {
    respondJson(res, 400, { ok: false, error: 'userId requis.', code: 'INVALID_JSON' });
    return true;
  }

  try { await withWalletMutex(body.userId, async () => {
    const wallet = await depositToWallet(body.userId, body.amount, body.method || 'admin-credit');
    const user = getUserById(body.userId);
    respondJson(res, 200, { ok: true, wallet, user });
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/wallet/withdraw') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'wallet')) { return true; }
  let body;
  try {
    body = await parseRequestBody(req);
  } catch {
    respondJson(res, 400, { ok: false, error: 'Corps de requete invalide.', code: 'INVALID_JSON' });
    return true;
  }
  // Montants en ZC : 150 min, 100 000 ZC max (= 1 000 000 FCFA, plafond payout FedaPay)
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < MIN_WITHDRAWAL_ZC || body.amount > 100_000) {
    respondJson(res, 400, { ok: false, error: `Montant invalide (${MIN_WITHDRAWAL_ZC} a 100 000 ZC).`, code: 'INVALID_AMOUNT' });
    return true;
  }
  // Pays payout : requête explicite, sinon profil, sinon Bénin (legacy).
  // Un pays explicite mais non supporté → INVALID_COUNTRY (pas de fallback silencieux).
  const rawCountry = typeof body.country === 'string' && body.country ? body.country : session.user.country;
  const countryIso = rawCountry ? normalizePayoutCountry(rawCountry) : 'bj';
  const countryCfg = PAYOUT_COUNTRY_CONFIG[countryIso];
  if (!countryCfg) {
    respondJson(res, 400, { ok: false, error: 'Retraits bientôt disponibles pour ton pays.', code: 'INVALID_COUNTRY' });
    return true;
  }
  if (typeof body.method !== 'string' || !countryCfg.operators[body.method]) {
    respondJson(res, 400, { ok: false, error: `Opérateur invalide (${countryCfg.label}) : ${Object.keys(countryCfg.operators).join(', ')}.`, code: 'INVALID_OPERATOR' });
    return true;
  }
  const phoneInfo = parsePhoneForFedaPay(typeof body.phone === 'string' ? body.phone : '', countryIso);
  if (!phoneInfo.number) {
    respondJson(res, 400, { ok: false, error: `Numéro de téléphone invalide (format ${countryCfg.label} : +${countryCfg.prefix}...).`, code: 'INVALID_PHONE' });
    return true;
  }
  // Idempotence : OBLIGATOIRE. Sans clé, un double-clic ou un retry réseau
  // débitait deux fois et déclenchait deux payouts FedaPay.
  const rawKey = body.idempotencyKey || req.headers['x-idempotency-key'];
  const cleanKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : null;
  if (!cleanKey) {
    respondJson(res, 400, { ok: false, error: 'idempotencyKey requis pour un retrait.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    return true;
  }


  // 1. Débit sous mutex (court, aucun appel réseau) — fonds réservés atomiquement
  let debitedWallet = null;
  let withdrawTxId = null;
  let isDuplicate = false;
  // `return true` DANS le callback ne sort PAS de la requete : le mutex renvoie
  // la valeur du callback, mais la route l'ignore et l'execution se poursuit
  // apres le bloc.
  //
  // Consequence sur la branche 409 : ni `isDuplicate` ni `debitedWallet` n'etaient
  // positionnes, donc le code tombait ensuite sur `initiateFedaPayPayout` — un
  // SECOND vrai transfert Mobile Money, apres avoir repondu « contacte le
  // support ». Le joueur recevait a la fois la mise en garde et l'argent.
  //
  // C'est exactement l'etat vise par le garde : une premiere requete qui a
  // debite sans avoir repondu (crash entre le debit et le tag). Relire la meme
  // cle declenchait un second envoi.
  let abandonner = false;
  try {
await withWalletMutex(session.user.id, async () => {
      // Check idempotency INSIDE mutex to prevent TOCTOU race.
      // L'index dedie (`hasActiveWithdrawalKey`) ne depend PAS de
      // l'historique de transactions, plafonne a 200 entrees : au-dela, la
      // cle disparait de l'historique et un retry redébitait.
      //
      // Deux etats a distinguer :
      //   - payout CONFIRME  (un payoutId existe) -> doublon strict, on
      //     renvoie l'etat existant, aucun second transfert.
      //   - payout AMBIGU (debit fait, aucun payoutId, pas de tag 'failed')
      //     -> FedaPay a pu envoyer l'argent sans que la reponse arrive.
      //     Relancer automatiquement risquerait un DOUBLE PAIEMENT. On
      //     refuse donc : seule la moderation tranche apres verification.
      if (cleanKey) {
        const userRecord = getUserById(session.user.id);
        const priorTx = (userRecord?.wallet?.transactions || []).find(
          (tx) => tx?.metadata?.idempotencyKey === cleanKey && tx.type === 'withdraw',
        );
        if (hasActiveWithdrawalKey(session.user.id, cleanKey, userRecord?.wallet?.transactions)) {
          if (priorTx && !priorTx.metadata?.payoutId && priorTx.metadata?.payoutStatus !== 'failed') {
            respondJson(res, 409, {
              ok: false,
              error: 'Un retrait avec cette cle est deja engage et son transfert n\'est pas confirme. Contacte le support avant de reessayer.',
              code: 'PAYOUT_PENDING_REVIEW',
              idempotencyKey: cleanKey,
            }, req);
            // Marque l abandon : le `return true` ci-dessous ne quitte que le
            // callback du mutex, pas la requete.
            abandonner = true;
            return true;
          }
          debitedWallet = getServerWallet(session.user.id);
          isDuplicate = true;
          return true;
        }
      }
      debitedWallet = await withdrawFromWallet(
        session.user.id, body.amount, body.method, body.phone,
        cleanKey ? { idempotencyKey: cleanKey } : {},
      );
      withdrawTxId = debitedWallet?.transactions?.[0]?.id || null;
      if (cleanKey) trackWithdrawalKey(session.user.id, cleanKey);
    });
  } catch (error) {
    respondMappedError(res, error);
    return true;
  }
  // La reponse 409 a deja ete envoyee DANS le mutex. Sans cette sortie, le code
  // tombait sur `initiateFedaPayPayout` : second transfert apres avoir refuse.
  if (abandonner) return true;
  if (isDuplicate) {
    respondJson(res, 200, {
      ok: true,
      wallet: debitedWallet,
      user: getUserById(session.user.id),
      duplicate: true,
      // Meme montant que le premier appel : l'UI peut afficher le net sans
      // le recalculer, et un retry ne change pas le message.
      ...buildWithdrawalAmounts(body.amount),
    });
    return true;
  }

  // 2. Payout FedaPay HORS mutex (appel réseau, ne bloque plus le wallet) — montant net après 2%
  const { netAmount } = calcWithdrawNet(body.amount);
  let payoutResult;
  try {
    const currentUser = getUserById(session.user.id);
    payoutResult = await initiateFedaPayPayout({
      amountZC: netAmount,
      method: body.method,
      country: countryIso,
      phone: body.phone,
      userPseudo: currentUser?.pseudo || 'Joueur',
      userEmail: currentUser?.email,
      merchantReference: cleanKey || `ZOYD-WITHDRAW-${Date.now()}`,
    });
  } catch (payoutError) {
    // 3. Échec payout — remboursement SOUS condition.
    //
    // `sendNow` peut avoir ete traite par FedaPay alors que la reponse s'est
    // perdue (timeout, 502, coupure reseau). L'argent est alors REELLEMENT parti
    // alors que l'appel echoue. Rembourser dans ce cas donnait au joueur son
    // remboursement ET son virement : un gain net sur la plateforme.
    //
    // Le moteur remonte desormais `payoutMaybeSent`. On ne rembourse que si
    // l'echec est survenu AVANT toute creation de payout — donc sur une
    // certitude d'absence d'envoi.
    const payoutPeutEtreParti = payoutError?.payoutMaybeSent === true;
    if (payoutPeutEtreParti) {
      // Aucune restitution automatique. Le retrait est marque pour
      // reconciliation : l'identifiant du payout est conserve, ce qui rend la
      // verification possible aupres de FedaPay.
      log.error('Payout uncertain — pas de remboursement automatique, reconciliation requise', {
        userId: session.user.id,
        payoutId: payoutError?.payoutId || null,
        idempotencyKey: cleanKey,
      });
      if (withdrawTxId) {
        await tagWalletTransaction(session.user.id, withdrawTxId, {
          payoutId: payoutError?.payoutId || undefined,
          payoutStatus: 'pending_review',
          status: 'pending_review',
        }).catch((tagError) => {
          log.error('CRITICAL: retrait en attente de revue non marque', {
            userId: session.user.id, txId: withdrawTxId, error: tagError.message,
          });
        });
      }
      respondMappedError(res, payoutError);
      return true;
    }

    log.error('Payout failed, refunding wallet', { userId: session.user.id, error: payoutError.message });
    try {
      await withWalletMutex(session.user.id, async () => {
        // `type: 'refund'` et non `deposit` : dans l'historique, un
        // remboursement d'un retrait echoue doit se lire comme tel. Ecrit
        // comme un depot, il laissait croire a un versement que personne
        // n'avait effectue.
        await depositToWallet(session.user.id, body.amount, 'Remboursement', {
          type: 'refund',
          description: `Remboursement — retrait echoue (${body.amount} ZC rendus)`,
          metadata: { reason: 'PAYOUT_FAILED', idempotencyKey: cleanKey },
        });
      });
    } catch (refundError) {
      // Perte sèche : l'argent est parti sans que le remboursement passe.
      // On le laisse CRISSER dans les logs plutôt que de l'avaler.
      log.error('CRITICAL: Refund also failed — balance to reconcile manually', {
        userId: session.user.id,
        amount: body.amount,
        idempotencyKey: cleanKey,
        error: refundError.message,
      });
    }
if (withdrawTxId) {
        try {
          // `status: 'failed'` ETANT `payoutStatus` : le statut est ce que
          // l'historique affiche. Sans lui, un retrait refuse par FedaPay
          // restait « completed » avec une coche verte.
          await tagWalletTransaction(session.user.id, withdrawTxId, { payoutStatus: 'failed', status: 'failed' });
        } catch (tagError) {
          // Avant : `.catch(() => {})`. Avalé, le retrait restait NON marqué
          // 'failed', donc compté dans les commissions ZOYD alors que la
          // somme avait été remboursée.
          //
          // `forgetWithdrawalKey` n'est PLUS dans ce `try` : il ne s'atteignait
          // jamais si le tag échouait, et la clé restait brûlée en mémoire —
          // sans que le joueur puisse plus jamais retirer. Le remboursement,
          // lui, porte desormais la meme cle, ce que `hasActiveWithdrawalKey`
          // reconnait : le joueur n'est donc plus bloque meme si le tag a echoue.
          log.error('CRITICAL: payoutStatus not tagged — commission may be over-counted', {
            userId: session.user.id, txId: withdrawTxId, error: tagError.message,
          });
        } finally {
          // La cle est liberee DANS TOUS LES CAS : le joueur a ete rembourse,
          // un retry doit pouvoir relancer un vrai payout.
if (cleanKey) forgetWithdrawalKey(session.user.id, cleanKey);
          }
      }
      respondMappedError(res, payoutError);
    return true;
  }
  // 4. Tag payoutId persisté (memory + Supabase) — best effort, le débit reste valide même si le tag échoue
  if (withdrawTxId) {
    try {
      await tagWalletTransaction(session.user.id, withdrawTxId, { payoutId: payoutResult.payoutId, payoutStatus: payoutResult.status });
    } catch (tagError) {
      log.error('Failed to tag payout metadata', { userId: session.user.id, txId: withdrawTxId, error: tagError.message });
    }
  }
  respondJson(res, 200, {
    ok: true,
    wallet: getServerWallet(session.user.id),
    user: getUserById(session.user.id),
    payoutId: payoutResult.payoutId,
    // Montants autoritaires : le client ne doit plus refaire le calcul de la
    // commission, sinon le « net » affiche peut differer du verse.
    ...buildWithdrawalAmounts(body.amount),
  });
  return true;
}

if (req.method === 'POST' && pathname === '/api/wallet/verify-fedapay') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'wallet')) { return true; }

  try { await withWalletMutex(session.user.id, async () => {
    const body = await parseRequestBody(req);
    // FedaPay renvoie un id NUMÉRIQUE (ex: 23) : on accepte number et string.
    const transactionId = body.transactionId === undefined || body.transactionId === null
      ? ''
      : String(body.transactionId);
    if (!/^\d{1,20}$/.test(transactionId)) {
      respondJson(res, 400, { ok: false, error: 'transactionId invalide.', code: 'INVALID_TRANSACTION_ID' });
      return true;
    }

    const outcome = await verifyFedaPayTransactionAndCredit(transactionId, session.user);
    const wallet = getServerWallet(session.user.id);

    // Le crédit FedaPay ne montrait qu'un toast éphémère : rien dans le
    // centre de notifications. Un joueur qui recharge puis ferme l'onglet
    // n'avait aucune trace du dépôt, et le reçu n'était consultable qu'en
    // fouillant l'historique du portefeuille.
    // `requireInteraction: false` : un dépôt réussi ne doit pas exiger une
    // action du joueur, tout en restant dans le centre de notifications.
    await deliverNotification(io, session.user.id, {
      title: 'Depot credite',
      body: `${formatZcForNotification(outcome.amountZC)} ajoutes a ton portefeuille via FedaPay.`,
      url: '/wallet',
      tag: `deposit-${transactionId}`,
      type: 'wallet_update',
      requireInteraction: false,
    }).catch((notifyError) => {
      // Une notification ratée ne doit jamais faire échouer le crédit :
      // l'argent est déjà dans le portefeuille à ce stade.
      log.error('Deposit notification failed', { userId: session.user.id, error: notifyError.message });
    });

    respondJson(res, 200, { 
      ok: true, 
      amount: outcome.amountZC, 
      wallet,
      user: outcome.user
    });
  }); } catch (error) {
    // Préserve les codes métier (ALREADY_PROCESSED → 409, IN_PROGRESS → 409, etc.)
    // au lieu de tout écraser en 400 générique
    log.error('Payment verification failed', { message: error.message, code: error.code });
    if (error && typeof error.code === 'string' && error.code !== 'UNKNOWN_ERROR') {
      respondMappedError(res, error);
    } else {
      respondJson(res, 400, { ok: false, error: 'Verification du paiement echouee.', code: 'PAYMENT_FAILED' });
    }
  }
  return true;
}

  return false;
};
