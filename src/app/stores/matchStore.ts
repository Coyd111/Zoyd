/**
 * matchStore - etat des matchs : collection, filtres, projections de gains.
 *
 * Detient les matchs recus du serveur, les filtres de l'ecran hub, et les
 * selecteurs (matchs actifs, historique, eligibilite arbitre). Porte les
 * TYPES metier partages par tous les ecrans match.
 *
 * INVARIANT : hydrateFromServer FUSIONNE (delta socket), replaceFromServer
 * REMPLACE. Le socket diffuse des deltas : remplacer effacerait tous les
 * autres matchs de la liste.
 * INVARIANT : ACTIVE_STATUSES vient de la source unique (`../lib/matchStatus`
 * -> `shared/match-status.json`) et inclut `awaiting_arbiter` : un match
 * vivant sans arbitre EST un match actif, cagnotte bloquee. Tout composant
 * qui filtre sur match.status doit le savoir.
 * INVARIANT : le serveur retire userId du payload et livre `isMe`, calcule
 * POUR chaque destinataire. Sur un match observe par un tiers, `isMe` vaut
 * false pour tout le monde : c'est le seul repere du joueur courant.
 * PIEGE : `payoutDistributed: 'pending'` doit survivre a la normalisation.
 * L'ecraser en false ferait passer un resultat non verse pour un match regle
 * (stats fausses).
 * PIEGE : StoredMatch n'a PAS de signature d'index : une faute de frappe
 * devient une erreur de compilation au lieu d'un `unknown` silencieux.
 *
 * Voir aussi : docs/08-frontend.md - section 6 (Les stores Zustand)
 */
import { create } from 'zustand';
import type { User } from './authStore';
import { useAuthStore } from './authStore';
import { ACTIVE_STATUSES, CLOSED_STATUSES, HISTORY_STATUSES, type MatchStatus } from '../lib/matchStatus';

export type { MatchStatus };

export type MatchFormat = '1VS1' | '2VS2' | '3VS3' | '4VS4' | '5VS5';

export type MatchVisibility = 'public' | 'private';
export type MatchTeam = 0 | 1;
export type ControllerRestriction = User['controllerType'] | 'open';
export type DeviceRestriction = User['device'] | 'open';

export interface MatchPlayer {
  pseudo: string;
  /**
   * Repère STABLE du joueur, à côté d'un pseudo librement modifiable.
   *
   * `gameId` est fixé à l'inscription et n'est pas modifiable, et il figure
   * déjà dans les profils publics : l'afficher permet à l'arbitre de distinguer
   * deux joueurs même si l'un d'eux se renomme en cours de route.
   */
  gameId?: string | null;
  team: MatchTeam;
  joinedAt: string;
  trustScore: number;
  rankMJ?: string;
  controllerType?: User['controllerType'];
  device?: User['device'];
  isReady: boolean;
  isCheckedIn: boolean;
  checkedInAt?: string;
  isCaptain: boolean;
  /**
   * `true` si ce joueur est le demandeur de la réponse. Le serveur retire
   * `userId` du payload (les UUID internes ne doivent pas fuiter) et le
   * remplace par ce drapeau, calculé POUR chaque destinataire : c'est le seul
   * moyen de retrouver son propre slot. Conséquence : sur un match observé par
   * quelqu'un d'autre, `isMe` vaut `false` pour tout le monde.
   */
  isMe: boolean;
  /**
   * Le joueur a déjà confirmé le résultat. Remplace l'accès à
   * `result.confirmedByTeams`, qui ne contient que des userId (illisibles ici).
   */
  hasConfirmed: boolean;
}

export interface MatchArbiter {
/**
 * `userId` n'est PLUS envoyé par le serveur (sanitizeMatchForBroadcast le
 * retire comme pour les joueurs). Le garder dans le type autorisait le
 * compilateur a valider `arbiter?.userId === user.id`, qui vaut toujours
 * false a l'execution : un piege silencieux. Utiliser `isMe`.
 */
pseudo: string;
  assignedAt: string;
  trustScore: number;
  roomName?: string;
  roomPassword?: string;
  roomPublishedAt?: string;
  hasSubmittedResult: boolean;
  /** Même contrat que `MatchPlayer.isMe` : calculé pour le demandeur. */
  isMe?: boolean;
}

