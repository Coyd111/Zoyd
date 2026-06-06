import { useAuthStore } from '../stores/authStore';
import type {
  CreateTournamentInput,
  Tournament,
  TournamentRegistrationInput,
} from '../stores/tournamentStore';
import type { WalletSnapshot } from './walletApi';

interface TournamentActionResponse {
  ok: boolean;
  tournament: Tournament;
  user?: any;
  wallet?: WalletSnapshot;
}

interface TournamentCollectionResponse {
  ok: boolean;
  tournaments: Tournament[];
}

interface TournamentDetailResponse {
  ok: boolean;
  tournament: Tournament;
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

const authorizedGet = async <T>(path: string) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
      },
    })
  );

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

export const fetchServerTournaments = () =>
  authorizedGet<TournamentCollectionResponse>('/api/tournaments');

export const fetchServerTournament = (tournamentId: string) =>
  authorizedGet<TournamentDetailResponse>(`/api/tournaments/${tournamentId}`);

export const createServerTournament = (payload: CreateTournamentInput) =>
  authorizedPost<TournamentActionResponse>('/api/tournaments', payload);

export const registerForServerTournament = (
  tournamentId: string,
  payload: Omit<TournamentRegistrationInput, 'tournamentId' | 'userId'>
) => authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/register`, payload);

export const leaveServerTournament = (tournamentId: string) =>
  authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/leave`);

export const assignServerTournamentArbiter = (tournamentId: string) =>
  authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/arbiter`);

export const startServerTournament = (tournamentId: string) =>
  authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/start`);

export const setServerTournamentRoomDetails = (
  tournamentId: string,
  matchId: string,
  roomName: string,
  roomPassword: string
) =>
  authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/matches/${matchId}/room`, {
    roomName,
    roomPassword,
  });

export const setServerTournamentMatchLive = (tournamentId: string, matchId: string) =>
  authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/matches/${matchId}/live`);

export const submitServerTournamentResult = (
  tournamentId: string,
  matchId: string,
  payload: { winnerEntryId: string; scoreA: number; scoreB: number; notes?: string }
) =>
  authorizedPost<TournamentActionResponse>(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, payload);
