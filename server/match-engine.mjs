import crypto from 'node:crypto';
import { createLogger } from './logger.mjs';
import { getUserById, updateUserAccount, sanitizeText } from './persistence.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  settleMatchLossWallet,
} from './wallet-engine.mjs';
import { withWalletMutex } from './mutex.mjs';
import { roundAmount, getNow, makeError, addXpToProgression } from './utils.mjs';
export { addXpToProgression };

const log = createLogger('match-engine');
export const MATCH_AUTOMATION_INTERVAL_MS = 30_000;
/** Taille d'équipe maximale par camp (1VS1 … 5VS5). */
export const MAX_TEAM_SIZE = 5;

const ACTIVE_STATUSES = ['recruiting', 'full', 'check_in', 'ready', 'in_progress', 'awaiting_confirmation'];
const TERMINAL_STATUSES = ['finished', 'cancelled', 'forfeited'];
/**
 * Fenetre de confirmation laissee aux deux équipes avant paiement automatique.
 * 30 min : assez pour ouvrir un litige, trop court pour geler la cagnotte.
 */
export const CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;
export const getTeamSize = (format) => parseInt(format.split('VS')[0], 10);
export const getSquadLabel = (team) => (team === 0 ? 'Squad Alpha' : 'Squad Bravo');
const getScheduledTimestamp = (match) => (match.scheduledAt ? new Date(match.scheduledAt).getTime() : null);
const getTeamCheckInCount = (match, team) =>
  match.players.filter((player) => player.team === team && player.isCheckedIn).length;
const isTeamReadyForLaunch = (match, team) => getTeamCheckInCount(match, team) >= match.teamSize;
// Preuves : le front accepte "liens ou refs" en texte libre, donc on ne peut
// pas exiger https: partout. On coupe court au XSS stocké en rejetant les
// schémas dangereux et le HTML : javascript:, data: non-image, vbscript:,
// chevrons et gestionnaires d'événements. 2000 caractères et 10 refs max.
const MAX_PROOF_REF_LENGTH = 2000;
const isSafeProofRef = (ref) => {
  if (typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > MAX_PROOF_REF_LENGTH) return false;
  if (/^\s*javascript:/i.test(trimmed)) return false;
  if (/^\s*vbscript:/i.test(trimmed)) return false;
  if (/^\s*data:(?!image\/(png|jpeg|jpg|webp);base64,)/i.test(trimmed)) return false;
  if (/[<>]/.test(trimmed)) return false;
  if (/\bon\w+\s*=/i.test(trimmed)) return false;
  return true;
};
const normalizeProofRefs = (refs = []) =>
  (Array.isArray(refs) ? refs : [refs]).map((ref) => `${ref}`.trim()).filter(isSafeProofRef).slice(0, 10);
const flattenProofs = (proofs) =>
  proofs
    ? [...(proofs.scoreboard || []), ...(proofs.finalResult || []), ...(proofs.roomCapture || []), ...(proofs.extraEvidence || [])]
    : [];
const buildProofHash = (matchId, winnerTeam, scores, refs) =>
  [String(matchId).toLowerCase(), winnerTeam, scores?.team0 ?? 0, scores?.team1 ?? 0, ...refs.map((ref) => ref.toLowerCase())].join('|');
export const getWinnerPayout = (match) => Math.max(0, roundAmount(match.prizePool - match.zoydFee - match.arbiterFee));

/** Commission d'arbitrage (part de l'arbitre sur la cagnotte). */
const ARBITER_FEE_RATE = 0.02;

/**
 * Cagnotte RÉELLEMENT verrouillée par les joueurs du match.
 * Source de vérité = les réservations wallet (lockedEntries), pas match.prizePool
 * (calculé sur maxPlayers à la création). Sans ça, un match à roster incomplet
 * distribue un pot fantôme : le joueur créait de la monnaie.
 * @param {object} match
 * @returns {number} somme des montants effectivement bloqués
 */
export const getLockedPot = (match) => {
  let total = 0;
  for (const player of match.players || []) {
    const user = getUserById(player.userId);
    const reservation = user?.wallet?.lockedEntries?.[match.id];
    if (reservation?.amount > 0) total += reservation.amount;
  }
  return roundAmount(total);
};

const cloneMatches = (matches) => matches.map((match) => structuredClone(match));

export const getPreferredTeam = (match, preferredTeam) => {
  const team0Count = match.players.filter((player) => player.team === 0).length;
  const team1Count = match.players.filter((player) => player.team === 1).length;

  if (preferredTeam === 0 && team0Count < match.teamSize) return 0;
  if (preferredTeam === 1 && team1Count < match.teamSize) return 1;
  if (team0Count <= team1Count && team0Count < match.teamSize) return 0;
  if (team1Count < match.teamSize) return 1;
  return null;
};

export const getStatusFromMatch = (match) => {
  if (match.disputes.some((dispute) => dispute.status === 'open' || dispute.status === 'under_review')) {
    return 'disputed';
  }

  if (TERMINAL_STATUSES.includes(match.status)) {
    return match.status;
  }

  if (match.result || match.finishedAt) {
    return 'finished';
  }

  const allPlayersPresent = match.players.length >= match.maxPlayers;
  if (!allPlayersPresent) return 'recruiting';

  const everyoneCheckedIn = match.players.every((player) => player.isCheckedIn);
  const everyoneReady = match.players.every((player) => player.isReady);

  if (!everyoneCheckedIn || !everyoneReady) {
    return match.arbiter ? 'check_in' : 'full';
  }

  if (match.status === 'in_progress') {
    return 'in_progress';
  }

  return match.arbiter ? 'ready' : 'ready';
};

const updateMatchSnapshot = (match, updates) => {
  const next = {
    ...match,
    ...updates,
    updatedAt: getNow(),
  };

  return {
    ...next,
    status: getStatusFromMatch(next),
  };
};

const findMatch = (matches, matchId) => matches.find((match) => match.id === matchId);

const requireActorUser = (actor) => {
  const user = getUserById(actor.id);
  if (!user) {
    throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');
  }
  return user;
};

const patchUserForMatchOutcome = async (userId, updater) =>
  await updateUserAccount(userId, (user) => {
    const next = updater(structuredClone(user));
    next.lastSeen = getNow();
    return next;
  });