export interface MatchProofBundle {
  scoreboard: string[];
  finalResult: string[];
  roomCapture: string[];
  extraEvidence: string[];
}

export interface MatchResult {
  winnerTeam: MatchTeam;
  scores: { team0: number; team1: number };
  screenshots: string[];
  proofs?: MatchProofBundle;
  proofHash?: string;
  arbiterNotes?: string;
  resolutionType?: 'played' | 'forfeit';
  forfeitTeam?: MatchTeam;
  submittedBy: string;
  submittedAt: string;
  confirmedByTeams: string[];
  /**
   * `'pending'` = résultat écrit mais cagnotte NON versée (fenêtre de
   * confirmation ouverte, ou règlement en attente). `true`/`false` = la
   * distribution a été tentée. Seul `true` autorise à compter le match
   * comme gagné/perdu.
   */
  payoutDistributed: 'pending' | boolean;
}

export type DisputeCategory = 'result' | 'room_issue' | 'no_show' | 'conduct' | 'other';

export interface Dispute {
  id: string;
  level: 1 | 2 | 3;
  category: DisputeCategory;
  reason: string;
  evidence: string[];
  requestedBy: string;
  openedByPseudo?: string;
  escalatedByPseudo?: string;
  status: 'open' | 'under_review' | 'resolved' | 'rejected';
  resolution?: string;
  createdAt: string;
  openedAt?: string;
  escalatedAt?: string;
  resolvedAt?: string;
  prizePoolFrozen: boolean;
}

export interface MatchRules {
  mode: string;
  map: string;
  scoreTarget: number;
  bestOf: number;
  weaponRestrictions?: string;
  pointstreaks?: 'allowed' | 'restricted';
  meleeAllowed?: boolean;
  notes?: string;
}

export type MatchPayoutType = 'prize_win' | 'arbitration_fee';

/**
 * Un versement reels effectue sur un match (A9) : part d'un gagnant
 * (`prize_win`) ou commission de l'arbitre (`arbitration_fee`), tel que le
 * reglement l'a servi - pas ce que la creation avait prevu.
 */
export interface MatchPayoutEntry {
  /** UUID interne : absent du payload public (le sanitiseur le retire). */
  userId?: string;
  pseudo?: string;
  amount: number;
  type: MatchPayoutType;
  /** true si ce versement est celui du lecteur (remap du sanitiseur). */
  isMe?: boolean;
  paidAt?: string;
}

/**
 * La salle CODM livree PAR destinataire (P13 C2, audit-3) : le serveur ne la
 * donne qu'aux participants du match, a son arbitre et a un admin — meme
 * modele que `isMe`. Sans cette livraison, `canLaunch` restait toujours
 * false et tout match arbitre etait inerte depuis l'UI. Absente (ou
 * `null`/`null`) tant que l'arbitre n'a pas partage la salle.
 */
export interface MatchRoom {
  name: string | null;
  password: string | null;
}

export interface Match {
  id: string;
  creatorId: string;
  creatorPseudo: string;
  format: MatchFormat;
  teamSize: number;
  maxPlayers: number;
  rules: MatchRules;
  entryFee: number;
  prizePool: number;
  zoydFee: number;
  arbiterFee: number;
  /**
   * Partition calculee par le serveur sur la cagnotte reellement verrouillee.
   * Source unique pour l'affichage : le front ne recalcule plus `pot * 0.98`.
   */
  projectedPayouts?: {
    basis: number;
    locked: boolean;
    arbiterFee: number;
    winner: number;
    perWinner: number;
  };
  /**
   * Versements REELLEMENT effectues (A9, audit-2) : ecrit par le serveur au
   * fil du reglement. L'UUID de chaque paye ne sort pas du payload (le
   * sanitiseur le remplace par `isMe`, comme pour le roster) ; une part
   * reconnue par `isMe` prime sur toute projection pour les gains du
   * lecteur (profileMetrics).
   */
  payouts?: MatchPayoutEntry[];
  visibility: MatchVisibility;
  deviceRestriction: DeviceRestriction;
  controllerRestriction: ControllerRestriction;
  status: MatchStatus;
  players: MatchPlayer[];
  arbiter?: MatchArbiter;
  result?: MatchResult;
  dispute?: Dispute;
  disputes: Dispute[];
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  /** ISO : fin de la fenêtre de confirmation, présente sur 'awaiting_confirmation'. */
  confirmationDeadline?: string;
  /**
   * Salle CODM livree PAR destinataire (P13 C2) : absente pour un lecteur
   * exterieur. Les champs bruts `roomName`/`roomPassword` ne sortent JAMAIS
   * du serveur — ne pas les attendre sur ce type.
   */
  room?: MatchRoom;
  chatChannelId: string;
  channelId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  trustScoreMin?: number;
  isInstant: boolean;
}

