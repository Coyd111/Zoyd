import { createBrowserRouter } from 'react-router';
import RootLayout from './layouts/RootLayout';
import AuthLayout from './layouts/AuthLayout';
import DashboardLayout from './layouts/DashboardLayout';
import AdminLayout from './layouts/AdminLayout';

// Critical pages loaded synchronously (landing + auth)
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import NotFoundPage from './pages/NotFoundPage';

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
const adminLoader = async () => { const { default: Component } = await import('./pages/AdminDashboardPage'); return { Component }; };
const publicProfilLoader = async () => { const { default: Component } = await import('./pages/PublicProfilPage'); return { Component }; };

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      {
        index: true,
        Component: LandingPage,
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
        ],
      },
      {
        path: 'mode',
        lazy: modeLoader,
      },
      {
        path: 'mj',
        Component: DashboardLayout,
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
          {
            path: 'tournois/:id',
            lazy: bracketLoader,
          },
        ],
      },
      // Other top-level routes
      {
        path: 'wallet',
        Component: DashboardLayout,
        children: [
          {
            index: true,
            lazy: walletLoader,
          },
        ],
      },
      {
        path: 'earnings',
        Component: DashboardLayout,
        children: [{ index: true, lazy: earningsLoader }],
      },
      {
        path: 'classements',
        Component: DashboardLayout,
        children: [{ index: true, lazy: classementsLoader }],
      },
      {
        path: 'chat',
        Component: DashboardLayout,
        children: [{ index: true, lazy: chatLoader }],
      },
      {
        path: 'profil',
        Component: DashboardLayout,
        children: [
          { index: true, lazy: profilLoader },
          { path: ':id', lazy: publicProfilLoader },
        ],
      },
      {
        path: 'parametres',
        Component: DashboardLayout,
        children: [{ index: true, lazy: parametresLoader }],
      },
      {
        path: 'br-league',
        Component: DashboardLayout,
        children: [
          { index: true, lazy: leagueLoader },
          { path: ':seasonId', lazy: leagueSeasonLoader },
        ],
      },
      {
        path: 'admin',
        Component: AdminLayout,
        children: [{ index: true, lazy: adminLoader }],
        // Note: Server-side role validation should be implemented in the API
        // This is client-side protection only as defense in depth
      },
      {
        path: '*',
        Component: NotFoundPage,
      },
    ],
  },
]);
