/**
 * useWalletSessionBootstrap - hydrate le portefeuille au demarrage de session.
 *
 * Appelle refreshFromServer avec l'userId attendu, et retente avec un backoff
 * 2 s -> 5 s -> 10 s -> 20 s si le serveur echoue (offre gratuite Render
 * endormie). N'hydrate qu'une fois par utilisateur.
 *
 * INVARIANT : passer le userId attendu au refresh. Si la reponse arrive apres
 * un logout suivi d'une reconnexion d'un autre compte, le store doit refuser
 * d'ecrire plutot que d'afficher le solde d'un autre joueur.
 * PIEGE : ne pas avaler l'erreur de refresh. Le bootstrap en depend pour
 * savoir s'il doit retenter : avaler affichait 0 ZC alors que le serveur en
 * avait, et le joueur croyait son portefeuille vide.
 * PIEGE : une seule hydratation par utilisateur. Le ref userId sert de
 * garde : changer de compte doit relancer le chargement, pas le bloquer.
 *
 * Voir aussi : docs/08-frontend.md - section 6.1 (Les hooks de session)
 */
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
        // On passe le userId attendu : si la réponse arrive après un logout +
        // reconnexion d'un autre compte, le store refuse d'écrire au lieu
        // d'afficher le solde d'un autre joueur.
        await useWalletStore.getState().refreshFromServer(userId);
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