export interface MatchFilters {
  format?: MatchFormat | 'all';
  status?: MatchStatus | 'all';
  minTrustScore?: number;
}

/**
 * La cagnotte n'est réellement partie que lorsque `payoutDistributed === true`.
 * Un résultat `'pending'` (fenêtre de confirmation) ou `false` (règlement échoué)
 * ne doit jamais être compté comme victoire/défaite : l'argent n'est pas
 * arrivé. Même règle que `applyResultSettlement` côté serveur.
 *
 * Type guard : dans un `if (isMatchPayoutSettled(match))`, `match.result` est
 * garanti présent (sinon TS18048 sur chaque accès).
 */
export const isMatchPayoutSettled = (match: Match): match is Match & { result: MatchResult } =>
  match.result?.payoutDistributed === true;

export interface CreateMatchInput {
  creatorId: string;
  creatorPseudo: string;
  creatorTrustScore: number;
  creatorControllerType: User['controllerType'];
  creatorDevice: User['device'];
  creatorRankMJ?: string;
  creatorTeam?: MatchTeam;
  format: MatchFormat;
  rules: MatchRules;
  entryFee: number;
  visibility?: MatchVisibility;
  trustScoreMin?: number;
  isInstant?: boolean;
}

export interface MatchState {
  matches: Match[];
  filters: MatchFilters;
  hydrateFromServer: (matches: Match[]) => void;
  replaceFromServer: (matches: Match[]) => void;
  setFilters: (f: Partial<MatchFilters>) => void;
  getFilteredMatches: () => Match[];
  getMatchById: (id: string) => Match | undefined;
  getMyActiveMatches: (userId: string) => Match[];
  getMatchHistory: (userId: string) => Match[];
  canJoinAsArbiter: (matchId: string) => boolean;
}

export const MATCH_AUTOMATION_INTERVAL_MS = 30_000;
const flattenProofs = (proofs?: MatchProofBundle) =>
  proofs
    ? [
        ...proofs.scoreboard,
        ...proofs.finalResult,
        ...proofs.roomCapture,
        ...proofs.extraEvidence,
      ]
    : [];
interface StoredDispute {
  id?: string;
  level?: number;
  category?: DisputeCategory;
  reason?: string;
  evidence?: string[];
  requestedBy?: string;
  status?: string;
  resolution?: string;
  createdAt?: string;
  openedAt?: string;
  resolvedAt?: string;
  prizePoolFrozen?: boolean;
}

interface StoredProofs {
  scoreboard?: string[];
  finalResult?: string[];
  roomCapture?: string[];
  extraEvidence?: string[];
}

interface StoredResult {
  winnerTeam?: MatchTeam;
  scores?: { team0: number; team1: number };
  screenshots?: string[];
  proofs?: StoredProofs;
  proofHash?: string;
  arbiterNotes?: string;
  resolutionType?: 'played' | 'forfeit';
  forfeitTeam?: MatchTeam;
  submittedBy?: string;
  submittedAt?: string;
  confirmedByTeams?: string[];
  payoutDistributed?: 'pending' | boolean;
}

/**
 * Projection serveur de la partition du pot (sanitizeMatchForBroadcast). Le
 * champ DOIT etre declare ici : sans lui, normalizeStoredMatch l'ecartait et
 * tous les gains affiches retombaient sur le recalcul local `prizePool - fee`
 * (pot theorique, commission figee) - jamais ce que le serveur verse.
 */
interface StoredProjectedPayouts {
  basis?: number;
  locked?: boolean;
  arbiterFee?: number;
  winner?: number;
  perWinner?: number;
}

