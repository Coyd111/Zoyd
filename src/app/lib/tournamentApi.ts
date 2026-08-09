import type {
  CreateTournamentInput,
  Tournament,
  TournamentRegistrationInput,
} from '../stores/tournamentStore';
import { authorizedGet, authorizedPost } from './apiClient';

interface TournamentListResponse {
  ok: boolean;
  tournaments: Tournament[];
}

interface TournamentResponse {
  ok: boolean;
  tournament: Tournament;
  user?: { id: string; pseudo: string; wallet?: { cashBalance: number; bonusBalance: number } };
  wallet?: { cashBalance: number; bonusBalance: number };
}

export const subscribeToTournaments = (onUpdate: () => void) => {
  // Géré via socketIO dans realtimeClient
  return { unsubscribe: () => {} };
};

export const fetchServerTournaments = async (): Promise<TournamentListResponse> => {
  try {
    return await authorizedGet<TournamentListResponse>('/api/tournaments');
  } catch (error) {
    console.error('Erreur chargement tournois:', error);
    return { ok: false, tournaments: [] };
  }
};

export const fetchServerTournament = async (tournamentId: string): Promise<TournamentResponse> => {
  return authorizedGet<TournamentResponse>(`/api/tournaments/${tournamentId}`);
};

export const createServerTournament = async (payload: CreateTournamentInput): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>('/api/tournaments', payload);
};

export const registerForServerTournament = async (
  tournamentId: string,
  payload: Omit<TournamentRegistrationInput, 'tournamentId' | 'userId'>
): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/register`, payload);
};

export const leaveServerTournament = async (tournamentId: string): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/leave`);
};

export const assignServerTournamentArbiter = async (tournamentId: string): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/arbiter`);
};

export const startServerTournament = async (tournamentId: string): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/start`);
};

export const setServerTournamentRoomDetails = async (
  tournamentId: string,
  matchId: string,
  roomName: string,
  roomPassword: string
): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/matches/${matchId}/room`, {
    roomName,
    roomPassword,
  });
};

export const setServerTournamentMatchLive = async (tournamentId: string, matchId: string): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/matches/${matchId}/live`);
};

export const submitServerTournamentResult = async (
  tournamentId: string,
  matchId: string,
  payload: { winnerEntryId: string; scoreA: number; scoreB: number; notes?: string }
): Promise<TournamentResponse> => {
  return authorizedPost<TournamentResponse>(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, payload);
};
