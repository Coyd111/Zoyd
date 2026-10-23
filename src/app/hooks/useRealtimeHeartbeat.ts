/**
 * useRealtimeHeartbeat - moteur du cycle temps reel : connecte le socket,
 * bootstrappe l'etat serveur, resynchronise et fusionne les deltas.
 *
 * Appele par AppLayout. Connecte via socketStore.connect(user), lance
 * bootstrapServerState une fois par session, puis appelle
 * syncFromMatches toutes les 15 s pour recalculer presence et rappels.
 *
 * INVARIANT : dependre de l'IDENTITE du user (user?.id), pas de l'objet user.
 * Dependre de l'objet recreait une boucle : chaque updateUser faisait
 * disconnect/connect + bootstrap, y compris a chaque hydrate du wallet.
 * INVARIANT : le socket diffuse des DELTAS (le match modifie), pas la
 * collection : il faut FUSIONNER via hydrateFromServer. replaceFromServer
 * effacerait tous les autres matchs de la liste.
 * PIEGE : quand la connexion tombe, les deltas emis pendant la coupure sont
 * perdus ; le store socketConnectionStore pose dirtySinceDisconnect et
 * resynchronise au retour. Ne pas vider les stores a la coupure.
 * INVARIANT (F2) : un echec de bootstrap ne condamne PAS l'ecran a un
 * squelette infini. Avant ce correctif, `didBootstrapRef` etait remis a false
 * (retry au prochain montage) mais l'effet ne rejoue jamais : cinq ecrans
 * restaient a jamais bloques. Le bootstrap est DESORMAIS retente avec le
 * meme backoff que le portefeuille (2 s -> 5 s -> 10 s -> 20 s). Apres
 * epuisement, le store porte `bootstrapFailed` et les ecrans rendent un
 * etat "chargement impossible + Reessayer".
 *
 * Voir aussi : docs/08-frontend.md - section 6.2 (Le cycle de synchronisation)
 */
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useSocketStore } from '../stores/socketStore';
import { useTournamentStore } from '../stores/tournamentStore';

export const REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;
// Meme echelle que useWalletSessionBootstrap : l'offre gratuite Render
// s'endort, et le reveille-rateau du backend demande de la patience.
export const BOOTSTRAP_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

export const useRealtimeHeartbeat = (enabled: boolean) => {
  // Dépendre de l'OBJET user était une boucle : chaque updateUser créait un
  // nouvel objet → disconnect/connect + bootstrap, y compris à chaque
  // hydrateFromServer du wallet. On ne dépend que de l'identité.
  const userId = useAuthStore((s) => s.user?.id);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // ATTENTION : le socket diffuse des DELTAS (le match modifié), pas la
  // collection complète. Il faut donc FUSIONNER (hydrateFromServer) —
  // replaceFromServer effacerait tous les autres matchs de la liste.
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const hydrateTournaments = useTournamentStore((state) => state.hydrateFromServer);
  const remoteMatchSnapshots = useSocketStore((s) => s.remoteMatchSnapshots);
  const remoteTournamentSnapshots = useSocketStore((s) => s.remoteTournamentSnapshots);

  const didBootstrapRef = useRef(false);
  // F2 : l'etat du cycle de retry du bootstrap (timer du backoff courant +
  // drapeau d'annulation). Deux refs separees pour que le cleanup de
  // l'effet - prochaine creation, logout, changement de compte - coupe
  // proprement les tentatives en vol.
  const bootstrapTimerRef = useRef<number | undefined>(undefined);
  const bootstrapCancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !userId) {
      useSocketStore.getState().disconnect();
      didBootstrapRef.current = false;
      bootstrapCancelledRef.current = true;
      if (bootstrapTimerRef.current) window.clearTimeout(bootstrapTimerRef.current);
      bootstrapTimerRef.current = undefined;
      return;
    }

    const user = useAuthStore.getState().user;
    if (!user) return;
    const socketStore = useSocketStore.getState();
    socketStore.connect(user);

    if (!didBootstrapRef.current) {
      didBootstrapRef.current = true;
      // F2 : `bootstrapServerState` avale ses propres erreurs (le catch du
      // store ne rejette pas), donc on ne peut pas se fier a un ".catch".
      // La reussite se lit dans le store (`bootstrapReady`) apres l'attente ;
      // en echec on retente avec le backoff, et apres le dernier essai le
      // store reste sur `bootstrapFailed` : les ecrans proposent "Reessayer".
      let attempt = 0;
      bootstrapCancelledRef.current = false;
      const attemptBootstrap = () => {
        void socketStore.bootstrapServerState(user).then(() => {
          if (bootstrapCancelledRef.current || useSocketStore.getState().bootstrapReady) return;
          if (attempt >= BOOTSTRAP_RETRY_DELAYS_MS.length) return;
          const delay = BOOTSTRAP_RETRY_DELAYS_MS[attempt];
          attempt += 1;
          bootstrapTimerRef.current = window.setTimeout(attemptBootstrap, delay);
        });
      };
      attemptBootstrap();
    }

    const sync = () => {
      const currentUser = useAuthStore.getState().user;
      const currentMatches = useMatchStore.getState().matches;
      socketStore.syncFromMatches(currentMatches, currentUser);
    };

    sync();

    const interval = window.setInterval(sync, REALTIME_HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      // Un nouveau bootstrap peut recommencer au prochain montage : on tue
      // le retry courant, mais on NE remet PAS didBootstrapRef a false ICI.
      // C'est la branche de desauthentification (plus haut) qui le fait ;
      // un simple remontage (navigation) ne doit pas retrigger le bootstrap.
      bootstrapCancelledRef.current = true;
      if (bootstrapTimerRef.current) window.clearTimeout(bootstrapTimerRef.current);
      bootstrapTimerRef.current = undefined;
      useSocketStore.getState().disconnect();
    };
  }, [enabled, isAuthenticated, userId]);

  useEffect(() => {
    if (!enabled || remoteMatchSnapshots.length === 0) return;
    hydrateMatches(remoteMatchSnapshots);
  }, [enabled, remoteMatchSnapshots, hydrateMatches]);

  useEffect(() => {
    if (!enabled || remoteTournamentSnapshots.length === 0) return;
    hydrateTournaments(remoteTournamentSnapshots);
  }, [enabled, remoteTournamentSnapshots, hydrateTournaments]);
};