export const getRankFromElo = (elo) => {
  if (elo < 1200) return 'Bronze';
  if (elo < 1400) return 'Silver';
  if (elo < 1600) return 'Gold';
  if (elo < 1800) return 'Platinum';
  if (elo < 2000) return 'Diamond';
  return 'Master';
};

const applyResultSettlement = async (match, result) => {
  // Anti-mint : on ne distribue QUE l'argent réellement verrouillé.
  // match.prizePool est calculé sur maxPlayers à la création ; s'il servait de
  // base, un match à roster incomplet paierait un pot fantôme.
  const lockedPot = getLockedPot(match);
  const arbiterFee = match.arbiter?.userId ? roundAmount(lockedPot * ARBITER_FEE_RATE) : 0;
  const payout = Math.max(0, roundAmount(lockedPot - arbiterFee));
  const settlementErrors = [];

  // Elo Calculation
  const K = 32;
  const teamElos = { 0: [], 1: [] };
  
  for (const player of match.players) {
    const user = getUserById(player.userId);
    const elo = user?.stats?.elo || 1200;
    teamElos[player.team].push({ userId: player.userId, elo });
  }

  const avgElo = (team) => {
    const players = teamElos[team];
    if (players.length === 0) return 1200;
    return players.reduce((sum, p) => sum + p.elo, 0) / players.length;
  };

  const eloA = avgElo(0);
  const eloB = avgElo(1);
  const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (eloA - eloB) / 400));

  const scoreA = result.winnerTeam === 0 ? 1 : (result.winnerTeam === null ? 0.5 : 0);
  const scoreB = result.winnerTeam === 1 ? 1 : (result.winnerTeam === null ? 0.5 : 0);

  const deltaA = K * (scoreA - expectedA);
  const deltaB = K * (scoreB - expectedB);

  const eloDeltaByTeam = { 0: deltaA, 1: deltaB };

  // Collect unique user IDs needing wallet ops, deduplicate
  const winnerIds = new Set(match.players.filter(p => p.team === result.winnerTeam).map(p => p.userId));
  const loserIds = new Set(match.players.filter(p => p.team !== result.winnerTeam).map(p => p.userId));

  // Anti-mint : le pot (moins commission) est DIVISÉ entre les gagnants.
  // Avant, chaque gagnant recevait le pot entier (2v2 = 2× le pot créé).
  const winnerCount = winnerIds.size || 1;
  const sharePerWinner = roundAmount(payout / winnerCount);
  // Le premier gagnant absorbe l'arrondi pour garder un total exact.
  const firstWinnerShare = roundAmount(payout - sharePerWinner * (winnerCount - 1));
  const paidWinners = new Set();

  for (const player of match.players) {
    try {
      const isWinner = player.team === result.winnerTeam;
      const deltaElo = eloDeltaByTeam[player.team] || 0;

      await withWalletMutex(player.userId, async () => {
        if (isWinner) {
          // Un même user listé 2 fois ne doit être payé qu'une fois.
          if (paidWinners.has(player.userId)) return;
          const amount = paidWinners.size === 0 ? firstWinnerShare : sharePerWinner;
          paidWinners.add(player.userId);
          await releaseWalletWinnings(
            player.userId, amount, match.id, 'prize_win',
            `Gain du match ${match.rules?.mode || match.format} / ${match.rules?.map || 'Libre'}`
          );
          await patchUserForMatchOutcome(player.userId, (user) => {
            const nextStats = {
              ...user.stats,
              wins: Number(user.stats?.wins || 0) + 1,
              totalEarnings: roundAmount(Number(user.stats?.totalEarnings || 0) + amount),
              elo: Math.round(Number(user.stats?.elo || 1200) + deltaElo),
            };
            const total = nextStats.wins + Number(nextStats.losses || 0) + Number(nextStats.draws || 0);
            nextStats.totalMatches = total;
            nextStats.winRate = total > 0 ? Math.round((nextStats.wins / total) * 1000) / 10 : 0;
            user.stats = nextStats;
            user.rankMJ = getRankFromElo(nextStats.elo);
            user.progression = addXpToProgression(user.progression, 120);
            if (result.resolutionType === 'forfeit') {
              user.trustScore = Math.max(0, Math.min(100, Number(user.trustScore || 0) + 2));
            }
            return user;
          });
        } else {
          await settleMatchLossWallet(player.userId, match.id, `Pass consomme apres la fin du match ${match.id}`);
          await patchUserForMatchOutcome(player.userId, (user) => {
            const nextStats = {
              ...user.stats,
              losses: Number(user.stats?.losses || 0) + 1,
              elo: Math.max(0, Math.round(Number(user.stats?.elo || 1200) + deltaElo)),
            };
            const total = Number(nextStats.wins || 0) + nextStats.losses + Number(nextStats.draws || 0);
            nextStats.totalMatches = total;
            nextStats.winRate = total > 0 ? Math.round((Number(nextStats.wins || 0) / total) * 1000) / 10 : 0;
            user.stats = nextStats;
            user.rankMJ = getRankFromElo(nextStats.elo);
            user.progression = addXpToProgression(user.progression, 35);
            if (result.resolutionType === 'forfeit' && result.forfeitTeam === player.team) {
              user.trustScore = Math.max(0, Math.min(100, Number(user.trustScore || 0) - 12));
            }
            return user;
          });
        }
      });
    } catch (err) {
      log.error('Settlement error for player', { matchId: match.id, playerId: player.userId, error: err.message });
      settlementErrors.push({ playerId: player.userId, error: err.message });
    }
  }

  if (match.arbiter?.userId && arbiterFee > 0) {
    try {
      await withWalletMutex(match.arbiter.userId, async () => {
        await releaseWalletWinnings(
          match.arbiter.userId,
          arbiterFee,
          match.id,
          'arbitration_fee',
          `Commission arbitre ${match.id}`
        );
      });
    } catch (err) {
      log.error('Arbiter payout error', { matchId: match.id, arbiterId: match.arbiter.userId, error: err.message });
      settlementErrors.push({ playerId: match.arbiter.userId, role: 'arbiter', error: err.message });
    }
  }

  if (settlementErrors.length > 0) {
    log.error('SETTLEMENT_PARTIAL_FAILURE', {
      matchId: match.id,
      failedCount: settlementErrors.length,
      errors: settlementErrors,
    });
  }

  return { success: settlementErrors.length === 0, errors: settlementErrors };
};

