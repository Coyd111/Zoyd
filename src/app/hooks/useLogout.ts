/**
 * useLogout - deconnexion propre : backend, push, socket, stores, redirection.
 *
 * Vide l'etat de session du compte courant (solde, matchs, tournois, ligue,
 * chat, amis, notifications, score de confiance, presence, toasts) puis
 * redirige vers /auth/login. appele par la Sidebar et la page profil.
 *
 * INVARIANT : le logout doit effacer le wallet, le chat et les amis. Sans ca,
 * un compte connecte ensuite dans le meme onglet voit les donnees du precedent
 * jusqu'au prochain rafraichissement serveur.
 * PIEGE : les timers de toast sont nettoyes explicitement (cleanupToastTimers) :
 * un toast pending survit sinon a la deconnexion et reapparait sur l'ecran
 * suivant.
 * PIEGE : la deconnexion du socket passe par le store, pas par un import de
 * realtimeClient : c'est le store qui reinitialise la presence.
 *
 * Voir aussi : docs/08-frontend.md - section 6.1 (Les hooks de session)
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { logoutFromBackend } from '../lib/authApi';
import { unsubscribeFromRealtimePush } from '../lib/realtimeClient';
import { useAuthStore } from '../stores/authStore';
import { useSocketStore } from '../stores/socketStore';
import { useWalletStore } from '../stores/walletStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useLeagueStore } from '../stores/leagueStore';
import { useChatStore } from '../stores/chatStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useTrustScoreStore } from '../stores/trustScoreStore';
import { usePresenceStore } from '../stores/presenceStore';
import { useToastStore, cleanupToastTimers } from '../stores/toastStore';

export function useLogout() {
  const navigate = useNavigate();

  return useCallback(() => {
    const user = useAuthStore.getState().user;
    logoutFromBackend().catch(() => undefined);
    if (user && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => unsubscribeFromRealtimePush(user, reg))
        .catch(() => undefined);
    }
    useSocketStore.getState().disconnect();
    useAuthStore.getState().logout();
    useWalletStore.setState({ cashBalance: 0, bonusBalance: 0, lockedBalance: 0, pendingWinnings: 0, transactions: [], lockedEntries: {} });
    useMatchStore.setState({ matches: [] });
    useTournamentStore.setState({ tournaments: [] });
    useLeagueStore.setState({ seasons: [] });
    useChatStore.getState().replaceFromServer([], []);
    useFriendsStore.setState({ friends: [], requests: [], blockedIds: [] });
    useNotificationStore.getState().clearAll();
    useTrustScoreStore.setState({ score: { overall: 50, punctuality: 50, fairPlay: 50, results: 50, disputes: 50, seniority: 50 }, history: [] });
    usePresenceStore.setState({ seenByChannel: {} });
    cleanupToastTimers();
    useToastStore.setState({ toasts: [], idCounter: 0 });
    navigate('/auth/login');
  }, [navigate]);
}
