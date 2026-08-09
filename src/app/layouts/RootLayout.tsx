import React, { useEffect } from 'react';
import { Outlet } from 'react-router';
import ToastContainer from '../components/notifications/ToastContainer';
import { useAuthSessionBootstrap } from '../hooks/useAuthSessionBootstrap';
import { fetchAllMatchesFromDb, subscribeToMatches } from '../lib/matchApi';
import { useMatchStore } from '../stores/matchStore';
import { fetchServerTournaments, subscribeToTournaments } from '../lib/tournamentApi';
import { useTournamentStore } from '../stores/tournamentStore';

const RootLayout: React.FC = () => {
  useAuthSessionBootstrap();

  useEffect(() => {
    // Initial fetch of all matches
    fetchAllMatchesFromDb().then((matches) => {
      useMatchStore.getState().replaceFromServer(matches);
    });

    // Subscribes via the dummy unsubscribe function (realtime is managed by socketStore)
    const { unsubscribe } = subscribeToMatches(() => {
      fetchAllMatchesFromDb().then((matches) => {
        useMatchStore.getState().replaceFromServer(matches);
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Initial fetch of all tournaments
    fetchServerTournaments().then((res) => {
      if (res.ok) {
        useTournamentStore.setState({ tournaments: res.tournaments });
      }
    });

    const { unsubscribe } = subscribeToTournaments(() => {
      fetchServerTournaments().then((res) => {
        if (res.ok) {
          useTournamentStore.setState({ tournaments: res.tournaments });
        }
      });
    });

    return () => unsubscribe();
  }, []);

  return (
    <>
      <Outlet />
      <ToastContainer />
    </>
  );
};

export default RootLayout;
