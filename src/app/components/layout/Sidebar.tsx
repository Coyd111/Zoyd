import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BarChart3, LayoutGrid, MessageCircle, Plus, Settings, ShieldCheck, Trophy, Users, Wallet, Zap } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWalletStore } from '../../stores/walletStore';
import { useChatStore } from '../../stores/chatStore';
import { useSocketStore } from '../../stores/socketStore';
import { cn, formatZC } from '../../../lib/utils';
import ZoydLogo from '../branding/ZoydLogo';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { getTotalBalance } = useWalletStore();
  const { getUnreadTotal } = useChatStore();
  const safeUser = user || { pseudo: 'ShadowX' };
  const totalBalance = getTotalBalance();
  const unreadMessages = getUnreadTotal();
  const isAdmin = user?.role === 'admin';

  const navItems = [
    { icon: LayoutGrid, label: 'MULTIJOUEUR', path: '/mj' },
    { icon: Trophy, label: 'TOURNOIS', path: '/mj/tournois' },
    { icon: Zap, label: 'BR LEAGUE', path: '/br-league' },
    { icon: BarChart3, label: 'CLASSEMENTS', path: '/classements' },
    ...(isAdmin ? [{ icon: ShieldCheck, label: 'CONTROLE', path: '/admin' }] : []),
  ];

  const socialItems = [
    { icon: MessageCircle, label: 'MESSAGES', path: '/chat', badge: unreadMessages > 0 ? String(unreadMessages) : undefined },
    { icon: Users, label: 'AMIS', path: '/chat' },
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen bg-zoyd-black sticky top-0 z-50">
      <div className="h-14 flex items-center px-6">
        <Link to="/mj" className="overflow-hidden">
          <ZoydLogo compact />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-10 space-y-12">
        <div>
          <div className="text-[9px] font-display font-black text-white/20 uppercase tracking-[0.3em] mb-6 px-3 italic">Navigation</div>
          <div className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/mj' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3 transition-all font-display font-black text-xs tracking-widest italic uppercase',
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
          <div className="space-y-3">
            <Link to="/mj/creer" className="flex items-center justify-between bg-zoyd-yellow text-black py-4 px-5 font-display font-black text-xs tracking-[0.2em] italic uppercase hover:bg-white transition-colors">
              CREER UN MATCH
              <Plus className="w-5 h-5" />
            </Link>
            <Link to="/mj/tournois/creer" className="flex items-center justify-between border border-white/10 text-white py-4 px-5 font-display font-black text-xs tracking-[0.2em] italic uppercase hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors">
              CREER UN TOURNOI
              <Trophy className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div>
          <div className="text-[9px] font-display font-black text-white/20 uppercase tracking-[0.3em] mb-6 px-3 italic">Communaute</div>
          <div className="space-y-2">
            {socialItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.label}
                  to={item.path}
                  className={cn(
                    'flex items-center justify-between px-4 py-3 transition-all font-display font-black text-xs tracking-widest italic uppercase',
                    isActive ? 'bg-white/5 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'
                  )}
                >
                  <div className="flex items-center gap-4">
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </div>
                  {item.badge ? (
                    <span className="bg-zoyd-blue text-white text-[9px] px-1.5 py-0.5 font-bold tabular-nums">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        <Link
          to="/parametres"
          className="flex items-center gap-3 px-3 py-2 text-white/30 hover:text-white hover:bg-white/5 transition-all font-display font-black text-[10px] tracking-widest uppercase italic"
        >
          <Settings className="w-3 h-3" />
          Parametres
        </Link>
        <button
          onClick={() => {
            useSocketStore.getState().disconnect();
            useAuthStore.getState().logout();
            navigate('/auth/login');
          }}
          className="flex w-full items-center gap-3 px-3 py-2 text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-all font-display font-black text-[10px] tracking-widest uppercase italic"
        >
          <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Se deconnecter
        </button>
      </div>

      <div className="p-5">
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
};

export { Sidebar };
