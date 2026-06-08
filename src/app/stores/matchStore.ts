import { create } from 'zustand';
import type { User } from './authStore';
import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { useNotificationStore } from './notificationStore';
import { useWalletStore } from './walletStore';

export type MatchFormat = '1VS1' | '2VS2' | '3VS3' | '4VS4' | '5VS5';
export type MatchStatus =
  | 'recruiting'
  | 'full'
  | 'check_in'
  | 'ready'
  | 'in_progress'
  | 'finished'
  | 'disputed'
  | 'cancelled'
  | 'forfeited';

export type MatchVisibility = 'public' | 'private';
export type MatchTeam = 0 | 1;
export type ControllerRestriction = User['controllerType'] | 'open';
export type DeviceRestriction = User['device'] | 'open';

export interface MatchPlayer {
  userId: string;
  pseudo: string;
  team: MatchTeam;
  joinedAt: string;
  trustScore: number;
  rankMJ?: string;
  controllerType?: User['controllerType'];
  device?: User['device'];
  isReady: boolean;
  isCheckedIn: boolean;
  checkedInAt?: string;
  isCaptain: boolean;
}

export interface MatchArbiter {
  userId: string;
  pseudo: string;
  assignedAt: string;
  trustScore: number;
  roomName?: string;
  roomPassword?: string;
  roomPublishedAt?: string;
  hasSubmittedResult: boolean;
}

export interface MatchProofBundle {
  scoreboard: string[];
  finalResult: string[];
  roomCapture: string[];
  extraEvidence: string[];
}

export interface MatchResult {
  winnerTeam: MatchTeam;
  scores: { team0: number; team1: number };
  screenshots: string[];
  proofs?: MatchProofBundle;
  proofHash?: string;
  arbiterNotes?: string;
  resolutionType?: 'played' | 'forfeit';
  forfeitTeam?: MatchTeam;
  submittedBy: string;
  submittedAt: string;
  confirmedByTeams: string[];
  payoutDistributed: boolean;
}

export type DisputeCategory = 'result' | 'room_issue' | 'no_show' | 'conduct' | 'other';

export interface Dispute {
  id: string;
  level: 1 | 2 | 3;
  category: DisputeCategory;
  reason: string;
  evidence: string[];
  requestedBy: string;
  openedByPseudo?: string;
  status: 'open' | 'under_review' | 'resolved' | 'rejected';
  resolution?: string;
  createdAt: string;
  openedAt?: string;
  resolvedAt?: string;
  prizePoolFrozen: boolean;
}

export interface MatchRules {
  mode: string;
  map: string;
  scoreTarget: number;
  bestOf: number;
  weaponRestrictions?: string;
  pointstreaks?: 'allowed' | 'restricted';
  meleeAllowed?: boolean;
  notes?: string;
}

export interface Match {
  id: string;
  creatorId: string;
  creatorPseudo: string;
  format: MatchFormat;
  teamSize: number;
  maxPlayers: number;
  rules: MatchRules;
  entryFee: number;
  prizePool: number;
  zoydFee: number;
  arbiterFee: number;
  visibility: MatchVisibility;
  privacy: MatchVisibility;
  deviceRestriction: DeviceRestriction;
  controllerRestriction: ControllerRestriction;
  status: MatchStatus;
  players: MatchPlayer[];
  arbiter?: MatchArbiter;
  result?: MatchResult;
  dispute?: Dispute;
  disputes: Dispute[];
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  roomName?: string;
  roomPassword?: string;
  chatChannelId: string;
  channelId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  trustScoreMin?: number;
  isInstant: boolean;
}

export interface MatchFilters {
  format?: MatchFormat | 'all';
  status?: MatchStatus | 'all';
  minTrustScore?: number;
}

export interface CreateMatchInput {
  creatorId: string;
  creatorPseudo: string;
  creatorTrustScore: number;
  creatorControllerType: User['controllerType'];
  creatorDevice: User['device'];
  creatorRankMJ?: string;
  creatorTeam?: MatchTeam;
  format: MatchFormat;
  rules: MatchRules;
  entryFee: number;
  visibility?: MatchVisibility;
  trustScoreMin?: number;
  isInstant?: boolean;
}

