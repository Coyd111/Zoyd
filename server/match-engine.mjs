import { getUserById, updateUserAccount } from './persistence.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  settleMatchLossWallet,
} from './wallet-engine.mjs';

export const MATCH_AUTOMATION_INTERVAL_MS = 30_000;

const ACTIVE_STATUSES = ['recruiting', 'full', 'check_in', 'ready', 'in_progress'];
const TERMINAL_STATUSES = ['finished', 'cancelled', 'forfeited'];
const roundAmount = (value) => Math.round(Number(value || 0) * 100) / 100;
const getNow = () => new Date().toISOString();
const getTeamSize = (format) => parseInt(format.split('VS')[0], 10);
const getSquadLabel = (team) => (team === 0 ? 'Squad Alpha' : 'Squad Bravo');
const getScheduledTimestamp = (match) => (match.scheduledAt ? new Date(match.scheduledAt).getTime() : null);
const getTeamCheckInCount = (match, team) =>
  match.players.filter((player) => player.team === team && player.isCheckedIn).length;
const isTeamReadyForLaunch = (match, team) => getTeamCheckInCount(match, team) >= match.teamSize;
const makeError = (code, message) => Object.assign(new Error(message), { code });
const normalizeProofRefs = (refs = []) => refs.map((ref) => `${ref}`.trim()).filter(Boolean);
const flattenProofs = (proofs) =>
  proofs
    ? [...proofs.scoreboard, ...proofs.finalResult, ...proofs.roomCapture, ...proofs.extraEvidence]
    : [];
const buildProofHash = (matchId, winnerTeam, scores, refs) =>
  [matchId, winnerTeam, scores.team0, scores.team1, ...refs.map((ref) => ref.toLowerCase())].join('|');
const getWinnerPayout = (match) => roundAmount(match.prizePool - match.zoydFee - match.arbiterFee);

const levelThresholds = {
  BEGINNER: 1000,
  COMPETITOR: 3000,
  CHALLENGER: 7000,
  ELITE: 15000,
  PRO: Infinity,
};

const progressionLevels = ['BEGINNER', 'COMPETITOR', 'CHALLENGER', 'ELITE', 'PRO'];

const addXpToProgression = (progression, amount) => {
  const next = {
    level: progression?.level || 'BEGINNER',
    xp: Number(progression?.xp || 0) + amount,
    nextLevelXp: Number(progression?.nextLevelXp || 1000),
  };

  const currentIdx = progressionLevels.indexOf(next.level);
  if (currentIdx >= 0 && currentIdx < progressionLevels.length - 1 && next.xp >= levelThresholds[next.level]) {
    next.level = progressionLevels[currentIdx + 1];
  }
  next.nextLevelXp = levelThresholds[next.level];
  return next;
};

const cloneMatches = (matches) => matches.map((match) => structuredClone(match));

const getPreferredTeam = (match, preferredTeam) => {
  const team0Count = match.players.filter((player) => player.team === 0).length;
  const team1Count = match.players.filter((player) => player.team === 1).length;

  if (preferredTeam === 0 && team0Count < match.teamSize) return 0;
  if (preferredTeam === 1 && team1Count < match.teamSize) return 1;
  if (team0Count <= team1Count && team0Count < match.teamSize) return 0;
  if (team1Count < match.teamSize) return 1;
  return null;
};

