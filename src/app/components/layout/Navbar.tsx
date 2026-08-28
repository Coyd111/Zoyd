import React, { useState } from 'react';
import { Link } from 'react-router';
import { Settings, Wallet, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWalletStore } from '../../stores/walletStore';
import { useSocketStore } from '../../stores/socketStore';
import { formatZC } from '../../../lib/utils';
import { NotificationDropdown } from '../notifications/NotificationDropdown';
import NotificationSettingsModal from '../notifications/NotificationSettingsModal';
import { useLogout } from '../../hooks/useLogout';

const Navbar: React.FC = React.memo(() => {
  const { user } = useAuthStore();
  const totalBalance = useWalletStore((s) => s.getTotalBalance());
  const { isConnected, serverConnected, liveMatches } = useSocketStore();
  const handleLogout = useLogout();
  const safeUser = user || { pseudo: 'ShadowX' };
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 bg-zoyd-black/95 backdrop-blur-xl safe-top border-b border-white/5">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/mj" className="flex items-center gap-3 group">
          <img src="/logo.png?v=2" alt="ZOYD" className="h-8 w-auto object-contain group-hover:opacity-90 transition-opacity" />
        </Link>

        <div className="hidden lg:flex items-center gap-12 font-mono text-[9px] uppercase tracking-[0.3em] text-white/40">
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
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-zoyd-blue/20 bg-zoyd-blue/10 text-zoyd-blue hover:border-zoyd-blue/40 transition-all text-[9px] font-mono font-black uppercase tracking-[0.2em]"
            >
              Control
            </Link>
          ) : null}

          <Link
            to="/wallet"
            className="flex items-center gap-2 px-2 py-1.5 transition-all touch-target"
          >
            <Wallet className="w-5 h-5 text-zoyd-yellow" />
            <span className="hidden sm:block text-right">
              <span className="text-[8px] font-mono font-bold text-white/30 uppercase tracking-widest">Solde</span>
              <span className="block font-display font-black text-xs text-zoyd-yellow tracking-widest leading-none">
                {formatZC(totalBalance)}
              </span>
            </span>
          </Link>

          <NotificationDropdown />

          <button
            onClick={() => setSettingsOpen(true)}
            className="touch-target flex items-center justify-center text-white/30 hover:text-white transition-colors"
            aria-label="Parametres de notifications"
          >
            <Settings className="w-5 h-5" />
          </button>

          <Link to="/profil" title="Mon Profil" className="touch-target flex items-center justify-center">
            <div className="w-9 h-9 flex items-center justify-center text-[10px] font-display font-black text-white hover:text-zoyd-yellow transition-colors">
              {safeUser.pseudo.substring(0, 2).toUpperCase()}
            </div>
          </Link>

          <button
            onClick={handleLogout}
            title="Se deconnecter"
            className="touch-target flex items-center justify-center text-white/30 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        <NotificationSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </nav>
  );
});

Navbar.displayName = 'Navbar';

export { Navbar };
