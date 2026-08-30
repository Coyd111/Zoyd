import { FedaPay, Transaction } from 'fedapay';
import { depositToWallet, debitFromWallet } from './wallet-engine.mjs';
import { hasTransactionBeenProcessed, claimTransaction, makeError } from './persistence.mjs';
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

    // 3. Calculer les Zoyd Coins (1 ZC = 10 FCFA)
    const amountZC = transaction.amount / 10;

    // 4. Réserver atomiquement AVANT tout crédit — si un autre process passe entre-temps, claimTransaction renvoie false
    const claimed = await claimTransaction(transactionId, user.id, amountZC);
    if (!claimed) {
      throw makeError('TRANSACTION_ALREADY_PROCESSED', 'Cette transaction a déjà été traitée.');
    }

    // 5. Créditer le portefeuille (le reservation est déjà garantie)
    const updatedUser = await depositToWallet(
      user.id,
      amountZC,
      'FedaPay'
    );

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
