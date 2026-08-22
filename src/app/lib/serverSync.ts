import { useAuthStore, type User } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';
import type { WalletSnapshot } from './walletApi';

export const applyServerAccountState = (payload: { user?: Partial<User>; wallet?: WalletSnapshot | null }) => {
  if (payload.user) {
    useAuthStore.getState().updateUser(payload.user);
  }

  if (payload.wallet) {
    useWalletStore.getState().hydrateFromServer(payload.wallet);
  }
};