/**
 * Versement brut venu du serveur. Le champ DOIT etre declare ici (A9) :
 * sans lui, `normalizeStoredMatch` ecartait les versements et l'ecran du
 * lecteur perdait la part reelle au profit de la projection seule.
 */
interface StoredPayout {
  userId?: string;
  pseudo?: string;
  amount?: number;
  type?: string;
  isMe?: boolean;
  paidAt?: string;
}

/**
 * Forme brute d'un match venant du serveur. Tous les champs sont optionnels
 * (le serveur peut envoyer une forme partielle) mais DOIVENT être déclarés
 * explicitement, et SANS index signature : avec `[key: string]: unknown`, chaque
 * accès non déclaré retombait sur l'index et `match.foo || ''` devenait `{}`
 * (30 erreurs TS2322 en cascade). Sans index signature, une faute de frappe
 * devient une erreur de compilation au lieu d'un `unknown` silencieux.
 */
interface StoredMatch {
  id?: string;
  creatorId?: string;
  creatorPseudo?: string;
  format?: MatchFormat;
  teamSize?: number;
  maxPlayers?: number;
  rules?: MatchRules;
  entryFee?: number;
  prizePool?: number;
  zoydFee?: number;
  arbiterFee?: number;
  visibility?: MatchVisibility;
  deviceRestriction?: DeviceRestriction;
  controllerRestriction?: ControllerRestriction;
  status?: MatchStatus;
  players?: MatchPlayer[];
  arbiter?: MatchArbiter;
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  /** ISO : fin de la fenêtre de confirmation, présente sur 'awaiting_confirmation'. */
  confirmationDeadline?: string;
  room?: MatchRoom | null;
  chatChannelId?: string;
  channelId?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  trustScoreMin?: number;
  isInstant?: boolean;
  disputes?: StoredDispute[];
  dispute?: StoredDispute;
  result?: StoredResult;
  projectedPayouts?: StoredProjectedPayouts;
  payouts?: StoredPayout[];
}

const normalizeStoredDispute = (dispute: StoredDispute): Dispute => ({
  id: dispute?.id || '',
  level: (dispute?.level as 1 | 2 | 3) || 1,
  category: dispute?.category || 'result',
  reason: dispute?.reason || '',
  evidence: Array.isArray(dispute?.evidence) ? dispute.evidence : [],
  requestedBy: dispute?.requestedBy || '',
  status: (dispute?.status as Dispute['status']) || 'open',
  resolution: dispute?.resolution,
  createdAt: dispute?.createdAt || '',
  openedAt: dispute?.openedAt,
  resolvedAt: dispute?.resolvedAt,
  prizePoolFrozen: Boolean(dispute?.prizePoolFrozen),
});
const normalizeStoredProofs = (proofs: StoredProofs): MatchProofBundle => ({
  scoreboard: Array.isArray(proofs?.scoreboard) ? proofs.scoreboard : [],
  finalResult: Array.isArray(proofs?.finalResult) ? proofs.finalResult : [],
  roomCapture: Array.isArray(proofs?.roomCapture) ? proofs.roomCapture : [],
  extraEvidence: Array.isArray(proofs?.extraEvidence) ? proofs.extraEvidence : [],
});
const normalizeStoredResult = (_matchId: string, result: StoredResult): MatchResult => {
  const proofs = result?.proofs ? normalizeStoredProofs(result.proofs) : undefined;
  const screenshots = Array.isArray(result?.screenshots) ? result.screenshots : flattenProofs(proofs);
  // 'pending' doit survivre à la normalisation : l'écraser en `false`
  // ferait passer un résultat non versé pour un match réglé (stats fausses).
  const payoutDistributed =
    result?.payoutDistributed === 'pending'
      ? 'pending'
      : result?.payoutDistributed === true;

  return {
    winnerTeam: result?.winnerTeam ?? 0,
    scores: result?.scores || { team0: 0, team1: 0 },
    screenshots,
    proofs,
    resolutionType: result?.resolutionType || 'played',
    // S4 + F13 : le champ ne sort plus du serveur (c'etait la concatenation
    // en clair des URL de captures, pas un hash) et aucun ecran ne l'affiche
    // plus. On ne le RECALCULE plus ici non plus : refabriquer une valeur
    // que le serveur n'a jamais concede, c'est encore mentir au store. Il ne
    // survit que si le payload persiste deja la valeur (matchs anciens).
    proofHash: result?.proofHash || undefined,
    arbiterNotes: result?.arbiterNotes,
    forfeitTeam: result?.forfeitTeam,
    submittedBy: result?.submittedBy || '',
    submittedAt: result?.submittedAt || '',
    confirmedByTeams: result?.confirmedByTeams || [],
    payoutDistributed,
  };
};
/**
 * Recopie la projection serveur sans la reconstruire : elle est calculee sur
 * les fonds REELLEMENT verrouilles (server/match-engine.mjs — getProjectedPayouts),
 * le front n'a pas assez d'information pour la recalculer. Si la base n'est
 * pas un nombre fini (payload ancien ou partial), on renvoie `undefined` pour
 * que les helpers retombent sur leur chemin de repli, sans inventer un pot.
 */
