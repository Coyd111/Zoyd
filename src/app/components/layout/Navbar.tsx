/**
 * Navbar - barre haute : logo, indicateur de connexion, solde, notifications.
 *
 * Affiche aussi le lien d'administration, visible uniquement si le role du
 * joueur est `admin`.
 *
 * INVARIANT : l'indicateur de connexion distingue `isConnected` (on cherche
 * a etre connecte) de `serverConnected` (le socket est reellement ouvert).
 * N'afficher ' En ligne ' que sur serverConnected : sinon l'interface
 * annonce un etat vert pour une connexion qui n'existe pas.
 * PIEGE : le solde vient du walletStore, qui est synchronise avec le store
 * d'auth par syncAuthBalance. Sans cette synchro, l'en-tete affiche l'ancien
 * total alors que la page portefeuille est deja a jour.
 * PIEGE : le lien ' Control ' est une commodite d'UX. Le role `admin` dans
 * le store n'est PAS une autorisation : la barriere est serveur.
 *
 * Voir aussi : docs/08-frontend.md - section 6 (Les stores Zustand)
 */
import React, { useState } from 'react';
import { Link } from 'react-router';
import { Settings, Wallet } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWalletStore } from '../../stores/walletStore';
import { useSocketStore } from '../../stores/socketStore';
import { formatZC } from '../../../lib/utils';
import { NotificationDropdown } from '../notifications/NotificationDropdown';
import NotificationSettingsModal from '../notifications/NotificationSettingsModal';
import ZoydLogo from '../branding/ZoydLogo';

const Navbar: React.FC = React.memo(() => {
  const { user } = useAuthStore();
  const cashBalance = useWalletStore((s) => s.cashBalance);
  const bonusBalance = useWalletStore((s) => s.bonusBalance);
  const lockedBalance = useWalletStore((s) => s.lockedBalance);
  const pendingWinnings = useWalletStore((s) => s.pendingWinnings);
  const totalBalance = cashBalance + bonusBalance + lockedBalance + pendingWinnings;
  const isConnected = useSocketStore((s) => s.isConnected);
  const serverConnected = useSocketStore((s) => s.serverConnected);
  const liveMatches = useSocketStore((s) => s.liveMatches);
  const safeUser = user || { pseudo: 'ShadowX' };
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 bg-zoyd-black/95 backdrop-blur-xl safe-top border-b border-white/5">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/mj" className="flex items-center gap-3 group">
          <ZoydLogo compact className="group-hover:opacity-90 transition-opacity" />
        </Link>

        <div className="hidden lg:flex items-center gap-12 font-mono text-[10px] uppercase tracking-[0.3em] text-white/70">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${
              serverConnected
                ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]'
                : isConnected
                  ? 'bg-zoyd-yellow'
                  : 'bg-red-500 animate-pulse'
            }`} />
            Serveurs Afrique : {serverConnected ? 'En ligne' : isConnected ? 'Sync local' : 'Hors ligne'}
          </div>
          <div className="flex items-center gap-2">Z-Bridge : {liveMatches.length} salon(s) live</div>
          <div className="flex items-center gap-2">{serverConnected ? 'Serveur connecte' : 'Hors ligne'}</div>
        </div>

        <div className="flex items-center gap-2">
          {user?.role === 'admin' ? (
            <Link
              to="/admin"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-zoyd-blue/20 bg-zoyd-blue/10 text-zoyd-blue hover:border-zoyd-blue/40 transition-all text-[10px] font-mono font-black uppercase tracking-[0.2em]"
            >
              Control
            </Link>
          ) : null}

          <Link
            to="/wallet"
            className="flex items-center gap-2 px-2 py-1.5 transition-all touch-target"
          >
            <Wallet className="w-5 h-5 text-zoyd-yellow" />
            <span className="text-right">
              <span className="text-[10px] font-mono font-bold text-white/60 uppercase tracking-widest">Solde</span>
              <span className="block font-display font-black text-xs text-zoyd-yellow tracking-widest leading-none">
                {formatZC(totalBalance)}
              </span>
            </span>
          </Link>

          <NotificationDropdown />

          <button
            onClick={() => setSettingsOpen(true)}
            className="touch-target flex items-center justify-center text-white/60 hover:text-white transition-colors"
            aria-label="Paramètres de notifications"
          >
            <Settings className="w-5 h-5" />
          </button>

          <Link to="/profil" title="Mon Profil" className="touch-target flex items-center justify-center">
            <div className="w-9 h-9 flex items-center justify-center text-[10px] font-display font-black text-white hover:text-zoyd-yellow transition-colors">
              {safeUser.pseudo.substring(0, 2).toUpperCase()}
            </div>
          </Link>

          {/* Pas de bouton de déconnexion ici : il est déjà dans la Sidebar.
              Le doublon mangeait de la largeur dans le header sur mobile. */}
        </div>

        <NotificationSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </nav>
  );
});

Navbar.displayName = 'Navbar';

export { Navbar };
