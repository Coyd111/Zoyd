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
 * P13 C8 (audit-3) : le bootstrap des collections depend de l'IDENTITE
 * (user?.id), pas du transport : une coupure reseau ne re-fetch PAS les
 * collections. Le polling de secours rejoue aux transitions du transport,
 * mais son fetch de rattrapage ne s'execute qu'apres une COUPURE du
 * socket - a la reconnexion, socketConnectionStore resynchronise deja les
 * deltas perdus (dirtySinceDisconnect) : refetcher la en plus etait un
 * doublon (pic de charge a chaque retour reseau mobile).
 */
import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import ToastContainer from '../components/notifications/ToastContainer';
import { pageTransition, pageTransitionProps } from '../../lib/motion';

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
  const { pathname } = useLocation();
  // P13 C8 (audit-3) : l'identite, pas seulement un booleen - changer de
  // compte doit re-bootstraper, une coupure de transport ne doit pas
  // (meme critere que useRealtimeHeartbeat).
  const userId = useAuthStore((s) => s.user?.id);
  const isSocketConnected = useSocketStore((s) => s.isConnected);
  // Distingue une coupure du transport (rattrapage legitime) du premier
  // montage socket-deconnecte (le bootstrap vient de fetcher).
  const wasSocketConnectedRef = useRef(isSocketConnected);

  // Bootstrap des collections : une fois par session d'identite. Racine de
  // toutes les routes, ce layout ne se demonte pas : le cleanup ne joue
  // donc qu'au changement d'identite (purge a la deconnexion).
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    // Le store ne doit jamais ecrire la REPONSE D UN AUTRE COMPTE.
    //
    // La reponse peut arriver apres un logout suivi d'une autre connexion :
    // sur reseau mobile, 1 a 30 s (plus le timeout de 30 s du client). Le
    // nettoyage ci-dessous vide le store au changement d identite, mais une
    // reponse deja EN VOL le remplacerait — avec la liste complete de
    // matchs du compte precedent, dont ses matchs PRIVES et les drapeaux
    // `isMe` calcules pour LUI. Le hub du nouveau joueur afficherait alors la
    // vie privee d'un autre.
    //
    // Le garde est pose au moment de l ECRITURE (pas au moment du
    // depart) : c est la seule fenetre qui compte.
    const expectedUserId = userId;
    const ecrireSiMemeCompte = (ecrire: () => void) => {
      if (useAuthStore.getState().user?.id !== expectedUserId) return;
      ecrire();
    };

    fetchAllMatchesFromDb().then((matches) => {
      ecrireSiMemeCompte(() => useMatchStore.getState().replaceFromServer(matches));
    }).catch((err) => {
      // L erreur est un ETAT, pas un simple log : une liste de matchs vide
      // se lit comme « il n y a aucun match », et le joueur attendait un
      // match qui n arriverait jamais, sans savoir que la lecture avait
      // echoue. Le hub affiche un bandeau « Reessayer ».
      console.warn('[RootLayout] Failed to fetch matches:', err?.message);
      ecrireSiMemeCompte(() => useMatchStore.getState().setLoadError(
        err?.message || 'Chargement des matchs impossible',
      ));
    });

    fetchServerTournaments().then((res) => {
      if (res.ok) {
        ecrireSiMemeCompte(() => useTournamentStore.getState().replaceFromServer(res.tournaments));
      }
    }).catch((err) => {
      console.warn('[RootLayout] Failed to fetch tournaments:', err?.message);
    });

    return () => {
      useMatchStore.getState().replaceFromServer([]);
      useTournamentStore.getState().replaceFromServer([]);
    };
  }, [isAuthenticated, userId]);

  // Polling de secours (INVARIANT : actif seulement si le socket est
  // deconnecte). Rejoue a chaque transition du transport, mais le fetch
  // initial y etait colee : a la reconnexion il refetchait EN DOUBLE avec
  // la resync socket (dirtySinceDisconnect) - supprime (P13 C8). A la
  // coupure, le rattrapage reste legitime : sinon le premier tick de
  // l'interval laisse 30 s de donnees figees.
  useEffect(() => {
    const wasConnected = wasSocketConnectedRef.current;
    wasSocketConnectedRef.current = isSocketConnected;
    if (!isAuthenticated || isSocketConnected) return;

    if (wasConnected) {
      fetchAllMatchesFromDb().then((matches) => {
        // Meme garde multi-compte que le bootstrap : le polling peut repondre
        // apres un logout suivi d'une autre connexion.
        if (useAuthStore.getState().user?.id !== userId) return;
        useMatchStore.getState().replaceFromServer(matches);
      }).catch((err) => {
        console.warn('[RootLayout] Failed to fetch matches:', err?.message);
      });

      fetchServerTournaments().then((res) => {
        if (res.ok && useAuthStore.getState().user?.id === userId) {
          useTournamentStore.getState().replaceFromServer(res.tournaments);
        }
      }).catch((err) => {
        console.warn('[RootLayout] Failed to fetch tournaments:', err?.message);
      });
    }

    const unsubscribeMatches = subscribeToMatches(() => {
      fetchAllMatchesFromDb().then((matches) => {
        // Meme garde multi-compte que le bootstrap : le polling peut repondre
        // apres un logout suivi d'une autre connexion.
        if (useAuthStore.getState().user?.id !== userId) return;
        useMatchStore.getState().replaceFromServer(matches);
      }).catch((err) => {
        console.warn('[RootLayout] Failed to poll matches:', err?.message);
      });
    });

    const unsubscribeTournaments = subscribeToTournaments(() => {
      fetchServerTournaments().then((res) => {
        if (res.ok && useAuthStore.getState().user?.id === userId) {
          useTournamentStore.getState().replaceFromServer(res.tournaments);
        }
      }).catch((err) => {
        console.warn('[RootLayout] Failed to fetch tournaments:', err?.message);
      });
    });

    return () => {
      unsubscribeMatches.unsubscribe();
      unsubscribeTournaments.unsubscribe();
    };
  }, [isAuthenticated, isSocketConnected]);

  return (
    <>
      <ScrollToTop />
      {/* Transition des pages publiques (landing, auth, légales) — même
          grammaire que AppLayout. Quand le joueur est authentifié, le
          chrome applicatif est déjà monté et AppLayout anime son contenu :
          on ne monte donc PAS un second wrapper ici (double fondu + chrome
          remonté à chaque navigation interne). */}
      {!isAuthenticated ? (
        <AnimatePresence mode="wait">
          <motion.div key={pathname} {...pageTransitionProps} variants={pageTransition}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      ) : (
        <Outlet />
      )}
      <ToastContainer />
    </>
  );
};

export default RootLayout;
