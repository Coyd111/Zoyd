import React from 'react';
import { Link, useLocation } from 'react-router';
import { BarChart3, LayoutGrid, LogOut, MessageCircle, Newspaper, Plus, Settings, ShieldCheck, Trophy, Users, Zap, TrendingUp } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { cn } from '../../../lib/utils';
import { useLogout } from '../../hooks/useLogout';

const navItems = [
  { icon: LayoutGrid, label: 'MULTIJOUEUR', path: '/mj' },
  { icon: Trophy, label: 'TOURNOIS', path: '/mj/tournois' },
  { icon: Zap, label: 'BR LEAGUE', path: '/br-league' },
  { icon: BarChart3, label: 'CLASSEMENTS', path: '/classements' },
  { icon: TrendingUp, label: 'GAINS', path: '/earnings' },
  { icon: Newspaper, label: 'INFOS', path: '/infos' },
];

const adminNavItem = { icon: ShieldCheck, label: 'CONTROLE', path: '/admin' };

const socialItems = [
  { icon: MessageCircle, label: 'MESSAGES', path: '/chat' },
  { icon: Users, label: 'AMIS', path: '/chat' },
];

const Sidebar: React.FC = React.memo(() => {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const unreadMessages = useChatStore((s) => s.getUnreadTotal());
  const handleLogout = useLogout();
  const safeUser = user || { pseudo: 'ShadowX' };
  const isAdmin = user?.role === 'admin';

  const items = isAdmin ? [...navItems, adminNavItem] : navItems;

  return (
    // Barre compacte : icônes seules (le libellé passe en title/aria-label).
    // La largeur passe de w-64 à w-16, ce qui rend la place au contenu sur
    // les écrans 1280-1440 où la colonne de texte mangeait trop de largeur.
    <aside aria-label="Barre de navigation" className="hidden md:flex flex-col w-16 min-h-[calc(100dvh-3.5rem)] bg-zoyd-black border-r border-white/5 sticky top-14 items-center">
      <div className="flex-1 overflow-y-auto w-full py-4 md:py-6 flex flex-col items-center gap-6">
        <nav className="w-full flex flex-col items-center gap-1" aria-label="Navigation principale">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/mj' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex items-center justify-center w-12 h-12 touch-target transition-all',
                  isActive ? 'bg-white text-black shadow-[3px_0_0_0_#FFE600]' : 'text-white/70 hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
              </Link>
            );
          })}
        </nav>

        <div className="w-full px-3 flex flex-col gap-2">
          <Link
            to="/mj/creer"
            title="Créer un match"
            aria-label="Créer un match"
            className="flex items-center justify-center w-full h-12 bg-zoyd-yellow text-black touch-target hover:bg-white transition-colors"
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
          </Link>
          <Link
            to="/mj/tournois/creer"
            title="Créer un tournoi"
            aria-label="Créer un tournoi"
            className="flex items-center justify-center w-full h-12 border border-white/10 text-white touch-target hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors"
          >
            <Trophy className="w-5 h-5" aria-hidden="true" />
          </Link>
        </div>

        <nav className="w-full flex flex-col items-center gap-1" aria-label="Communauté">
          {socialItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            const showBadge = item.label === 'MESSAGES' && unreadMessages > 0;
            return (
              <Link
                key={item.label}
                to={item.path}
                title={item.label}
                aria-label={showBadge ? `${item.label} (${unreadMessages} non lus)` : item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex items-center justify-center w-12 h-12 touch-target transition-all',
                  isActive ? 'bg-white/5 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                {showBadge ? (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 flex items-center justify-center bg-zoyd-blue text-white text-[9px] font-bold tabular-nums pointer-events-none"
                    aria-hidden="true"
                  >
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="w-full py-3 flex flex-col items-center gap-1 border-t border-white/5">
        <Link
          to="/parametres"
          title="Paramètres"
          aria-label="Paramètres"
          className="flex items-center justify-center w-12 h-12 touch-target text-white/60 hover:text-white hover:bg-white/5 transition-all"
        >
          <Settings className="w-5 h-5" aria-hidden="true" />
        </Link>
        <button
          onClick={handleLogout}
          title="Se déconnecter"
          aria-label="Se déconnecter"
          className="flex items-center justify-center w-12 h-12 touch-target text-red-400 hover:bg-red-400/10 transition-all"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <Link
        to="/profil"
        title={safeUser.pseudo}
        aria-label={`Mon profil — ${safeUser.pseudo}`}
        className="w-full py-3 border-t border-white/5 flex items-center justify-center group"
      >
        <div className="w-9 h-9 flex items-center justify-center font-display font-black text-white text-[10px] group-hover:text-zoyd-yellow transition-colors">
          {safeUser.pseudo.slice(0, 2).toUpperCase()}
        </div>
      </Link>
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';

export { Sidebar };
