import { authorizedGet, authorizedPost } from './apiClient';

export interface WalletSnapshot {
  cashBalance: number;
  bonusBalance: number;
  lockedBalance: number;
  pendingWinnings: number;
  transactions: any[];
  lockedEntries: Record<string, any>;
}

interface WalletResponse {
  ok: boolean;
  wallet: WalletSnapshot;
  user: any;
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
