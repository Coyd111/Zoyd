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
 *
 * Voir aussi : docs/08-frontend.md - section 6.2 (Le cycle de synchronisation)
 */
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useSocketStore } from '../stores/socketStore';
import { useTournamentStore } from '../stores/tournamentStore';

export const REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;

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

  useEffect(() => {
    if (!enabled || !isAuthenticated || !userId) {
      useSocketStore.getState().disconnect();
      didBootstrapRef.current = false;
      return;
    }

    const user = useAuthStore.getState().user;
    if (!user) return;
    const socketStore = useSocketStore.getState();
    socketStore.connect(user);

    if (!didBootstrapRef.current) {
      didBootstrapRef.current = true;
      socketStore
        .bootstrapServerState(user)
        .catch(() => {
          // Échec (session realtime expirée pendant un sleep Render, timeout) :
          // on autorise un nouvel essai au prochain montage.
          didBootstrapRef.current = false;
        });
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
