/**
 * AppLayout - chrome applicative : Navbar, Sidebar, BottomNav, zone principale.
 *
 * Enveloppe toutes les routes authentifiees (/mj, /wallet, /chat, /admin...).
 * Pose le lien d'evitement d'accessibilite, branche useRealtimeHeartbeat et
 * rend l'Outlet de la route enfant.
 *
 * INVARIANT : `requireAdmin` est un garde d'UX, PAS une autorisation. Il
 * redirige vers /mj si le role n'est pas admin, mais n'intercepte aucune
 * requete : n'importe qui peut appeler /api/admin/* sans navigateur. La
 * barriere reelle est serveur (requireAdmin / requireAdmin2fa).
 * PIEGE : `min-w-0` + `overflow-x-clip` sur <main> sont obligatoires ; sans
 * eux, le min-content des descendants etire main au-dela du viewport.
 * PIEGE : le socket est monte ici (useRealtimeHeartbeat) : le debrancher
 * laisse l'interface affichee sans jamais resynchroniser.
 *
 * Voir aussi : docs/08-frontend.md - section 5 (Les gardes client)
 */
import React from 'react';
import { Outlet, Navigate, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { BottomNav } from '../components/layout/BottomNav';
import { useRealtimeHeartbeat } from '../hooks/useRealtimeHeartbeat';
import { useAuthStore } from '../stores/authStore';
import { IntegrityCovenantModal } from '../components/integrity/IntegrityCovenantModal';
import { pageTransition, pageTransitionProps } from '../../lib/motion';

interface AppLayoutProps {
  requireAdmin?: boolean;
  children?: React.ReactNode;
}

const AppLayout = ({ requireAdmin = false, children }: AppLayoutProps) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  const isAdmin = user?.role === 'admin';

  useRealtimeHeartbeat(isAuthenticated);

  const [covenantDismissed, setCovenantDismissed] = React.useState(false);
  const [covenantOpen, setCovenantOpen] = React.useState(false);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-zoyd-yellow rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/mj" replace />;
  }

  // Serment d'intégrité (P0-1 UI/UX) : le joueur doit voir l'arène AVANT de
  // signer — un mur plein écran de 10 clics avant le 1er match fait abandonner.
  // Le scellement reste serveur, une seule fois par compte. On affiche le
  // chrome et on propose le serment en bannière + modale fermable ("Découvrir
  // l'arène d'abord"). La date reste posée serveur au scellement, invariante.
  const covenantMissing = Boolean(user && !user.covenant?.acceptedAt);
  const showCovenantModal = covenantMissing && covenantOpen;

  return (
    <div className="min-h-dvh bg-zoyd-black safe-top">
      {showCovenantModal ? (
        <IntegrityCovenantModal onClose={() => setCovenantOpen(false)} />
      ) : null}
      {covenantMissing && !showCovenantModal && !covenantDismissed ? (
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-zoyd-yellow/30 bg-zoyd-black/95 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-white/80">
          <span>Serment d'intégrité à signer avant de miser</span>
          <span className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setCovenantOpen(true)} className="bg-zoyd-yellow px-3 py-1.5 font-display font-black text-black">Signer</button>
            <button type="button" onClick={() => setCovenantDismissed(true)} className="border border-white/20 px-3 py-1.5">Découvrir d'abord</button>
          </span>
        </div>
      ) : null}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:font-display focus:font-black focus:text-xs focus:uppercase focus:tracking-widest">
        Aller au contenu principal
      </a>
      <Navbar />
      <div className="flex">
        <Sidebar />
        {/* min-w-0 : sans ça, le min-content des descendants (onglets nowrap,
            inputs, grilles) étire main au-delà du viewport (flex item min-width:auto).
            Avec overflow-x-clip, ça ne scrollait pas — mais le contenu était rogné. */}
        <main id="main-content" className="flex-1 min-w-0 pb-24 md:pb-4 overflow-x-clip">
          {/* Transition de page (fade + montée 10 px) : sans elle, chaque
              navigation remplaçait l'écran d'un bloc — perceptible comme un
              flash. Clé = pathname : la page sortante fade-out pendant
              que la suivante monte, sans mode="wait" (pas de latence). */}
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              {...pageTransitionProps}
              variants={pageTransition}
            >
              {children ?? <Outlet />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <BottomNav />
    </div>
  );
};

export default AppLayout;
