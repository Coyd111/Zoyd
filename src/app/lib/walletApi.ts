import { authorizedGet, authorizedPost } from './apiClient';

import type { TransactionStatus, TransactionType } from '../stores/walletStore';

export interface WalletTransaction {
  id: string;
  /** Union volontairement reprise du store : le serveur n'émet que ces
   *  valeurs, et un `string` large rendait le mapping non assignable
   *  (le store forçait un cast). */
  type: TransactionType;
  amount: number;
  description?: string;
  status: TransactionStatus;
  metadata?: Record<string, unknown>;
  /** Champ écrit par le serveur (`buildTransaction`). `created_at` est
   *  toléré pour les lignes plus anciennes. */
  timestamp?: string;
  created_at?: string;
}

export interface WalletSnapshot {
  cashBalance: number;
  bonusBalance: number;
  lockedBalance: number;
  pendingWinnings: number;
  transactions: WalletTransaction[];
  lockedEntries: Record<string, { amount: number; cashAmount?: number; bonusAmount?: number; lockedAt: string }>;
}

/**
 * Politique de retrait, publiee par le serveur (`/api/wallet/me`).
 *
 * Le taux etait code en dur a deux endroits dans le front, et le store
 * recalculait le net localement apres un retrait reussi : la notification
 * « X net envoyes » pouvait differer du montant reellement verse par FedaPay.
 */
export interface WithdrawalPolicy {
  feeRate: number;
  minAmount: number;
}

/** Montants d'un retrait, calcules par le serveur (source de verite). */
export interface WithdrawalAmounts {
  feeRate: number;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
}

interface WalletResponse {
  ok: boolean;
  wallet: WalletSnapshot;
  user?: { id: string; pseudo: string; wallet?: WalletSnapshot };
  amount?: number;
  withdrawal?: WithdrawalPolicy;
  feeRate?: number;
  grossAmount?: number;
  feeAmount?: number;
  netAmount?: number;
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

/**
 * Commission ZOYD, calculee par le serveur sur l'ensemble des portefeuilles.
 * Donnee financiere sensible : la route exige la 2FA admin
 * (`requireAdmin2fa`), donc l'appel echoue sans code valide.
 *
 * Revenu et sortie sont volontairement dans deux champs distincts : le
 * revenu ZOYD ne vient QUE des 2 % de retrait.
 */
export interface CommissionStats {
  /** Chiffre d'affaires ZOYD : la commission de retrait (2 %), et rien d'autre. */
  revenue: number;
  /** Detail de la commission de retrait, pour le libelle de l'UI. */
  withdrawalFees: number;
  withdrawalCount: number;
  /** Sortie : part de cagnotte versee aux arbitres. PAS un revenu. */
  arbiterPayouts: number;
}

export const fetchAdminCommissions = async (): Promise<CommissionStats> => {
  const response = await authorizedGet<{ ok: boolean; commissions: CommissionStats }>('/api/admin/commissions');
  return response.commissions;
};
