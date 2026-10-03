import { create } from 'zustand';
import type { User } from './authStore';
import { useAuthStore } from './authStore';
import type { MatchFormat } from './matchStore';
import { roundAmount } from '../../lib/utils';

export type TournamentStatus = 'recruiting' | 'live' | 'completed' | 'cancelled';
export type TournamentMatchStatus = 'pending' | 'ready' | 'live' | 'finished';
export type TournamentBracketType = 'main' | 'third_place';
export type TournamentControllerRestriction = User['controllerType'] | 'open';
export type TournamentDeviceRestriction = User['device'] | 'open';

export interface TournamentRules {
  mode: string;
  mapPool: string[];
  scoreTarget: number;
  bestOf: number;
  weaponRestrictions?: string;
  pointstreaks: 'allowed' | 'restricted';
  meleeAllowed: boolean;
  notes?: string;
}

export interface TournamentEntryMember {
/**
 * `userId` n'est PLUS envoyé : `sanitizeTournamentForBroadcast` le retire.
 * Le serveur ajoute `isMe` (calculé pour le demandeur). Utiliser `isMe`
 * ou `pseudo` (unique) — jamais `userId`, qui serait toujours undefined.
 */
pseudo: string;
/** Ce membre est le demandeur (calculé par le serveur). */
isMe?: boolean;
  joinedAt: string;
  isCaptain: boolean;
  rankMJ?: string;
}

export interface TournamentEntry {
  id: string;
  seed: number;
  squadName: string;
  captainId: string;
  captainPseudo: string;
  teamSize: number;
  members: TournamentEntryMember[];
  checkedIn: boolean;
  joinedAt: string;
  wins: number;
  losses: number;
  eliminatedAtRound?: number;
  finalPlacement?: number;
}

export interface TournamentArbiterSlot {
  slot: 1 | 2;
  userId?: string;
  pseudo?: string;
  trustScore?: number;
  assignedAt?: string;
  matchesHandled: number;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  bracketType: TournamentBracketType;
  round: number;
  position: number;
  entryAId?: string;
  entryBId?: string;
  winnerEntryId?: string;
  loserEntryId?: string;
  scoreA?: number;
  scoreB?: number;
  status: TournamentMatchStatus;
  scheduledAt?: string;
  arbiterSlot?: 1 | 2;
  roomName?: string;
  roomPassword?: string;
  notes?: string;
  updatedAt: string;
}

export interface TournamentPayout {
  grossPool: number;
  playerPool: number;
  arbiterPool: number;
  first: number;
  second: number;
  third: number;
}

export interface Tournament {
  id: string;
  name: string;
  format: MatchFormat;
  teamSize: number;
  maxEntries: number;
  minEntries: number;
  entryFee: number;
  status: TournamentStatus;
  rules: TournamentRules;
  startsAt: string;
  estimatedDurationHours: number;
  controllerRestriction: TournamentControllerRestriction;
  deviceRestriction: TournamentDeviceRestriction;
  entries: TournamentEntry[];
  arbitersNeeded: 1 | 2;
  arbiters: TournamentArbiterSlot[];
  payout: TournamentPayout;
  matches: TournamentMatch[];
  mainRounds: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  cancelReason?: string;
  cancelledAt?: string;
  /**
   * Remboursements de pass restés en échec sur un tournoi annulé. Non vide =
   * des ZC sont encore bloqués pour ces capitaines ; le serveur les rejoue
   * toutes les 6 h.
   */
  pendingRefunds?: Array<{ captainId: string; entryId?: string; lastError?: string }>;
}

export interface TournamentFilters {
  format?: MatchFormat | 'all';
  status?: TournamentStatus | 'all';
}

export interface CreateTournamentInput {
  creatorId: string;
  creatorPseudo: string;
  creatorTrustScore: number;
  format: MatchFormat;
  name: string;
  maxEntries: number;
  entryFee: number;
  startsAt: string;
  deviceRestriction?: TournamentDeviceRestriction;
  controllerRestriction?: TournamentControllerRestriction;
  reserveCreatorAsArbiter?: boolean;
  rules: TournamentRules;
}

export interface TournamentRegistrationMemberInput {
  pseudo: string;
  rankMJ?: string;
  userId?: string;
}

export interface TournamentRegistrationInput {
  tournamentId: string;
  userId: string;
  pseudo: string;
  rankMJ?: string;
  squadName?: string;
  teammates?: TournamentRegistrationMemberInput[];
}

export interface TournamentState {
  tournaments: Tournament[];
  filters: TournamentFilters;
  /** Caller-scoped positions, keyed by tournament id (session memory only, never persisted). */
  callerEntryByTournament: Record<string, string>;
  callerArbiterSlotByTournament: Record<string, 1 | 2>;
  openArbiterSlotsByTournament: Record<string, number>;
  hydrateFromServer: (tournaments: Tournament[]) => void;
  replaceFromServer: (tournaments: Tournament[]) => void;
  setFilters: (partial: Partial<TournamentFilters>) => void;
  setCallerTournamentContext: (
    tournamentId: string,
    context: { myEntryId?: string | null; myArbiterSlot?: 1 | 2 | null; openArbiterSlots?: number }
  ) => void;
  getFilteredTournaments: () => Tournament[];
  getTournamentById: (id: string) => Tournament | undefined;
}


// ---------------------------------------------------------------------------
// Server-side normalization helpers
// These functions ensure tournament data coming from the backend is always
// shaped correctly, regardless of schema version differences.
// ---------------------------------------------------------------------------