const getStatusFromMatch = (match) => {
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
  if (!match.arbiter) return 'full';

  const everyoneCheckedIn = match.players.every((player) => player.isCheckedIn);
  const everyoneReady = match.players.every((player) => player.isReady);

  if (!everyoneCheckedIn || !everyoneReady) {
    return 'check_in';
  }

  if (match.status === 'in_progress') {
    return 'in_progress';
  }

  return 'ready';
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

const patchUserForMatchOutcome = (userId, updater) =>
  updateUserAccount(userId, (user) => {
    const next = updater(structuredClone(user));
    next.lastSeen = getNow();
    return next;
  });

const applyResultSettlement = (match, result) => {
  const payout = getWinnerPayout(match);

  for (const player of match.players) {
    const isWinner = player.team === result.winnerTeam;

    if (isWinner) {
      releaseWalletWinnings(
        player.userId,
        payout,
        match.id,
        'prize_win',
        `Gain du match ${match.rules.mode} / ${match.rules.map}`
      );

      patchUserForMatchOutcome(player.userId, (user) => {
        const nextStats = {
          ...user.stats,
          wins: Number(user.stats?.wins || 0) + 1,
          totalEarnings: roundAmount(Number(user.stats?.totalEarnings || 0) + payout),
        };
        const total = nextStats.wins + Number(nextStats.losses || 0) + Number(nextStats.draws || 0);
        nextStats.totalMatches = total;
        nextStats.winRate = total > 0 ? Math.round((nextStats.wins / total) * 1000) / 10 : 0;
        user.stats = nextStats;
        user.progression = addXpToProgression(user.progression, 120);
        if (result.resolutionType === 'forfeit') {
          user.trustScore = Math.max(0, Math.min(100, Number(user.trustScore || 0) + 2));
        }
        return user;
      });
      continue;
    }

    settleMatchLossWallet(player.userId, match.id, `Pass consomme apres la fin du match ${match.id}`);
    patchUserForMatchOutcome(player.userId, (user) => {
      const nextStats = {
        ...user.stats,
        losses: Number(user.stats?.losses || 0) + 1,
      };
      const total = Number(nextStats.wins || 0) + nextStats.losses + Number(nextStats.draws || 0);
      nextStats.totalMatches = total;
      nextStats.winRate = total > 0 ? Math.round((Number(nextStats.wins || 0) / total) * 1000) / 10 : 0;
      user.stats = nextStats;
      user.progression = addXpToProgression(user.progression, 35);
      if (result.resolutionType === 'forfeit' && result.forfeitTeam === player.team) {
        user.trustScore = Math.max(0, Math.min(100, Number(user.trustScore || 0) - 12));
      }
      return user;
    });
  }

  if (match.arbiter?.userId && match.arbiterFee > 0) {
    releaseWalletWinnings(
      match.arbiter.userId,
      match.arbiterFee,
      match.id,
      'arbitration_fee',
      `Commission arbitre ${match.id}`
    );
  }
};

const resolveOpenDisputes = (match, resolution) =>
  match.disputes.map((dispute) =>
    dispute.status === 'open' || dispute.status === 'under_review'
      ? { ...dispute, status: 'resolved', resolution, resolvedAt: getNow(), prizePoolFrozen: false }
      : dispute
  );

export const createMatchOnServer = (matches, actor, input) => {
  const actorUser = requireActorUser(actor);
  const matchId = `M-${Date.now().toString(36).toUpperCase()}`;
  const teamSize = getTeamSize(input.format);
  const maxPlayers = teamSize * 2;
  const prizePool = roundAmount(input.entryFee * maxPlayers);
  const creatorTeam = input.creatorTeam ?? 0;

  lockEntryFee(actorUser.id, input.entryFee, matchId);

  const match = {
    id: matchId,
    creatorId: actorUser.id,
    creatorPseudo: actorUser.pseudo,
    format: input.format,
    teamSize,
    maxPlayers,
    rules: input.rules,
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

export const joinMatchOnServer = (matches, actor, matchId, preferredTeam) => {
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

  lockEntryFee(actorUser.id, match.entryFee, match.id);

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

export const toggleReadyOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  const player = match.players.find((entry) => entry.userId === actorUser.id);
  if (!player) throw makeError('PLAYER_NOT_FOUND', 'Tu ne participes pas a ce match.');
  if (!player.isCheckedIn) throw makeError('CHECKIN_REQUIRED', "Confirme d'abord ta presence.");

  player.isReady = !player.isReady;
  Object.assign(match, updateMatchSnapshot(match, {}));
  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

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

export const setRoomDetailsOnServer = (matches, actor, matchId, roomName, roomPassword) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (match.arbiter?.userId !== actorUser.id && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', "Seul l'arbitre confirme peut publier la salle.");
  }

  const safeRoomName = `${roomName}`.trim();
  const safeRoomPassword = `${roomPassword}`.trim();
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

export const submitMatchResultOnServer = (matches, actor, matchId, resultPayload) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (match.arbiter?.userId !== actorUser.id && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul l arbitre ou un admin peut valider le score.');
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
  const requiresMandatoryProofs =
    resultPayload.resolutionType !== 'forfeit' && resultPayload.submittedBy !== 'admin-dashboard';

  if (
    requiresMandatoryProofs &&
    (!normalizedProofs || normalizedProofs.scoreboard.length === 0 || normalizedProofs.finalResult.length === 0)
  ) {
    throw makeError('PROOFS_REQUIRED', 'Ajoute au moins un scoreboard et un ecran final avant de valider le score.');
  }

  const fullResult = {
    ...resultPayload,
    screenshots: normalizedScreenshots,
    proofs: normalizedProofs,
    proofHash: buildProofHash(matchId, resultPayload.winnerTeam, resultPayload.scores, normalizedScreenshots),
    resolutionType: resultPayload.resolutionType || 'played',
    submittedAt: getNow(),
    confirmedByTeams: [],
    payoutDistributed: true,
  };

  match.result = fullResult;
  match.disputes = resolveOpenDisputes(match, 'Resultat arbitre valide');
  match.dispute = match.disputes[0];
  if (match.arbiter) {
    match.arbiter.hasSubmittedResult = true;
  }
  match.status = fullResult.resolutionType === 'forfeit' ? 'forfeited' : 'finished';
  match.finishedAt = getNow();
  match.updatedAt = getNow();

  applyResultSettlement(match, fullResult);

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

export const confirmMatchResultOnServer = (matches, actor, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (!match.result) throw makeError('RESULT_NOT_FOUND', 'Aucun resultat a confirmer.');
  if (!match.players.some((player) => player.userId === actorUser.id)) {
    throw makeError('FORBIDDEN', 'Seuls les joueurs du match peuvent confirmer ce resultat.');
  }
  if (!match.result.confirmedByTeams.includes(actorUser.id)) {
    match.result.confirmedByTeams.push(actorUser.id);
  }
  match.updatedAt = getNow();
  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

export const openDisputeOnServer = (matches, actor, matchId, payload) => {
  const actorUser = requireActorUser(actor);
  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  const normalizedEvidence = normalizeProofRefs(payload.evidence);

  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');
  if (!payload.reason?.trim() || normalizedEvidence.length === 0) {
    throw makeError('DISPUTE_INCOMPLETE', 'Ajoute une raison claire et au moins une preuve.');
  }
  if (match.disputes.some((dispute) => dispute.status === 'open' || dispute.status === 'under_review')) {
    throw makeError('DISPUTE_ALREADY_OPEN', 'Un litige est deja actif sur ce match.');
  }

  const dispute = {
    id: `DSP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    level: 1,
    category: payload.category || 'result',
    reason: payload.reason.trim(),
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

export const resolveDisputeOnServer = (matches, actor, matchId, resolution) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un admin peut cloturer un litige.');
  }

  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  match.disputes = resolveOpenDisputes(match, resolution);
  match.dispute = match.disputes[0];
  match.status =
    match.status === 'forfeited'
      ? 'forfeited'
      : match.result
        ? TERMINAL_STATUSES.includes(match.status) ? match.status : 'finished'
        : getStatusFromMatch(match);
  match.updatedAt = getNow();

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

export const cancelMatchOnServer = (matches, actor, matchId, reason = 'Match annule par moderation.') => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un admin peut annuler un match.');
  }

  const nextMatches = cloneMatches(matches);
  const match = findMatch(nextMatches, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Match introuvable.');

  for (const player of match.players) {
    refundLockedEntry(player.userId, match.id, `Remboursement moderation ${match.id}`);
  }

  match.disputes = resolveOpenDisputes(match, reason);
  match.dispute = match.disputes[0];
  match.status = 'cancelled';
  match.finishedAt = getNow();
  match.updatedAt = getNow();
  match.result = match.result || undefined;

  return { matches: nextMatches, match, actorUser: getUserById(actorUser.id) };
};

const resolveForfeit = (match, winnerTeam, losingTeam, reason) => {
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
    payoutDistributed: true,
  };

  match.result = fullResult;
  if (match.arbiter) {
    match.arbiter.hasSubmittedResult = true;
  }
  match.status = 'forfeited';
  match.finishedAt = getNow();
  match.updatedAt = getNow();

  applyResultSettlement(match, fullResult);
};

const cancelForAutomation = (match, reason) => {
  for (const player of match.players) {
    refundLockedEntry(player.userId, match.id, `Remboursement automatique ${match.id}`);
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

export const processMatchAutomationOnServer = (matches) => {
  const now = Date.now();
  const nextMatches = cloneMatches(matches);
  let changed = false;

  for (const match of nextMatches) {
    if (match.status === 'disputed' || TERMINAL_STATUSES.includes(match.status)) {
      continue;
    }

    const expired = new Date(match.expiresAt).getTime() <= now;
    if (expired) {
      cancelForAutomation(
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
      cancelForAutomation(
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
      cancelForAutomation(
        match,
        "Le match est annule automatiquement: aucune equipe n'a valide tous ses joueurs a l'heure convenue."
      );
      changed = true;
      continue;
    }

    resolveForfeit(
      match,
      teamAlphaReady ? 0 : 1,
      teamAlphaReady ? 1 : 0,
      `${getSquadLabel(teamAlphaReady ? 1 : 0)} ne s'est pas presente avec un roster complet a l'heure convenue.`
    );
    changed = true;
  }

  return { matches: nextMatches, changed };
};

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
