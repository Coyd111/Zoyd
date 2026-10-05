import { authorizedGet, authorizedPost } from './apiClient';

/**
 * Client du Battle Royale (salon unique, un seul match).
 *
 * Règle commerciale rappelée dans toute l'UI : le pass est payé à
 * l'inscription et n'est JAMAIS remboursé une fois la partie lancée. Le seul
 * remboursement possible est une désinscription avant l'heure de départ.
 */

export interface BrMap {
  id: string;
  label: string;
  maxPlayers: number;
  vehicles: boolean;
}

export interface BrMode {
  id: string;
  label: string;
  teamSize: number;
  maxPlayers: number;
}

export interface BrRankingMode {
  id: string;
  label: string;
}

/** Joueur dans le roster public : AUCUN userId n'est exposé. */
export interface BrLobbyPlayer {
  pseudo: string;
  teamId: string;
  joinedAt: string;
  checkedIn: boolean;
  alive: boolean;
  placement: number | null;
  kills: number;
  absent: boolean;
}

export interface BrPayout {
  first: number;
  second: number;
  third: number;
  fourth: number;
  fifth: number;
  /** Commission de l'arbitre, plafonnée à 5 % côté serveur. */
  arbiterRate: number;
}

export type BrLobbyStatus = 'scheduled' | 'live' | 'settling' | 'finished' | 'cancelled';

export interface BrLobby {
  id: string;
  name: string;
  mode: string;
  map: string;
  maxPlayers: number;
  entryFee: number;
  rankingMode: string;
  payout: BrPayout;
  status: BrLobbyStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  players: BrLobbyPlayer[];
  pot: number;
  prizePool: number;
  notes: string;
  creatorId: string | null;
  creatorPseudo: string | null;
  createdAt: string;
  /** Renseigné quand l'admin s'est déclaré arbitre du salon. */
  arbiterId?: string | null;
}

export interface BrConfig {
  maps: Record<string, BrMap>;
  mapIds: string[];
  modes: Record<string, BrMode>;
  modeIds: string[];
  rankingModes: Record<string, BrRankingMode>;
  rankingModeIds: string[];
  prizedPlaces: number;
  arbiterMaxRate: number;
}

export interface BrPrizeProjection {
  placement: number;
  kills: number;
  amount: number;
}

/**
 * Répartition lisible d'une cagnotte BR : montants en ZC par place, plus la
 * commission de l'arbitre. Calculée par le serveur (source de vérité).
 */
export const splitBrPayout = (lobby: BrLobby) => {
  const pot = lobby.pot || 0;
  const rate = lobby.payout?.arbiterRate || 0;
  const winnersPool = pot * (1 - rate);
  const shares: Array<{ place: number; rate: number }> = [
    { place: 1, rate: lobby.payout?.first || 0 },
    { place: 2, rate: lobby.payout?.second || 0 },
    { place: 3, rate: lobby.payout?.third || 0 },
    { place: 4, rate: lobby.payout?.fourth || 0 },
    { place: 5, rate: lobby.payout?.fifth || 0 },
  ];
  return {
    pot,
    winnersPool,
    arbiterRate: rate,
    arbiterAmount: pot * rate,
    places: shares.map((s) => ({ ...s, amount: winnersPool * s.rate })),
  };
};

export const fetchBrConfig = async (): Promise<BrConfig> => {
  const response = await authorizedGet<{ ok: boolean } & BrConfig>('/api/br/config');
  return response;
};

export const fetchBrLobbies = async (): Promise<BrLobby[]> => {
  const response = await authorizedGet<{ ok: boolean; lobbies: BrLobby[] }>('/api/br/lobbies');
  return Array.isArray(response.lobbies) ? response.lobbies : [];
};

export const fetchBrLobby = async (lobbyId: string): Promise<BrLobby> => {
  const response = await authorizedGet<{ ok: boolean; lobby: BrLobby }>(`/api/br/lobbies/${lobbyId}`);
  return response.lobby;
};

export interface CreateBrLobbyPayload {
  name: string;
  mode: string;
  map: string;
  entryFee: number;
  scheduledAt: string;
  rankingMode: string;
  payout: BrPayout;
  notes?: string;
}

export const createBrLobby = async (payload: CreateBrLobbyPayload): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>('/api/br/lobbies', payload);
  return response.lobby;
};

export const joinBrLobby = async (lobbyId: string): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>(`/api/br/lobbies/${lobbyId}/join`);
  return response.lobby;
};

export const leaveBrLobby = async (lobbyId: string): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>(`/api/br/lobbies/${lobbyId}/leave`);
  return response.lobby;
};

export const checkInBrLobby = async (lobbyId: string): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>(`/api/br/lobbies/${lobbyId}/checkin`);
  return response.lobby;
};
