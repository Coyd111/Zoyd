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
import { useToastStore } from '../stores/toastStore';

/**
 * Vide TOUTES les données de session d'un compte.
 *
 * `useAuthStore.logout()` ne fait que vider l'auth : sans ce reset, un 401
 * (expiration, changement de mot de passe) laissait le solde, les matchs, le
 * chat et les amis du compte précédent en mémoire. Un autre compte qui se
 * connectait dans le même onglet les voyait jusqu'au prochain refresh serveur.
 *
 * Volontairement dans un module séparé : authStore est importé par walletStore,
 * un import direct créerait un cycle.
 */
export const resetAllSessionStores = () => {
  try {
    useSocketStore.getState().disconnect();
  } catch { /* store non initialisé */ }
  try {
    useWalletStore.setState({
      cashBalance: 0,
      bonusBalance: 0,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [],
      lockedEntries: {},
    });
  } catch { /* noop */ }
  try {
    useMatchStore.setState({ matches: [] });
    useTournamentStore.setState({
      tournaments: [],
      // Maps par-utilisateur : sans ce reset, le nouveau compte héritait de
      // l'ENTRÉE du précédent (le bracket affichait "ta position" et
      // bloquait l'inscription) -> fuite de données + fonctionnalité cassée.
      callerEntryByTournament: {},
      callerArbiterSlotByTournament: {},
      openArbiterSlotsByTournament: {},
    });
    useLeagueStore.setState({ seasons: [] });
  } catch { /* noop */ }
  try {
    useChatStore.getState().replaceFromServer([], []);
  } catch { /* noop */ }
  try {
    useFriendsStore.setState({ friends: [], requests: [], blockedIds: [], reports: [], pendingId: null });
    useNotificationStore.getState().clearAll();
    useToastStore.getState().clearAll();
  } catch { /* noop */ }
  try {
    useTrustScoreStore.setState({
      score: { overall: 50, punctuality: 50, fairPlay: 50, results: 50, disputes: 50, seniority: 50 },
      history: [],
    });
    usePresenceStore.setState({ seenByChannel: {} });
  } catch { /* noop */ }
};
