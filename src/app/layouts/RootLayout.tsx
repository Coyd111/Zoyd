import React, { useEffect } from 'react';
import { Outlet } from 'react-router';
import ToastContainer from '../components/notifications/ToastContainer';
import { useAuthStore } from '../stores/authStore';
import { fetchCurrentUser } from '../lib/authApi';
import { fetchAllMatchesFromDb, subscribeToMatches } from '../lib/matchApi';
import { useMatchStore } from '../stores/matchStore';
import { fetchServerTournaments, subscribeToTournaments } from '../lib/tournamentApi';
import { useTournamentStore } from '../stores/tournamentStore';

const RootLayout: React.FC = () => {
  const { sessionToken, hydrateSession, logout } = useAuthStore();

  useEffect(() => {
    // Check initial session with our node backend instead of supabase
    if (sessionToken) {
      fetchCurrentUser(sessionToken)
        .then((res) => {
          if (res.ok && res.user) {
            hydrateSession(res.user, sessionToken);
          } else {
            logout();
          }
        })
        .catch(() => logout());
    }
  }, [sessionToken, hydrateSession, logout]);

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