const resolveOpenDisputes = (match, resolution) =>
  match.disputes.map((dispute) =>
    dispute.status === 'open' || dispute.status === 'under_review'
      ? { ...dispute, status: 'resolved', resolution, resolvedAt: getNow(), prizePoolFrozen: false }
      : dispute
  );

/**
 * Create a new match after validating format and entry fee.
 * Locks the creator's entry fee in their wallet and returns the updated match list.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user creating the match.
 * @param {Object} input - Match config (format, entryFee, rules, visibility, etc.).
 * @returns {Promise<{matches: Array, match: Object, actorUser: Object}>}
 */
export const createMatchOnServer = async (matches, actor, input) => {
  const actorUser = requireActorUser(actor);

  if (!input.format || typeof input.format !== 'string') {
    throw makeError('INVALID_MATCH', 'Le format du match (ex: 1VS1, 2VS2) est requis.');
  }
  // Limite produit : 1VS1 à 5VS5. Sans garde, un "12VS12" par POST créait un
  // match que l'interface ne sait ni afficher ni arbitrer.
  const formatMatch = /^(\d+)VS(\d+)$/i.exec(`${input.format || '1VS1'}`);
  const teamSize = formatMatch ? Number(formatMatch[1]) : NaN;
  if (!formatMatch || formatMatch[1] !== formatMatch[2] || teamSize < 1 || teamSize > MAX_TEAM_SIZE) {
    throw makeError('INVALID_MATCH', 'Format invalide : de 1VS1 a 5VS5.');
  }
  if (input.entryFee === undefined || input.entryFee === null || Number(input.entryFee) < 0) {
    throw makeError('INVALID_AMOUNT', 'Le droit dentree est requis et doit etre positif.');
  }

  const matchId = `M-${Date.now().toString(36).toUpperCase()}`;
  const maxPlayers = teamSize * 2;
  const prizePool = roundAmount(input.entryFee * maxPlayers);
  const creatorTeam = input.creatorTeam ?? 0;

  await lockEntryFee(actorUser.id, input.entryFee, matchId);

  const match = {
    id: matchId,
    creatorId: actorUser.id,
    creatorPseudo: actorUser.pseudo,
    format: input.format,
    teamSize,
    maxPlayers,
    rules: input.rules && typeof input.rules === 'object' ? input.rules : {},
    entryFee: roundAmount(input.entryFee),
    prizePool,
    zoydFee: 0,
    arbiterFee: roundAmount(prizePool * 0.02),
    visibility: input.visibility || 'public',
    privacy: input.visibility || 'public',
    deviceRestriction: actorUser.device,
    controllerRestriction: actorUser.controllerType,
    status: 'recruiting',
    players: [
      {
        userId: actorUser.id,
        pseudo: actorUser.pseudo,
        team: creatorTeam,
        joinedAt: getNow(),
        trustScore: actorUser.trustScore,
        rankMJ: actorUser.rankMJ,
        controllerType: actorUser.controllerType,
        device: actorUser.device,
        isReady: false,
        isCheckedIn: false,
        isCaptain: true,
      },
    ],
    disputes: [],
    chatChannelId: `match-${matchId}`,
    channelId: `match-${matchId}`,
    createdAt: getNow(),
    updatedAt: getNow(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    trustScoreMin: input.trustScoreMin || 0,
    isInstant: input.isInstant ?? true,
  };

  return {
    matches: [match, ...cloneMatches(matches)],
    match,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Join a match as a player, auto-assigning to an open team slot if needed.
 * Validates device/controller restrictions, trust score, and locks the entry fee.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user joining the match.
 * @param {string} matchId - ID of the match to join.
 * @param {number} [preferredTeam] - Preferred team (0 or 1), or auto-assigned.
 * @returns {Promise<{matches: Array, match: Object, actorUser: Object}>}
 */
export const joinMatchOnServer = async (matches, actor, matchId, preferredTeam) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);

  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (TERMINAL_STATUSES.includes(match.status)) throw makeError('MATCH_CLOSED', 'Ce match est deja clos.');
  if (match.players.some((player) => player.userId === actorUser.id)) throw makeError('ALREADY_JOINED', 'Tu es deja dans ce match.');
  if (match.arbiter?.userId === actorUser.id) throw makeError('ROLE_CONFLICT', "Tu occupes deja la place d'arbitre.");
  if ((match.trustScoreMin || 0) > actorUser.trustScore) throw makeError('TRUST_REQUIRED', 'Trust score insuffisant pour ce match.');

  const deviceMismatch = match.deviceRestriction !== 'open' && actorUser.device !== match.deviceRestriction;
  const controllerMismatch =
    match.controllerRestriction !== 'open' && actorUser.controllerType !== match.controllerRestriction;
  if (deviceMismatch || controllerMismatch) {
    throw makeError('MATCH_SEGMENT_MISMATCH', 'Ton appareil ou ton controle ne correspond pas a cette publication.');
  }

  const assignedTeam = getPreferredTeam(match, preferredTeam);
  if (assignedTeam === null) throw makeError('NO_SLOT_AVAILABLE', 'Les deux squads sont deja complets.');

  await lockEntryFee(actorUser.id, match.entryFee, match.id);

  const teamCount = match.players.filter((player) => player.team === assignedTeam).length;
  match.players.push({
    userId: actorUser.id,
    pseudo: actorUser.pseudo,
    team: assignedTeam,
    joinedAt: getNow(),
    trustScore: actorUser.trustScore,
    rankMJ: actorUser.rankMJ,
    controllerType: actorUser.controllerType,
    device: actorUser.device,
    isReady: false,
    isCheckedIn: false,
    isCaptain: teamCount === 0,
  });
  Object.assign(match, updateMatchSnapshot(match, {}));

  return {
    matches: nextMatches,
    match,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Assign the acting user as arbiter for a match.
 * Validates that no arbiter is already assigned and the actor is not a player.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user to assign as arbiter.
 * @param {string} matchId - ID of the match to arbitrate.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const assignArbiterOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);

  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (match.arbiter) throw makeError('ARBITER_TAKEN', "La place d'arbitre n'est plus disponible.");
  if (match.players.some((player) => player.userId === actorUser.id)) throw makeError('ROLE_CONFLICT', 'Un joueur ne peut pas arbitrer son propre match.');

  match.arbiter = {
    userId: actorUser.id,
    pseudo: actorUser.pseudo,
    assignedAt: getNow(),
    trustScore: actorUser.trustScore,
    hasSubmittedResult: false,
  };
  Object.assign(match, updateMatchSnapshot(match, {}));

  return {
    matches: nextMatches,
    match,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Mark a player as checked-in for a match before it starts.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The player checking in.
 * @param {string} matchId - ID of the match.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const checkInMatchOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  const player = match.players.find((entry) => entry.userId === actorUser.id);
  if (!player) throw makeError('PLAYER_NOT_FOUND', 'Tu ne participes pas a ce match.');

  player.isCheckedIn = true;
  player.checkedInAt = getNow();
  Object.assign(match, updateMatchSnapshot(match, {}));

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Toggle the ready state of a checked-in player.
 * If all players are ready and no arbiter, the match starts automatically.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The player toggling ready.
 * @param {string} matchId - ID of the match.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const toggleReadyOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  const player = match.players.find((entry) => entry.userId === actorUser.id);
  if (!player) throw makeError('PLAYER_NOT_FOUND', 'Tu ne participes pas a ce match.');
  if (!player.isCheckedIn) throw makeError('CHECKIN_REQUIRED', "Confirme d'abord ta presence.");

  player.isReady = !player.isReady;

  const everyoneReady = match.players.length === match.maxPlayers &&
    match.players.every((p) => p.isCheckedIn && p.isReady);

  if (everyoneReady && !match.arbiter) {
    match.status = 'in_progress';
    match.startedAt = getNow();
    match.updatedAt = getNow();
  } else {
    Object.assign(match, updateMatchSnapshot(match, {}));
  }

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Set the scheduled date/time for a match (arbiter, creator, admin, or participant only).
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user setting the schedule.
 * @param {string} matchId - ID of the match.
 * @param {string} scheduledAt - ISO date string for the match start time.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const scheduleMatchOnServer = (matches, actor, matchId, scheduledAt) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (
    actorUser.role !== 'admin' &&
    actorUser.id !== match.creatorId &&
    actorUser.id !== match.arbiter?.userId &&
    !match.players.some((player) => player.userId === actorUser.id)
  ) {
    throw makeError('FORBIDDEN', "Tu n'as pas le droit de fixer l'horaire.");
  }

  Object.assign(match, updateMatchSnapshot(match, { scheduledAt }));
  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Set the game room name and password for a match (arbiter only).
 * Can only be done within 10 minutes of the scheduled time.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The arbiter setting room details.
 * @param {string} matchId - ID of the match.
 * @param {string} roomName - Room name to publish.
 * @param {string} roomPassword - Room password to publish.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const setRoomDetailsOnServer = (matches, actor, matchId, roomName, roomPassword) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (match.arbiter?.userId !== actorUser.id && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', "Seul l'arbitre confirme peut publier la salle.");
  }

  const safeRoomName = sanitizeText(`${roomName}`.trim().slice(0, 100));
  const safeRoomPassword = sanitizeText(`${roomPassword}`.trim().slice(0, 50));
  const scheduledAt = getScheduledTimestamp(match);
  if (!safeRoomName || !safeRoomPassword || !scheduledAt) {
    throw makeError('ROOM_INCOMPLETE', "Confirme d'abord l'heure du match puis renseigne la room.");
  }

  const minutesUntilMatch = (scheduledAt - Date.now()) / 60000;
  if (minutesUntilMatch > 10) {
    throw makeError('ROOM_TOO_EARLY', 'La salle ne peut etre partagee que 10 minutes avant le match.');
  }

  match.roomName = safeRoomName;
  match.roomPassword = safeRoomPassword;
  if (match.arbiter) {
    match.arbiter.roomName = safeRoomName;
    match.arbiter.roomPassword = safeRoomPassword;
    match.arbiter.roomPublishedAt = getNow();
  }
  Object.assign(match, updateMatchSnapshot(match, {}));

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Transition a match to in_progress status (arbiter only).
 * Requires all players checked-in, ready, and room details set.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The arbiter launching the match.
 * @param {string} matchId - ID of the match.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const launchMatchOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (match.arbiter?.userId !== actorUser.id && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul l arbitre peut lancer ce match.');
  }

  const canLaunch =
    match.arbiter &&
    match.roomName &&
    match.roomPassword &&
    match.players.length === match.maxPlayers &&
    match.players.every((player) => player.isCheckedIn && player.isReady);

  if (!canLaunch) {
    throw makeError('MATCH_NOT_READY', 'Tous les joueurs doivent etre prets avant le lancement.');
  }

  match.status = 'in_progress';
  match.startedAt = getNow();
  match.updatedAt = getNow();
  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Submit a match result with proof screenshots and scores.
 * Validates permissions, processes settlement (payouts, ELO, XP), and closes disputes.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user submitting the result (arbiter, player, or admin).
 * @param {string} matchId - ID of the match.
 * @param {Object} resultPayload - Result data (winnerTeam, scores, proofs, resolutionType).
 * @param {Object} [opts] - { deferSettlement: true } renvoie le résultat marqué
 *   'pending' sans créditer (la route persiste d'abord, puis appelle
 *   settlePendingMatchResult) — évite le double paiement si l'écriture échoue.
 * @returns {Promise<{matches: Array, match: Object, actorUser: Object}>}
 */
export const submitMatchResultOnServer = async (matches, actor, matchId, resultPayload, opts = {}) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  const isPlayer = match.players.some((p) => p.userId === actorUser.id);
  const isArbiter = match.arbiter?.userId === actorUser.id;
  if (!isArbiter && !isPlayer && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul l arbitre, un admin ou un participant peut valider le score.');
  }
  if (match.arbiter && !isArbiter && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul l arbitre peut valider le score quand un arbitre est assigne.');
  }
  if (match.result) throw makeError('RESULT_ALREADY_EXISTS', 'Ce match a deja un resultat valide.');
  // Pas de résultat sur un match clôturé : les mises ont déjà été remboursées
  // (cancel) ou consommées — en créer un ici minterait des ZC sans cagnotte.
  if (['cancelled', 'forfeited', 'archived'].includes(match.status)) {
    throw makeError('MATCH_CLOSED', 'Ce match est clôturé et ne peut plus recevoir de résultat.');
  }
  // Un litige ouvert gèle la cagnotte : seul resolveDispute peut le clore.
  if ((match.disputes || []).some((d) => d.status === 'open' || d.status === 'under_review')) {
    throw makeError('DISPUTE_ALREADY_OPEN', 'Un litige est actif sur ce match : règle-le avant de valider un score.');
  }
  // winnerTeam strict : "0", null, 2 ou undefined détruiraient la cagnotte
  // (isWinner false pour tous) ou permettaient des calculs falsifiés.
  if (resultPayload.winnerTeam !== 0 && resultPayload.winnerTeam !== 1) {
    throw makeError('INVALID_RESULTS', 'Equipe gagnante invalide.');
  }
  // Roster complet + match lancé, sauf override admin (award/moderation).
  // Source de vérité = le rôle RÉEL de l'acteur. `resultPayload.submittedBy`
  // venait du JSON client : un joueur pouvait forger "admin-dashboard" pour
  // sauter ces gardes ET les preuves, puis emporter la mise de l'adversaire
  // sur un match jamais lancé.
  const isAdminOverride = actorUser.role === 'admin';
  if (!isAdminOverride) {
    if (match.status !== 'in_progress') {
      throw makeError('MATCH_NOT_LIVE', 'Le match doit etre lance avant de valider un score.');
    }
    if (match.players.length !== match.maxPlayers) {
      throw makeError('NOT_ENOUGH_PLAYERS', `Match incomplet (${match.players.length}/${match.maxPlayers} joueurs).`);
    }
  }

  const normalizedProofs = resultPayload.proofs
    ? {
        scoreboard: normalizeProofRefs(resultPayload.proofs.scoreboard),
        finalResult: normalizeProofRefs(resultPayload.proofs.finalResult),
        roomCapture: normalizeProofRefs(resultPayload.proofs.roomCapture),
        extraEvidence: normalizeProofRefs(resultPayload.proofs.extraEvidence),
      }
    : undefined;
  const flattenedProofs = flattenProofs(normalizedProofs);
  const normalizedScreenshots = Array.isArray(resultPayload.screenshots) && resultPayload.screenshots.length
    ? normalizeProofRefs(resultPayload.screenshots)
    : flattenedProofs;
  const isInstantNoArbiter = !match.arbiter && match.isInstant;
  const requiresMandatoryProofs =
    resultPayload.resolutionType !== 'forfeit' && !isAdminOverride && !isInstantNoArbiter;

  if (requiresMandatoryProofs &&
    (!normalizedProofs || normalizedProofs.scoreboard.length === 0 || normalizedProofs.finalResult.length === 0)
  ) {
    throw makeError('PROOFS_REQUIRED', 'Ajoute au moins un scoreboard et un ecran final avant de valider le score.');
  }

  if (isInstantNoArbiter && !normalizedScreenshots.length && !isAdminOverride) {
    throw makeError('PROOFS_REQUIRED', 'Ajoute au moins une capture d\'ecran pour valider le score.');
  }

  const fullResult = {
    ...resultPayload,
    screenshots: normalizedScreenshots,
    proofs: normalizedProofs,
    proofHash: buildProofHash(matchId, resultPayload.winnerTeam, resultPayload.scores, normalizedScreenshots),
    resolutionType: resultPayload.resolutionType || 'played',
    submittedAt: getNow(),
    confirmedByTeams: [],
    // 'pending' = résultat écrit mais gains pas encore distribués. Permet de
    // persister le résultat AVANT de créditer : si l'écriture échoue, aucun
    // crédit n'a eu lieu et le client peut rejouer sans double paiement.
    payoutDistributed: opts.deferSettlement ? 'pending' : false,
  };

  match.result = fullResult;
  if (match.arbiter) {
    match.arbiter.hasSubmittedResult = true;
  }
  match.updatedAt = getNow();

  if (opts.deferSettlement) {
    // NE PAS VERSER. Le resultat part en attente de confirmation des DEUX
    // equipes : c'est le seul moment ou le perdant peut encore contester
    // (openDispute l'autorise sur 'awaiting_confirmation') sans que la
    // cagnotte ait deja quitt� le compte du gagnant.
    match.status = fullResult.resolutionType === 'forfeit' ? 'awaiting_confirmation' : 'awaiting_confirmation';
    match.confirmationDeadline = new Date(Date.now() + CONFIRMATION_WINDOW_MS).toISOString();
    match.finishedAt = null;
    return {
      matches: nextMatches,
      match,
      actorUser: getUserById(actorUser.id),
      needsConfirmation: true,
    };
  }

  // Forfait automatique (no-show) : pas de perdant humain a proteger, reglement
  // immediat pour ne pas geler la cagnotte.
  match.status = fullResult.resolutionType === 'forfeit' ? 'forfeited' : 'finished';
  match.finishedAt = getNow();
  match.confirmationDeadline = null;
  match.updatedAt = getNow();

  const settlementResult = await applyResultSettlement(match, fullResult);
  match.result.payoutDistributed = settlementResult.success;
  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Deuxième phase du règlement : distribue les gains d'un résultat marqué
 * 'pending'. Idempotent — un résultat déjà distribué n'est pas rejoué.
 * @param {Array} matches - Liste courante des matchs
 * @param {string} matchId - ID du match à régler
 * @returns {Promise<{matches: Array, match: object|null, success: boolean}>}
 */
export const settlePendingMatchResult = async (matches, matchId) => {
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match?.result) return { matches: nextMatches, match: match || null, success: true };
  if (match.result.payoutDistributed !== 'pending') {
    return { matches: nextMatches, match, success: match.result.payoutDistributed !== false };
  }
  const settlementResult = await applyResultSettlement(match, match.result);
  match.result.payoutDistributed = settlementResult.success;
  return { matches: nextMatches, match, success: settlementResult.success };
};

/**
 * Confirm a submitted match result (player only).
 * Adds the player's ID to confirmedByTeams; match finishes once all teams confirm.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The player confirming the result.
 * @param {string} matchId - ID of the match.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
/**
 * Confirmer un résultat en attente (joueur du match).
 *
 * Le pot n'est versé que lorsque TOUS les participants ont confirmé, ou à
 * l'expiration de la fenêtre de confirmation (cron). Une dispute protège le
 * perdant tant que la fenêtre est ouverte.
 * @param {Array} matches - Liste courante des matchs
 * @param {Object} actor - Le joueur confirmant
 * @param {string} matchId - ID du match
 * @returns {Promise<{matches: Array, match: Object, actorUser: Object, settled: boolean, waitingFor: string[]}>}
 */
export const confirmMatchResultOnServer = async (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (!match.result) throw makeError('RESULT_NOT_FOUND', 'Aucun resultat a confirmer.');
  if (!match.players.some((player) => player.userId === actorUser.id)) {
    throw makeError('FORBIDDEN', 'Seuls les joueurs du match peuvent confirmer ce resultat.');
  }
  if (match.status !== 'awaiting_confirmation') {
    throw makeError('ALREADY_CONFIRMED', 'Ce match n attend plus de confirmation.');
  }
  if (match.result.confirmedByTeams.includes(actorUser.id)) {
    throw makeError('ALREADY_CONFIRMED', 'Tu as deja confirme ce resultat.');
  }
  if (match.result.payoutDistributed !== 'pending') {
    throw makeError('ALREADY_CONFIRMED', 'Ce resultat est deja regle.');
  }

  match.result.confirmedByTeams.push(actorUser.id);
  match.updatedAt = getNow();

  const pending = match.players
    .map((player) => player.userId)
    .filter((userId) => !match.result.confirmedByTeams.includes(userId));
  if (pending.length > 0) {
    return {
      matches: nextMatches,
      match,
      actorUser: getUserById(actorUser.id),
      settled: false,
      waitingFor: pending,
    };
  }

  const settlementResult = await applyResultSettlement(match, match.result);
  match.result.payoutDistributed = settlementResult.success;
  if (settlementResult.success) {
    match.status = 'finished';
    match.finishedAt = getNow();
    match.confirmationDeadline = null;
  }
  match.updatedAt = getNow();
  return {
    matches: nextMatches,
    match,
    actorUser: getUserById(actorUser.id),
    settled: settlementResult.success,
    waitingFor: [],
  };
};

/**
 * Expirer la fenêtre de confirmation : tout match en attente depuis plus de
 * CONFIRMATION_WINDOW_MS sans litige est réglé (sinon un joueur absent
 * gèlerait la cagnotte indéfiniment).
 * @param {Array} matches - Liste courante des matchs
 * @param {number} now - Horodatage de référence
 * @returns {Promise<{matches: Array, settled: Array}>}
 */
export const expireConfirmationsOnServer = async (matches, now = Date.now()) => {
  const nextMatches = cloneMatches(matches);
  const settled = [];

  for (const match of nextMatches) {
    if (match.status !== 'awaiting_confirmation') continue;
    if (match.result?.payoutDistributed !== 'pending') continue;
    const deadline = match.confirmationDeadline ? new Date(match.confirmationDeadline).getTime() : 0;
    if (!deadline || deadline > now) continue;
    // Un litige ouvert doit rester gelé : c'est l'admin qui tranche.
    if (match.disputes.some((d) => d.status === 'open' || d.status === 'under_review')) continue;

    const settlementResult = await applyResultSettlement(match, match.result);
    match.result.payoutDistributed = settlementResult.success;
    if (settlementResult.success) {
      match.status = 'finished';
      match.finishedAt = getNow();
      match.confirmationDeadline = null;
    }
    match.updatedAt = getNow();
    settled.push({ id: match.id, success: settlementResult.success });
  }

  return { matches: nextMatches, settled };
};

/**
 * Open a dispute on a match, freezing the prize pool.
 * Requires a clear reason and at least one piece of evidence.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user opening the dispute.
 * @param {string} matchId - ID of the match.
 * @param {Object} payload - Dispute data (reason, category, evidence).
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const openDisputeOnServer = (matches, actor, matchId, payload) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  const normalizedEvidence = normalizeProofRefs(payload.evidence);

  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  // Seuls un participant, l'arbitre ou un admin peuvent contester. Sinon
  // n'importe quel connecté figeait la cagnotte d'un match arbitraire
  // (statut 'disputed' que l'automation saute ensuite indéfiniment).
  const isParticipant = match.players.some((p) => p.userId === actorUser.id);
  const isMatchArbiter = match.arbiter?.userId === actorUser.id;
  if (!isParticipant && !isMatchArbiter && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un joueur du match ou son arbitre peut contester.');
  }
  // Un match payé ne se conteste plus : les ZC sont partis. MAIS tant que le
  // résultat est en attente de confirmation, le perdant a le droit de
  // contester — c'est précisément la fenêtre qui rend la confirmation utile.
  const alreadyPaid = match.result?.payoutDistributed === true
    || TERMINAL_STATUSES.includes(match.status)
    || match.status === 'archived';
  if (alreadyPaid) {
    throw makeError('MATCH_CLOSED', 'Ce match est clos : trop tard pour contester.');
  }
  if (!payload.reason?.trim() || normalizedEvidence.length === 0) {
    throw makeError('DISPUTE_INCOMPLETE', 'Ajoute une raison claire et au moins une preuve.');
  }
  if (match.disputes.some((dispute) => dispute.status === 'open' || dispute.status === 'under_review')) {
    throw makeError('DISPUTE_ALREADY_OPEN', 'Un litige est deja actif sur ce match.');
  }

  const dispute = {
    id: `DSP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    level: 1,
    category: payload.category || 'result',
    reason: sanitizeText(payload.reason.trim()),
    evidence: normalizedEvidence,
    requestedBy: actorUser.id,
    openedByPseudo: actorUser.pseudo,
    status: 'open',
    createdAt: getNow(),
    openedAt: getNow(),
    prizePoolFrozen: true,
  };

  match.dispute = dispute;
  match.disputes = [dispute, ...match.disputes];
  match.status = 'disputed';
  match.updatedAt = getNow();

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Resolve all open disputes on a match (admin only).
 * Unfreezes the prize pool and restores the match to its pre-dispute status.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The admin resolving the dispute.
 * @param {string} matchId - ID of the match.
 * @param {string} resolution - Resolution note describing the outcome.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
/**
 * Clôturer les litiges ouverts (admin) et déclencher le sort de l'argent.
 *
 * AVANT cette évolution, cette fonction ne touchait à aucun argent : un litige
 * ouvert sur un match dont le résultat était déjà versé ne pouvait donc pas
 * être corrigé, et un litige sur un résultat en attente gelait la cagnotte
 * indéfiniment. Elle décide maintenant explicitement :
 *   - `action: 'settle'`  → applique le résultat (défaut si un résultat existe)
 *   - `action: 'refund'`  → rembourse toutes les passes, match annulé
 * @param {Array} matches - Liste courante des matchs
 * @param {Object} actor - L'admin
 * @param {string} matchId - ID du match
 * @param {string} resolution - Note de résolution
 * @param {{action?: 'settle'|'refund'}} [options]
 * @returns {Promise<{matches: Array, match: Object, actorUser: Object, action: string}>}
 */
export const resolveDisputeOnServer = async (matches, actor, matchId, resolution, options = {}) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un admin peut cloturer un litige.');
  }

  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  match.disputes = resolveOpenDisputes(match, resolution);
  match.dispute = match.disputes[0];

  // Décision explicite : on ne bouge l'argent que si l'admin l'a demandé et
  // si le match n'est pas déjà soldé (sinon il n'y a plus rien à faire).
  const hasUnpaidResult = !!match.result && match.result.payoutDistributed !== true;
  const action = options.action || (hasUnpaidResult ? 'settle' : 'none');
  if (action !== 'none' && action !== 'settle' && action !== 'refund') {
    throw makeError('INVALID_RESULTS', 'Action de resolution invalide (settle ou refund).');
  }
  if ((action === 'settle' || action === 'refund') && match.result?.payoutDistributed === true) {
    throw makeError('MATCH_CLOSED', 'Gains deja distribues : rectification manuelle necessaire.');
  }

  if (action === 'settle' && match.result) {
    const settlementResult = await applyResultSettlement(match, match.result);
    match.result.payoutDistributed = settlementResult.success;
    match.status = settlementResult.success ? 'finished' : 'disputed';
    if (settlementResult.success) {
      match.finishedAt = getNow();
      match.confirmationDeadline = null;
    }
  } else if (action === 'refund') {
    for (const player of match.players) {
      await withWalletMutex(player.userId, async () => {
        await refundLockedEntry(player.userId, match.id, `Remboursement litige ${match.id}`);
      });
    }
    match.status = 'cancelled';
    match.finishedAt = getNow();
    match.confirmationDeadline = null;
  } else {
    // Aucun argent en jeu (litige sur un match sans résultat) : on restaure
    // l'état de jeu pour que le match reprenne.
    match.status = match.result
      ? 'awaiting_confirmation'
      : getStatusFromMatch(match);
  }

  match.updatedAt = getNow();
  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id), action };
};

