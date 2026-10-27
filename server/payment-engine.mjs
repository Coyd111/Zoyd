/**
 * server/payment-engine.mjs - Integration FedaPay : verification et credit
 * d'un depot, creation d'un payout Mobile Money, relecture d'un payout.
 *
 * Seul module du serveur qui parle au prestataire de paiement.
 *
 * INVARIANT : la transaction est RELUE chez FedaPay (jamais le corps de la
 *   requete) et doit etre `approved` avant tout credit.
 * INVARIANT : la propriete est prouvee par la description `ZOYD:<userId>`
 *   gravee a la creation du paiement, ou a defaut par l'email. Le telephone
 *   n'est PAS une preuve : les 8 derniers chiffres coincident entre pays.
 * INVARIANT : la reservation (`claimTransaction`) est prise AVANT le credit
 *   et relachee si le credit echoue, pour que le joueur puisse reessayer.
 * INVARIANT : un meme identifiant de transaction ne peut etre credit qu'une
 *   fois (`hasTransactionBeenProcessed` + verrou en memoire).
 * INVARIANT : 1 ZC = 10 FCFA, et la devise doit etre XOF quand l'information
 *   est presente.
 * INVARIANT : le payout est plafonne a 1 000 000 FCFA, et le pays comme
 *   l'operateur doivent figurer dans `PAYOUT_COUNTRY_CONFIG`.
 * PIEGE : un echec survenu APRES la creation du payout peut signifier que
 *   l'argent EST PARTI : `payoutMaybeSent` et `payoutId` sont alors portes
 *   par l'erreur, et l'appelant NE DOIT PAS rembourser dans ce cas.
 * PIEGE : le 403 de FedaPay est un refus d'AUTORISATION du compte marchand,
 *   pas une requete malformee : le message doit le dire.
 * PIEGE : `TRANSACTION_ALREADY_PROCESSED`, `TRANSACTION_IN_PROGRESS` et
 *   `TRANSACTION_NOT_OWNED` sont relances tels quels : les masquer en
 *   `FEDAPAY_API_ERROR` ferait croire a un echec definitif.
 * PIEGE : le SDK cache la vraie raison du refus : passer par
 *   `extraireErreurFedaPay` pour la journaliser, sinon le log ne dit que
 *   "403".
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { FedaPay, Transaction, Payout } from 'fedapay';
import { depositToWallet, debitFromWallet, refundLockedEntry } from './wallet-engine.mjs';
import { hasTransactionBeenProcessed, claimTransaction, releaseTransaction, makeError } from './persistence.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('payment');

const getFedaPayConfig = () => {
  const key = process.env.FEDAPAY_SECRET_KEY;
  if (key && !FedaPay.apiKey) {
    FedaPay.setApiKey(key);
    FedaPay.setEnvironment(key.includes('sandbox') ? 'sandbox' : 'live');
  }
  return key;
};

/**
 * Vérifie que la transaction FedaPay appartient au demandeur.
 *
 * Source de vérité unique : la description `ZOYD:<userId>` gravée par notre
 * widget au moment du paiement.
 *
 * ⚠️ Le téléphone n'est PLUS utilisé comme preuve : l'unicité d'inscription
 * porte sur la chaîne complète alors qu'une comparaison sur les 8 derniers
 * chiffres collide entre pays (+229 97… vs +225 97…) — un attaquant pouvait
 * s'inscrire avec un numéro cousin et réclamer le dépôt d'un autre.
 * L'email reste accepté : il n'est pas devinable par collision.
 */
const normalizePhoneLoose = (value) => String(value || '').replace(/\D/g, '').slice(-8);

export const isTransactionOwnedBy = (transaction, user) => {
  if (!transaction || !user) return false;
  const description = String(transaction.description || '');
  const match = /ZOYD:([A-Za-z0-9-]+)/.exec(description);
  if (match && match[1] === user.id) return true;
  const customer = transaction.customer || {};
  const txEmail = String(customer.email || transaction.email || '').trim().toLowerCase();
  const userEmail = String(user.email || '').trim().toLowerCase();
  return Boolean(txEmail && userEmail && txEmail === userEmail);
};

// Atomic lock per transaction ID — Map<id, Promise> for true TOCTOU safety
const processingTransactions = new Map();

