import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useSocketStore } from '../stores/socketStore';
import { useTournamentStore } from '../stores/tournamentStore';

export const REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;

export const useRealtimeHeartbeat = (enabled: boolean) => {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const replaceMatches = useMatchStore((state) => state.replaceFromServer);
  const replaceTournaments = useTournamentStore((state) => state.replaceFromServer);

  const didBootstrapRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !user) {
      useSocketStore.getState().disconnect();
      didBootstrapRef.current = false;
      return;
    }

    const socketStore = useSocketStore.getState();
    socketStore.connect(user);

    if (!didBootstrapRef.current) {
      didBootstrapRef.current = true;
      void socketStore.bootstrapServerState(user);
    }

    const sync = () => {
      const currentUser = useAuthStore.getState().user;
      const currentMatchStore = useMatchStore.getState();
      const currentMatches = currentMatchStore.matches;

      socketStore.syncFromMatches(currentMatches, currentUser);
    };

    sync();

    const interval = window.setInterval(sync, REALTIME_HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      useSocketStore.getState().disconnect();
    };
  }, [enabled, isAuthenticated, user]);

  useEffect(() => {
    if (!enabled) return;
    const snapshots = useSocketStore.getState().remoteMatchSnapshots;
    if (snapshots.length > 0) replaceMatches(snapshots);
  }, [enabled, replaceMatches]);

  useEffect(() => {
    if (!enabled) return;
    const snapshots = useSocketStore.getState().remoteTournamentSnapshots;
    if (snapshots.length > 0) replaceTournaments(snapshots);
  }, [enabled, replaceTournaments]);
};
