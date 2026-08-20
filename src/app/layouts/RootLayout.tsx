import React, { useEffect } from 'react';
import { Outlet } from 'react-router';
import ToastContainer from '../components/notifications/ToastContainer';
import { useAuthSessionBootstrap } from '../hooks/useAuthSessionBootstrap';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { fetchAllMatchesFromDb, subscribeToMatches } from '../lib/matchApi';
import { useMatchStore } from '../stores/matchStore';
import { fetchServerTournaments, subscribeToTournaments } from '../lib/tournamentApi';
import { useTournamentStore } from '../stores/tournamentStore';
import { useSocketStore } from '../stores/socketStore';

const RootLayout: React.FC = () => {
  useAuthSessionBootstrap();
  const isAuthenticated = useAuthStore((state: AuthState) => state.isAuthenticated);
  const isSocketConnected = useSocketStore((s) => s.isConnected);

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchAllMatchesFromDb().then((matches) => {
      useMatchStore.getState().replaceFromServer(matches);
    }).catch(() => {});

    return () => {
      useMatchStore.getState().replaceFromServer([]);
      useTournamentStore.setState({ tournaments: [] });
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Polling only when socket is NOT connected (realtime via socket when connected)
    if (isSocketConnected) return;

    const { unsubscribe } = subscribeToMatches(() => {
      fetchAllMatchesFromDb().then((matches) => {
        useMatchStore.getState().replaceFromServer(matches);
      }).catch(() => {});
    });

    return () => unsubscribe();
  }, [isAuthenticated, isSocketConnected]);

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchServerTournaments().then((res) => {
      if (res.ok) {
        useTournamentStore.setState({ tournaments: res.tournaments });
      }
    }).catch(() => {});

    if (isSocketConnected) return;

    const { unsubscribe } = subscribeToTournaments(() => {
      fetchServerTournaments().then((res) => {
        if (res.ok) {
          useTournamentStore.setState({ tournaments: res.tournaments });
        }
      }).catch(() => {});
    });

    return () => unsubscribe();
  }, [isAuthenticated, isSocketConnected]);

  return (
    <>
      <Outlet />
      <ToastContainer />
    </>
  );
};

export default RootLayout;
