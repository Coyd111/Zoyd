import { authorizedGet, authorizedPost } from './apiClient';

export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  description?: string;
  status: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface WalletSnapshot {
  cashBalance: number;
  bonusBalance: number;
  lockedBalance: number;
  pendingWinnings: number;
  transactions: WalletTransaction[];
  lockedEntries: Record<string, { amount: number; cashAmount?: number; bonusAmount?: number; lockedAt: string }>;
}

interface WalletResponse {
  ok: boolean;
  wallet: WalletSnapshot;
  user?: { id: string; pseudo: string; wallet?: WalletSnapshot };
  amount?: number;
}

export const fetchWalletSnapshot = async (): Promise<WalletResponse> => {
  try {
    return await authorizedGet<WalletResponse>('/api/wallet/me');
  } catch (error) {
    console.error('Erreur chargement wallet:', error);
    throw error;
  }
};

export const depositWalletBalance = async (amount: number, method: string): Promise<WalletResponse> => {
  try {
    return await authorizedPost<WalletResponse>('/api/wallet/deposit', { amount, method });
  } catch (error) {
    console.error('Erreur depot wallet:', error);
    throw error;
  }
};

export const withdrawWalletBalance = async (amount: number, method: string, phone: string): Promise<WalletResponse> => {
  try {
    return await authorizedPost<WalletResponse>('/api/wallet/withdraw', { amount, method, phone });
  } catch (error) {
    console.error('Erreur retrait wallet:', error);
    throw error;
  }
};

export const verifyFedaPayTransaction = async (transactionId: number | string): Promise<WalletResponse> => {
  try {
    return await authorizedPost<WalletResponse>('/api/wallet/verify-fedapay', { transactionId });
  } catch (error) {
    console.error('Erreur verification FedaPay:', error);
    throw error;
  }
};