export interface MatchState {
  matches: Match[];
  myMatches: string[];
  myArbitrations: string[];
  filters: MatchFilters;
  hydrateFromServer: (matches: Match[]) => void;
  replaceFromServer: (matches: Match[]) => void;
  createMatch: (input: CreateMatchInput) => string;
  joinMatch: (matchId: string, userId: string, pseudo: string, team?: number, trustScore?: number) => boolean;
  leaveMatch: (matchId: string, userId: string) => void;
  assignArbiter: (matchId: string, arbiterId: string, arbiterPseudo: string, trustScore: number) => boolean;
  submitCheckIn: (matchId: string, userId: string) => void;
  togglePlayerReady: (matchId: string, userId: string) => void;
  setMatchStatus: (matchId: string, status: MatchStatus) => void;
  updateMatchStatus: (matchId: string, status: MatchStatus) => void;
  launchMatch: (matchId: string) => void;
  submitResult: (matchId: string, result: Omit<MatchResult, 'submittedAt' | 'confirmedByTeams' | 'payoutDistributed'>) => boolean;
  confirmResult: (matchId: string, userId: string) => void;
  openDispute: (matchId: string, reason: string, evidence: string[], requestedBy: string, category?: DisputeCategory) => boolean;
  resolveDispute: (matchId: string, resolution: string) => void;
  setRoomDetails: (matchId: string, roomName: string, roomPassword: string) => boolean;
  setScheduledTime: (matchId: string, scheduledAt: string) => void;
  setFilters: (f: Partial<MatchFilters>) => void;
  getFilteredMatches: () => Match[];
  getMatchById: (id: string) => Match | undefined;
  getMyActiveMatches: (userId: string) => Match[];
  getMatchHistory: (userId: string) => Match[];
  canJoinAsArbiter: (matchId: string) => boolean;
  processMatchAutomation: () => void;
  cleanupExpired: () => void;
}

const ACTIVE_STATUSES: MatchStatus[] = ['recruiting', 'full', 'check_in', 'ready', 'in_progress'];
export const MATCH_AUTOMATION_INTERVAL_MS = 30_000;

const getNow = () => new Date().toISOString();
const getTeamSize = (format: MatchFormat) => parseInt(format.split('VS')[0], 10);
const roundAmount = (value: number) => Math.round(value * 100) / 100;
const getSquadLabel = (team: MatchTeam) => (team === 0 ? 'Squad Alpha' : 'Squad Bravo');
const getScheduledTimestamp = (match: Match) => (match.scheduledAt ? new Date(match.scheduledAt).getTime() : null);
const getTeamCheckInCount = (match: Match, team: MatchTeam) =>
  match.players.filter((player) => player.team === team && player.isCheckedIn).length;
const isTeamReadyForLaunch = (match: Match, team: MatchTeam) => getTeamCheckInCount(match, team) >= match.teamSize;
const isTerminalMatchStatus = (status: MatchStatus) =>
  status === 'finished' || status === 'cancelled' || status === 'forfeited';
const normalizeProofRefs = (refs: string[]) => refs.map((ref) => ref.trim()).filter(Boolean);
const flattenProofs = (proofs?: MatchProofBundle) =>
  proofs
    ? [
        ...proofs.scoreboard,
        ...proofs.finalResult,
        ...proofs.roomCapture,
        ...proofs.extraEvidence,
      ]
    : [];
const buildProofHash = (matchId: string, winnerTeam: MatchTeam, scores: { team0: number; team1: number }, refs: string[]) =>
  [matchId, winnerTeam, scores.team0, scores.team1, ...refs.map((ref) => ref.toLowerCase())].join('|');
const normalizeStoredDispute = (dispute: any): Dispute => ({
  ...dispute,
  category: dispute?.category || 'result',
  evidence: Array.isArray(dispute?.evidence) ? dispute.evidence : [],
});
const normalizeStoredProofs = (proofs: any): MatchProofBundle => ({
  scoreboard: Array.isArray(proofs?.scoreboard) ? proofs.scoreboard : [],
  finalResult: Array.isArray(proofs?.finalResult) ? proofs.finalResult : [],
  roomCapture: Array.isArray(proofs?.roomCapture) ? proofs.roomCapture : [],
  extraEvidence: Array.isArray(proofs?.extraEvidence) ? proofs.extraEvidence : [],
});
const normalizeStoredResult = (matchId: string, result: any): MatchResult => {
  const proofs = result?.proofs ? normalizeStoredProofs(result.proofs) : undefined;
  const screenshots = Array.isArray(result?.screenshots) ? result.screenshots : flattenProofs(proofs);

  return {
    ...result,
    screenshots,
    proofs,
    resolutionType: result?.resolutionType || 'played',
    proofHash:
      result?.proofHash ||
      buildProofHash(
        matchId,
        result?.winnerTeam ?? 0,
        result?.scores || { team0: 0, team1: 0 },
        screenshots
      ),
  };
};
const normalizeStoredMatch = (match: any): Match => ({
  ...match,
  disputes: Array.isArray(match?.disputes) ? match.disputes.map(normalizeStoredDispute) : [],
  dispute: match?.dispute ? normalizeStoredDispute(match.dispute) : undefined,
  result: match?.result ? normalizeStoredResult(match.id, match.result) : undefined,
});

const getPreferredTeam = (match: Match, preferredTeam?: number): MatchTeam | null => {
  const team0Count = match.players.filter((player) => player.team === 0).length;
  const team1Count = match.players.filter((player) => player.team === 1).length;

  if (preferredTeam === 0 && team0Count < match.teamSize) return 0;
  if (preferredTeam === 1 && team1Count < match.teamSize) return 1;
  if (team0Count <= team1Count && team0Count < match.teamSize) return 0;
  if (team1Count < match.teamSize) return 1;
  return null;
};

const isCurrentUser = (userId: string) => useAuthStore.getState().user?.id === userId;

