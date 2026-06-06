import { FedaPay, Transaction } from 'fedapay';
import { depositToWallet } from './wallet-engine.mjs';

// Configuration FedaPay
const FEDAPAY_SECRET_KEY = process.env.FEDAPAY_SECRET_KEY;
if (FEDAPAY_SECRET_KEY) {
  FedaPay.setApiKey(FEDAPAY_SECRET_KEY);
  FedaPay.setEnvironment(FEDAPAY_SECRET_KEY.includes('sandbox') ? 'sandbox' : 'live');
}

// Keep track of processed transactions in memory (in production, use DB)
const processedTransactions = new Set();

export const verifyFedaPayTransactionAndCredit = async (transactionId, user) => {
  if (!FEDAPAY_SECRET_KEY) {
    throw new Error("FedaPay n'est pas configuré sur le serveur.");
  }

  if (processedTransactions.has(transactionId)) {
    throw new Error("Cette transaction a déjà été traitée.");
  }

  try {
    // 1. Fetch the transaction directly from FedaPay to avoid frontend spoofing
    const transaction = await Transaction.retrieve(transactionId);
    
    // 2. Check if the payment was successful
    if (transaction.status !== 'approved') {
      throw new Error(`La transaction n'est pas approuvée (Statut: ${transaction.status})`);
    }

    // 3. Mark as processed to prevent double-spending
    processedTransactions.add(transactionId);

    // 4. Calculate Zoyd Coins (1 FCFA = 1 ZC)
    const amountZC = transaction.amount;

    // 5. Credit the user's wallet
    const updatedUser = depositToWallet(
      user.id,
      amountZC,
      `Recharge FedaPay (${transactionId})`
    );

    return {
      success: true,
      amountZC,
      user: updatedUser
    };
  } catch (error) {
    console.error('[FedaPay] Erreur de vérification :', error.message);
    throw new Error("Erreur lors de la vérification de la transaction FedaPay.");
  }
};
