import { FedaPay, Transaction } from 'fedapay';
import { depositToWallet } from './wallet-engine.mjs';
import { hasTransactionBeenProcessed, markTransactionAsProcessed } from './persistence.mjs';

// Configuration FedaPay
const FEDAPAY_SECRET_KEY = process.env.FEDAPAY_SECRET_KEY;
if (FEDAPAY_SECRET_KEY) {
  FedaPay.setApiKey(FEDAPAY_SECRET_KEY);
  FedaPay.setEnvironment(FEDAPAY_SECRET_KEY.includes('sandbox') ? 'sandbox' : 'live');
}

export const verifyFedaPayTransactionAndCredit = async (transactionId, user) => {
  if (!FEDAPAY_SECRET_KEY) {
    throw new Error("FedaPay n'est pas configuré sur le serveur.");
  }

  // Vérification d'idempotence en BDD (résiste aux redémarrages serveur)
  if (hasTransactionBeenProcessed(transactionId)) {
    throw new Error('Cette transaction a déjà été traitée.');
  }

  try {
    // 1. Récupérer la transaction directement depuis FedaPay (évite la falsification côté frontend)
    const transaction = await Transaction.retrieve(transactionId);

    // 2. Vérifier que le paiement est bien approuvé
    if (transaction.status !== 'approved') {
      throw new Error(`La transaction n'est pas approuvée (Statut: ${transaction.status})`);
    }

    // 3. Calculer les Zoyd Coins (1 ZC = 10 FCFA)
    const amountZC = transaction.amount / 10;

    // 4. Marquer comme traitée en BDD AVANT de créditer
    //    La contrainte PRIMARY KEY garantit l'atomicité : un doublon lève une erreur UNIQUE
    markTransactionAsProcessed(transactionId, user.id, amountZC);

    // 5. Créditer le portefeuille
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
    // Si c'est une erreur d'idempotence qu'on a nous-même levée, la relancer telle quelle
    if (error.message.includes('déjà été traitée') || error.message.includes('UNIQUE')) {
      throw new Error('Cette transaction a déjà été traitée.');
    }
    throw new Error('Erreur lors de la vérification de la transaction FedaPay.');
  }
};