const getStatusFromMatch = (match: Match): MatchStatus => {
  if (match.disputes.some((dispute) => dispute.status === 'open' || dispute.status === 'under_review')) {
    return 'disputed';
  }

  if (match.status === 'cancelled' || match.status === 'forfeited' || match.status === 'finished') {
    return match.status;
  }

  if (match.result || match.finishedAt) {
    return 'finished';
  }

  const allPlayersPresent = match.players.length >= match.maxPlayers;
  if (!allPlayersPresent) return 'recruiting';
  if (!match.arbiter) return 'full';

  const everyoneCheckedIn = match.players.every((player) => player.isCheckedIn);
  const everyoneReady = match.players.every((player) => player.isReady);

  if (!everyoneCheckedIn || !everyoneReady) {
    return 'check_in';
  }

  if (match.status === 'in_progress') {
    return 'in_progress';
  }

  return 'ready';
};

const updateMatchSnapshot = (match: Match, updates: Partial<Match>): Match => {
  const next = {
    ...match,
    ...updates,
    updatedAt: getNow(),
  };

  return {
    ...next,
    status: getStatusFromMatch(next),
  };
};

const withMatchUpdate = (matches: Match[], matchId: string, updater: (match: Match) => Match): Match[] =>
  matches.map((match) => (match.id === matchId ? updater(match) : match));

