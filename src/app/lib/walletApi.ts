import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../stores/authStore';

export interface WalletSnapshot {
  cashBalance: number;
  bonusBalance: number;
  lockedBalance: number;
  pendingWinnings: number;
  transactions: any[];
  lockedEntries: Record<string, any>;
}

export const fetchWalletSnapshot = async (): Promise<{ ok: boolean; wallet: WalletSnapshot; user: any }> => {
  const token = useAuthStore.getState().sessionToken;
  if (!token) throw new Error('Session requise');

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new Error('Utilisateur non identifié');

  const userId = authData.user.id;

  // Récupérer le wallet
  let { data: wallet } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!wallet) {
    // Créer un wallet par défaut si introuvable
    const { data: newWallet } = await supabase
      .from('wallets')
      .insert({ user_id: userId, cash_balance: 0, locked_balance: 0 })
      .select()
      .single();
    wallet = newWallet;
  }

  // Récupérer les transactions récentes
  const { data: transactions } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Formater les transactions pour le store
  const formattedTxs = (transactions || []).map(tx => ({
    id: tx.id,
    type: tx.transaction_type,
    amount: Number(tx.amount),
    description: tx.description || '',
    status: tx.status,
    timestamp: tx.created_at,
    reference: tx.reference,
  }));

  const snapshot: WalletSnapshot = {
    cashBalance: Number(wallet?.cash_balance || 0),
    bonusBalance: 0,
    lockedBalance: Number(wallet?.locked_balance || 0),
    pendingWinnings: 0,
    transactions: formattedTxs,
    lockedEntries: {},
  };

  return { ok: true, wallet: snapshot, user: null };
};

export const depositWalletBalance = async (amount: number, method: string) => {
  const token = useAuthStore.getState().sessionToken;
  if (!token) throw new Error('Session requise');
  const { data: authData } = await supabase.auth.getUser(token);
  const userId = authData?.user?.id;
  if (!userId) throw new Error('Non autorisé');

  // 1. Ajouter la transaction
  await supabase.from('wallet_transactions').insert({
    user_id: userId,
    amount: amount,
    transaction_type: 'deposit',
    description: `Dépôt via ${method}`,
    status: 'completed',
  });

  // 2. Mettre à jour le solde
  const { data: current } = await supabase.from('wallets').select('cash_balance').eq('user_id', userId).single();
  const newBalance = Number(current?.cash_balance || 0) + amount;
  
  await supabase.from('wallets').update({ cash_balance: newBalance }).eq('user_id', userId);

  return fetchWalletSnapshot();
};

export const withdrawWalletBalance = async (amount: number, method: string, phone: string) => {
  const token = useAuthStore.getState().sessionToken;
  if (!token) throw new Error('Session requise');
  const { data: authData } = await supabase.auth.getUser(token);
  const userId = authData?.user?.id;
  if (!userId) throw new Error('Non autorisé');

  // 1. Ajouter la transaction
  await supabase.from('wallet_transactions').insert({
    user_id: userId,
    amount: -amount,
    transaction_type: 'withdrawal',
    description: `Retrait vers ${phone} via ${method}`,
    status: 'completed',
  });

  // 2. Mettre à jour le solde
  const { data: current } = await supabase.from('wallets').select('cash_balance').eq('user_id', userId).single();
  const newBalance = Math.max(0, Number(current?.cash_balance || 0) - amount);
  
  await supabase.from('wallets').update({ cash_balance: newBalance }).eq('user_id', userId);

  return fetchWalletSnapshot();
};

export const verifyFedaPayTransaction = async (transactionId: number | string) => {
  // Dans la vraie vie, on vérifierait auprès de l'API FedaPay depuis une Edge Function.
  // Pour la migration Frontend, on simule la validation et on fait un dépôt classique de 5000 FCFA (500 ZC).
  return depositWalletBalance(500, 'FedaPay Mobile Money');
};
