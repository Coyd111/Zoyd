import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { fetchCurrentUser, type AuthResponse } from '../lib/authApi';
import { resetAllSessionStores } from '../lib/sessionReset';
import { useAuthStore } from '../stores/authStore';

// Cookie-only : au chargement, la session est revalidée via GET /api/auth/me
// (le cookie httpOnly part automatiquement). Pas de token en JS.
export const useAuthSessionBootstrap = () => {
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const setLoading = useAuthStore((state) => state.setLoading);
  const logout = useAuthStore((state) => state.logout);
  const bootstrappedRef = useRef(false);

  const logoutAndPurge = () => {
    resetAllSessionStores();
    logout();
  };

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    setLoading(true);
    fetchCurrentUser()
      .then((payload: AuthResponse) => {
        if (!payload?.user) {
          logoutAndPurge();
          return;
        }
        hydrateSession(payload.user, payload.expiresAt);
      })
      .catch((error) => {
        // Ne purge que sur une vraie absence de session : un cold-start Render
        // (timeout 30s) ou un 502 ne doivent pas éjecter l'utilisateur alors
        // que son cookie est valide. On propose un réessai.
        const status = (error as { status?: number })?.status;
        if (status === 401) {
          logoutAndPurge();
          return;
        }
        setLoading(false);
        toast.error('Connexion au serveur impossible. Vérifie ton réseau et réessaie.', {
          id: 'auth-bootstrap-retry',
          action: { label: 'Réessayer', onClick: () => window.location.reload() },
        });
      });
  }, [hydrateSession, logout, setLoading]);
};
