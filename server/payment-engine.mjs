import { FedaPay, Transaction, Payout } from 'fedapay';
import { depositToWallet, debitFromWallet, refundLockedEntry } from './wallet-engine.mjs';
import { hasTransactionBeenProcessed, claimTransaction, releaseTransaction, makeError } from './persistence.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('payment');

class PaymentRollbackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentRollbackError';
  }
}

const getFedaPayConfig = () => {
  const key = process.env.FEDAPAY_SECRET_KEY;
  if (key && !FedaPay.apiKey) {
    FedaPay.setApiKey(key);
    FedaPay.setEnvironment(key.includes('sandbox') ? 'sandbox' : 'live');
  }
  return key;
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
    if (error instanceof PaymentRollbackError) throw error;
    if (error.code === 'TRANSACTION_ALREADY_PROCESSED' || error.code === 'TRANSACTION_IN_PROGRESS') throw error;
    if (error.message.includes('UNIQUE')) {
      throw makeError('TRANSACTION_ALREADY_PROCESSED', 'Cette transaction a déjà été traitée.');
    }
    throw makeError('FEDAPAY_API_ERROR', 'Erreur lors de la vérification de la transaction FedaPay.');
  } finally {
    processingTransactions.delete(transactionId);
    processingTxTimestamps.delete(transactionId);
  }
};

// ─── FedaPay Payout (Retrait Mobile Money) ───────────────────────────────────

const OPERATOR_MODE_MAP = {
  'MTN MoMo': 'mtn_open',
  'Moov Money': 'moov',
  'Celtiis': 'sbin',
};

/**
 * Mask a phone number for logs (keeps last 2 digits): "61000001" → "******01".
 */
export const maskPhone = (number) => {
  const digits = `${number || ''}`;
  if (digits.length <= 2) return '**';
  return '*'.repeat(digits.length - 2) + digits.slice(-2);
};
/**
 * Parse a phone number string into FedaPay format.
 * Accepts: "+22961000001", "22961000001", "61000001" (Benin, 8 digits).
 * Returns { number: '', country: 'bj' } when the input is not a valid phone.
 */
export const parsePhoneForFedaPay = (rawPhone) => {
  if (!rawPhone || typeof rawPhone !== 'string') return { number: '', country: 'bj' };
  const cleaned = rawPhone.replace(/[\s\-().]/g, '');

  // +229XXXXXXXX or 229XXXXXXXX → country bj, local 8-digit number
  const match229 = cleaned.match(/^\+?229(\d{8})$/);
  if (match229) return { number: match229[1], country: 'bj' };

  // Already a local 8-digit Benin number
  if (/^\d{8}$/.test(cleaned)) return { number: cleaned, country: 'bj' };

  return { number: '', country: 'bj' };
};

/**
 * Initiate a FedaPay payout (Mobile Money transfer to user).
 * Creates the payout and sends it immediately.
 *
 * @param {Object} params
 * @param {number} params.amountZC - Amount in Zoyd Coins
 * @param {string} params.method - Operator name ('MTN MoMo', 'Moov Money', 'Celtiis')
 * (modes FedaPay vérifiés : mtn_open, moov, sbin — pas de mode Orange/Wave au Bénin)
 * @param {string} params.phone - User's phone number
 * @param {string} params.userPseudo - User's display name
 * @param {string} [params.userEmail] - User's email
 * @param {string} [params.merchantReference] - Unique reference for idempotency
 * @returns {Promise<{ success: boolean, payoutId?: number, status?: string, amountFCFA?: number }>}
 */
export const initiateFedaPayPayout = async ({ amountZC, method, phone, userPseudo, userEmail, merchantReference }) => {
  const FEDAPAY_SECRET_KEY = getFedaPayConfig();
  if (!FEDAPAY_SECRET_KEY) {
    throw makeError('PAYMENT_NOT_CONFIGURED', "FedaPay n'est pas configuré pour les retraits.");
  }

  const mode = OPERATOR_MODE_MAP[method];
  if (!mode) {
    throw makeError('INVALID_OPERATOR', `Opérateur non supporté: ${method}. Utilisez MTN MoMo, Moov Money ou Celtiis.`);
  }

  const amountFCFA = Math.round(amountZC * 10);
  if (amountFCFA <= 0 || amountFCFA > 1_000_000) {
    throw makeError('INVALID_AMOUNT', 'Montant invalide pour le retrait (max 1 000 000 FCFA).');
  }

  const phoneInfo = parsePhoneForFedaPay(phone);
  if (!phoneInfo.number) {
    throw makeError('INVALID_PHONE', 'Numéro de téléphone invalide pour le retrait.');
  }

  const names = (userPseudo || 'Joueur').split(/\s+/);
  const firstname = names[0] || 'Joueur';
  const lastname = names.slice(1).join(' ') || 'ZOYD';

  log.info('Initiating FedaPay payout', { amountFCFA, method, mode, phone: maskPhone(phoneInfo.number), merchantReference });

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

    // 2. Send immediately
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
    log.error('FedaPay payout failed', { message: error.message, amountFCFA, method, phone: maskPhone(phoneInfo.number) });
    throw makeError('PAYOUT_FAILED', `Échec du transfert Mobile Money: ${error.message || 'Erreur inconnue'}`);
  }
};
