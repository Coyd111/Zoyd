/**
 * index.ts - barrel de re-export des stores Zustand de l'application.
 *
 * Point d'entree unique pour importer un store depuis l'exterieur de
 * src/app/stores/. Re-exporte les hooks et les types publics de chaque store.
 *
 * INVARIANT : ce fichier est un BARREL pur. Il ne doit contenir ni logique,
 * ni appel reseau, ni import de module qui declenche un effet de bord.
 * PIEGE : ce barrel n'exporte pas useSocketConnectionStore ni
 * usePresenceStore : ils passent par socketStore.ts, qui les re-exporte.
 * Ne pas dupliquer ces exports ici, sous peine de deux chemins d'import pour
 * le meme store.
 * PIEGE : la liste des exports est une surface publique : retirer un export
 * casse les appelants qui passent par le barrel, meme si le store
 * d'origine est intact.
 *
 * Voir aussi : docs/08-frontend.md - section 6 (Les stores Zustand)
 */
export { useAuthStore } from './authStore';
export type { User, UserStats, ControllerType, PlayerLevel } from './authStore';

export { useWalletStore } from './walletStore';
export type { Transaction, TransactionType, TransactionStatus } from './walletStore';

export { useFriendsStore } from './friendsStore';
export type { Friend, FriendRequest, FriendStatus, FriendRequestStatus, Report } from './friendsStore';

export { useChatStore } from './chatStore';
export type { ChatMessage, ChatChannel, ChatChannelDef } from './chatStore';

export { useNotificationStore } from './notificationStore';
export type { Notification, NotificationType, NotificationPriority } from './notificationStore';

export { useMatchStore } from './matchStore';
export type {
  Match,
  MatchPlayer,
  MatchArbiter,
  MatchResult,
  Dispute,
  MatchRules,
  MatchFilters,
  MatchFormat,
  MatchStatus,
  MatchVisibility,
  ControllerRestriction,
} from './matchStore';

export { useTournamentStore } from './tournamentStore';
export type {
  Tournament,
  TournamentBracketType,
  TournamentMatch,
  TournamentFilters,
  TournamentStatus,
} from './tournamentStore';

export { useTrustScoreStore } from './trustScoreStore';
export type { TrustBreakdown, TrustScoreState } from './trustScoreStore';

export { useToastStore } from './toastStore';
export type { Toast, ToastType } from './toastStore';

export { useSocketStore } from './socketStore';

export { useLeagueStore } from './leagueStore';
export type {
  LeagueSeason,
  LeagueSeasonStatus,
  LeagueDayKey,
  LeagueStanding,
  LeaguePlayer,
} from './leagueStore';
