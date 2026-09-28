import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';

const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

export const useWalletSessionBootstrap = () => {
  const userId = useAuthStore((state) => state.user?.id);
  const hydratedRef = useRef<string | null>(null);
  const retryRef = useRef<{ attempt: number; timer: number | null }>({ attempt: 0, timer: null });

  useEffect(() => {
    if (!userId) {
      hydratedRef.current = null;
      if (retryRef.current.timer) window.clearTimeout(retryRef.current.timer);
      retryRef.current = { attempt: 0, timer: null };
      return;
    }

    if (hydratedRef.current === userId) {
      return;
    }

    let cancelled = false;

    const scheduleRetry = () => {
      const { attempt, timer } = retryRef.current;
      if (timer || cancelled || attempt >= RETRY_DELAYS_MS.length) return;
      const delay = RETRY_DELAYS_MS[attempt];
      retryRef.current = {
        attempt: attempt + 1,
        timer: window.setTimeout(() => {
          retryRef.current = { attempt: retryRef.current.attempt, timer: null };
          void load();
        }, delay),
      };
    };

    const load = async () => {
      try {
        await useWalletStore.getState().refreshFromServer();
        if (!cancelled) {
          hydratedRef.current = userId;
          retryRef.current = { attempt: 0, timer: null };
        }
      } catch {
        // Échec réseau / serveur en veille (Render gratuit) : on retente avec
        // backoff au lieu d'afficher 0 ZC.
        scheduleRetry();
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (retryRef.current.timer) {
        window.clearTimeout(retryRef.current.timer);
        retryRef.current = { attempt: 0, timer: null };
      }
    };
  }, [userId]);
};