/**
 * Cancel a match and refund all players' locked entry fees (admin only).
 * Resolves any open disputes and marks the match as cancelled.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The admin cancelling the match.
 * @param {string} matchId - ID of the match.
 * @param {string} [reason] - Cancellation reason.
 * @returns {Promise<{matches: Array, match: Object, actorUser: Object}>}
 */
export const cancelMatchOnServer = async (matches, actor, matchId, reason = 'Match annule par moderation.') => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un admin peut annuler un match.');
  }

  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  // Anti-double-remboursement : un match déjà soldé (résultat + gains distribués
  // ou statut terminal) ne peut plus être annulé — les mises sont déjà parties.
  if (match.result?.payoutDistributed || TERMINAL_STATUSES.includes(match.status)) {
    throw makeError('MATCH_CLOSED', 'Match déjà clôturé : annulation impossible, gains déjà distribués.');
  }

  for (const player of match.players) {
    await withWalletMutex(player.userId, async () => {
      await refundLockedEntry(player.userId, match.id, `Remboursement moderation ${match.id}`);
    });
  }

  match.disputes = resolveOpenDisputes(match, reason);
  match.dispute = match.disputes[0];
  match.status = 'cancelled';
  match.finishedAt = getNow();
  match.updatedAt = getNow();
  match.result = match.result || undefined;

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

