import type { Match } from '../stores/matchStore';
import { authorizedGet, authorizedPost } from './apiClient';

interface MatchResponse {
  ok: boolean;
  match: Match;
  matches?: Match[];
}

interface MatchListResponse {
  ok: boolean;
  matches: Match[];
}

export interface CreateMatchPayload {
  visibility?: 'public' | 'private';
  format?: string;
  betAmount?: number;
  gameMode?: string;
  region?: string;
  scheduledAt?: string;
  description?: string;
}

export interface MatchResultPayload {
  winnerTeam: 0 | 1;
  score?: string;
  scores?: { team0: number; team1: number };
  screenshots?: string[];
  proofs?: {
    scoreboard?: string[];
    finalResult?: string[];
    roomCapture?: string[];
    extraEvidence?: string[];
  };
  arbiterNotes?: string;
  submittedBy?: string;
}

export interface DisputePayload {
  reason: string;
  evidence?: string[];
}

export const subscribeToMatches = (onUpdate: () => void) => {
  // Polling léger pour les mises à jour hors-socket (remplace le no-op précédent)
  const intervalId = setInterval(onUpdate, 30_000);
  return { unsubscribe: () => clearInterval(intervalId) };
};

export const fetchAllMatchesFromDb = async (): Promise<Match[]> => {
  try {
    const res = await authorizedGet<MatchListResponse>('/api/matches');
    return res.matches || [];
  } catch (error) {
    return [];
  }
};

export const createServerMatch = async (payload: CreateMatchPayload) => {
  return authorizedPost<MatchResponse>('/api/matches', payload);
};

export const joinServerMatch = async (matchId: string, team?: 0 | 1) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/join`, { team });
};

export const assignServerArbiter = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/arbiter`);
};

export const checkInServerMatch = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/check-in`);
};

export const toggleServerReady = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/ready`);
};

export const scheduleServerMatch = async (matchId: string, scheduledAt: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/schedule`, { scheduledAt });
};

export const setServerRoomDetails = async (matchId: string, roomName: string, roomPassword: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/room`, { roomName, roomPassword });
};

export const launchServerMatch = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/launch`);
};

export const submitServerMatchResult = async (matchId: string, payload: MatchResultPayload) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/result`, payload);
};

export const confirmServerMatchResult = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/confirm`);
};

export const openServerMatchDispute = async (matchId: string, payload: DisputePayload) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/dispute`, payload);
};

export const adminAwardServerMatch = async (matchId: string, winnerTeam: 0 | 1, arbiterNotes?: string) => {
  return authorizedPost<MatchResponse>(`/api/admin/matches/${matchId}/award`, { winnerTeam, arbiterNotes });
};

export const adminResolveServerDispute = async (matchId: string, resolution: string) => {
  return authorizedPost<MatchResponse>(`/api/admin/matches/${matchId}/resolve-dispute`, { resolution });
};

export const adminCancelServerMatch = async (matchId: string, reason: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/cancel`, { reason });
};

export const addServerDisputeEvidence = async (matchId: string, evidence: string[]) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/dispute/evidence`, { evidence });
};

export const escalateServerDispute = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/dispute/escalate`, {});
};