const normalizeStoredProjection = (
  projection: StoredProjectedPayouts | undefined
): Match['projectedPayouts'] => {
  if (!projection || typeof projection !== 'object') return undefined;
  const basis = Number(projection.basis);
  const winner = Number(projection.winner);
  if (!Number.isFinite(basis) || !Number.isFinite(winner)) return undefined;
  const arbiterFee = Number(projection.arbiterFee);
  const perWinner = Number(projection.perWinner);
  return {
    basis,
    locked: projection.locked === true,
    arbiterFee: Number.isFinite(arbiterFee) ? arbiterFee : 0,
    winner,
    perWinner: Number.isFinite(perWinner) ? perWinner : 0,
  };
};
/**
 * Recopie les versements reels (A9) sans les reconstruire : le serveur
 * ecrit-au fil du reglement ce que le wallet a servi, avec l'UUID deja
 * remplace par `isMe`. On ne garde que les types connus et un montant
 * numerique : un payload partial ou ancien retombe sur `undefined` et les
 * helpers continuent de lire la projection.
 */
const normalizeStoredPayouts = (payouts: StoredPayout[] | undefined): Match['payouts'] => {
  if (!Array.isArray(payouts)) return undefined;
  const entries: MatchPayoutEntry[] = [];
  for (const payout of payouts) {
    if (payout?.type !== 'prize_win' && payout?.type !== 'arbitration_fee') continue;
    entries.push({
      ...(payout.userId ? { userId: payout.userId } : {}),
      pseudo: payout.pseudo || '',
      amount: Number(payout.amount || 0),
      type: payout.type,
      ...(payout.isMe === true ? { isMe: true } : {}),
      ...(payout.paidAt ? { paidAt: payout.paidAt } : {}),
    });
  }
  return entries.length > 0 ? entries : undefined;
};

const normalizeStoredMatch = (match: StoredMatch): Match => ({
  id: match.id || '',
  creatorId: match.creatorId || '',
  creatorPseudo: match.creatorPseudo || '',
  format: match.format || '1VS1',
  teamSize: match.teamSize || 1,
  maxPlayers: match.maxPlayers || 2,
  rules: match.rules || { mode: 'ranked', map: 'Unknown', scoreTarget: 13, bestOf: 1 },
  entryFee: match.entryFee || 0,
  prizePool: match.prizePool || 0,
  zoydFee: match.zoydFee || 0,
  arbiterFee: match.arbiterFee || 0,
  visibility: match.visibility || 'public',
  deviceRestriction: match.deviceRestriction || 'open',
  controllerRestriction: match.controllerRestriction || 'open',
  status: match.status || 'recruiting',
  players: match.players || [],
  arbiter: match.arbiter,
  result: match?.result ? normalizeStoredResult(match.id || '', match.result) : undefined,
  dispute: match?.dispute ? normalizeStoredDispute(match.dispute) : undefined,
  disputes: Array.isArray(match?.disputes) ? match.disputes.map(normalizeStoredDispute) : [],
  scheduledAt: match.scheduledAt,
  startedAt: match.startedAt,
  finishedAt: match.finishedAt,
  confirmationDeadline: match.confirmationDeadline,
  // Salle livree par destinataire (P13 C2) : normalisee en { name, password }
  // non nuls-absents, pour que `canLaunch`/`MatchRules` lisent une forme
  // stable.
  room: match.room ? { name: match.room.name ?? null, password: match.room.password ?? null } : undefined,
  chatChannelId: match.chatChannelId || '',
  channelId: match.channelId || '',
  createdAt: match.createdAt || '',
  updatedAt: match.updatedAt || '',
  expiresAt: match.expiresAt || '',
  trustScoreMin: match.trustScoreMin,
  isInstant: match.isInstant ?? false,
  projectedPayouts: normalizeStoredProjection(match.projectedPayouts),
  payouts: normalizeStoredPayouts(match.payouts),
});

