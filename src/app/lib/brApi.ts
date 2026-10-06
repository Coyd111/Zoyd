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

/**
 * Joueur dans la VUE ARBITRE : seule vue qui porte les `userId`.
 *
 * `eliminate` exige un `userId`, et personne d'autre que l'arbitre ne peut
 * l'obtenir — le roster public masque volontairement les identifiants.
 */
export interface BrArbiterPlayer extends BrLobbyPlayer {
  userId: string;
  /** Id du joueur qui l'a éliminé (`null` si mort/mort ou absent). */
  killedBy: string | null;
  eliminatedAt: string | null;
  /** Absent au lancement : son pass est consommé, il ne peut pas tuer. */
  settled: boolean;
  winnings: number;
  assists: number;
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
  /**
   * Le lecteur courant est-il l'arbitre de ce salon ? C'est ce booléen qui
   * remplace `arbiterId` dans l'API publique : un `userId` d'arbitre dans un
   * roster partagé relierait un pseudo à un compte pour tout le monde.
   */
  isArbiter: boolean;
  creatorPseudo: string | null;
  arbiterPseudo: string | null;
  createdAt: string;
}

/** Salon vu par son arbitre : porte les `userId` nécessaires aux éliminations. */
export interface BrArbiterLobby extends Omit<BrLobby, 'players' | 'isArbiter'> {
  players: BrArbiterPlayer[];
  isArbiter: true;
}

export interface BrArbiterSummary {
  total: number;
  present: number;
  alive: number;
  eliminated: number;
  absent: number;
  pot: number;
}

export interface BrArbiterView {
  lobby: BrArbiterLobby;
  ranking: Array<BrArbiterPlayer & { score: number }>;
  summary: BrArbiterSummary;
  projectedPayouts: BrProjectedPayouts;
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
 * Répartition projetée par le serveur (source de vérité) : les gains du top 5
 * et la commission d'arbitre, calculés sur la cagnotte réellement bloquée.
 */
export interface BrProjectedPayouts {
  payouts: BrPrizeProjection[];
  arbiter: { rate: number; amount: number } | null;
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

/**
 * Vue ARBITRE du salon (les `userId` sont inclus).
 *
 * Le serveur la refuse à quiconque n'est pas l'arbitre désigné : c'est la
 * seule source des identifiants nécessaires pour saisir une élimination.
 */
export const fetchBrArbiterView = async (lobbyId: string): Promise<BrArbiterView> => {
  const response = await authorizedGet<{ ok: boolean } & BrArbiterView>(
    `/api/br/lobbies/${lobbyId}/arbiter`,
  );
  return response;
};

/**
 * Lance la partie. Réservé à l'arbitre : c'est le moment où les absents sont
 * pénalisés et où leur pass est consommé.
 */
export const startBrLobby = async (lobbyId: string): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>(`/api/br/lobbies/${lobbyId}/start`);
  return response.lobby;
};

export interface EliminateBrPlayerPayload {
  /** Le joueur éliminé. */
  userId: string;
  /** Son tueur, ou `null` pour une mort « mort/mort » / sans kill crédité. */
  killerUserId?: string | null;
  assists?: number;
}

export const eliminateBrPlayer = async (
  lobbyId: string,
  payload: EliminateBrPlayerPayload,
): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>(
    `/api/br/lobbies/${lobbyId}/eliminate`,
    payload,
  );
  return response.lobby;
};

/**
 * Clôture la partie : le serveur calcule le classement et verse la cagnotte.
 *
 * Money-out : la route exige la 2FA admin en plus du rôle d'arbitre.
 */
export const finishBrLobby = async (lobbyId: string): Promise<BrLobby> => {
  const response = await authorizedPost<{ ok: boolean; lobby: BrLobby }>(`/api/br/lobbies/${lobbyId}/finish`);
  return response.lobby;
};
