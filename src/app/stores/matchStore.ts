import { create } from 'zustand';
import type { User } from './authStore';
import { useAuthStore } from './authStore';
import { roundAmount } from '../../lib/utils';

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
  escalatedByPseudo?: string;
  status: 'open' | 'under_review' | 'resolved' | 'rejected';
  resolution?: string;
  createdAt: string;
  openedAt?: string;
  escalatedAt?: string;
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
  filters: MatchFilters;
  hydrateFromServer: (matches: Match[]) => void;
  replaceFromServer: (matches: Match[]) => void;
  setFilters: (f: Partial<MatchFilters>) => void;
  getFilteredMatches: () => Match[];
  getMatchById: (id: string) => Match | undefined;
  getMyActiveMatches: (userId: string) => Match[];
  getMatchHistory: (userId: string) => Match[];
  canJoinAsArbiter: (matchId: string) => boolean;
}

const ACTIVE_STATUSES: MatchStatus[] = ['recruiting', 'full', 'check_in', 'ready', 'in_progress'];
export const MATCH_AUTOMATION_INTERVAL_MS = 30_000;

const getNow = () => new Date().toISOString();
const getTeamSize = (format: MatchFormat) => parseInt(format.split('VS')[0], 10);
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
interface StoredDispute {
  id?: string;
  level?: number;
  category?: DisputeCategory;
  reason?: string;
  evidence?: string[];
  requestedBy?: string;
  status?: string;
  resolution?: string;
  createdAt?: string;
  openedAt?: string;
  resolvedAt?: string;
  prizePoolFrozen?: boolean;
}

interface StoredProofs {
  scoreboard?: string[];
  finalResult?: string[];
  roomCapture?: string[];
  extraEvidence?: string[];
}

interface StoredResult {
  winnerTeam?: MatchTeam;
  scores?: { team0: number; team1: number };
  screenshots?: string[];
  proofs?: StoredProofs;
  proofHash?: string;
  arbiterNotes?: string;
  resolutionType?: 'played' | 'forfeit';
  forfeitTeam?: MatchTeam;
  submittedBy?: string;
  submittedAt?: string;
  confirmedByTeams?: string[];
  payoutDistributed?: boolean;
}

interface StoredMatch {
  id?: string;
  disputes?: StoredDispute[];
  dispute?: StoredDispute;
  result?: StoredResult;
  [key: string]: unknown;
}

const normalizeStoredDispute = (dispute: StoredDispute): Dispute => ({
  id: dispute?.id || '',
  level: (dispute?.level as 1 | 2 | 3) || 1,
  category: dispute?.category || 'result',
  reason: dispute?.reason || '',
  evidence: Array.isArray(dispute?.evidence) ? dispute.evidence : [],
  requestedBy: dispute?.requestedBy || '',
  status: (dispute?.status as Dispute['status']) || 'open',
  resolution: dispute?.resolution,
  createdAt: dispute?.createdAt || '',
  openedAt: dispute?.openedAt,
  resolvedAt: dispute?.resolvedAt,
  prizePoolFrozen: Boolean(dispute?.prizePoolFrozen),
});
const normalizeStoredProofs = (proofs: StoredProofs): MatchProofBundle => ({
  scoreboard: Array.isArray(proofs?.scoreboard) ? proofs.scoreboard : [],
  finalResult: Array.isArray(proofs?.finalResult) ? proofs.finalResult : [],
  roomCapture: Array.isArray(proofs?.roomCapture) ? proofs.roomCapture : [],
  extraEvidence: Array.isArray(proofs?.extraEvidence) ? proofs.extraEvidence : [],
});
const normalizeStoredResult = (matchId: string, result: StoredResult): MatchResult => {
  const proofs = result?.proofs ? normalizeStoredProofs(result.proofs) : undefined;
  const screenshots = Array.isArray(result?.screenshots) ? result.screenshots : flattenProofs(proofs);

  return {
    winnerTeam: result?.winnerTeam ?? 0,
    scores: result?.scores || { team0: 0, team1: 0 },
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
    arbiterNotes: result?.arbiterNotes,
    forfeitTeam: result?.forfeitTeam,
    submittedBy: result?.submittedBy || '',
    submittedAt: result?.submittedAt || '',
    confirmedByTeams: result?.confirmedByTeams || [],
    payoutDistributed: Boolean(result?.payoutDistributed),
  };
};
const normalizeStoredMatch = (match: StoredMatch): Match => ({
  id: match.id || '',
  creatorId: match.creatorId || '',
  creatorPseudo: match.creatorPseudo || '',
  format: match.format || '1VS1',
  teamSize: match.teamSize || 1,
  maxPlayers: match.maxPlayers || 2,
  rules: match.rules || { mode: 'ranked', map: 'Unknown', scoreTarget: 13, bestOf: 1 },
  entryFee: match.entryFee || 0,
  prizePool: match.prizePool || 0,
  zoydFee: match.zoydFee || 0,
  arbiterFee: match.arbiterFee || 0,
  visibility: match.visibility || 'public',
  deviceRestriction: match.deviceRestriction || 'open',
  controllerRestriction: match.controllerRestriction || 'open',
  status: match.status || 'recruiting',
  players: match.players || [],
  arbiter: match.arbiter,
  result: match?.result ? normalizeStoredResult(match.id || '', match.result) : undefined,
  dispute: match?.dispute ? normalizeStoredDispute(match.dispute) : undefined,
  disputes: Array.isArray(match?.disputes) ? match.disputes.map(normalizeStoredDispute) : [],
  scheduledAt: match.scheduledAt,
  startedAt: match.startedAt,
  finishedAt: match.finishedAt,
  roomName: match.roomName,
  roomPassword: match.roomPassword,
  chatChannelId: match.chatChannelId || '',
  channelId: match.channelId || '',
  createdAt: match.createdAt || '',
  updatedAt: match.updatedAt || '',
  expiresAt: match.expiresAt || '',
  trustScoreMin: match.trustScoreMin,
  isInstant: match.isInstant ?? false,
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
      return {
        matches: [],
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

        setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f } })),

        getFilteredMatches: () => {
          const { matches, filters } = get();
          const currentUser = useAuthStore.getState().user;
          if (!Array.isArray(matches)) return [];

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

      };
});