// SEC-R4: Safety cleanup — if server crashed mid-transaction, the finally block
// may not have run. Clean stale entries every 5 minutes (>10min old).
const PROCESSING_TX_MAX_AGE_MS = 10 * 60 * 1000;
const processingTxTimestamps = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [txId, ts] of processingTxTimestamps) {
    if (now - ts > PROCESSING_TX_MAX_AGE_MS) {
      processingTransactions.delete(txId);
      processingTxTimestamps.delete(txId);
    }
  }
}, 5 * 60 * 1000);

export const verifyFedaPayTransactionAndCredit = async (transactionId, user) => {
  const FEDAPAY_SECRET_KEY = getFedaPayConfig();
  if (!FEDAPAY_SECRET_KEY) {
    throw makeError('PAYMENT_NOT_CONFIGURED', "FedaPay n'est pas configuré sur le serveur.");
  }

  // Vérification d'idempotence en BDD (résiste aux redémarrages serveur)
  if (await hasTransactionBeenProcessed(transactionId)) {
    throw makeError('TRANSACTION_ALREADY_PROCESSED', 'Cette transaction a déjà été traitée.');
  }

  // Atomic lock: reject if already processing, otherwise set immediately
  if (processingTransactions.has(transactionId)) {
    throw makeError('TRANSACTION_IN_PROGRESS', 'Cette transaction est en cours de traitement.');
  }
  processingTransactions.set(transactionId, Promise.resolve());
  processingTxTimestamps.set(transactionId, Date.now());

  try {
    // 1. Récupérer la transaction directement depuis FedaPay (évite la falsification côté frontend)
    const transaction = await Transaction.retrieve(transactionId);

    // 2. Vérifier que le paiement est bien approuvé
    if (transaction.status !== 'approved') {
      throw makeError('TRANSACTION_NOT_APPROVED', `La transaction n'est pas approuvée (Statut: ${transaction.status})`);
    }

    // 2b. Anti-vol : la transaction doit appartenir au demandeur.
    // Le widget ZOYD grave `ZOYD:<userId>` dans la description. Sans ça,
    // n'importe qui pourrait créditer son wallet avec un transactionId volé/deviné.
    if (!isTransactionOwnedBy(transaction, user)) {
      log.error('deposit ownership mismatch', { transactionId, userId: user.id });
      throw makeError('TRANSACTION_NOT_OWNED', "Cette transaction ne correspond pas à ton compte.");
    }

    // 2c. Devise : XOF attendu quand l'info est présente.
    const currency = typeof transaction.currency === 'string'
      ? transaction.currency
      : transaction.currency?.iso;
    if (currency && String(currency).toUpperCase() !== 'XOF') {
      throw makeError('INVALID_AMOUNT', 'Devise de transaction inattendue.');
    }

    // 3. Calculer les Zoyd Coins (1 ZC = 10 FCFA) + validation
    const amountZC = transaction.amount / 10;
    if (!Number.isFinite(amountZC) || amountZC <= 0) {
      throw makeError('INVALID_AMOUNT', 'Montant de transaction FedaPay invalide.');
    }

    // 4. Réserver atomiquement AVANT tout crédit — si un autre process passe entre-temps, claimTransaction renvoie false
    const claimed = await claimTransaction(transactionId, user.id, amountZC);
    if (!claimed) {
      throw makeError('TRANSACTION_ALREADY_PROCESSED', 'Cette transaction a déjà été traitée.');
    }

    // 5. Créditer le portefeuille (le reservation est déjà garantie)
    // En cas d'échec, libérer le claim pour permettre un retry (sinon fonds perdus)
    let updatedUser;
    try {
      updatedUser = await depositToWallet(
        user.id,
        amountZC,
        'FedaPay'
      );
    } catch (creditError) {
      await releaseTransaction(transactionId);
      throw creditError;
    }

    return {
      success: true,
      amountZC,
      user: updatedUser
    };
  } catch (error) {
    log.error('FedaPay verification error', { message: error.message });
    // SERVER_BUSY doit remonter tel quel : c'est la Base indisponible, le
    // claim a été relâché et le joueur peut réessayer. Masqué en
    // FEDAPAY_API_ERROR, le message poussait à croire à un échec définitif
    // alors que rien n'a été débité.
    if (error.code === 'SERVER_BUSY') throw error;
    if (error.code === 'TRANSACTION_ALREADY_PROCESSED' || error.code === 'TRANSACTION_IN_PROGRESS' || error.code === 'TRANSACTION_NOT_OWNED') throw error;
    if (error.message.includes('UNIQUE')) {
      throw makeError('TRANSACTION_ALREADY_PROCESSED', 'Cette transaction a déjà été traitée.');
    }
    throw makeError('FEDAPAY_API_ERROR', 'Erreur lors de la vérification de la transaction FedaPay.');
  } finally {
    processingTransactions.delete(transactionId);
    processingTxTimestamps.delete(transactionId);
  }
};