const resolveForfeit = async (match, winnerTeam, losingTeam, reason) => {
  const fullResult = {
    winnerTeam,
    scores: {
      team0: winnerTeam === 0 ? 1 : 0,
      team1: winnerTeam === 1 ? 1 : 0,
    },
    screenshots: [],
    arbiterNotes: reason,
    resolutionType: 'forfeit',
    forfeitTeam: losingTeam,
    submittedBy: 'system-no-show',
    submittedAt: getNow(),
    confirmedByTeams: [],
    payoutDistributed: false,
  };

  match.result = fullResult;
  if (match.arbiter) {
    match.arbiter.hasSubmittedResult = true;
  }
  match.status = 'forfeited';
  match.finishedAt = getNow();
  match.updatedAt = getNow();

  const settlementResult = await applyResultSettlement(match, fullResult);
  match.result.payoutDistributed = settlementResult.success;
};

const cancelForAutomation = async (match, reason) => {
  for (const player of match.players) {
    await withWalletMutex(player.userId, async () => {
      await refundLockedEntry(player.userId, match.id, `Remboursement automatique ${match.id}`);
    });
  }

  match.status = 'cancelled';
  match.finishedAt = getNow();
  match.updatedAt = getNow();
  match.disputes = resolveOpenDisputes(match, reason);
  match.dispute = match.disputes[0];
};