const getWinnerPayout = (match: Match) => roundAmount(match.prizePool - match.zoydFee - match.arbiterFee);
const mergeMatchesByFreshness = (currentMatches: Match[], incomingMatches: Match[]) => {
  const merged = new Map<string, Match>();

  for (const match of currentMatches) {
    merged.set(match.id, match);
  }

  for (const rawMatch of incomingMatches) {
    const incoming = normalizeStoredMatch(rawMatch);
    const existing = merged.get(incoming.id);

    if (!existing) {
      merged.set(incoming.id, incoming);
      continue;
    }

    const existingTs = new Date(existing.updatedAt || existing.createdAt).getTime();
    const incomingTs = new Date(incoming.updatedAt || incoming.createdAt).getTime();

    if (incomingTs >= existingTs) {
      merged.set(incoming.id, incoming);
    }
  }

  return [...merged.values()].sort(
    (left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
  );
};

export const useMatchStore = create<MatchState>()((set, get) => {
      const syncChannel = (match: Match) => {
        const participants = [
          ...match.players.map((player) => player.userId),
          ...(match.arbiter ? [match.arbiter.userId] : []),
        ];
        useChatStore.getState().syncChannelParticipants(match.channelId, participants);
      };

      const postSystemMessage = (match: Match, text: string) => {
        useChatStore.getState().sendMessage(match.channelId, text, 'system', 'ZOYD System', true);
      };

      const notify = (
        title: string,
        message: string,
        actionUrl?: string,
        type: 'system' | 'match_start' | 'check_in_required' | 'result_ready' | 'arbitration_assigned' | 'dispute_update' = 'system'
      ) => {
        useNotificationStore.getState().addNotification({
          type,
          title,
          message,
          priority: type === 'result_ready' || type === 'match_start' ? 'high' : 'normal',
          actionUrl,
        });
      };

      const settleLocalUserForResult = (match: Match, result: MatchResult) => {
        const currentUser = useAuthStore.getState().user;
        if (!currentUser) return;

        const wallet = useWalletStore.getState();
        const auth = useAuthStore.getState();
        const isParticipant = match.players.some((player) => player.userId === currentUser.id);
        const isWinner = match.players.some(
          (player) => player.userId === currentUser.id && player.team === result.winnerTeam
        );
        const isArbiter = match.arbiter?.userId === currentUser.id;

        if (isParticipant && isWinner) {
          const payout = getWinnerPayout(match);
          wallet.releaseWinnings(payout, match.id, 'prize_win', `Gain du match ${match.rules.mode} / ${match.rules.map}`);
          auth.updateStats({
            wins: currentUser.stats.wins + 1,
            totalEarnings: roundAmount(currentUser.stats.totalEarnings + payout),
          });
          auth.addXp(120);
          if (result.resolutionType === 'forfeit') {
            auth.adjustTrustScore(2);
          }
          notify('Victoire enregistree', `${payout.toFixed(1)} ZC distribues pour ${match.id}.`, `/mj/match/${match.id}`, 'result_ready');
        } else if (isParticipant) {
          wallet.settleMatchLoss(match.id, `Pass consomme apres la fin du match ${match.id}`);
          auth.updateStats({
            losses: currentUser.stats.losses + 1,
          });
          auth.addXp(35);
          if (result.resolutionType === 'forfeit' && result.forfeitTeam === match.players.find((player) => player.userId === currentUser.id)?.team) {
            auth.adjustTrustScore(-12);
          }
        }

        if (isArbiter && match.arbiterFee > 0) {
          wallet.releaseWinnings(match.arbiterFee, match.id, 'arbitration_fee', `Commission arbitre ${match.id}`);
        }
      };

      const cancelMatchAutomatically = (match: Match, reason: string) => {
        let updatedMatch: Match | undefined;

        set((state) => ({
          matches: withMatchUpdate(state.matches, match.id, (entry) => {
            updatedMatch = {
              ...entry,
              status: 'cancelled',
              finishedAt: getNow(),
              updatedAt: getNow(),
            };
            return updatedMatch;
          }),
        }));

        const currentUserId = useAuthStore.getState().user?.id;
        const localUserWasPlayer = !!currentUserId && match.players.some((player) => player.userId === currentUserId);

        if (localUserWasPlayer) {
          useWalletStore.getState().unlockFunds(match.entryFee, match.id);
        }

        if (updatedMatch) {
          postSystemMessage(updatedMatch, reason);
          notify('Match annule automatiquement', `${updatedMatch.id} a ete clos et les passes locaux ont ete relaches.`, `/mj/match/${updatedMatch.id}`);
        }
      };

      const resolveMatchForfeit = (match: Match, winnerTeam: MatchTeam, losingTeam: MatchTeam, reason: string) => {
        const fullResult: MatchResult = {
          winnerTeam,
          scores: {
            team0: winnerTeam === 0 ? 1 : 0,
            team1: winnerTeam === 1 ? 1 : 0,
          },
          screenshots: [],
          arbiterNotes: reason,
          resolutionType: 'forfeit',
          forfeitTeam: losingTeam,
          submittedBy: 'system-no-show',
          submittedAt: getNow(),
          confirmedByTeams: [],
          payoutDistributed: true,
        };

        let updatedMatch: Match | undefined;

        set((state) => ({
          matches: withMatchUpdate(state.matches, match.id, (entry) => {
            updatedMatch = {
              ...entry,
              result: fullResult,
              arbiter: entry.arbiter ? { ...entry.arbiter, hasSubmittedResult: true } : entry.arbiter,
              status: 'forfeited',
              finishedAt: getNow(),
              updatedAt: getNow(),
            };
            return updatedMatch;
          }),
        }));

        if (!updatedMatch) return;

        settleLocalUserForResult(updatedMatch, fullResult);
        postSystemMessage(
          updatedMatch,
          `${getSquadLabel(winnerTeam)} remporte le match par forfait. ${reason}`
        );
        notify(
          'Forfait automatique',
          `${getSquadLabel(winnerTeam)} gagne ${updatedMatch.id} apres absence de ${getSquadLabel(losingTeam)}.`,
          `/mj/match/${updatedMatch.id}`,
          'result_ready'
        );
      };

      const autoReadyCheckedInPlayers = (match: Match) => {
        if (!match.players.some((player) => player.isCheckedIn && !player.isReady)) return;

        let updatedMatch: Match | undefined;
        set((state) => ({
          matches: withMatchUpdate(state.matches, match.id, (entry) => {
            updatedMatch = updateMatchSnapshot(entry, {
              players: entry.players.map((player) =>
                player.isCheckedIn ? { ...player, isReady: true } : player
              ),
            });
            return updatedMatch;
          }),
        }));

        if (updatedMatch) {
          postSystemMessage(updatedMatch, "Toutes les presences confirmees passent automatiquement en statut pret.");
          notify(
            'Match pret a lancer',
            `${updatedMatch.id} est pret. L'arbitre peut maintenant publier la salle et lancer le match.`,
            `/mj/match/${updatedMatch.id}`,
            'check_in_required'
          );
        }
      };

      return {
        matches: [],
        myMatches: [],
        myArbitrations: [],
        filters: { format: 'all', status: 'all' },

        hydrateFromServer: (matches) => {
          set((state) => ({
            matches: mergeMatchesByFreshness(state.matches, matches),
          }));
        },

        replaceFromServer: (matches) => {
          set(() => ({
            matches: matches
              .map((match) => normalizeStoredMatch(match))
              .sort(
                (left, right) =>
                  new Date(right.updatedAt || right.createdAt).getTime() -
                  new Date(left.updatedAt || left.createdAt).getTime()
              ),
          }));
        },

        createMatch: (input) => {
          const matchId = `M-${Date.now().toString(36).toUpperCase()}`;
          const teamSize = getTeamSize(input.format);
          const maxPlayers = teamSize * 2;
          const prizePool = roundAmount(input.entryFee * maxPlayers);
          const creatorTeam = input.creatorTeam ?? 0;
          if (isCurrentUser(input.creatorId)) {
            const locked = useWalletStore.getState().deductEntryFee(input.entryFee, matchId);
            if (!locked) {
              return '';
            }
          }

          const channelId = useChatStore
            .getState()
            .createChannel('match', `Match MJ ${matchId}`, [input.creatorId]);

          const creatorPlayer: MatchPlayer = {
            userId: input.creatorId,
            pseudo: input.creatorPseudo,
            team: creatorTeam,
            joinedAt: getNow(),
            trustScore: input.creatorTrustScore,
            rankMJ: input.creatorRankMJ,
            controllerType: input.creatorControllerType,
            device: input.creatorDevice,
            isReady: false,
            isCheckedIn: false,
            isCaptain: true,
          };

          const match: Match = {
            id: matchId,
            creatorId: input.creatorId,
            creatorPseudo: input.creatorPseudo,
            format: input.format,
            teamSize,
            maxPlayers,
            rules: input.rules,
            entryFee: roundAmount(input.entryFee),
            prizePool,
            zoydFee: 0,
            arbiterFee: roundAmount(prizePool * 0.02),
            visibility: input.visibility || 'public',
            privacy: input.visibility || 'public',
            deviceRestriction: input.creatorDevice,
            controllerRestriction: input.creatorControllerType,
            status: 'recruiting',
            players: [creatorPlayer],
            disputes: [],
            chatChannelId: channelId,
            channelId,
            createdAt: getNow(),
            updatedAt: getNow(),
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            trustScoreMin: input.trustScoreMin || 0,
            isInstant: input.isInstant ?? true,
          };

          set((state) => ({
            matches: [match, ...state.matches],
            myMatches: state.myMatches.includes(matchId) ? state.myMatches : [matchId, ...state.myMatches],
          }));

          postSystemMessage(
            match,
            `${input.creatorPseudo} a publie un match public ${input.format}. ${maxPlayers - 1} joueur(s) et 1 arbitre sont attendus.`
          );
          notify('Match public publie', `Ton pass est bloque et ${matchId} est maintenant visible dans le feed MJ.`, `/mj/match/${matchId}`);
          return matchId;
        },

        joinMatch: (matchId, userId, pseudo, team, trustScore = 0) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          if (!match) return false;
          if (match.status === 'cancelled' || match.status === 'finished' || match.status === 'forfeited') return false;
          if (match.players.some((player) => player.userId === userId)) return false;
          if (match.arbiter?.userId === userId) return false;
          if ((match.trustScoreMin || 0) > trustScore) return false;

          const preferredTeam = getPreferredTeam(match, team);
          if (preferredTeam === null) return false;

          const currentUser = useAuthStore.getState().user;
          if (currentUser?.id === userId) {
            const deviceMismatch =
              match.deviceRestriction !== 'open' && currentUser.device !== match.deviceRestriction;
            const controllerMismatch =
              match.controllerRestriction !== 'open' && currentUser.controllerType !== match.controllerRestriction;

            if (deviceMismatch || controllerMismatch) {
              return false;
            }

            const locked = useWalletStore.getState().deductEntryFee(match.entryFee, matchId);
            if (!locked) return false;
          }

          const teamCount = match.players.filter((player) => player.team === preferredTeam).length;
          const nextPlayer: MatchPlayer = {
            userId,
            pseudo,
            team: preferredTeam,
            joinedAt: getNow(),
            trustScore,
            rankMJ: currentUser?.id === userId ? currentUser.rankMJ : undefined,
            controllerType: currentUser?.id === userId ? currentUser.controllerType : undefined,
            device: currentUser?.id === userId ? currentUser.device : undefined,
            isReady: false,
            isCheckedIn: false,
            isCaptain: teamCount === 0,
          };

          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = updateMatchSnapshot(entry, {
                players: [...entry.players, nextPlayer],
              });
              return updatedMatch;
            }),
            myMatches: state.myMatches.includes(matchId) ? state.myMatches : [matchId, ...state.myMatches],
          }));

          if (!updatedMatch) return false;
          syncChannel(updatedMatch);
          postSystemMessage(
            updatedMatch,
            `${pseudo} rejoint ${preferredTeam === 0 ? 'Squad Alpha' : 'Squad Bravo'} et bloque son pass de ${match.entryFee.toFixed(1)} ZC.`
          );

          if (updatedMatch.players.length === updatedMatch.maxPlayers) {
            notify(
              'Slots joueurs complets',
              `${updatedMatch.id} attend maintenant un arbitre pour ouvrir le check-in.`,
              `/mj/match/${updatedMatch.id}`,
              'check_in_required'
            );
          }

          return true;
        },

        leaveMatch: (matchId, userId) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          if (!match) return;
          if (!['recruiting', 'full'].includes(match.status)) return;

          const leavingPlayer = match.players.find((player) => player.userId === userId);
          if (!leavingPlayer) return;

          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              const remainingPlayers = entry.players
                .filter((player) => player.userId !== userId)
                .map((player, index, players) => ({
                  ...player,
                  isCaptain: player.team === leavingPlayer.team
                    ? players.filter((candidate) => candidate.team === player.team)[0]?.userId === player.userId
                    : player.isCaptain,
                }));

              updatedMatch = updateMatchSnapshot(entry, { players: remainingPlayers });
              return updatedMatch;
            }),
            myMatches: state.myMatches.filter((trackedId) => !(trackedId === matchId && userId === useAuthStore.getState().user?.id)),
          }));

          if (isCurrentUser(userId)) {
            useWalletStore.getState().unlockFunds(match.entryFee, matchId);
          }

          if (updatedMatch) {
            syncChannel(updatedMatch);
            postSystemMessage(updatedMatch, `${leavingPlayer.pseudo} quitte le match. Son pass est rembourse.`);
          }
        },

        assignArbiter: (matchId, arbiterId, arbiterPseudo, trustScore) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          if (!match || match.arbiter) return false;
          if (match.players.some((player) => player.userId === arbiterId)) return false;

          const arbiter: MatchArbiter = {
            userId: arbiterId,
            pseudo: arbiterPseudo,
            assignedAt: getNow(),
            trustScore,
            hasSubmittedResult: false,
          };

          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = updateMatchSnapshot(entry, { arbiter });
              return updatedMatch;
            }),
            myArbitrations: state.myArbitrations.includes(matchId)
              ? state.myArbitrations
              : [matchId, ...state.myArbitrations],
          }));

          if (!updatedMatch) return false;
          syncChannel(updatedMatch);
          postSystemMessage(updatedMatch, `${arbiterPseudo} prend le slot arbitre de ce match.`);

          if (updatedMatch.players.length === updatedMatch.maxPlayers) {
            notify(
              'Check-in ouvert',
              `Tous les joueurs et l'arbitre sont en place pour ${updatedMatch.id}.`,
              `/mj/match/${updatedMatch.id}`,
              'arbitration_assigned'
            );
          }

          return true;
        },

        submitCheckIn: (matchId, userId) => {
          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = updateMatchSnapshot(entry, {
                players: entry.players.map((player) =>
                  player.userId === userId
                    ? { ...player, isCheckedIn: true, checkedInAt: getNow() }
                    : player
                ),
              });
              return updatedMatch;
            }),
          }));

          if (updatedMatch) {
            const player = updatedMatch.players.find((entry) => entry.userId === userId);
            if (player) {
              postSystemMessage(updatedMatch, `${player.pseudo} valide son check-in.`);
            }
          }
        },

        togglePlayerReady: (matchId, userId) => {
          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = updateMatchSnapshot(entry, {
                players: entry.players.map((player) =>
                  player.userId === userId
                    ? { ...player, isReady: player.isCheckedIn ? !player.isReady : player.isReady }
                    : player
                ),
              });
              return updatedMatch;
            }),
          }));

          if (updatedMatch) {
            const player = updatedMatch.players.find((entry) => entry.userId === userId);
            if (player) {
              postSystemMessage(updatedMatch, `${player.pseudo} ${player.isReady ? 'est pret.' : 'retire son ready.'}`);
            }
          }
        },

        setMatchStatus: (matchId, status) => {
          const currentMatch = get().matches.find((entry) => entry.id === matchId);
          if (!currentMatch) return;

          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              const updates: Partial<Match> = { status };

              if (status === 'in_progress') {
                updates.startedAt = getNow();
              }

              if (status === 'finished' || status === 'cancelled' || status === 'forfeited') {
                updates.finishedAt = getNow();
              }

              updatedMatch =
                status === 'cancelled' || status === 'forfeited'
                  ? { ...entry, ...updates, updatedAt: getNow() }
                  : updateMatchSnapshot(entry, updates);

              return updatedMatch;
            }),
          }));

          if (!updatedMatch) return;

          const currentUserId = useAuthStore.getState().user?.id;
          const localUserWasPlayer = !!currentUserId && currentMatch.players.some((player) => player.userId === currentUserId);

          if (status === 'cancelled' && localUserWasPlayer) {
            useWalletStore.getState().unlockFunds(currentMatch.entryFee, currentMatch.id);
          }
        },

        updateMatchStatus: (matchId, status) => {
          get().setMatchStatus(matchId, status);
        },

        launchMatch: (matchId) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          if (!match) return;
          const canLaunch =
            match.arbiter &&
            match.roomName &&
            match.roomPassword &&
            match.players.length === match.maxPlayers &&
            match.players.every((player) => player.isCheckedIn && player.isReady);

          if (!canLaunch) return;

          let updatedMatch: Match | undefined;
          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = { ...entry, status: 'in_progress', startedAt: getNow(), updatedAt: getNow() };
              return updatedMatch;
            }),
          }));

          if (updatedMatch) {
            postSystemMessage(updatedMatch, 'Le salon CODM est verrouille. Le match commence maintenant.');
            notify('Match en cours', `Le match ${updatedMatch.id} vient de passer en direct.`, `/mj/match/${updatedMatch.id}`, 'match_start');
          }
        },

        submitResult: (matchId, result) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          if (!match) return false;

          const normalizedProofs: MatchProofBundle | undefined = result.proofs
            ? {
                scoreboard: normalizeProofRefs(result.proofs.scoreboard),
                finalResult: normalizeProofRefs(result.proofs.finalResult),
                roomCapture: normalizeProofRefs(result.proofs.roomCapture),
                extraEvidence: normalizeProofRefs(result.proofs.extraEvidence),
              }
            : undefined;
          const flattenedProofs = flattenProofs(normalizedProofs);
          const normalizedScreenshots = result.screenshots?.length
            ? normalizeProofRefs(result.screenshots)
            : flattenedProofs;
          const requiresMandatoryProofs =
            result.resolutionType !== 'forfeit' && result.submittedBy !== 'admin-dashboard';

          if (
            requiresMandatoryProofs &&
            (!normalizedProofs || normalizedProofs.scoreboard.length === 0 || normalizedProofs.finalResult.length === 0)
          ) {
            return false;
          }

          const fullResult: MatchResult = {
            ...result,
            screenshots: normalizedScreenshots,
            proofs: normalizedProofs,
            proofHash: buildProofHash(matchId, result.winnerTeam, result.scores, normalizedScreenshots),
            resolutionType: result.resolutionType || 'played',
            submittedAt: getNow(),
            confirmedByTeams: [],
            payoutDistributed: true,
          };

          const resolvedDisputes = match.disputes.map((dispute) =>
            dispute.status === 'open' ? { ...dispute, status: 'resolved' as const, resolvedAt: getNow(), resolution: 'Resultat arbitre valide' } : dispute
          );

          let updatedMatch: Match | undefined;

          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = {
                ...entry,
                result: fullResult,
                disputes: resolvedDisputes,
                dispute: resolvedDisputes[0],
                arbiter: entry.arbiter ? { ...entry.arbiter, hasSubmittedResult: true } : entry.arbiter,
                status: 'finished',
                finishedAt: getNow(),
                updatedAt: getNow(),
              };
              return updatedMatch;
            }),
          }));

          if (!updatedMatch) return false;
          settleLocalUserForResult(updatedMatch, fullResult);
          postSystemMessage(
            updatedMatch,
            `Resultat valide. Squad ${fullResult.winnerTeam === 0 ? 'Alpha' : 'Bravo'} remporte le match.`
          );
          return true;
        },

        confirmResult: (matchId, userId) => {
          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              if (!entry.result || entry.result.confirmedByTeams.includes(userId)) return entry;
              return {
                ...entry,
                result: {
                  ...entry.result,
                  confirmedByTeams: [...entry.result.confirmedByTeams, userId],
                },
                updatedAt: getNow(),
              };
            }),
          }));
        },

        openDispute: (matchId, reason, evidence, requestedBy, category = 'result') => {
          const match = get().matches.find((entry) => entry.id === matchId);
          const normalizedEvidence = normalizeProofRefs(evidence);
          if (!match || !reason.trim() || normalizedEvidence.length === 0) return false;
          if (match.disputes.some((dispute) => dispute.status === 'open' || dispute.status === 'under_review')) {
            return false;
          }

          const openerPseudo =
            useAuthStore.getState().user?.id === requestedBy
              ? useAuthStore.getState().user?.pseudo
              : match.players.find((player) => player.userId === requestedBy)?.pseudo;

          const dispute: Dispute = {
            id: `DSP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            level: 1,
            category,
            reason: reason.trim(),
            evidence: normalizedEvidence,
            requestedBy,
            openedByPseudo: openerPseudo,
            status: 'open',
            createdAt: getNow(),
            openedAt: getNow(),
            prizePoolFrozen: true,
          };

          let updatedMatch: Match | undefined;
          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = {
                ...entry,
                dispute,
                disputes: [dispute, ...entry.disputes],
                status: 'disputed',
                updatedAt: getNow(),
              };
              return updatedMatch;
            }),
          }));

          if (!updatedMatch) return false;

          postSystemMessage(updatedMatch, `Litige ouvert par ${openerPseudo || 'un joueur'}. Prize pool gele.`);
          notify(
            'Litige ouvert',
            `${updatedMatch.id}: verification demandee sur ${category}.`,
            `/mj/match/${updatedMatch.id}`,
            'dispute_update'
          );
          return true;
        },

        resolveDispute: (matchId, resolution) => {
          let updatedMatch: Match | undefined;
          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              const nextDisputes = entry.disputes.map((dispute) =>
                dispute.status === 'open' || dispute.status === 'under_review'
                  ? { ...dispute, status: 'resolved' as const, resolution, resolvedAt: getNow(), prizePoolFrozen: false }
                  : dispute
              );

              updatedMatch = {
                ...entry,
                disputes: nextDisputes,
                dispute: nextDisputes[0],
                status:
                  entry.status === 'forfeited'
                    ? 'forfeited'
                    : entry.result
                      ? 'finished'
                      : getStatusFromMatch({ ...entry, disputes: nextDisputes }),
                updatedAt: getNow(),
              };
              return updatedMatch;
            }),
          }));

          if (updatedMatch) {
            postSystemMessage(updatedMatch, `Litige resolu: ${resolution}`);
            notify('Litige resolu', `${updatedMatch.id}: ${resolution}`, `/mj/match/${updatedMatch.id}`, 'dispute_update');
          }
        },

        setRoomDetails: (matchId, roomName, roomPassword) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          const safeRoomName = roomName.trim();
          const safeRoomPassword = roomPassword.trim();
          const scheduledAt = match ? getScheduledTimestamp(match) : null;
          const now = Date.now();

          if (!match || !safeRoomName || !safeRoomPassword || !match.arbiter || !scheduledAt) {
            return false;
          }

          const minutesUntilMatch = (scheduledAt - now) / 60000;
          if (minutesUntilMatch > 10) {
            return false;
          }

          let updatedMatch: Match | undefined;
          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = updateMatchSnapshot(entry, {
                roomName: safeRoomName,
                roomPassword: safeRoomPassword,
                arbiter: entry.arbiter
                  ? {
                      ...entry.arbiter,
                      roomName: safeRoomName,
                      roomPassword: safeRoomPassword,
                      roomPublishedAt: getNow(),
                    }
                  : entry.arbiter,
              });
              return updatedMatch;
            }),
          }));

          if (!updatedMatch) return false;

          postSystemMessage(updatedMatch, `Room CODM publiee: ${safeRoomName}. Le mot de passe est maintenant disponible.`);
          notify(
            'Salle partagee',
            `${updatedMatch.id}: la room CODM est visible pour les joueurs confirmes.`,
            `/mj/match/${updatedMatch.id}`,
            'arbitration_assigned'
          );
          return true;
        },

        setScheduledTime: (matchId, scheduledAt) => {
          let updatedMatch: Match | undefined;
          set((state) => ({
            matches: withMatchUpdate(state.matches, matchId, (entry) => {
              updatedMatch = updateMatchSnapshot(entry, { scheduledAt });
              return updatedMatch;
            }),
          }));

          if (updatedMatch) {
            postSystemMessage(updatedMatch, `Horaire confirme pour le ${new Date(scheduledAt).toLocaleString('fr-FR')}.`);
          }
        },

        setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f } })),

        getFilteredMatches: () => {
          const { matches, filters } = get();
          const currentUser = useAuthStore.getState().user;

          return matches.filter((match) => {
            if (match.visibility !== 'public') return false;
            if (currentUser) {
              const deviceAllowed =
                match.deviceRestriction === 'open' || match.deviceRestriction === currentUser.device;
              const controllerAllowed =
                match.controllerRestriction === 'open' || match.controllerRestriction === currentUser.controllerType;

              if (!deviceAllowed || !controllerAllowed) return false;
            }

            if (filters.format && filters.format !== 'all' && match.format !== filters.format) return false;
            if (filters.status && filters.status !== 'all' && match.status !== filters.status) return false;
            if (filters.minTrustScore && (match.trustScoreMin || 0) < filters.minTrustScore) return false;
            return true;
          });
        },

        getMatchById: (id) => get().matches.find((match) => match.id === id),

        getMyActiveMatches: (userId) =>
          get().matches.filter(
            (match) =>
              ACTIVE_STATUSES.includes(match.status) &&
              (match.players.some((player) => player.userId === userId) || match.arbiter?.userId === userId)
          ),

        getMatchHistory: (userId) =>
          get().matches.filter(
            (match) =>
              ['finished', 'cancelled', 'forfeited', 'disputed'].includes(match.status) &&
              (match.players.some((player) => player.userId === userId) || match.arbiter?.userId === userId)
          ),

        canJoinAsArbiter: (matchId) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          const currentUser = useAuthStore.getState().user;
          if (!match || !currentUser) return false;
          if (match.arbiter) return false;
          if (match.players.some((player) => player.userId === currentUser.id)) return false;
          return !['finished', 'cancelled', 'forfeited'].includes(match.status);
        },

        processMatchAutomation: () => {
          const now = Date.now();
          const matches = get().matches;

          matches.forEach((match) => {
            if (match.status === 'disputed' || isTerminalMatchStatus(match.status)) {
              return;
            }

            const expired = new Date(match.expiresAt).getTime() <= now;
            if (expired) {
              cancelMatchAutomatically(
                match,
                "Le match est annule automatiquement: la fenetre de 14 jours est depassee sans resultat valide."
              );
              return;
            }

            const scheduledAt = getScheduledTimestamp(match);
            if (!scheduledAt || scheduledAt > now || match.status === 'in_progress') {
              return;
            }

            if (!match.arbiter) {
              cancelMatchAutomatically(
                match,
                "Le match est annule automatiquement: aucun arbitre n'a confirme la salle a l'heure prevue."
              );
              return;
            }

            const teamAlphaReady = isTeamReadyForLaunch(match, 0);
            const teamBravoReady = isTeamReadyForLaunch(match, 1);

            if (teamAlphaReady && teamBravoReady) {
              autoReadyCheckedInPlayers(match);
              return;
            }

            if (!teamAlphaReady && !teamBravoReady) {
              cancelMatchAutomatically(
                match,
                "Le match est annule automatiquement: aucune equipe n'a valide tous ses joueurs a l'heure convenue."
              );
              return;
            }

            resolveMatchForfeit(
              match,
              teamAlphaReady ? 0 : 1,
              teamAlphaReady ? 1 : 0,
              `${getSquadLabel(teamAlphaReady ? 1 : 0)} ne s'est pas presente avec un roster complet a l'heure convenue.`
            );
          });
        },

        cleanupExpired: () => {
          get().processMatchAutomation();
        },
      };
});
