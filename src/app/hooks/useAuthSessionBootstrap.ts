import { useEffect, useRef } from 'react';
import { fetchCurrentUser } from '../lib/authApi';
import { useAuthStore } from '../stores/authStore';

export const useAuthSessionBootstrap = () => {
  const sessionToken = useAuthStore((state) => state.sessionToken);
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const logout = useAuthStore((state) => state.logout);
  const bootstrappedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      bootstrappedTokenRef.current = null;
      return;
    }

    if (bootstrappedTokenRef.current === sessionToken) {
      return;
    }

    let cancelled = false;

    fetchCurrentUser(sessionToken)
      .then((payload) => {
        if (cancelled) return;
        hydrateSession(payload.user, sessionToken);
        bootstrappedTokenRef.current = sessionToken;
      })
      .catch(() => {
        if (cancelled) return;
        logout();
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateSession, logout, sessionToken]);
};
