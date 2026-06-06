import { useAuthStore } from '../stores/authStore';

export interface WalletSnapshot {
  cashBalance: number;
  bonusBalance: number;
  lockedBalance: number;
  pendingWinnings: number;
  transactions: any[];
  lockedEntries: Record<string, any>;
}

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

const getAuthHeaders = () => {
  const token = useAuthStore.getState().sessionToken;
  if (!token) {
    throw new Error('Session joueur requise.');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Une erreur reseau est survenue.');
  }

  return payload as T;
};

export const fetchWalletSnapshot = async () =>
  readJson<{ ok: boolean; wallet: WalletSnapshot; user: any }>(
    await fetch(getApiUrl('/api/wallet/me'), {
      headers: getAuthHeaders(),
    })
  );

export const depositWalletBalance = async (amount: number, method: string) =>
  readJson<{ ok: boolean; wallet: WalletSnapshot; user: any }>(
    await fetch(getApiUrl('/api/wallet/deposit'), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, method }),
    })
  );

export const withdrawWalletBalance = async (amount: number, method: string, phone: string) =>
  readJson<{ ok: boolean; wallet: WalletSnapshot; user: any }>(
    await fetch(getApiUrl('/api/wallet/withdraw'), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, method, phone }),
    })
  );

export const verifyFedaPayTransaction = async (transactionId: number | string) =>
  readJson<{ ok: boolean; amount: number; wallet: WalletSnapshot; user: any }>(
    await fetch(getApiUrl('/api/wallet/verify-fedapay'), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transactionId }),
    })
  );
