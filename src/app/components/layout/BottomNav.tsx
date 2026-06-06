import React from 'react';
import { Link, useLocation } from 'react-router';
import { LayoutGrid, Zap, Trophy, MessageCircle, User } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { motion } from 'motion/react';

const BottomNav: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { icon: LayoutGrid, label: 'LOBBY', path: '/mj' },
    { icon: Zap, label: 'CRÉER', path: '/mj/creer' },
    { icon: Trophy, label: 'TOURNOIS', path: '/mj/tournois' },
    { icon: MessageCircle, label: 'CHAT', path: '/chat' },
    { icon: User, label: 'PROFIL', path: '/profil' },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zoyd-black border-t border-white/5 pb-safe backdrop-blur-xl">
      <div className="flex items-center justify-around h-16 relative">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path || (item.path !== '/mj' && location.pathname.startsWith(item.path));
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'relative flex flex-col items-center justify-center w-full h-full transition-all',
                isActive ? 'text-white bg-white/5' : 'text-white/30 hover:text-white'
              )}
            >
              {isActive && (
                <motion.div 
                  layoutId="bottom-nav-indicator"
                  className="absolute top-0 w-full h-[3px] bg-zoyd-yellow shadow-[0_4px_10px_rgba(255,230,0,0.5)]"
                />
              )}
              <Icon className={cn("w-5 h-5 mb-1 transition-transform", isActive ? "scale-110" : "")} />
              <span className="text-[9px] font-display font-black uppercase tracking-widest italic">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export { BottomNav };
