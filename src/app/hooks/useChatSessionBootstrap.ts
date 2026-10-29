/**
 * useChatSessionBootstrap - hydrate les canaux et messages du chat.
 *
 * Appelle fetchChatBootstrap une fois par utilisateur, puis retente avec un
 * backoff 2 s -> 5 s -> 10 s -> 20 s si le serveur echoue — meme liste de
 * delais que useWalletSessionBootstrap, pour la meme raison : le serveur
 * Render gratuit dort apres inactivite, le premier appel timeout (30 s)
 * pendant le reveil, le suivant passe.
 *
 * INVARIANT : un echec de chargement NE purge PAS le store. Avant le fix
 * (audit-4 C2), un cold-start rendait /chat muet : un seul fetch, aucune
 * tentative, aucun signal — le joueur voyait une liste vide sans savoir
 * pourquoi. A present : les retentatives relancent le bootstrap, et apres
 * epuisement une toast informe le joueur une seule fois.
 * INVARIANT : replaceFromServer([], []) est reserve a la deconnexion (purge
 * volontaire), jamais a un echec reseau.
 * PIEGE : aucune hydratation double : hydratedRef sert de garde par
 * identite ; le nettoyage annule le flag cancelled et le timer en attente.
 *
 * Voir aussi : docs/08-frontend.md - section 6.1 (Les hooks de session)
 */
import { useEffect, useRef } from 'react';
import { fetchChatBootstrap } from '../lib/chatApi';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useToastStore } from '../stores/toastStore';

/** Les memes delais que useWalletSessionBootstrap (mirroir intangible). */
export const CHAT_BOOTSTRAP_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

/**
 * Decision apres `attempt` echecs consecutifs (0 = apres la tentative
 * initiale). Exporte pour test : la sequence doit rester alignee avec le
 * bootstrap wallet. Apres le dernier delai vient le SIGNAL (toast d'echec
 * unique), jamais une purge du store.
 */
export const chatBootstrapFailurePlan = (
  attempt: number
): { retry: boolean; delayMs: number; signal: boolean } => {
  const delayMs = CHAT_BOOTSTRAP_RETRY_DELAYS_MS[attempt];
  if (typeof delayMs === 'number') {
    return { retry: true, delayMs, signal: false };
  }
  return { retry: false, delayMs: 0, signal: true };
};

export const useChatSessionBootstrap = () => {
  const userId = useAuthStore((state) => state.user?.id);
  const hydratedRef = useRef<string | null>(null);
  const retryRef = useRef<{ attempt: number; timer: number | null }>({ attempt: 0, timer: null });

  useEffect(() => {
    if (!userId) {
      hydratedRef.current = null;
      if (retryRef.current.timer) window.clearTimeout(retryRef.current.timer);
      retryRef.current = { attempt: 0, timer: null };
      useChatStore.getState().replaceFromServer([], []);
      return;
    }

    if (hydratedRef.current === userId) {
      return;
    }

    let cancelled = false;

    const scheduleRetry = () => {
      const { attempt, timer } = retryRef.current;
      if (timer || cancelled) return;
      const plan = chatBootstrapFailurePlan(attempt);
      if (!plan.retry) {
        // File epuisee : UN seul signal utilisateur. Pas de purge : les
        // messages locaux restent lisibles, le socket resynchronisera.
        useToastStore.getState().addToast({
          type: 'error',
          title: 'Messages indisponibles',
          message: 'Impossible de charger tes conversations : le serveur ne repond pas. Recharge la page dans un instant.',
          duration: 6000,
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
        const payload = await fetchChatBootstrap();
        if (cancelled) return;
        useChatStore.getState().replaceFromServer(payload.channels, payload.messages);
        hydratedRef.current = userId;
        retryRef.current = { attempt: 0, timer: null };
      } catch {
        // 401 : apiClient purge deja la session — le changement d'identite
        // relance l'effet et le cleanup annule le timer. Les autres echecs
        // (cold-start Render, panne reseau) : backoff, store intact.
        if (!cancelled) scheduleRetry();
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
