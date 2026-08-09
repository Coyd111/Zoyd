import { create } from 'zustand';
import { useAuthStore } from './authStore';

export type LeagueSeasonStatus = 'registering' | 'qualifying' | 'final' | 'completed';
export type LeagueDayKey = 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type LeagueDayStatus = 'pending' | 'scheduled' | 'live' | 'finished';

export interface LeaguePlayer {
  userId: string;
  pseudo: string;
  joinedAt: string;
}

export interface LeagueDayResult {
  userId: string;
  placement: number;
  kills: number;
  points: number;
}

export interface LeagueDaySlot {
  players: string[];
  matchId: string | null;
  results: LeagueDayResult[];
  status: LeagueDayStatus;
}

export interface LeagueStanding {
  userId: string;
  pseudo: string;
  totalPoints: number;
  bestPlacement: number;
  matchesPlayed: number;
  placements: number[];
}

export interface LeagueFinalist {
  userId: string;
  pseudo: string;
  totalPoints: number;
  bestPlacement: number;
}

export interface LeaguePayout {
  gross: number;
  first: number;
  second: number;
  third: number;
}

export interface LeaguePodium {
  first: string | null;
  second: string | null;
  third: string | null;
}

export interface LeagueSchedule {
  registrationOpens: string;
  registrationCloses: string | null;
  qualifyingStarts: string | null;
  qualifyingEnds: string | null;
  finalAt: string | null;
}

export interface LeagueFinalMatch {
  matchId: string | null;
  results: Array<{ userId: string; placement: number; kills: number }>;
  status: 'pending' | 'live' | 'finished';
}

