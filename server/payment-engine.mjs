import { FedaPay, Transaction } from 'fedapay';
import { depositToWallet } from './wallet-engine.mjs';
import { hasTransactionBeenProcessed, markTransactionAsProcessed } from './persistence.mjs';
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

// Lock in-memory pour éviter le TOCTOU race condition sur les transactions
const processingTransactions = new Set();

export const verifyFedaPayTransactionAndCredit = async (transactionId, user) => {
  const FEDAPAY_SECRET_KEY = getFedaPayConfig();
  if (!FEDAPAY_SECRET_KEY) {
    throw new Error("FedaPay n'est pas configuré sur le serveur.");
  }

  // Vérification d'idempotence en BDD (résiste aux redémarrages serveur)
  if (hasTransactionBeenProcessed(transactionId)) {
    throw new Error('Cette transaction a déjà été traitée.');
  }

  // Verrou atomique pour éviter le double-crediting concurrent
  if (processingTransactions.has(transactionId)) {
    throw new Error('Cette transaction est en cours de traitement.');
  }
  processingTransactions.add(transactionId);

  try {
    // 1. Récupérer la transaction directement depuis FedaPay (évite la falsification côté frontend)
    const transaction = await Transaction.retrieve(transactionId);

    // 2. Vérifier que le paiement est bien approuvé
    if (transaction.status !== 'approved') {
      throw new Error(`La transaction n'est pas approuvée (Statut: ${transaction.status})`);
    }

    // 3. Double-check idempotence après retrieve (deuxième filet de sécurité)
    if (hasTransactionBeenProcessed(transactionId)) {
      throw new Error('Cette transaction a déjà été traitée.');
    }

    // 4. Calculer les Zoyd Coins (1 ZC = 10 FCFA)
    const amountZC = transaction.amount / 10;

    // 5. Créditer le portefeuille EN PREMIER (si ça échoue, on ne marquera pas comme traité)
    const updatedUser = depositToWallet(
      user.id,
      amountZC,
      `Recharge FedaPay (${transactionId})`
    );

    // 6. Marquer comme traitée APRÈS crédit réussi
    try {
      markTransactionAsProcessed(transactionId, user.id, amountZC);
    } catch (markErr) {
      // Rollback : annuler le crédit si l'enregistrement échoue
      log.error('Failed to mark transaction processed, rolling back wallet credit', { transactionId, error: markErr.message });
      try {
        depositToWallet(user.id, -amountZC, `Rollback FedaPay (${transactionId})`);
      } catch (rollbackErr) {
        log.error('CRITICAL: Rollback also failed', { transactionId, error: rollbackErr.message });
      }
      throw new PaymentRollbackError('Erreur interne lors de l\'enregistrement de la transaction.');
    }

    return {
      success: true,
      amountZC,
      user: updatedUser
    };
  } catch (error) {
    log.error('FedaPay verification error', { message: error.message });
    if (error instanceof PaymentRollbackError) throw error;
    if (error.message.includes('déjà été traitée') || error.message.includes('UNIQUE')) {
      throw new Error('Cette transaction a déjà été traitée.');
    }
    throw new Error('Erreur lors de la vérification de la transaction FedaPay.');
  } finally {
    processingTransactions.delete(transactionId);
  }
};
