import React, { useState } from 'react';
import { Link } from 'react-router';
import { Settings, Wallet } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import { logoutFromBackend } from '../../lib/authApi';
import { unsubscribeFromRealtimePush } from '../../lib/realtimeClient';
import { useWalletStore } from '../../stores/walletStore';
import { formatZC } from '../../../lib/utils';
import { NotificationDropdown } from '../notifications/NotificationDropdown';
import NotificationSettingsModal from '../notifications/NotificationSettingsModal';
import ZoydLogo from '../branding/ZoydLogo';

const Navbar: React.FC = () => {
  const { user } = useAuthStore();
  const { getTotalBalance } = useWalletStore();
  const { isConnected, serverConnected, liveMatches } = useSocketStore();
  const safeUser = user || { pseudo: 'ShadowX' };
  const totalBalance = getTotalBalance();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navAuthenticated = true;

  return (
    <nav className="sticky top-0 z-40 bg-zoyd-black w-full">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
        <Link to={navAuthenticated ? '/mj' : '/'} className="flex items-center gap-3 group">
          <ZoydLogo compact className="group-hover:opacity-90 transition-opacity" />
        </Link>

        <div className="hidden lg:flex items-center gap-12 font-mono text-[9px] uppercase tracking-[0.3em] text-white/20">
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

        {navAuthenticated ? (
          <>
            <div className="flex items-center gap-6">
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
                className="flex items-center gap-3 px-3 py-1.5 transition-all group"
              >
                <div className="text-right hidden sm:block">
                  <div className="text-[8px] font-mono font-bold text-white/30 uppercase tracking-widest">Solde</div>
                  <div className="font-display font-black text-xs text-zoyd-yellow tracking-widest leading-none">
                    {formatZC(totalBalance)}
                  </div>
                </div>
                <Wallet className="w-4 h-4 text-zoyd-yellow group-hover:scale-110 transition-transform" />
              </Link>

              <div className="flex items-center gap-2 sm:gap-4 pl-3 sm:pl-6 h-14">
                <NotificationDropdown />

                <button
                  onClick={() => setSettingsOpen(true)}
                  className="text-white/30 hover:text-white transition-colors"
                  aria-label="Parametres de notifications"
                  title="Parametres de notifications"
                >
                  <Settings className="w-4 h-4" />
                </button>

                <Link to="/profil" title="Mon Profil" className="flex items-center gap-3 group">
                  <div className="w-9 h-9 flex items-center justify-center text-[10px] font-display font-black text-white group-hover:text-zoyd-yellow transition-colors">
                    {safeUser.pseudo.substring(0, 2).toUpperCase()}
                  </div>
                </Link>

                <button
                  onClick={() => {
                    const u = useAuthStore.getState().user;
                    logoutFromBackend().catch(() => undefined);
                    if (u && 'serviceWorker' in navigator) {
                      navigator.serviceWorker.ready
                        .then((reg) => unsubscribeFromRealtimePush(u, reg))
                        .catch(() => undefined);
                    }
                    useSocketStore.getState().disconnect();
                    useAuthStore.getState().logout();
                  }}
                  title="Se deconnecter"
                  className="text-white/30 hover:text-red-400 transition-colors ml-2"
                >
                  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                </button>
              </div>
            </div>
            <NotificationSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </>
        ) : (
          <div className="flex items-center gap-6">
            <Link to="/auth/login" className="text-[11px] font-display font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest">
              Connexion
            </Link>
            <Link to="/auth/register" className="bg-white text-black px-6 py-2 text-[11px] font-display font-bold tracking-widest hover:bg-zoyd-yellow transition-colors italic uppercase">
              S'inscrire
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
};

export { Navbar };