// Les regles pays et de format de telephone vivent dans `payout-countries.mjs`
// (module feuille, sans import) : `persistence.mjs` doit pouvoir les utiliser
// pour valider un numero a l'inscription, et il ne peut pas importer
// `payment-engine.mjs` sans creer un cycle — payment-engine importe persistence.
export {
  PAYOUT_COUNTRY_CONFIG,
  normalizePayoutCountry,
  parsePhoneForFedaPay,
  isAnySupportedPhone,
  phoneFormatError,
} from './payout-countries.mjs';
import { PAYOUT_COUNTRY_CONFIG, parsePhoneForFedaPay, normalizePayoutCountry } from './payout-countries.mjs';
export const maskPhone = (number) => {
  const digits = `${number || ''}`;
  if (digits.length <= 2) return '**';
  return '*'.repeat(digits.length - 2) + digits.slice(-2);
};

/**
 * Extrait la VRAIE raison d'un refus FedaPay.
 *
 * Le SDK stocke l'explication du prestataire à part du message axios :
 *   - `error.errorMessage` ← `data.message` de la réponse
 *   - `error.errors`        ← détail par champ
 *   - `error.httpResponse.data` ← corps brut, si les deux premiers manquent
 *
 * Lire `error.message` seul donnait « Request failed with status code: 403 »
 * — c'est-à-dire RIEN. Le motif réel (paiements non activés sur le compte,
 * numéro refusé, solde insuffisant) était dans la réponse et partait à la
 * poubelle. Sans cela, ni le joueur ni le support ne pouvait dire quoi que ce
 * soit, et le retrait échouait sans explication.
 *
 * @param {unknown} error
 * @returns {{ status: number|null, raison: string, details: string[] }}
 */
export const extraireErreurFedaPay = (error) => {
  const status = error?.httpStatus ?? error?.response?.status ?? null;
  const body = error?.httpResponse?.data ?? error?.response?.data ?? null;

  const raison = [
    error?.errorMessage,
    body?.message,
    body?.error,
    typeof body === 'string' ? body : null,
  ].find((value) => typeof value === 'string' && value.trim())
    ?.trim() || '';

  const rawErrors = error?.errors ?? body?.errors;
  const details = Array.isArray(rawErrors)
    ? rawErrors.map((item) => (typeof item === 'string' ? item : item?.message || item?.field)).filter(Boolean)
    : [];

  return { status, raison, details };
};

/**
 * Message actionnable pour le joueur et le support.
 *
 * Un 403 n'est PAS dans la liste d'erreurs documentee par FedaPay (400 / 401 /
 * 404 / 500) : c'est un refus d'AUTORISATION, pas une requête malformée. Avec
 * un dépôt qui fonctionne, la clé est donc valide et valide pour l'encaissement
 * — c'est le COMPTE MARCHAND qui n'est pas autorisé à émettre des transferts.
 * Cela se règle auprès de FedaPay, pas dans le code.
 */
