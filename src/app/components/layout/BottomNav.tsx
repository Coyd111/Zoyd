import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { LayoutGrid, Zap, Trophy, MessageCircle, User, BarChart3, Wallet, Settings, X, Newspaper } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const navItems = [
  { icon: LayoutGrid, label: 'MULTIJOUEUR', path: '/mj' },
  { icon: Trophy, label: 'TOURNOIS', path: '/mj/tournois' },
  { icon: Zap, label: 'BR LEAGUE', path: '/br-league' },
  { icon: BarChart3, label: 'CLASSEMENTS', path: '/classements' },
  { icon: MessageCircle, label: 'MESSAGES', path: '/chat' },
  { icon: Newspaper, label: 'INFOS', path: '/infos' },
];

const menuItems = [
  { icon: Wallet, label: 'WALLET', path: '/wallet' },
  { icon: User, label: 'PROFIL', path: '/profil' },
  { icon: Settings, label: 'PARAMÈTRES', path: '/parametres' },
];

const BottomNav: React.FC = React.memo(() => {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleNavigate = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="md:hidden fixed bottom-20 left-0 right-0 z-50 bg-zoyd-black border-t border-white/10 safe-bottom"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="font-display font-black text-[10px] text-white/40 tracking-widest uppercase italic">Plus</span>
              <button onClick={() => setMenuOpen(false)} className="touch-target flex items-center justify-center text-white/30 hover:text-white" aria-label="Fermer le menu">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 pb-4">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                    aria-label={item.label}
                    className={cn(
                      'flex items-center gap-4 w-full px-4 py-4 touch-target font-display font-black text-sm tracking-widest italic uppercase transition-all',
                      isActive ? 'text-zoyd-yellow bg-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zoyd-black/95 border-t border-white/10 safe-bottom backdrop-blur-xl">
        <div className="flex items-center justify-around h-[4.5rem] relative">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/mj' && location.pathname.startsWith(item.path));

            return (
              <Link
                key={item.path}
                to={item.path}
                aria-label={item.label}
                className={cn(
                  'relative flex flex-col items-center justify-center w-full h-full touch-target transition-all',
                  isActive ? 'text-white' : 'text-white/30'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-indicator"
                    className="absolute top-0 w-full h-[3px] bg-zoyd-yellow shadow-[0_4px_10px_rgba(255,230,0,0.5)]"
                  />
                )}
                <Icon className={cn("w-5 h-5 mb-1 transition-transform", isActive ? "scale-110" : "")} />
                <span className="text-[10px] font-display font-black uppercase tracking-widest italic">{item.label}</span>
              </Link>
            );
          })}

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Plus d'options"
            className={cn(
              'relative flex flex-col items-center justify-center w-full h-full touch-target transition-all',
              menuOpen ? 'text-white' : 'text-white/30'
            )}
          >
            {menuOpen && (
              <motion.div
                layoutId="bottom-nav-indicator"
                className="absolute top-0 w-full h-[3px] bg-zoyd-yellow shadow-[0_4px_10px_rgba(255,230,0,0.5)]"
              />
            )}
            <div className={cn("w-5 h-5 mb-1 flex flex-col items-center justify-center gap-[3px] transition-transform", menuOpen ? "scale-110" : "")}>
              <span className="block w-4 h-[2px] bg-current rounded-full" />
              <span className="block w-3 h-[2px] bg-current rounded-full" />
              <span className="block w-4 h-[2px] bg-current rounded-full" />
            </div>
            <span className="text-[10px] font-display font-black uppercase tracking-widest italic">PLUS</span>
          </button>
        </div>
      </nav>
    </>
  );
});

BottomNav.displayName = 'BottomNav';

export { BottomNav };
