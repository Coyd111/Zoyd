import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import ToastContainer from '../components/notifications/ToastContainer';

/** Scroll to top on route change */
const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};
import { useAuthStore, type AuthState } from '../stores/authStore';
import { fetchAllMatchesFromDb, subscribeToMatches } from '../lib/matchApi';
import { useMatchStore } from '../stores/matchStore';
import { fetchServerTournaments, subscribeToTournaments } from '../lib/tournamentApi';
import { useTournamentStore } from '../stores/tournamentStore';
import { useSocketStore } from '../stores/socketStore';

const RootLayout: React.FC = () => {
  const isAuthenticated = useAuthStore((state: AuthState) => state.isAuthenticated);
  const isSocketConnected = useSocketStore((s) => s.isConnected);

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchAllMatchesFromDb().then((matches) => {
      useMatchStore.getState().replaceFromServer(matches);
    }).catch(() => {});

    return () => {
      useMatchStore.getState().replaceFromServer([]);
      useTournamentStore.getState().replaceFromServer([]);
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
        useTournamentStore.getState().replaceFromServer(res.tournaments);
      }
    }).catch(() => {});

    if (isSocketConnected) return;

    const { unsubscribe } = subscribeToTournaments(() => {
      fetchServerTournaments().then((res) => {
        if (res.ok) {
          useTournamentStore.getState().replaceFromServer(res.tournaments);
        }
      }).catch(() => {});
    });

    return () => unsubscribe();
  }, [isAuthenticated, isSocketConnected]);

  return (
    <>
      <ScrollToTop />
      <Outlet />
      <ToastContainer />
    </>
  );
};

export default RootLayout;