export interface LeagueSeason {
  id: string;
  cycleNumber: number;
  status: LeagueSeasonStatus;
  entryFee: number;
  maxPlayers: number;
  registeredPlayers: LeaguePlayer[];
  qualificationGroups: Partial<Record<LeagueDayKey, LeagueDaySlot>>;
  standings: LeagueStanding[];
  finalists: LeagueFinalist[];
  finalMatch: LeagueFinalMatch;
  podium: LeaguePodium;
  payout: LeaguePayout;
  schedule: LeagueSchedule;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface LeagueFilters {
  status: LeagueSeasonStatus | 'all';
}

export interface LeagueState {
  seasons: LeagueSeason[];
  filters: LeagueFilters;
  hydrateFromServer: (seasons: LeagueSeason[]) => void;
  replaceFromServer: (seasons: LeagueSeason[]) => void;
  setFilters: (partial: Partial<LeagueFilters>) => void;
  getFilteredSeasons: () => LeagueSeason[];
  getSeasonById: (id: string) => LeagueSeason | undefined;
  getActiveSeason: () => LeagueSeason | undefined;
  isPlayerRegistered: (seasonId: string, userId?: string) => boolean;
}

interface StoredSeason {
  id?: string;
  cycleNumber?: number;
  status?: string;
  entryFee?: number;
  maxPlayers?: number;
  registeredPlayers?: LeaguePlayer[];
  qualificationGroups?: Partial<Record<LeagueDayKey, Partial<LeagueDaySlot>>>;
  standings?: LeagueStanding[];
  finalists?: LeagueFinalist[];
  finalMatch?: Partial<LeagueFinalMatch>;
  podium?: Partial<LeaguePodium>;
  payout?: Partial<LeaguePayout>;
  schedule?: Partial<LeagueSchedule>;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
}

const normalizePersistedSeason = (season: StoredSeason): LeagueSeason => {
  const DAY_KEYS: LeagueDayKey[] = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const qualificationGroups: Partial<Record<LeagueDayKey, LeagueDaySlot>> = {};
  for (const day of DAY_KEYS) {
    const raw = season?.qualificationGroups?.[day];
    qualificationGroups[day] = {
      players: Array.isArray(raw?.players) ? raw.players : [],
      matchId: raw?.matchId || null,
      results: Array.isArray(raw?.results) ? raw.results : [],
      status: raw?.status || 'pending',
    };
  }

  return {
    ...season,
    status: season?.status || 'registering',
    entryFee: Number(season?.entryFee || 50),
    maxPlayers: Number(season?.maxPlayers || 500),
    registeredPlayers: Array.isArray(season?.registeredPlayers) ? season.registeredPlayers : [],
    qualificationGroups,
    standings: Array.isArray(season?.standings) ? season.standings : [],
    finalists: Array.isArray(season?.finalists) ? season.finalists : [],
    finalMatch: {
      matchId: season?.finalMatch?.matchId || null,
      results: Array.isArray(season?.finalMatch?.results) ? season.finalMatch.results : [],
      status: season?.finalMatch?.status || 'pending',
    },
    podium: {
      first: season?.podium?.first || null,
      second: season?.podium?.second || null,
      third: season?.podium?.third || null,
    },
    payout: {
      gross: Number(season?.payout?.gross || 0),
      first: Number(season?.payout?.first || 0),
      second: Number(season?.payout?.second || 0),
      third: Number(season?.payout?.third || 0),
    },
    schedule: {
      registrationOpens: season?.schedule?.registrationOpens || season?.createdAt || new Date().toISOString(),
      registrationCloses: season?.schedule?.registrationCloses || null,
      qualifyingStarts: season?.schedule?.qualifyingStarts || null,
      qualifyingEnds: season?.schedule?.qualifyingEnds || null,
      finalAt: season?.schedule?.finalAt || null,
    },
    createdAt: season?.createdAt || new Date().toISOString(),
    updatedAt: season?.updatedAt || new Date().toISOString(),
    finishedAt: season?.finishedAt || null,
  };
};

const mergeSeasonsByFreshness = (current: LeagueSeason[], incoming: LeagueSeason[]) => {
  const merged = new Map<string, LeagueSeason>();
  for (const s of current) merged.set(s.id, s);

  for (const raw of incoming) {
    const incomingSeason = normalizePersistedSeason(raw);
    const existing = merged.get(incomingSeason.id);
    if (!existing) {
      merged.set(incomingSeason.id, incomingSeason);
      continue;
    }
    const existingTs = new Date(existing.updatedAt || existing.createdAt).getTime();
    const incomingTs = new Date(incomingSeason.updatedAt || incomingSeason.createdAt).getTime();
    if (incomingTs >= existingTs) merged.set(incomingSeason.id, incomingSeason);
  }

  return [...merged.values()].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  );
};

const normalizeSeasonCollection = (seasons: LeagueSeason[]) =>
  (Array.isArray(seasons) ? seasons : [])
    .map(normalizePersistedSeason)
    .sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );

export const useLeagueStore = create<LeagueState>()((set, get) => ({
  seasons: [],
  filters: { status: 'all' },

  hydrateFromServer: (seasons) => {
    set((state) => ({
      seasons: mergeSeasonsByFreshness(state.seasons, seasons),
    }));
  },

  replaceFromServer: (seasons) => {
    set(() => ({
      seasons: normalizeSeasonCollection(seasons),
    }));
  },

  setFilters: (partial) =>
    set((state) => ({
      filters: { ...state.filters, ...partial },
    })),

  getFilteredSeasons: () => {
    const { seasons, filters } = get();
    return seasons.filter((s) => {
      if (filters.status !== 'all' && filters.status !== s.status) return false;
      return true;
    });
  },

  getSeasonById: (id) => get().seasons.find((s) => s.id === id),

  getActiveSeason: () => {
    const { seasons } = get();
    return seasons.find((s) => s.status === 'registering' || s.status === 'qualifying' || s.status === 'final');
  },

  isPlayerRegistered: (seasonId, userId?) => {
    const uid = userId || useAuthStore.getState().user?.id;
    if (!uid) return false;
    const season = get().seasons.find((s) => s.id === seasonId);
    if (!season) return false;
    return season.registeredPlayers.some((p) => p.userId === uid);
  },
}));