const mergeMatchesByFreshness = (currentMatches: Match[], incomingMatches: Match[]) => {
  const merged = new Map<string, Match>();

  for (const match of currentMatches) {
    merged.set(match.id, match);
  }

  for (const rawMatch of incomingMatches) {
    const incoming = normalizeStoredMatch(rawMatch);
    const existing = merged.get(incoming.id);

    if (!existing) {
      merged.set(incoming.id, incoming);
      continue;
    }

    const existingTs = new Date(existing.updatedAt || existing.createdAt).getTime();
    const incomingTs = new Date(incoming.updatedAt || incoming.createdAt).getTime();

    if (incomingTs >= existingTs) {
      merged.set(incoming.id, incoming);
    }
  }

  return [...merged.values()].sort(
    (left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
  );
};

export const useMatchStore = create<MatchState>()((set, get) => {
      return {
        matches: [],
        filters: { format: 'all', status: 'all' },

        hydrateFromServer: (matches) => {
          set((state) => ({
            matches: mergeMatchesByFreshness(state.matches, matches),
          }));
        },

        replaceFromServer: (matches) => {
          set(() => ({
            matches: matches
              .map((match) => normalizeStoredMatch(match))
              .sort(
                (left, right) =>
                  new Date(right.updatedAt || right.createdAt).getTime() -
                  new Date(left.updatedAt || left.createdAt).getTime()
              ),
          }));
        },

        setFilters: (f) => set((state) => ({ filters: { ...state.filters, ...f } })),

        getFilteredMatches: () => {
          const { matches, filters } = get();
          const currentUser = useAuthStore.getState().user;
          if (!Array.isArray(matches)) return [];

          return matches.filter((match) => {
            if (match.visibility !== 'public') return false;
            if (currentUser) {
              const deviceAllowed =
                match.deviceRestriction === 'open' || match.deviceRestriction === currentUser.device;
              const controllerAllowed =
                match.controllerRestriction === 'open' || match.controllerRestriction === currentUser.controllerType;

              if (!deviceAllowed || !controllerAllowed) return false;
            }

            if (filters.format && filters.format !== 'all' && match.format !== filters.format) return false;
            if (filters.status && filters.status !== 'all' && match.status !== filters.status) return false;
            if (filters.minTrustScore && (match.trustScoreMin || 0) < filters.minTrustScore) return false;
            return true;
          });
        },

        getMatchById: (id) => get().matches.find((match) => match.id === id),

        // `userId` n'est plus lisible dans le payload : le serveur ne livre
        // qu'un `isMe` par joueur, calculé pour le demandeur. La signature est
        // conservée pour ne pas casser les appelants, la décision se prend sur
        // `isMe`.
        getMyActiveMatches: (_userId) =>
          get().matches.filter(
            (match) =>
              ACTIVE_STATUSES.includes(match.status) &&
              (match.players.some((player) => player.isMe) || match.arbiter?.isMe === true)
          ),

        getMatchHistory: (_userId) =>
          get().matches.filter(
            (match) =>
              HISTORY_STATUSES.includes(match.status) &&
              (match.players.some((player) => player.isMe) || match.arbiter?.isMe === true)
          ),

        canJoinAsArbiter: (matchId) => {
          const match = get().matches.find((entry) => entry.id === matchId);
          const currentUser = useAuthStore.getState().user;
          if (!match || !currentUser) return false;
          if (match.arbiter) return false;
          if (match.players.some((player) => player.isMe)) return false;
          return !CLOSED_STATUSES.includes(match.status);
        },

      };
});
