import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useSocketStore } from '../stores/socketStore';
import { useTournamentStore } from '../stores/tournamentStore';

export const REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;

export const useRealtimeHeartbeat = (enabled: boolean) => {
  const { user, isAuthenticated } = useAuthStore();
  const replaceMatches = useMatchStore((state) => state.replaceFromServer);
  const replaceTournaments = useTournamentStore((state) => state.replaceFromServer);
  const remoteMatchSnapshots = useSocketStore((state) => state.remoteMatchSnapshots);
  const remoteTournamentSnapshots = useSocketStore((state) => state.remoteTournamentSnapshots);

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
    if (!enabled || remoteMatchSnapshots.length === 0) return;
    replaceMatches(remoteMatchSnapshots);
  }, [enabled, remoteMatchSnapshots, replaceMatches]);

  useEffect(() => {
    if (!enabled || remoteTournamentSnapshots.length === 0) return;
    replaceTournaments(remoteTournamentSnapshots);
  }, [enabled, remoteTournamentSnapshots, replaceTournaments]);
};