const autoReadyCheckedInPlayers = (match) => {
  let changed = false;
  match.players = match.players.map((player) => {
    if (player.isCheckedIn && !player.isReady) {
      changed = true;
      return { ...player, isReady: true };
    }
    return player;
  });

  if (changed) {
    Object.assign(match, updateMatchSnapshot(match, {}));
  }
};

/**
 * Run automated match lifecycle checks: expire old matches, auto-forfeit no-shows.
 * Called periodically to handle matches that missed their scheduled window.
 * @param {Array} matches - Current array of all matches.
 * @returns {Promise<{matches: Array, changed: boolean}>}
 */
export const processMatchAutomationOnServer = async (matches) => {
  const now = Date.now();
  const nextMatches = cloneMatches(matches);
  let changed = false;

  for (const match of nextMatches) {
    try {
      if (match.status === 'disputed' || TERMINAL_STATUSES.includes(match.status)) {
        continue;
      }

      const expired = new Date(match.expiresAt).getTime() <= now;
      if (expired) {
        await cancelForAutomation(
          match,
          "Le match est annule automatiquement: la fenetre de 14 jours est depassee sans resultat valide."
        );
        changed = true;
        continue;
      }

      const scheduledAt = getScheduledTimestamp(match);
      if (!scheduledAt || scheduledAt > now || match.status === 'in_progress') {
        continue;
      }

      if (!match.arbiter) {
        await cancelForAutomation(
          match,
          "Le match est annule automatiquement: aucun arbitre n'a confirme la salle a l'heure prevue."
        );
        changed = true;
        continue;
      }

      const teamAlphaReady = isTeamReadyForLaunch(match, 0);
      const teamBravoReady = isTeamReadyForLaunch(match, 1);

      if (teamAlphaReady && teamBravoReady) {
        autoReadyCheckedInPlayers(match);
        changed = true;
        continue;
      }

      if (!teamAlphaReady && !teamBravoReady) {
        await cancelForAutomation(
          match,
          "Le match est annule automatiquement: aucune equipe n'a valide tous ses joueurs a l'heure convenue."
        );
        changed = true;
        continue;
      }

      await resolveForfeit(
        match,
        teamAlphaReady ? 0 : 1,
        teamAlphaReady ? 1 : 0,
        `${getSquadLabel(teamAlphaReady ? 1 : 0)} ne s'est pas presente avec un roster complet a l'heure convenue.`
      );
      changed = true;
    } catch (err) {
      log.error('Automation error for match', { matchId: match.id, error: err.message });
    }
  }

  return { matches: nextMatches, changed };
};

