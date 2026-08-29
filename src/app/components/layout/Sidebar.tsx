import React from 'react';
import { Link, useLocation } from 'react-router';
import { BarChart3, LayoutGrid, MessageCircle, Newspaper, Plus, Settings, ShieldCheck, Trophy, Users, Wallet, Zap, TrendingUp } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWalletStore } from '../../stores/walletStore';
import { useChatStore } from '../../stores/chatStore';
import { cn, formatZC } from '../../../lib/utils';
import ZoydLogo from '../branding/ZoydLogo';
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
  const { user } = useAuthStore();
  const totalBalance = useWalletStore((s) => s.getTotalBalance());
  const unreadMessages = useChatStore((s) => s.getUnreadTotal());
  const handleLogout = useLogout();
  const safeUser = user || { pseudo: 'ShadowX' };
  const isAdmin = user?.role === 'admin';

  const items = isAdmin ? [...navItems, adminNavItem] : navItems;

  return (
    <aside className="hidden md:flex flex-col w-64 min-h-[calc(100dvh-3.5rem)] bg-zoyd-black border-r border-white/5 sticky top-14">
      <div className="flex-1 overflow-y-auto px-4 py-8 space-y-10">
        <div>
          <div className="text-[10px] font-display font-black text-white/40 uppercase tracking-[0.3em] mb-4 px-3 italic">Navigation</div>
          <div className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/mj' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3 touch-target transition-all font-display font-black text-xs tracking-widest italic uppercase',
                    isActive ? 'bg-white text-black translate-x-1 shadow-[4px_0_0_0_#FFE600]' : 'text-white/40 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="px-2">
          <div className="space-y-2">
            <Link to="/mj/creer" className="flex items-center justify-between bg-zoyd-yellow text-black py-4 px-5 touch-target font-display font-black text-xs tracking-[0.2em] italic uppercase hover:bg-white transition-colors">
              CREER UN MATCH
              <Plus className="w-5 h-5" />
            </Link>
            <Link to="/mj/tournois/creer" className="flex items-center justify-between border border-white/10 text-white py-4 px-5 touch-target font-display font-black text-xs tracking-[0.2em] italic uppercase hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors">
              CREER UN TOURNOI
              <Trophy className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-display font-black text-white/40 uppercase tracking-[0.3em] mb-4 px-3 italic">Communauté</div>
          <div className="space-y-1">
            {socialItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.label}
                  to={item.path}
                  className={cn(
                    'flex items-center justify-between px-4 py-3 touch-target transition-all font-display font-black text-xs tracking-widest italic uppercase',
                    isActive ? 'bg-white/5 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'
                  )}
                >
                  <div className="flex items-center gap-4">
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </div>
                  {item.label === 'MESSAGES' && unreadMessages > 0 ? (
                    <span className="bg-zoyd-blue text-white text-[10px] px-1.5 py-0.5 font-bold tabular-nums">
                      {unreadMessages}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-1 border-t border-white/5">
        <Link
          to="/parametres"
          className="flex items-center gap-3 px-3 py-2.5 touch-target text-white/30 hover:text-white hover:bg-white/5 transition-all font-display font-black text-[10px] tracking-widest uppercase italic"
        >
          <Settings className="w-4 h-4" />
          Paramètres
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2.5 touch-target text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-all font-display font-black text-[10px] tracking-widest uppercase italic"
        >
          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Se déconnecter
        </button>
      </div>

      <div className="p-4 border-t border-white/5">
        <Link to="/profil" className="flex items-center gap-4 group">
          <div className="w-10 h-10 flex items-center justify-center font-display font-black text-white text-xs group-hover:text-zoyd-yellow transition-colors">
            {safeUser.pseudo.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="font-display font-black text-sm text-white tracking-widest uppercase truncate">{safeUser.pseudo}</div>
            <div className="flex items-center gap-1.5 font-display font-black text-[10px] text-zoyd-yellow italic">
              <Wallet className="w-3 h-3" />
              {formatZC(totalBalance)}
            </div>
          </div>
        </Link>
      </div>
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';

export { Sidebar };
