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
