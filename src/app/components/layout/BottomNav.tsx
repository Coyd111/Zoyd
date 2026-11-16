/**
 * BottomNav - barre de navigation basse (mobile), avec un menu ' Plus '.
 *
 * Version mobile de la Sidebar : memes destinations, plus un tiroir qui
 * regroupe les entrees secondaires (salons et ligue BR, classements, gains,
 * infos).
 *
 * INVARIANT : la liste de destinations doit rester coherente avec la
 * Sidebar. Une destination presente dans l'une et absente de l'autre est un
 * ecran inaccessible pour un profil de navigation donne.
 * PIEGE : c'est une navigation de confort, pas une garde. Aucun acces n'est
 * filtre par role ici : le role n'a de sens que pour l'entree d'admin.
 * PIEGE : la barre occupe le bas de l'ecran : le contenu principal doit
 * garder une marge basse (pb-24 sur le main d'AppLayout), sinon la
 * navigation cache la derniere ligne d'un ecran.
 */
import React, { useState } from 'react';
import { Sheet, SheetContent } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Link, useLocation, useNavigate } from 'react-router';
import { LayoutGrid, Zap, Trophy, MessageCircle, User, BarChart3, Wallet, Settings, Newspaper, Shield, ShieldCheck, TrendingUp, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { motion } from 'motion/react';
import { useAuthStore } from '../../stores/authStore';

const navItems = [
  // shortLabel = version affichee dans la barre. A 360 px, cinq cellules de
  // ~61 px ecrasaient MULTIJOUEUR (11 chars a 11 px tracking-widest) en
  // 'MULTIJ...' sous ellipsis CSS : 3 des 5 destinations etaient tronquees.
  // L'aria-label garde le libelle complet pour l'accessibilite, et le
  // test e2e responsive.spec.ts (U-2) refuse tout ellipsis CSS actif.
  //
  // PIEGE (WCAG 2.5.3 « Label in Name ») : le nom accessible doit
  // CONTENIR le libelle visible. « MESSAGES » ne contient pas « MSGS » :
  // une commande vocale (« clique MSGS ») ne trouvait pas le bouton. On
  // concatene donc les deux.
  { icon: LayoutGrid, label: 'MULTIJOUEUR', shortLabel: 'MULTI', path: '/mj' },
  { icon: Trophy, label: 'TOURNOIS', shortLabel: 'TOURNOI', path: '/mj/tournois' },
  { icon: MessageCircle, label: 'MESSAGES', shortLabel: 'MSGS', path: '/chat' },
  { icon: Wallet, label: 'WALLET', shortLabel: 'WALLET', path: '/wallet' },
];

const moreNavItems = [
  // P13 C1 (audit-3) : /br n'etait atteignable depuis aucun chemin mobile —
  // seule la Sidebar desktop l'exposait. Liste miroir de la Sidebar :
  // 'BR SALON' (/br) avant 'BR LEAGUE' (/br-league), icons comprises.
  { icon: Zap, label: 'BR SALON', path: '/br' },
  { icon: ShieldCheck, label: 'BR LEAGUE', path: '/br-league' },
  { icon: BarChart3, label: 'CLASSEMENTS', path: '/classements' },
  { icon: TrendingUp, label: 'GAINS', path: '/earnings' },
  { icon: Newspaper, label: 'INFOS', path: '/infos' },
];

const menuItems = [
  // P13 C16 (audit-3) : WALLET etait duplique — deja dans la barre (navItems)
  // ET premier du menu : deux chemins visuels vers la meme page dans un
  // espace de 5 items. Le menu garde PROFIL et PARAMETRES.
  { icon: User, label: 'PROFIL', path: '/profil' },
  { icon: Settings, label: 'PARAMÈTRES', path: '/parametres' },
];

const BottomNav: React.FC = React.memo(() => {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const handleNavigate = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="bottom"
          className="md:hidden bottom-20 left-0 right-0 max-h-[calc(100dvh-5rem)] w-full overflow-y-auto overscroll-contain scrollbar-hide bg-zoyd-black border-t border-white/10 p-0 gap-0"
          aria-label="Plus d'options"
          closeLabel="Fermer le menu"
        >
          <div className="flex items-center justify-between px-4 py-3 pr-14 border-b border-white/5">
            <span className="font-display font-black text-[10px] text-white/70 tracking-widest uppercase italic">Plus</span>
          </div>
          <div className="p-2 pb-4">
              <Button
                variant="primary"
                size="md"
                fullWidth
                animate={false}
                onClick={() => handleNavigate('/mj/creer')}
                aria-label="Créer un match"
                className="flex items-center gap-4 w-full px-4 py-4 justify-start font-display font-black text-sm tracking-widest italic uppercase transition-all bg-zoyd-yellow text-black hover:bg-white mb-2"
              >
                <Plus className="w-5 h-5" />
                Créer un match
              </Button>
              {moreNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
                return (
                  <Button
                    key={item.path}
                    variant="ghost"
                    size="md"
                    fullWidth
                    animate={false}
                    onClick={() => handleNavigate(item.path)}
                    aria-label={item.label}
                    className={cn(
                      'flex items-center gap-4 w-full px-4 py-4 justify-start font-display font-black text-sm tracking-widest italic uppercase transition-all',
                      isActive ? 'text-zoyd-yellow bg-white/5' : 'text-white/70 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Button>
                );
              })}
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Button
                    key={item.path}
                    variant="ghost"
                    size="md"
                    fullWidth
                    animate={false}
                    onClick={() => handleNavigate(item.path)}
                    aria-label={item.label}
                    className={cn(
                      'flex items-center gap-4 w-full px-4 py-4 justify-start font-display font-black text-sm tracking-widest italic uppercase transition-all',
                      isActive ? 'text-zoyd-yellow bg-white/5' : 'text-white/70 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Button>
                );
              })}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="md"
                  fullWidth
                  animate={false}
                  onClick={() => handleNavigate('/admin')}
                  aria-label="ADMIN"
                  className={cn(
                    'flex items-center gap-4 w-full px-4 py-4 justify-start font-display font-black text-sm tracking-widest italic uppercase transition-all',
                    location.pathname === '/admin' ? 'text-red-400 bg-white/5' : 'text-white/70 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Shield className="w-5 h-5" />
                  ADMIN
                </Button>
              )}
          </div>
        </SheetContent>
      </Sheet>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zoyd-black/95 border-t border-white/10 safe-bottom backdrop-blur-xl">
        <div className="flex items-center justify-around h-[4.5rem] relative">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/mj' && location.pathname.startsWith(item.path));

            return (
              <Link
                key={item.path}
                to={item.path}
                aria-label={`${item.shortLabel} — ${item.label}`}
                className={cn(
                  'relative flex flex-col items-center justify-center w-full h-full touch-target transition-all',
                  isActive ? 'text-white' : 'text-white/60'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-indicator"
                    className="absolute top-0 w-full h-[3px] bg-zoyd-yellow shadow-[0_4px_10px_rgba(255,230,0,0.5)]"
                  />
                )}
                <Icon className={cn("w-5 h-5 mb-1 transition-transform shrink-0", isActive ? "scale-110" : "")} />
                <span className="text-[11px] font-display font-black uppercase tracking-wider italic truncate max-w-full px-0.5">{item.shortLabel}</span>
              </Link>
            );
          })}

          <Button
            variant="ghost"
            size="sm"
            animate={false}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Plus d'options"
            aria-expanded={menuOpen}
            className={cn(
              // PIEGE : ce bouton partage la barre avec quatre liens. Le
              // design system ajoute un remplissage horizontal (px-4) que
              // les liens n ont pas : a 320 px, la ligne « PLUS » etait
              // plus large que ses voisines et le texte des autres
              // libelles se tronquait. `px-0` remet les cinq a equalite.
              'relative flex flex-col items-center justify-center w-full h-full px-0 touch-target transition-all',
              menuOpen ? 'text-white' : 'text-white/60'
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
          </Button>
        </div>
      </nav>
    </>
  );
});

BottomNav.displayName = 'BottomNav';

export { BottomNav };
