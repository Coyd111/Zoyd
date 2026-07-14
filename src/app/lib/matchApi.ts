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

export const subscribeToMatches = (onUpdate: () => void) => {
  // En temps réel via socket, ceci est géré par realtimeClient et socketStore.
  // On retourne une fonction de désabonnement vide pour garder la signature compatible avec le RootLayout actuel.
  return { unsubscribe: () => {} };
};

export const fetchAllMatchesFromDb = async (): Promise<Match[]> => {
  try {
    const res = await authorizedGet<MatchListResponse>('/api/matches');
    return res.matches || [];
  } catch (error) {
    console.error('Erreur chargement matchs:', error);
    return [];
  }
};

export const createServerMatch = async (payload: any) => {
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

export const submitServerMatchResult = async (matchId: string, payload: any) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/result`, payload);
};

export const confirmServerMatchResult = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/confirm-result`);
};

export const openServerMatchDispute = async (matchId: string, payload: any) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/dispute`, payload);
};

export const adminAwardServerMatch = async (matchId: string, winnerTeam: 0 | 1, arbiterNotes?: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/result`, { winnerTeam, arbiterNotes, isAdmin: true });
};

export const adminResolveServerDispute = async (matchId: string, resolution: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/resolve-dispute`, { resolution });
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
