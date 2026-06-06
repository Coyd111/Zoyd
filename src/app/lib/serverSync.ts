import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';
import type { WalletSnapshot } from './walletApi';

export const applyServerAccountState = (payload: { user?: any; wallet?: WalletSnapshot | null }) => {
  if (payload.user) {
    useAuthStore.getState().updateUser(payload.user);
  }

  if (payload.wallet) {
    useWalletStore.getState().hydrateFromServer(payload.wallet);
  }
};