/**
 * Filter public matches visible to a given user based on device/controller restrictions.
 * @param {Array} matches - Current array of all matches.
 * @param {Object|null} currentUser - The user requesting matches, or null for anonymous.
 * @returns {Array} Array of matching public matches.
 */
export const getPublicMatchesForUser = (matches, currentUser) =>
  matches.filter((match) => {
    if (match.visibility !== 'public') return false;
    if (!currentUser) return true;

    const deviceAllowed = match.deviceRestriction === 'open' || match.deviceRestriction === currentUser.device;
    const controllerAllowed =
      match.controllerRestriction === 'open' || match.controllerRestriction === currentUser.controllerType;

    return deviceAllowed && controllerAllowed;
  });

export const getMatchActivityForUser = (matches, userId) => ({
  active: matches.filter(
    (match) =>
      ACTIVE_STATUSES.includes(match.status) &&
      (match.players.some((player) => player.userId === userId) || match.arbiter?.userId === userId)
  ),
  history: matches.filter(
    (match) =>
      ['finished', 'cancelled', 'forfeited', 'disputed'].includes(match.status) &&
      (match.players.some((player) => player.userId === userId) || match.arbiter?.userId === userId)
  ),
});

/**
 * Add additional evidence to an active dispute on a match.
 * Only players or the arbiter may add evidence.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The user adding evidence.
 * @param {string} matchId - ID of the match.
 * @param {Array|string} newEvidence - Evidence references (URLs or file IDs).
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const addEvidenceToDisputeOnServer = (matches, actor, matchId, newEvidence) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);

  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  const isParticipant =
    match.players.some((player) => player.userId === actorUser.id) ||
    match.arbiter?.userId === actorUser.id;

  if (!isParticipant && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un joueur ou l arbitre peut ajouter des preuves.');
  }

  const activeDispute =
    match.disputes.find((dispute) => dispute.status === 'open' || dispute.status === 'under_review') ||
    match.dispute;

  if (!activeDispute) {
    throw makeError('DISPUTE_NOT_FOUND', 'Aucun litige actif sur ce match.');
  }

  const normalizedNew = normalizeProofRefs(
    Array.isArray(newEvidence) ? newEvidence : String(newEvidence).split(',')
  );
  if (normalizedNew.length === 0) {
    throw makeError('DISPUTE_INCOMPLETE', 'Ajoute au moins une preuve valide.');
  }

  activeDispute.evidence = [...activeDispute.evidence, ...normalizedNew];
  if (match.dispute?.id === activeDispute.id) {
    match.dispute = activeDispute;
  }
  match.updatedAt = getNow();

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

/**
 * Escalate a dispute to admin review (arbiter only).
 * Promotes the dispute level to 2 and sets status to under_review.
 * @param {Array} matches - Current array of all matches.
 * @param {Object} actor - The arbiter escalating the dispute.
 * @param {string} matchId - ID of the match.
 * @returns {{matches: Array, match: Object, actorUser: Object}}
 */
export const escalateDisputeOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);

  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  const isArbiter = match.arbiter?.userId === actorUser.id;
  if (!isArbiter && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul l arbitre peut escalader un litige.');
  }

  const activeDispute =
    match.disputes.find((dispute) => dispute.status === 'open' || dispute.status === 'under_review') ||
    match.dispute;

  if (!activeDispute) {
    throw makeError('DISPUTE_NOT_FOUND', 'Aucun litige actif sur ce match.');
  }

  if ((activeDispute.level || 1) >= 2) {
    throw makeError('DISPUTE_ALREADY_ESCALATED', 'Ce litige est deja au niveau admin.');
  }

  activeDispute.level = 2;
  activeDispute.status = 'under_review';
  activeDispute.escalatedAt = getNow();
  activeDispute.escalatedByPseudo = actorUser.pseudo;

  if (match.dispute?.id === activeDispute.id) {
    match.dispute = activeDispute;
  }
  match.updatedAt = getNow();

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};