/** Reconstruct payout breakdown from raw pool figures. */
const buildPayout = (
  entryFee: number,
  entriesCount: number,
  arbitersNeeded: 1 | 2,
  teamSize = 1
): TournamentPayout => {
  const grossPool = roundAmount(entryFee * entriesCount * teamSize);
  const arbiterRate = arbitersNeeded === 2 ? 0.1 : 0.05;
  const arbiterPool = roundAmount(grossPool * arbiterRate);
  const playerPool = roundAmount(grossPool - arbiterPool);
  return {
    grossPool,
    playerPool,
    arbiterPool,
    first: roundAmount(playerPool * 0.5),
    second: roundAmount(playerPool * 0.3),
    third: roundAmount(playerPool * 0.2),
  };
};

/** Derive number of arbiters from max-entry count (matches backend rule). */
const getArbitersNeeded = (maxEntries: number): 1 | 2 => (maxEntries > 8 ? 2 : 1);

/** Extract team size from format string (e.g. '4VS4' → 4). */
const getTeamSize = (format: MatchFormat) => parseInt(format.split('VS')[0], 10);

/** Le serveur ne produit que 1 ou 2 ; le garde-fou tolère une valeur héritée hors bornes. */
const isArbiterCount = (value: number): value is 1 | 2 => value === 1 || value === 2;

const normalizePersistedTournament = (tournament: Tournament): Tournament => {
  const format = tournament?.format || '1VS1';
  const teamSize = tournament?.teamSize || getTeamSize(format as MatchFormat);
  const entries: TournamentEntry[] = Array.isArray(tournament?.entries)
    ? tournament.entries.map((entry, index) => ({
        ...entry,
        seed: entry?.seed || index + 1,
        teamSize: entry?.teamSize || teamSize,
        members: Array.isArray(entry?.members) ? entry.members : [],
      }))
    : [];
  const rawArbitersNeeded = tournament?.arbitersNeeded;
  const arbitersNeeded =
    typeof rawArbitersNeeded === 'number' && isArbiterCount(rawArbitersNeeded)
      ? rawArbitersNeeded
      : getArbitersNeeded(tournament?.maxEntries || 4);

  return {
    ...tournament,
    format: format as MatchFormat,
    teamSize,
    entries,
    arbitersNeeded,
    payout: buildPayout(Number(tournament?.entryFee || 0), entries.length, arbitersNeeded, teamSize),
  };
};

const mergeTournamentsByFreshness = (currentTournaments: Tournament[], incomingTournaments: Tournament[]) => {
  const merged = new Map<string, Tournament>();

  for (const tournament of currentTournaments) {
    merged.set(tournament.id, tournament);
  }

  for (const rawTournament of incomingTournaments) {
    const incoming = normalizePersistedTournament(rawTournament);
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

const normalizeTournamentCollection = (tournaments: Tournament[]) =>
  (Array.isArray(tournaments) ? tournaments : [])
    .map((tournament) => normalizePersistedTournament(tournament))
    .sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
    );

export const useTournamentStore = create<TournamentState>()((set, get) => {
      return {
        tournaments: [],
        filters: {
          format: 'all',
          status: 'all',
        },
        callerEntryByTournament: {},
        callerArbiterSlotByTournament: {},
        openArbiterSlotsByTournament: {},

        hydrateFromServer: (tournaments) => {
          set((state) => ({
            tournaments: mergeTournamentsByFreshness(state.tournaments, tournaments),
          }));
        },

        replaceFromServer: (tournaments) => {
          set(() => ({
            tournaments: normalizeTournamentCollection(tournaments),
          }));
        },

        setFilters: (partial) =>
          set((state) => ({
            filters: {
              ...state.filters,
              ...partial,
            },
          })),

        setCallerTournamentContext: (tournamentId, context) =>
          set((state) => {
            const callerEntryByTournament = { ...state.callerEntryByTournament };
            const callerArbiterSlotByTournament = { ...state.callerArbiterSlotByTournament };
            const openArbiterSlotsByTournament = { ...state.openArbiterSlotsByTournament };
            if (context.myEntryId) {
              callerEntryByTournament[tournamentId] = context.myEntryId;
            } else {
              delete callerEntryByTournament[tournamentId];
            }
            if (context.myArbiterSlot) {
              callerArbiterSlotByTournament[tournamentId] = context.myArbiterSlot;
            } else {
              delete callerArbiterSlotByTournament[tournamentId];
            }
            if (typeof context.openArbiterSlots === 'number') {
              openArbiterSlotsByTournament[tournamentId] = context.openArbiterSlots;
            }
            return { callerEntryByTournament, callerArbiterSlotByTournament, openArbiterSlotsByTournament };
          }),

        getFilteredTournaments: () => {
          const { tournaments, filters } = get();
          const currentUser = useAuthStore.getState().user;

          return tournaments.filter((tournament) => {
            if (currentUser) {
              const deviceAllowed =
                tournament.deviceRestriction === 'open' || tournament.deviceRestriction === currentUser.device;
              const controllerAllowed =
                tournament.controllerRestriction === 'open' || tournament.controllerRestriction === currentUser.controllerType;

              if (!deviceAllowed || !controllerAllowed) return false;
            }

            if (filters.format && filters.format !== 'all' && filters.format !== tournament.format) return false;
            if (filters.status && filters.status !== 'all' && filters.status !== tournament.status) return false;
            return true;
          });
        },

        getTournamentById: (id) => get().tournaments.find((tournament) => tournament.id === id),

      };
});
