import React, { useEffect } from 'react';
import { Outlet } from 'react-router';
import ToastContainer from '../components/notifications/ToastContainer';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { fetchCurrentUser } from '../lib/authApi';
import { fetchAllMatchesFromDb, subscribeToMatches } from '../lib/matchApi';
import { useMatchStore } from '../stores/matchStore';
import { fetchServerTournaments, subscribeToTournaments } from '../lib/tournamentApi';
import { useTournamentStore } from '../stores/tournamentStore';

const RootLayout: React.FC = () => {
  const { hydrateSession, logout } = useAuthStore();

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        fetchCurrentUser(session.access_token)
          .then((res) => hydrateSession(res.user, session.access_token))
          .catch(() => logout());
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        fetchCurrentUser(session.access_token)
          .then((res) => hydrateSession(res.user, session.access_token))
          .catch(() => logout());
      } else {
        logout();
      }
    });

    return () => subscription.unsubscribe();
  }, [hydrateSession, logout]);

  useEffect(() => {
    // Initial fetch of all matches
    fetchAllMatchesFromDb().then((matches) => {
      useMatchStore.getState().replaceFromServer(matches);
    });

    // Subscribe to realtime updates for matches and participants
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
      useTournamentStore.setState({ tournaments: res.tournaments });
    });

    // Subscribe to realtime updates for tournaments
    const { unsubscribe } = subscribeToTournaments(() => {
      fetchServerTournaments().then((res) => {
        useTournamentStore.setState({ tournaments: res.tournaments });
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
