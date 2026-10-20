/**
 * matchApi - appels REST des matchs : liste, creation, check-in, arbitrage,
 * resultat, confirmation, litiges.
 *
 * Client dedie du domaine match. Chaque fonction renvoie la forme renvoyee
 * par le serveur (match, user, wallet) ; la normalisation vers les types du
 * store est faite par matchStore.
 *
 * INVARIANT : toute mutation passe par cette API. Le front ne doit jamais
 * ecrire un match localement en esperant que le serveur suive.
 * PIEGE : les actions authentifiees renvoient le snapshot du wallet. Il faut
 * l'hydrater (applyServerAccountState) : sinon l'ecran affiche un solde
 * anterieur a l'action.
 * PIEGE : le resultat d'un match n'est pas verse au moment de la soumission.
 * Le pot est gele jusqu'a la confirmation des DEUX equipes : c'est
 * `payoutDistributed` qui dit si l'argent est parti.
 *
 * Voir aussi : docs/08-frontend.md - section 4 (Les layouts)
 */
import type { Match } from '../stores/matchStore';
import type { User } from '../stores/authStore';
import type { WalletSnapshot } from './walletApi';
import { authorizedGet, authorizedPost } from './apiClient';
import { getApiUrl } from './apiUrl';

interface MatchResponse {
  ok: boolean;
  match: Match;
  /** Le serveur renvoie l'enregistrement utilisateur complet. */
  user?: Partial<User>;
  /** Snapshot normalisé complet renvoyé par les actions authentifiées. */
  wallet?: WalletSnapshot;
  /** `true` quand le résultat attend la confirmation des deux équipes (aucun versement). */
  awaitingConfirmation?: boolean;
  /** ISO : fin de la fenêtre de confirmation (~30 min). */
  confirmationDeadline?: string;
}

/** Réponse de `POST /api/matches/:id/confirm`. */
export interface ConfirmMatchResultResponse extends MatchResponse {
  /** `true` = toutes les équipes ont confirmé, le pot est parti, le match est `finished`. */
  settled: boolean;
  /** Joueurs du match qui n'ont pas encore confirmé. */
  waitingFor: string[];
}

interface MatchListResponse {
  ok: boolean;
  matches: Match[];
}

export interface CreateMatchPayload {
  creatorTeam?: 0 | 1;
  format?: string;
  entryFee?: number;
  visibility?: 'public' | 'private';
  trustScoreMin?: number;
  isInstant?: boolean;
  rules?: {
    mode: string;
    map: string;
    weaponRestrictions?: string;
    scoreTarget?: number;
    bestOf?: number;
    pointstreaks?: 'allowed' | 'restricted';
    meleeAllowed?: boolean;
  };
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
  category?: string;
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
  } catch {
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
  return authorizedPost<ConfirmMatchResultResponse>(`/api/matches/${matchId}/confirm`);
};

export const openServerMatchDispute = async (matchId: string, payload: DisputePayload) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/disputes`, payload);
};

export const adminAwardServerMatch = async (matchId: string, winnerTeam: 0 | 1, arbiterNotes?: string) => {
  return authorizedPost<MatchResponse>(`/api/admin/matches/${matchId}/award`, { winnerTeam, arbiterNotes });
};

/**
 * Clôturer un litige (admin).
 *
 * `action` décide du sort de l'argent — sans lui, le serveur applique `settle`
 * par défaut, ce qui PAIE le résultat. Pour rembourser les passes il faut
 * explicitement demander `refund`.
 *   - `settle` : applique le résultat en attente (gagnant payé)
 *   - `refund` : rembourse toutes les passes, match annulé
 *   - `'none'`  : aucun argent en jeu (litige sur un match sans résultat)
 */
export const adminResolveServerDispute = async (
  matchId: string,
  resolution: string,
  action: 'settle' | 'refund' | 'none' = 'settle'
) => {
  return authorizedPost<MatchResponse>(`/api/admin/matches/${matchId}/resolve-dispute`, { resolution, action });
};

export const adminCancelServerMatch = async (matchId: string, reason: string) => {
  return authorizedPost<MatchResponse>(`/api/admin/matches/${matchId}/cancel`, { reason });
};

export const addServerDisputeEvidence = async (matchId: string, evidence: string[]) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/dispute/evidence`, { evidence });
};

export const escalateServerDispute = async (matchId: string) => {
  return authorizedPost<MatchResponse>(`/api/matches/${matchId}/dispute/escalate`, {});
};

/**
 * Historique des matchs en fichier telechargeable.
 *
 * Le telechargement ne passe PAS par `authorizedGet` : la reponse est un CSV,
 * pas du JSON, et le client d'API chercherait a la parser. D'ou un `fetch` nu
 * suivi d un Blob — et la liberation de l URL objet, sans quoi le fichier
 * reste en memoire jusqu au rechargement de la page.
 */
export const downloadMatchHistory = async (
  from?: string,
  to?: string,
  format: 'csv' | 'json' = 'csv'
) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('format', format);

  const response = await fetch(`${getApiUrl('/api/admin/matches/export')}?${params.toString()}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    let message = 'Export indisponible.';
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      /* reponse non JSON : on garde le message par defaut */
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const found = /filename="([^"]+)"/.exec(disposition);
  const filename = found ? found[1] : `zoyd-matchs.${format}`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return filename;
};
