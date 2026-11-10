/**
 * routes.tsx - routeur du front : 35 entrees, statiques pour l'accueil et
 * l'authentification, paresseuses pour tout le reste.
 *
 * createBrowserRouter. RootLayout est la racine, AppLayout enveloppe les
 * ecrans authentifies. Les pages legales sont hors AppLayout (pas de session
 * requise). Chaque branche protegee porte un errorElement.
 *
 * INVARIANT : `adminLoader` ne verifie RIEN : c'est un simple import() de
 * AdminDashboardPage. La redirection admin est faite par la prop
 * `requireAdmin` d'AppLayout, qui est de l'UX, PAS une securite. La seule
 * barriere reelle est serveur (requireAdmin / requireAdmin2fa sur /api/admin/*).
 * PIEGE : toute page ajoutee ici doit l'etre via un loader paresseux, sauf
 * s'il s'agit de l'accueil, de l'auth, d'une page legale ou du 404.
 * PIEGE : deux routes de compatibilite redirigent les URLs accentuees vers
 * les URLs ASCII ; les supprimer casse les liens deja partages.
 */
import { createBrowserRouter, Navigate } from 'react-router';
import RootLayout from './layouts/RootLayout';
import AuthLayout from './layouts/AuthLayout';
import AppLayout from './layouts/AppLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { isStaleChunkError, chunkRetryKey, reloadWithFreshBuild } from '../lib/buildVersion';

// Critical pages loaded synchronously (landing + auth)
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ActivatePage from './pages/auth/ActivatePage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import NotFoundPage from './pages/NotFoundPage';
import RootIndexPage from './pages/RootIndexPage';
import ConditionsPage from './pages/legal/ConditionsPage';
import LitigesPage from './pages/legal/LitigesPage';
import AntiFraudePage from './pages/legal/AntiFraudePage';
import ConfidentialitePage from './pages/legal/ConfidentialitePage';
import MentionsPage from './pages/legal/MentionsPage';
import JeuResponsablePage from './pages/legal/JeuResponsablePage';

