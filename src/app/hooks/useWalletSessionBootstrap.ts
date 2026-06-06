import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';

export const useWalletSessionBootstrap = () => {
  const sessionToken = useAuthStore((state) => state.sessionToken);
  const refreshFromServer = useWalletStore((state) => state.refreshFromServer);
  const hydratedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      hydratedTokenRef.current = null;
      return;
    }

    if (hydratedTokenRef.current === sessionToken) {
      return;
    }

    let cancelled = false;

    refreshFromServer()
      .then(() => {
        if (!cancelled) {
          hydratedTokenRef.current = sessionToken;
        }
      })
      .catch(() => {
        if (!cancelled) {
          hydratedTokenRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshFromServer, sessionToken]);
};
