import { useEffect, useRef } from 'react';
import { fetchCurrentUser, type AuthResponse } from '../lib/authApi';
import { useAuthStore } from '../stores/authStore';

// Cookie-only : au chargement, la session est revalidée via GET /api/auth/me
// (le cookie httpOnly part automatiquement). Pas de token en JS.
export const useAuthSessionBootstrap = () => {
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const setLoading = useAuthStore((state) => state.setLoading);
  const logout = useAuthStore((state) => state.logout);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    setLoading(true);
    fetchCurrentUser()
      .then((payload: AuthResponse) => {
        if (!payload?.user) {
          logout();
          return;
        }
        hydrateSession(payload.user, payload.expiresAt);
      })
      .catch(() => {
        logout();
      });
  }, [hydrateSession, logout, setLoading]);
};