const messagePayout = ({ status, raison, details }, step) => {
  // L'étape change le diagnostic : un refus à la création parle du compte,
  // un refus à l'envoi parle du bénéficiaire. Les nommer évite de faire
  // diagnostiquer la mauvaise chose.
  const ou = step === 'envoi' ? " à l'envoi du transfert" : ' à la création du transfert';
  if (status === 403) {
    return `FedaPay refuse le transfert (403)${ou} : ton compte marchand n'est pas autorisé à émettre des retraits. À activer auprès de FedaPay — les dépôts, eux, fonctionnent.${raison ? ` (${raison})` : ''}`;
  }
  if (status === 401) {
    return `Clé FedaPay refusée (401) : la clé secrète utilisée pour les retraits est invalide ou absente de l'environnement.${raison ? ` (${raison})` : ''}`;
  }
  if (status === 429) {
    return 'FedaPay limite le nombre de transferts (429). Réessaie dans quelques minutes.';
  }
  const detail = details.length ? ` — ${details.slice(0, 3).join(', ')}` : '';
  return `Échec du transfert Mobile Money (${step})${raison ? ` : ${raison}` : ''}${detail}`;
};

/**
 * Initiate a FedaPay payout (Mobile Money transfer to user).
 * Creates the payout and sends it immediately.
 *
 * @param {Object} params
 * @param {number} params.amountZC - Amount in Zoyd Coins
 * @param {string} params.method - Operator name (selon pays, voir PAYOUT_COUNTRY_CONFIG)
 * @param {string} [params.country] - Pays payout : iso ('bj') ou nom FR ('Benin'). Défaut 'bj'.
 * @param {string} params.phone - User's phone number
 * @param {string} params.userPseudo - User's display name
 * @param {string} [params.userEmail] - User's email
 * @param {string} [params.merchantReference] - Unique reference for idempotency
 * @returns {Promise<{ success: boolean, payoutId?: number, status?: string, amountFCFA?: number }>}
 */
export const initiateFedaPayPayout = async ({ amountZC, method, country, phone, userPseudo, userEmail, merchantReference }) => {
  const FEDAPAY_SECRET_KEY = getFedaPayConfig();
  if (!FEDAPAY_SECRET_KEY) {
    throw makeError('PAYMENT_NOT_CONFIGURED', "FedaPay n'est pas configuré pour les retraits.");
  }

  const countryIso = country ? normalizePayoutCountry(country) : 'bj';
  const cfg = countryIso ? PAYOUT_COUNTRY_CONFIG[countryIso] : undefined;
  if (!countryIso || !cfg) {
    throw makeError('INVALID_COUNTRY', 'Retraits bientôt disponibles pour ton pays.');
  }
  const mode = cfg.operators[method];
  if (!mode) {
    throw makeError('INVALID_OPERATOR', `Opérateur non supporté (${cfg.label}) : ${Object.keys(cfg.operators).join(', ')}.`);
  }

  const amountFCFA = Math.round(amountZC * 10);
  if (amountFCFA <= 0 || amountFCFA > 1_000_000) {
    throw makeError('INVALID_AMOUNT', 'Montant invalide pour le retrait (max 1 000 000 FCFA).');
  }

  const phoneInfo = parsePhoneForFedaPay(phone, countryIso);
  if (!phoneInfo.number) {
    throw makeError('INVALID_PHONE', `Numéro de téléphone invalide (format ${cfg.label} : +${cfg.prefix}...).`);
  }

  const names = (userPseudo || 'Joueur').split(/\s+/);
  const firstname = names[0] || 'Joueur';
  const lastname = names.slice(1).join(' ') || 'ZOYD';

  log.info('Initiating FedaPay payout', { amountFCFA, method, mode, country: countryIso, phone: maskPhone(phoneInfo.number), merchantReference });

  // On distingue l'étape : un 403 sur `create` et un 403 sur `start` ne
  // désignent pas la même chose (autorisation du compte vs. refus du
  // bénéficiaire), et le payoutId permet de retrouver la trace côté FedaPay.
  let step = 'création';
  let createdPayoutId = null;
  try {
    // 1. Create the payout
    const payout = await Payout.create({
      amount: amountFCFA,
      currency: { iso: 'XOF' },
      mode,
      description: `Retrait ZOYD ${amountZC} ZC`,
      merchant_reference: merchantReference || `ZOYD-WITHDRAW-${Date.now()}`,
      customer: {
        firstname,
        lastname,
        email: userEmail || 'joueur@zoyd.app',
        phone_number: phoneInfo,
      },
    });
    createdPayoutId = payout?.id ?? null;

    // 2. Send immediately
    step = 'envoi';
    await payout.sendNow({
      phone_number: phoneInfo,
    });

    log.info('FedaPay payout sent', { payoutId: payout.id, status: payout.status, amountFCFA });

    return {
      success: true,
      payoutId: payout.id,
      status: payout.status,
      amountFCFA,
    };
} catch (error) {
    const diagnostic = extraireErreurFedaPay(error);
    log.error('FedaPay payout failed', {
      step,
      status: diagnostic.status,
      // La raison du prestataire : sans elle, le log ne disait que « 403 ».
      raison: diagnostic.raison || undefined,
      details: diagnostic.details.length ? diagnostic.details : undefined,
      payoutId: createdPayoutId,
      amountFCFA,
      method,
      mode,
      country: countryIso,
      phone: maskPhone(phoneInfo.number),
      raw: error?.message,
    });
    // `createdPayoutId` est REMONTE dans l'erreur.
      //
      // `sendNow` peut avoir ete traite par FedaPay alors que la reponse se
      // perd (timeout, 502, coupure reseau). Dans ce cas l'argent EST parti,
      // mais l'appelant ne le savait pas : il remboursait le joueur, et celui-ci
      // recevait a la fois son remboursement et son virement.
      //
      // Avec l'identifiant, l'appelant peut conclure « payout peut-etre parti »
      // et NE PAS rembourser automatiquement — il marque le retrait a
      // reconcilier. C'est la difference entre un remboursement excessif et une
      // reconciliation ulterieure.
      throw makeError('PAYOUT_FAILED', messagePayout(diagnostic, step), {
        payoutId: createdPayoutId || null,
        payoutMaybeSent: Boolean(createdPayoutId),
      });
  }
};

