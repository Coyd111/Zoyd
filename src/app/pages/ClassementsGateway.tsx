/**
 * ClassementsGateway - arbitre la route /classements entre deux versions :
 *
 * - AUTHENTIFIE  : ClassementsPage historique (agregation cote client a
 *   partir des stores presents au bootstrap) rendue dans AppLayout.
 * - ANONYME      : PublicClassementsPage (photo reelle SERVEUR via les
 *   endpoints publics /api/leaderboard + /api/stats) — SANS AppLayout.
 *
 * Pourquoi un gateway : avant, le visiteur anonyme etait redirige
 * /auth/login par AppLayout — frontiere qui tuerait toute valeur SEO
 * de /classements (elle avait donc ete sortie du sitemap, S-1). Le point d'entree SUBSTITUE une page a l'autre a
 * chaud selon l'etat du store : un seul chemin URL, deux lecteurs.
 *
 * INVARIANT : la version authentifiee reste CHARGEE A LA DEMANDE
 * (React.lazy) — elle ne doit jamais entrer dans le chunk de la route
 * publique (equilibre S-4 de l'entry).
 * INVARIANT : cet arbitrage est de l'UX — la barriere reelle reste
 * serveur (requireAdmin ; /api/leaderboard est public) : rendre la
 * PAGE anonyme n'expose rien de neuf (projection serveur deja publique).
 * PIEGE : NE PAS rendre AppLayout pour l'anonyme : Navbar/Sidebar/
 * BottomNav consomment le store utilisateur et attendent pour rien —
 * le socket n'a pas ete bootstrappe et tournerait en echec repetes.
 *
 * Voir aussi : routes.tsx (classementsLoader), PublicClassementsPage.tsx,
 * ClassementsPage.tsx, docs/08-frontend.md - section 5 (Les gardes client).
 */
import React, { Suspense } from 'react';
import AppLayout from '../layouts/AppLayout';
import { Skeleton } from '../components/ui/Skeleton';
import { useAuthStore } from '../stores/authStore';
import PublicClassementsPage from './PublicClassementsPage';

// Lazy : la page authentifiee reste dans son chunk dedie (comme elle
// l'etait quand le routeur la chargait directement).
const AuthedClassements = React.lazy(() => import('./ClassementsPage'));

const GatewayLoading: React.FC = () => (
  <div className="min-h-dvh bg-zoyd-black flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-white/20 border-t-zoyd-yellow rounded-full animate-spin" />
  </div>
);

// Fallback du lazy : squelettes de lignes, famille visuelle du tableau.
const RowsFallback: React.FC = () => (
  <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 py-8">
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-16 bg-white/5" />
      ))}
    </div>
  </div>
);

const ClassementsGateway: React.FC = () => {
  const isLoading = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isLoading) return <GatewayLoading />;
  if (!isAuthenticated) return <PublicClassementsPage />;
  return (
    <AppLayout>
      <Suspense fallback={<RowsFallback />}>
        <AuthedClassements />
      </Suspense>
    </AppLayout>
  );
};

export default ClassementsGateway;
