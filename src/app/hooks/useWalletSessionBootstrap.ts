import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';

export const useWalletSessionBootstrap = () => {
  const userId = useAuthStore((state) => state.user?.id);
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      hydratedRef.current = null;
      return;
    }

    if (hydratedRef.current === userId) {
      return;
    }

    let cancelled = false;

    useWalletStore.getState().refreshFromServer()
      .then(() => {
        if (!cancelled) {
          hydratedRef.current = userId;
        }
      })
      .catch(() => {
        if (!cancelled) {
          hydratedRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);
};