/**
 * Relit un payout chez FedaPay.
 *
 * SANS CECI, un payout envoye puis rejete plus tard par FedaPay laisse le joueur
 * debite A JAMAIS : le statut est ecrit a l envoi (en pratique `pending`), et
 * rien ne le relait ensuite. Aucun webhook, aucun `Payout.retrieve`, aucun sweep
 * cron sur les retraits.
 *
 * @param {number} payoutId
 * @returns {Promise<{payoutId: number, status: string, raw: object|null}>}
 */
export const retrieveFedaPayPayout = async (payoutId) => {
  const FEDAPAY_SECRET_KEY = getFedaPayConfig();
  if (!FEDAPAY_SECRET_KEY) {
    throw makeError('PAYMENT_NOT_CONFIGURED', "FedaPay n'est pas configure pour les retraits.");
  }
  const id = Number(payoutId);
  if (!Number.isInteger(id) || id <= 0) {
    throw makeError('INVALID_PAYOUT_ID', 'Identifiant de retrait invalide.');
  }
  try {
    const payout = await Payout.retrieve(id);
    return {
      payoutId: id,
      status: String(payout?.status || 'unknown'),
      raw: payout || null,
    };
  } catch (error) {
    throw makeError('PAYOUT_LOOKUP_FAILED', `Lecture du retrait ${id} impossible.`, {
      payoutId: id,
    });
  }
};

/**
 * L'argent a-t-il atteint le joueur ?
 *
 * Cycle de vie OFFICIEL FedaPay (docs "Gestion des depots") :
 * `pending -> started -> processing -> sent -> failed`. Le statut final de
 * SUCCES est `sent` : un payout verse restait 'en attente' pour toujours
 * si le predicat l'ignore — la file de reconciliation grossissait a vie et
 * l'etat du joueur etait faux (audit-3 P4 C1). Les autres vocabulaires
 * couvrent les libelles historiques et la variante `transferred`.
 */
export const payoutSucceeded = (status) => {
  const n = String(status || '').toLowerCase();
  return ['success', 'successful', 'completed', 'paid', 'done', 'sent', 'transferred'].includes(n);
};

/**
 * Echec DEFINITIF : le prestataire a refuse, aucune reconciliation ne
 * changera rien. `failed` est le statut final FedaPay ; `refused` et
 * `declined` couvrent les refus restitues par les operateurs Mobile Money.
 */
export const payoutFailed = (status) => {
  const n = String(status || '').toLowerCase();
  return ['failed', 'failure', 'error', 'rejected', 'refused', 'declined', 'cancelled', 'canceled'].includes(n);
};
