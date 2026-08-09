import { useEffect, useRef } from 'react';
import { fetchCurrentUser } from '../lib/authApi';
import { useAuthStore } from '../stores/authStore';

export const useAuthSessionBootstrap = () => {
  const sessionToken = useAuthStore((state) => state.sessionToken);
  const expiresAt = useAuthStore((state) => state.expiresAt);
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const logout = useAuthStore((state) => state.logout);
  const bootstrappedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      bootstrappedTokenRef.current = null;
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

    fetchCurrentUser(sessionToken)
      .then((payload) => {
        if (cancelled) return;
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
  }, [hydrateSession, logout, sessionToken, expiresAt]);
};
