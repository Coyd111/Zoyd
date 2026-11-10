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
 * INVARIANT : la file de retentatives se TERMINE par un SIGNAL, jamais par
 * le silence. Sans lui, la navbar affichait `0 ZC` en permanence chez un
 * joueur qui pouvait avoir 20 000 ZC — le portefeuille indisponible se
 * lisait exactement comme un portefeuille vide. Le bootstrap CHAT emetait
 * deja un toast a l'epuisement : le wallet est aligne sur ce comportement.
 */
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';
import { useToastStore } from '../stores/toastStore';

/** Les memes delais que useChatSessionBootstrap (miroir intangible). */
export const WALLET_BOOTSTRAP_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

/**
 * Decision apres `attempt` echecs consecutifs (0 = apres la tentative
 * initiale). Exporte pour test : la sequence doit rester alignee avec le
 * bootstrap chat. Apres le dernier delai vient le SIGNAL (toast d'echec
 * unique avec un bouton « Reessayer »), jamais une purge du store.
 */
export const walletBootstrapFailurePlan = (
  attempt: number
): { retry: boolean; delayMs: number; signal: boolean } => {
  const delayMs = WALLET_BOOTSTRAP_RETRY_DELAYS_MS[attempt];
  if (typeof delayMs === 'number') {
    return { retry: true, delayMs, signal: false };
  }
  return { retry: false, delayMs: 0, signal: true };
};

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
      if (timer || cancelled) return;
      const plan = walletBootstrapFailurePlan(attempt);
      if (!plan.retry) {
        // File epuisee : UN seul signal utilisateur. Pas de purge : le
        // portefeuille du joueur n'est pas modifie, seul son miroir local
        // est reste vide.
        //
        // Sur un 401, apiClient a deja purge et deconnecte : le toast
        // « portefeuille indisponible » ne serait que du bruit. On ne
        // signale donc que si la session est toujours celle du joueur.
        if (useAuthStore.getState().user?.id !== userId) return;
        useToastStore.getState().addToast({
          id: 'wallet-bootstrap-failed',
          type: 'error',
          title: 'Portefeuille indisponible',
          message: "Impossible de charger ton portefeuille : le serveur ne repond pas. Ton solde n'est pas perdu — reessaie dans un instant.",
          duration: 8000,
          action: {
            label: 'Réessayer',
            onClick: () => {
              // Relance une tentativeImmediate : on repart d'une file
              // neuve, sinon le plan resterait epuise et le signal
              // partirait aussitot.
              retryRef.current = { attempt: 0, timer: null };
              hydratedRef.current = null;
              void load();
            },
          },
        });
        return;
      }
      retryRef.current = {
        attempt: attempt + 1,
        timer: window.setTimeout(() => {
          retryRef.current = { attempt: retryRef.current.attempt, timer: null };
          void load();
        }, plan.delayMs),
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
