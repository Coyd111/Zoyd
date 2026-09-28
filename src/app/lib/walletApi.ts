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
  return authorizedGet<WalletResponse>('/api/wallet/me');
};

export const depositWalletBalance = async (amount: number, method: string): Promise<WalletResponse> => {
  return authorizedPost<WalletResponse>('/api/wallet/deposit', { amount, method });
};

/**
 * Retire des fonds. `idempotencyKey` est générée ici et non par l'appelant :
 * un double-clic ou un retry réseau réutilise la même clé, donc le serveur
 * détecte la duplication (un seul débit, un seul payout FedaPay).
 */
export const withdrawWalletBalance = async (
  amount: number,
  method: string,
  phone: string,
  country?: string
): Promise<WalletResponse> => {
  const idempotencyKey =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return authorizedPost<WalletResponse>('/api/wallet/withdraw', {
    amount,
    method,
    phone,
    country,
    idempotencyKey,
  });
};

export const verifyFedaPayTransaction = async (transactionId: number | string): Promise<WalletResponse> => {
  return authorizedPost<WalletResponse>('/api/wallet/verify-fedapay', { transactionId });
};
