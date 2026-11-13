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
import { AnimatedNumber } from '../ui/AnimatedNumber';

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
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
        {/* Marque : la tuile Z carree. Arbitrage 2026-11-01 : dans le header,
            l'icone EST le logo a utiliser - le wordmark comprime en h-8
            rendait les lettres OYD du contour invisibles sur fond noir. */}
        <Link to="/mj" aria-label="ZOYD — Aller au hub" className="shrink-0 group flex items-center justify-center min-h-[44px] min-w-[44px]">
          <ZoydLogo icon className="group-hover:opacity-90 transition-opacity" />
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
          <div className="flex items-center gap-2">{serverConnected ? 'Serveur connecté' : 'Hors ligne'}</div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* P3-4 (audit UI) : « Control » -> « ADMIN » — le troisieme nom
              d'une meme page (Sidebar « ADMIN » depuis ce fix, BottomNav
              « ADMIN » deja). */}
          {user?.role === 'admin' ? (
            <Link
              to="/admin"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-zoyd-blue/20 bg-zoyd-blue/10 text-zoyd-blue hover:border-zoyd-blue/40 transition-all text-[10px] font-mono font-black uppercase tracking-[0.2em]"
            >
              ADMIN
            </Link>
          ) : null}

          {/* Solde : pill mono-ligne (l'ancien bloc deux lignes mangeait de
              la hauteur utile dans une barre de 56 px). */}
          <Link
            to="/wallet"
            aria-label={`Portefeuille — solde ${formatZC(totalBalance)}`}
            className="touch-target flex items-center gap-2 pl-2.5 pr-3 border border-zoyd-yellow/25 bg-zoyd-yellow/5 hover:bg-zoyd-yellow/10 hover:border-zoyd-yellow/40 transition-colors"
          >
            <Wallet className="w-4 h-4 text-zoyd-yellow" />
            <span className="font-display font-black text-xs text-zoyd-yellow tracking-widest leading-none tabular-nums">
              <AnimatedNumber value={totalBalance} format={(v) => formatZC(v)} />
            </span>
          </Link>

          <NotificationDropdown />

          {/* Reglages push : >= sm seulement. Sur mobile la fonction reste
              branchee : la cloche porte deja le bloc d'activation de la
              permission, et son pied conduit a /parametres (onglet
              PARAMETRES de la BottomNav aussi). La modale n'apportait
              qu'un second chemin vers la meme chose, au prix d'un tap
              supplementaire dans l'entete mobile. */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="hidden sm:flex touch-target items-center justify-center text-white/60 hover:text-white transition-colors"
            aria-label="Paramètres de notifications"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* Avatar : initiales en chip bordee (l'initiale nue flottait
              sans bordure). */}
          <Link
            to="/profil"
            aria-label={`${safeUser.pseudo.substring(0, 2).toUpperCase()} — Mon profil`}
            title="Mon Profil"
            className="touch-target flex items-center justify-center"
          >
            {/* PIEGE (audit UI) : le nom accessible doit CONTENIR le texte
                visible (WCAG 2.5.3). Les initiales sont donc dans le nom :
                un lecteur d ecran annonce « CO — Mon profil » au lieu de
                « CO », et la commande vocale « CO » atteint bien le lien. */}
            <span className="w-8 h-8 flex items-center justify-center border border-white/10 bg-white/5 hover:border-zoyd-yellow/40 hover:text-zoyd-yellow transition-colors font-display font-black text-[10px] text-white tracking-widest">
              {safeUser.pseudo.substring(0, 2).toUpperCase()}
            </span>
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
