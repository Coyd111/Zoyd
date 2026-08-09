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
  lockedEntries: Record<string, { amount: number; reason: string; lockedAt: string }>;
}

interface WalletResponse {
  ok: boolean;
  wallet: WalletSnapshot;
  user?: { id: string; pseudo: string; wallet?: WalletSnapshot };
  amount?: number;
}

export const fetchWalletSnapshot = async (): Promise<WalletResponse> => {
  return authorizedGet<WalletResponse>('/api/wallet/me');
};

export const depositWalletBalance = async (amount: number, method: string): Promise<WalletResponse> => {
  return authorizedPost<WalletResponse>('/api/wallet/deposit', { amount, method });
};

export const withdrawWalletBalance = async (amount: number, method: string, phone: string): Promise<WalletResponse> => {
  return authorizedPost<WalletResponse>('/api/wallet/withdraw', { amount, method, phone });
};

export const verifyFedaPayTransaction = async (transactionId: number | string): Promise<WalletResponse> => {
  return authorizedPost<WalletResponse>('/api/wallet/verify-fedapay', { transactionId });
};
