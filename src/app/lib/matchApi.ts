import { useAuthStore } from '../stores/authStore';
import type { DisputeCategory, Match, MatchResult } from '../stores/matchStore';
import type { WalletSnapshot } from './walletApi';

interface MatchActionResponse {
  ok: boolean;
  match: Match;
  user?: any;
  wallet?: WalletSnapshot;
}

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

const getAuthHeaders = () => {
  const token = useAuthStore.getState().sessionToken;
  if (!token) {
    throw new Error('Session joueur requise.');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Une erreur reseau est survenue.');
  }

  return payload as T;
};

const authorizedPost = async <T>(path: string, body?: unknown) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

export const createServerMatch = (payload: any) =>
  authorizedPost<MatchActionResponse>('/api/matches', payload);

export const joinServerMatch = (matchId: string, team?: 0 | 1) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/join`, { team });

export const assignServerArbiter = (matchId: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/arbiter`);

export const checkInServerMatch = (matchId: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/check-in`);

export const toggleServerReady = (matchId: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/ready`);

export const scheduleServerMatch = (matchId: string, scheduledAt: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/schedule`, { scheduledAt });

export const setServerRoomDetails = (matchId: string, roomName: string, roomPassword: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/room`, { roomName, roomPassword });

export const launchServerMatch = (matchId: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/launch`);

export const submitServerMatchResult = (
  matchId: string,
  payload: Omit<MatchResult, 'submittedAt' | 'confirmedByTeams' | 'payoutDistributed'>
) => authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/result`, payload);

export const confirmServerMatchResult = (matchId: string) =>
  authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/confirm`);

export const openServerMatchDispute = (
  matchId: string,
  payload: { reason: string; evidence: string[]; category?: DisputeCategory }
) => authorizedPost<MatchActionResponse>(`/api/matches/${matchId}/disputes`, payload);

export const adminAwardServerMatch = (matchId: string, winnerTeam: 0 | 1, arbiterNotes?: string) =>
  authorizedPost<MatchActionResponse>(`/api/admin/matches/${matchId}/award`, { winnerTeam, arbiterNotes });

export const adminResolveServerDispute = (matchId: string, resolution: string) =>
  authorizedPost<MatchActionResponse>(`/api/admin/matches/${matchId}/resolve-dispute`, { resolution });

export const adminCancelServerMatch = (matchId: string, reason: string) =>
  authorizedPost<MatchActionResponse>(`/api/admin/matches/${matchId}/cancel`, { reason });
