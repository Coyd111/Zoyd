/**
 * RootLayout - coquille globale : ScrollToTop, Outlet, ToastContainer.
 *
 * Pere de toutes les routes. Charge les matchs et les tournois au demarrage,
 * puis bascule en POLLING HTTP quand le socket n'est pas connecte. Monte aussi
 * le ToastContainer, seul point d'affichage des toasts de l'application.
 *
 * INVARIANT : le polling n'est active que si le socket n'est pas connecte.
 * Les deux actifs en meme temps, les listes se battent et la cagnotte affichee
 * peut reculer.
 * PIEGE : le socket diffuse des DELTAS, pas la collection ; la rehydratation
 * doit passer par hydrateFromServer (fusion), jamais replaceFromServer.
 * PIEGE : ToastContainer est monte ici : le deplacer supprime tous les
 * retours utilisateur de l'app.
 *
 * Voir aussi : docs/08-frontend.md - section 4 (Les layouts)
 */
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
    }).catch((err) => {
      console.warn('[RootLayout] Failed to fetch matches:', err?.message);
    });

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
      }).catch((err) => {
        console.warn('[RootLayout] Failed to poll matches:', err?.message);
      });
    });

    return () => unsubscribe();
  }, [isAuthenticated, isSocketConnected]);

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchServerTournaments().then((res) => {
      if (res.ok) {
        useTournamentStore.getState().replaceFromServer(res.tournaments);
      }
    }).catch((err) => {
      console.warn('[RootLayout] Failed to fetch tournaments:', err?.message);
    });

    if (isSocketConnected) return;

    const { unsubscribe } = subscribeToTournaments(() => {
      fetchServerTournaments().then((res) => {
        if (res.ok) {
          useTournamentStore.getState().replaceFromServer(res.tournaments);
        }
      }).catch((err) => {
      console.warn('[RootLayout] Failed to fetch tournaments:', err?.message);
    });
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
