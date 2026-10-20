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
 *
 * Voir aussi : docs/08-frontend.md - section 3 (Le routeur)
 */
import { createBrowserRouter, Navigate } from 'react-router';
import RootLayout from './layouts/RootLayout';
import AuthLayout from './layouts/AuthLayout';
import AppLayout from './layouts/AppLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';

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

// Lazy page loaders
const modeLoader = async () => { const { default: Component } = await import('./pages/ModeSelectionPage'); return { Component }; };
const hubLoader = async () => { const { default: Component } = await import('./pages/mj/HubMJPage'); return { Component }; };
const createMatchLoader = async () => { const { default: Component } = await import('./pages/mj/CreateMatchPage'); return { Component }; };
const createTournamentLoader = async () => { const { default: Component } = await import('./pages/mj/CreateTournamentPage'); return { Component }; };
const walletLoader = async () => { const { default: Component } = await import('./pages/WalletPage'); return { Component }; };
const profilLoader = async () => { const { default: Component } = await import('./pages/ProfilPage'); return { Component }; };
const classementsLoader = async () => { const { default: Component } = await import('./pages/ClassementsPage'); return { Component }; };
const chatLoader = async () => { const { default: Component } = await import('./pages/ChatPage'); return { Component }; };
const parametresLoader = async () => { const { default: Component } = await import('./pages/ParametresPage'); return { Component }; };
const earningsLoader = async () => { const { default: Component } = await import('./pages/EarningsDashboard'); return { Component }; };
const matchDetailLoader = async () => { const { default: Component } = await import('../features/match/pages/MatchDetailPage'); return { Component }; };
const tournoisLoader = async () => { const { default: Component } = await import('../features/tournament/pages/TournoisPage'); return { Component }; };
const bracketLoader = async () => { const { default: Component } = await import('../features/tournament/pages/TournamentBracketPage'); return { Component }; };
const leagueLoader = async () => { const { default: Component } = await import('../features/league/pages/LeaguePage'); return { Component }; };
const leagueSeasonLoader = async () => { const { default: Component } = await import('../features/league/pages/LeagueSeasonPage'); return { Component }; };
const brLoader = async () => { const { default: Component } = await import('../features/br/pages/BrPage'); return { Component }; };
const brLobbyLoader = async () => { const { default: Component } = await import('../features/br/pages/BrLobbyDetailPage'); return { Component }; };
const leaksLoader = async () => { const { default: Component } = await import('./pages/LeaksPage'); return { Component }; };
const adminLoader = async () => { const { default: Component } = await import('./pages/AdminDashboardPage'); return { Component }; };
const publicProfilLoader = async () => { const { default: Component } = await import('./pages/PublicProfilPage'); return { Component }; };

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
        path: 'classements',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, lazy: classementsLoader }],
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
