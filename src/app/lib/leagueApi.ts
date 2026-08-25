import type { LeagueSeason, LeagueDayKey } from '../stores/leagueStore';
import { authorizedGet, authorizedPost, authorizedPatch } from './apiClient';

interface LeagueListResponse {
  ok: boolean;
  seasons: LeagueSeason[];
}

interface LeagueResponse {
  ok: boolean;
  season: LeagueSeason;
  user?: { id: string; pseudo: string; wallet?: { cashBalance: number; bonusBalance: number } };
  wallet?: { cashBalance: number; bonusBalance: number };
}

export const fetchServerLeagues = async (): Promise<LeagueListResponse> => {
  try {
    return await authorizedGet<LeagueListResponse>('/api/leagues');
  } catch {
    return { ok: false, seasons: [] };
  }
};

export const fetchServerLeagueSeason = async (seasonId: string): Promise<LeagueResponse> => {
  return authorizedGet<LeagueResponse>(`/api/leagues/${seasonId}`);
};

export const createServerLeagueSeason = async (payload?: {
  registrationOpens?: string;
}): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>('/api/leagues', payload || {});
};

export const joinServerLeagueSeason = async (seasonId: string): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/join`);
};

export const leaveServerLeagueSeason = async (seasonId: string): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/leave`);
};

export const startServerLeagueQualification = async (seasonId: string): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/start-qualification`);
};

export const startServerLeagueDay = async (seasonId: string, dayKey: LeagueDayKey): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/days/${dayKey}/start`);
};

export const submitServerLeagueDayResults = async (
  seasonId: string,
  dayKey: LeagueDayKey,
  results: Array<{ userId: string; placement: number; kills?: number }>
): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/days/${dayKey}/results`, { results });
};

export const advanceToServerLeagueFinal = async (seasonId: string): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/advance-to-final`);
};

export const submitServerLeagueFinalResults = async (
  seasonId: string,
  results: Array<{ userId: string; placement: number; kills?: number }>
): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/final-results`, { results });
};

export const fetchServerLeagueLeaderboard = async (
  seasonId: string
): Promise<{ ok: boolean; standings: LeagueSeason['standings'] }> => {
  return authorizedGet(`/api/leagues/${seasonId}/leaderboard`);
};

export const updateServerLeagueSettings = async (
  seasonId: string,
  settings: {
    maxPlayers?: number;
    entryFee?: number;
    registrationOpens?: string;
    registrationCloses?: string;
  }
): Promise<LeagueResponse> => {
  return authorizedPatch<LeagueResponse>(`/api/leagues/${seasonId}`, settings);
};

export const reassignServerLeaguePlayer = async (
  seasonId: string,
  userId: string,
  fromDay: LeagueDayKey,
  toDay: LeagueDayKey
): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/reassign`, { userId, fromDay, toDay });
};

export const refundServerLeaguePlayer = async (
  seasonId: string,
  userId: string
): Promise<LeagueResponse> => {
  return authorizedPost<LeagueResponse>(`/api/leagues/${seasonId}/refund/${userId}`);
};

export const fetchServerLeaguePayments = async (
  seasonId: string
): Promise<{
  ok: boolean;
  payments: Array<{
    userId: string;
    pseudo: string;
    joinedAt: string;
    paid: boolean;
    amount: number;
    cashAmount: number;
    bonusAmount: number;
  }>;
}> => {
  return authorizedGet(`/api/leagues/${seasonId}/payments`);
};