// Lazy page loaders — retry sur chunk périmé (déploiement entre le
// chargement de la page et le premier rendu paresseux : le hash du chunk a
// changé, l'ancien `index.html` pointe dans le vide → 404 → RouteErrorBoundary).
//
// ANTI-RÉCURRENCE (corrige l'écran « UNE MISE À JOUR EST ARRIVÉE » dès le
// 2e déploiement) : l'ancien garde `zoyd_lazy_retry = 1` par SESSION
// bloquait tout retry après le premier déploiement. Désormais la clé est
// PAR (build, chunk) et le rechargement contourne le cache : chaque nouveau
// déploiement récupère un retry, sans boucler. En parallèle, versionWatcher
// (/version.json) recharge préventivement avant le clic fautif.
const lazyWithRetry = (loader: () => Promise<{ default: React.ComponentType }>) => async () => {
  try {
    const { default: Component } = await loader();
    return { Component };
  } catch (error) {
    if (isStaleChunkError(error)) {
      const key = chunkRetryKey(error);
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        reloadWithFreshBuild();
        return { Component: (() => null) as React.ComponentType };
      }
    }
    throw error;
  }
};
const modeLoader = lazyWithRetry(() => import('./pages/ModeSelectionPage'));
const hubLoader = lazyWithRetry(() => import('./pages/mj/HubMJPage'));
const createMatchLoader = lazyWithRetry(() => import('./pages/mj/CreateMatchPage'));
const createTournamentLoader = lazyWithRetry(() => import('./pages/mj/CreateTournamentPage'));
const walletLoader = lazyWithRetry(() => import('./pages/WalletPage'));
const profilLoader = lazyWithRetry(() => import('./pages/ProfilPage'));
const classementsLoader = lazyWithRetry(() => import('./pages/ClassementsGateway'));
const chatLoader = lazyWithRetry(() => import('./pages/ChatPage'));
const parametresLoader = lazyWithRetry(() => import('./pages/ParametresPage'));
const earningsLoader = lazyWithRetry(() => import('./pages/EarningsDashboard'));
const matchDetailLoader = lazyWithRetry(() => import('../features/match/pages/MatchDetailPage'));
const tournoisLoader = lazyWithRetry(() => import('../features/tournament/pages/TournoisPage'));
const bracketLoader = lazyWithRetry(() => import('../features/tournament/pages/TournamentBracketPage'));
const leagueLoader = lazyWithRetry(() => import('../features/league/pages/LeaguePage'));
const leagueSeasonLoader = lazyWithRetry(() => import('../features/league/pages/LeagueSeasonPage'));
const brLoader = lazyWithRetry(() => import('../features/br/pages/BrPage'));
const brLobbyLoader = lazyWithRetry(() => import('../features/br/pages/BrLobbyDetailPage'));
const leaksLoader = lazyWithRetry(() => import('./pages/LeaksPage'));
const adminLoader = lazyWithRetry(() => import('./pages/AdminDashboardPage'));
const publicProfilLoader = lazyWithRetry(() => import('./pages/PublicProfilPage'));

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        Component: RootIndexPage,
      },
      {
        path: 'auth',
        Component: AuthLayout,
        children: [
          {
            path: 'login',
            Component: LoginPage,
          },
          {
            path: 'register',
            Component: RegisterPage,
          },
          {
            path: 'activate',
            Component: ActivatePage,
          },
          {
            path: 'forgot',
            Component: ForgotPasswordPage,
          },
        ],
      },
      {
        path: 'mode',
        lazy: modeLoader,
      },
      // Pages légales publiques (pas de login requis)
      {
        path: 'conditions',
        Component: ConditionsPage,
      },
      {
        path: 'reglement-litiges',
        Component: LitigesPage,
      },
      {
        path: 'anti-fraude',
        Component: AntiFraudePage,
      },
      {
        path: 'confidentialite',
        Component: ConfidentialitePage,
      },
      {
        path: 'mentions',
        Component: MentionsPage,
      },
      {
        path: 'jeu-responsable',
        Component: JeuResponsablePage,
      },
      {
        path: 'mj',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          {
            index: true,
            lazy: hubLoader,
          },
          {
            path: 'creer',
            lazy: createMatchLoader,
          },
          {
            path: 'match/:id',
            lazy: matchDetailLoader,
          },
          {
            path: 'tournois',
            lazy: tournoisLoader,
          },
          {
            path: 'tournois/creer',
            lazy: createTournamentLoader,
          },
          // Compat : anciennes URLs accentuées partagées avant le renommage.
          {
            path: 'créer',
            element: <Navigate to="/mj/creer" replace />,
          },
          {
            path: 'tournois/créer',
            element: <Navigate to="/mj/tournois/creer" replace />,
          },
          {
            path: 'tournois/:id',
            lazy: bracketLoader,
          },
        ],
      },
      // Other top-level routes
      {
        path: 'wallet',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          {
            index: true,
            lazy: walletLoader,
          },
        ],
      },
      {
        path: 'earnings',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, lazy: earningsLoader }],
      },
      {
        // ClassementsGateway arbitre : anonyme -> PublicClassementsPage
        // (endpoints publics sans AppLayout), authentifie -> ClassementsPage
        // dans AppLayout. Un seul chemin URL, deux lecteurs.
        path: 'classements',
        lazy: classementsLoader,
      },
      {
        path: 'chat',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, lazy: chatLoader }],
      },
      {
        path: 'profil',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, lazy: profilLoader },
          { path: ':id', lazy: publicProfilLoader },
        ],
      },
      {
        path: 'parametres',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, lazy: parametresLoader }],
      },
      {
        path: 'br-league',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, lazy: leagueLoader },
          { path: ':seasonId', lazy: leagueSeasonLoader },
        ],
      },
      {
        // Battle Royale : salon unique, un seul match. Distinct de br-league
        // (5 jours, top 40) et de mj (1v1-5v5).
        path: 'br',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, lazy: brLoader },
          { path: ':lobbyId', lazy: brLobbyLoader },
        ],
      },
      {
        path: 'infos',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, lazy: leaksLoader }],
      },
      {
        path: 'admin',
        element: <AppLayout requireAdmin />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, lazy: adminLoader }],
      },
      {
        path: '*',
        Component: NotFoundPage,
      },
    ],
  },
]);
