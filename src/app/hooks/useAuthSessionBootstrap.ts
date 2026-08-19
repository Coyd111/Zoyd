import { useEffect, useRef } from 'react';
import { fetchCurrentUser, type AuthResponse } from '../lib/authApi';
import { useAuthStore } from '../stores/authStore';

export const useAuthSessionBootstrap = () => {
  const sessionToken = useAuthStore((state) => state.sessionToken);
  const expiresAt = useAuthStore((state) => state.expiresAt);
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const setLoading = useAuthStore((state) => state.setLoading);
  const logout = useAuthStore((state) => state.logout);
  const bootstrappedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      bootstrappedTokenRef.current = null;
      setLoading(false);
      return;
    }

    // Client-side expiration check — avoid network round-trip for expired tokens
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      logout();
      return;
    }

    if (bootstrappedTokenRef.current === sessionToken) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    fetchCurrentUser(sessionToken)
      .then((payload: AuthResponse) => {
        if (cancelled) return;
        if (!payload?.user) {
          logout();
          return;
        }
        hydrateSession(payload.user, sessionToken, payload.expiresAt);
        bootstrappedTokenRef.current = sessionToken;
      })
      .catch(() => {
        if (cancelled) return;
        logout();
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateSession, logout, setLoading, sessionToken, expiresAt]);
};
