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
  userId: string;
  pseudo: string;
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
  hydrateFromServer: (tournaments: Tournament[]) => void;
  replaceFromServer: (tournaments: Tournament[]) => void;
  setFilters: (partial: Partial<TournamentFilters>) => void;
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

interface StoredTournamentEntry {
  id?: string;
  userId?: string;
  pseudo?: string;
  seed?: number;
  teamSize?: number;
  members?: Array<{ userId: string; pseudo: string }>;
  [key: string]: unknown;
}

interface StoredTournament {
  format?: string;
  teamSize?: number;
  entries?: StoredTournamentEntry[];
  arbitersNeeded?: number;
  maxEntries?: number;
  entryFee?: number;
  [key: string]: unknown;
}

const normalizePersistedTournament = (tournament: StoredTournament): Tournament => {
  const format = tournament?.format || '1VS1';
  const teamSize = tournament?.teamSize || getTeamSize(format as MatchFormat);
  const entries = Array.isArray(tournament?.entries)
    ? tournament.entries.map((entry: StoredTournamentEntry, index: number) => ({
        ...entry,
        seed: entry?.seed || index + 1,
        teamSize: entry?.teamSize || teamSize,
        members: Array.isArray(entry?.members) ? entry.members : [],
      }))
    : [];
  const arbitersNeeded = tournament?.arbitersNeeded || getArbitersNeeded(tournament?.maxEntries || 4);

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
