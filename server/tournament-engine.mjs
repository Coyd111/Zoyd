import { getUserById, updateUserAccount, sanitizeText } from './persistence.mjs';
import { withWalletMutex } from './mutex.mjs';
import { roundAmount, getNow, makeError, addXpToProgression } from './utils.mjs';
import { createLogger } from './logger.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  settleMatchLossWallet,
} from './wallet-engine.mjs';

const log = createLogger('tournament');

const getTeamSize = (format) => parseInt(`${format || '1VS1'}`.split('VS')[0], 10) || 1;
const getBracketSize = (entriesCount) => {
  let size = 2;
  while (size < entriesCount) size *= 2;
  return size;
};
const getArbitersNeeded = (maxEntries) => (Number(maxEntries || 0) > 8 ? 2 : 1);
const normalizeLabel = (value) => `${value || ''}`.trim().replace(/\s+/g, ' ');
const toEntityKey = (value) =>
  normalizeLabel(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ENTRY';
const getSquadLockAmount = (entryFee, teamSize) => roundAmount(Number(entryFee || 0) * Number(teamSize || 1));

const buildPayout = (entryFee, entriesCount, arbitersNeeded, teamSize = 1) => {
  const grossPool = roundAmount(Number(entryFee || 0) * Number(entriesCount || 0) * Number(teamSize || 1));
  const arbiterRate = arbitersNeeded === 2 ? 0.1 : 0.05;
  const arbiterPool = roundAmount(grossPool * arbiterRate);
  const playerPool = roundAmount(grossPool - arbiterPool);

  const first = roundAmount(playerPool * 0.5);
  const second = roundAmount(playerPool * 0.3);
  const third = roundAmount(playerPool - first - second);

  return {
    grossPool,
    playerPool,
    arbiterPool,
    first,
    second,
    third,
  };
};

const normalizePlayableDate = (date) => {
  const next = new Date(date);
  if (next.getHours() >= 0 && next.getHours() < 7) {
    next.setHours(7, 0, 0, 0);
  }
  return next;
};

const addPlayableMinutes = (isoDate, minutes) => {
  const next = new Date(isoDate);
  next.setMinutes(next.getMinutes() + minutes);
  if (next.getHours() >= 0 && next.getHours() < 7) {
    next.setHours(7, 0, 0, 0);
  }
  return next.toISOString();
};

const normalizeEntry = (entry, index, teamSize) => ({
  ...entry,
  seed: Number(entry?.seed || index + 1),
  teamSize: Number(entry?.teamSize || teamSize),
  members: Array.isArray(entry?.members) ? entry.members : [],
});

const normalizeTournamentSnapshot = (tournament) => {
  const format = tournament?.format || '1VS1';
  const teamSize = tournament?.teamSize || getTeamSize(format);
  const entries = Array.isArray(tournament?.entries)
    ? tournament.entries.map((entry, index) => normalizeEntry(entry, index, teamSize))
    : [];
  const arbitersNeeded = tournament?.arbitersNeeded || getArbitersNeeded(tournament?.maxEntries || 4);
  const createdAt = tournament?.createdAt || getNow();
  const updatedAt = tournament?.updatedAt || createdAt;

  return {
    ...tournament,
    format,
    teamSize,
    maxEntries: Number(tournament?.maxEntries || 4),
    minEntries: Number(tournament?.minEntries || Math.min(4, Number(tournament?.maxEntries || 4))),
    entryFee: roundAmount(tournament?.entryFee || 0),
    status: tournament?.status || 'recruiting',
    rules: {
      mode: tournament?.rules?.mode || 'S&D',
      mapPool: Array.isArray(tournament?.rules?.mapPool) ? tournament.rules.mapPool : ['Raid', 'Standoff', 'Crash'],
      scoreTarget: Number(tournament?.rules?.scoreTarget || 7),
      bestOf: Number(tournament?.rules?.bestOf || 1),
      weaponRestrictions: tournament?.rules?.weaponRestrictions || 'Toutes armes selon reglement',
      pointstreaks: tournament?.rules?.pointstreaks === 'allowed' ? 'allowed' : 'restricted',
      meleeAllowed: Boolean(tournament?.rules?.meleeAllowed),
      notes: tournament?.rules?.notes || 'Pas de matchs entre 00h00 et 07h00.',
    },
    startsAt: tournament?.startsAt || createdAt,
    estimatedDurationHours: Number(tournament?.estimatedDurationHours || (Number(tournament?.maxEntries || 4) > 8 ? 3 : 2)),
    controllerRestriction: tournament?.controllerRestriction || 'open',
    deviceRestriction: tournament?.deviceRestriction || 'open',
    entries,
    arbitersNeeded,
    arbiters: Array.isArray(tournament?.arbiters)
      ? tournament.arbiters.map((arbiter, index) => ({
          slot: arbiter?.slot || index + 1,
          matchesHandled: Number(arbiter?.matchesHandled || 0),
          userId: arbiter?.userId,
          pseudo: arbiter?.pseudo,
          trustScore: arbiter?.trustScore,
          assignedAt: arbiter?.assignedAt,
        }))
      : Array.from({ length: arbitersNeeded }, (_, index) => ({
          slot: index + 1,
          matchesHandled: 0,
        })),
    payout: buildPayout(tournament?.entryFee || 0, entries.length, arbitersNeeded, teamSize),
    matches: Array.isArray(tournament?.matches) ? tournament.matches : [],
    mainRounds: Number(tournament?.mainRounds || 0),
    createdAt,
    updatedAt,
    finishedAt: tournament?.finishedAt,
  };
};

/**
 * Normalize and sort a collection of tournament objects from the database.
 * Ensures all fields have safe defaults and entries are properly structured.
 * @param {Array} tournaments - Raw tournament array from storage.
 * @returns {Array} Normalized tournaments sorted by most recently updated.
 */
export const normalizeTournamentCollection = (tournaments) =>
  (Array.isArray(tournaments) ? tournaments : [])
    .map((tournament) => normalizeTournamentSnapshot(tournament))
    .sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt || 0).getTime() -
        new Date(left.updatedAt || left.createdAt || 0).getTime()
    );

const cloneTournaments = (tournaments) => normalizeTournamentCollection(tournaments).map((tournament) => structuredClone(tournament));
const findTournament = (tournaments, tournamentId) => tournaments.find((tournament) => tournament.id === tournamentId);
const findMatch = (tournament, matchId) => tournament.matches.find((match) => match.id === matchId);
const getEntryById = (tournament, entryId) => tournament.entries.find((entry) => entry.id === entryId);

const requireActorUser = (actor) => {
  const user = getUserById(actor.id);
  if (!user) {
    throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');
  }
  return user;
};

const patchUserForTournamentOutcome = async (userId, updater) => {
  if (!userId || !getUserById(userId)) return null;
  return await updateUserAccount(userId, (user) => {
    const next = updater(structuredClone(user));
    next.lastSeen = getNow();
    return next;
  });
};

const createRegisteredEntry = (options) => {
  const teamSize = getTeamSize(options.format);
  const captainPseudo = normalizeLabel(options.captainPseudo);
  const squadName =
    teamSize === 1 ? captainPseudo : normalizeLabel(options.squadName || `${captainPseudo} Squad`);
  const entryId = `ENTRY-${toEntityKey(squadName)}-${options.seed}`;
  const members = [
    {
      userId: options.captainId,
      pseudo: captainPseudo,
      joinedAt: options.joinedAt,
      isCaptain: true,
      rankMJ: options.captainRankMJ,
    },
    ...(options.teammates || []).map((member, index) => ({
      userId: member.userId || `${entryId}-M${index + 2}`,
      pseudo: normalizeLabel(member.pseudo),
      joinedAt: options.joinedAt,
      isCaptain: false,
      rankMJ: member.rankMJ,
    })),
  ];

  return {
    id: entryId,
    seed: options.seed,
    squadName,
    captainId: options.captainId,
    captainPseudo,
    teamSize,
    members,
    checkedIn: false,
    joinedAt: options.joinedAt,
    wins: 0,
    losses: 0,
  };
};

const createTournamentBase = (options) => {
  const teamSize = getTeamSize(options.format);
  const arbitersNeeded = getArbitersNeeded(options.maxEntries);
  const entries = options.entries || [];
  const now = getNow();

  return {
    id: options.id,
    name: options.name,
    format: options.format,
    teamSize,
    maxEntries: Number(options.maxEntries || 4),
    minEntries: Math.min(4, Number(options.maxEntries || 4)),
    entryFee: roundAmount(options.entryFee || 0),
    status: options.status || 'recruiting',
    rules: {
      mode: options.rules?.mode || 'S&D',
      mapPool: Array.isArray(options.rules?.mapPool) && options.rules.mapPool.length
        ? options.rules.mapPool
        : ['Raid', 'Standoff', 'Crash'],
      scoreTarget: Number(options.rules?.scoreTarget || 7),
      bestOf: Number(options.rules?.bestOf || 1),
      weaponRestrictions: options.rules?.weaponRestrictions || 'Toutes armes selon reglement',
      pointstreaks: options.rules?.pointstreaks === 'allowed' ? 'allowed' : 'restricted',
      meleeAllowed: Boolean(options.rules?.meleeAllowed),
      notes: options.rules?.notes || 'Pas de matchs entre 00h00 et 07h00.',
    },
    startsAt: options.startsAt,
    estimatedDurationHours: Number(options.maxEntries || 4) > 8 ? 3 : 2,
    controllerRestriction: options.controllerRestriction || 'open',
    deviceRestriction: options.deviceRestriction || 'open',
    entries,
    arbitersNeeded,
    arbiters:
      options.arbiters ||
      Array.from({ length: arbitersNeeded }, (_, index) => ({
        slot: index + 1,
        matchesHandled: 0,
      })),
    payout: buildPayout(options.entryFee, entries.length, arbitersNeeded, teamSize),
    matches: [],
    mainRounds: 0,
    createdAt: now,
    updatedAt: now,
  };
};

const getMatchKey = (bracketType, round, position) => `${bracketType}:${round}:${position}`;

const setMatchField = (matches, matchId, field, entryId) =>
  matches.map((match) =>
    match.id === matchId
      ? {
          ...match,
          [field]: entryId,
          updatedAt: getNow(),
        }
      : match
  );

const scheduleMatches = (mainRounds, bracketSize, tournamentId, startsAt, arbitersNeeded) => {
  const matches = [];
  let roundCursor = normalizePlayableDate(new Date(startsAt)).toISOString();

  for (let round = 1; round <= mainRounds; round += 1) {
    const matchesInRound = bracketSize / 2 ** round;
    for (let index = 0; index < matchesInRound; index += 1) {
      const batchIndex = Math.floor(index / arbitersNeeded);
      const arbiterSlot = (index % arbitersNeeded) + 1;
      matches.push({
        id: `TM-${tournamentId}-${getMatchKey('main', round, index + 1)}`,
        tournamentId,
        bracketType: 'main',
        round,
        position: index + 1,
        status: 'pending',
        scheduledAt: addPlayableMinutes(roundCursor, batchIndex * 50),
        arbiterSlot,
        updatedAt: getNow(),
      });
    }

    const roundBatches = Math.ceil(matchesInRound / arbitersNeeded);
    roundCursor = addPlayableMinutes(roundCursor, roundBatches * 50 + 25);
  }

  if (mainRounds >= 2) {
    const finalMatch = matches.find((match) => match.bracketType === 'main' && match.round === mainRounds);
    matches.push({
      id: `TM-${tournamentId}-${getMatchKey('third_place', mainRounds + 1, 1)}`,
      tournamentId,
      bracketType: 'third_place',
      round: mainRounds + 1,
      position: 1,
      status: 'pending',
      scheduledAt: finalMatch
        ? arbitersNeeded === 2
          ? finalMatch.scheduledAt
          : addPlayableMinutes(finalMatch.scheduledAt || roundCursor, 50)
        : roundCursor,
      arbiterSlot: arbitersNeeded === 2 ? 2 : 1,
      updatedAt: getNow(),
    });
  }

  return matches;
};

const getSourceMatch = (matches, bracketType, round, position) =>
  matches.find((match) => match.bracketType === bracketType && match.round === round && match.position === position);

const getNextMainMatchMeta = (match, mainRounds) => {
  if (match.bracketType !== 'main' || match.round >= mainRounds) return null;
  return {
    round: match.round + 1,
    position: Math.ceil(match.position / 2),
    field: match.position % 2 === 1 ? 'entryAId' : 'entryBId',
  };
};

const shouldAutoAdvance = (match, matches, mainRounds) => {
  const hasA = !!match.entryAId;
  const hasB = !!match.entryBId;
  if (hasA === hasB) return false;
  if (match.round === 1) return true;

  const feederPosition = hasA ? match.position * 2 : match.position * 2 - 1;
  const feederMatch = getSourceMatch(matches, 'main', match.round - 1, feederPosition);
  if (!feederMatch) return true;
  if (feederMatch.winnerEntryId) return false;
  if (feederMatch.entryAId || feederMatch.entryBId) return false;

  const feederNextMeta = getNextMainMatchMeta(feederMatch, mainRounds);
  if (!feederNextMeta) return true;
  return true;
};

const placeWinner = (matches, match, mainRounds, winnerEntryId) => {
  const nextMeta = getNextMainMatchMeta(match, mainRounds);
  if (!nextMeta) return matches;
  const nextMatch = getSourceMatch(matches, 'main', nextMeta.round, nextMeta.position);
  if (!nextMatch) return matches;
  return setMatchField(matches, nextMatch.id, nextMeta.field, winnerEntryId);
};

const placeSemifinalLoser = (matches, match, mainRounds, loserEntryId) => {
  if (!loserEntryId || mainRounds < 2 || match.bracketType !== 'main' || match.round !== mainRounds - 1) {
    return matches;
  }
  const bronzeMatch = matches.find((entry) => entry.bracketType === 'third_place');
  if (!bronzeMatch) return matches;
  return setMatchField(matches, bronzeMatch.id, match.position === 1 ? 'entryAId' : 'entryBId', loserEntryId);
};

const normalizeMatches = (matches, mainRounds) => {
  let nextMatches = matches.map((match) => ({ ...match }));
  let changed = true;

  while (changed) {
    changed = false;

    nextMatches = nextMatches.map((match) => {
      if (match.status === 'live' || match.winnerEntryId) return match;

      const hasA = !!match.entryAId;
      const hasB = !!match.entryBId;

      if (hasA && hasB) {
        if (match.status !== 'ready') {
          changed = true;
          return { ...match, status: 'ready', updatedAt: getNow() };
        }
        return match;
      }

      if (!hasA && !hasB) {
        if (match.status !== 'pending') {
          changed = true;
          return { ...match, status: 'pending', updatedAt: getNow() };
        }
        return match;
      }

      if (shouldAutoAdvance(match, nextMatches, mainRounds)) {
        const winnerEntryId = match.entryAId || match.entryBId;
        if (!winnerEntryId) return match;

        changed = true;
        let mutatedMatches = nextMatches.map((entry) =>
          entry.id === match.id
            ? {
                ...entry,
                winnerEntryId,
                loserEntryId: undefined,
                scoreA: entry.entryAId ? 1 : 0,
                scoreB: entry.entryBId ? 1 : 0,
                notes: 'Auto avance via bye',
                status: 'finished',
                updatedAt: getNow(),
              }
            : entry
        );
        mutatedMatches = placeWinner(mutatedMatches, match, mainRounds, winnerEntryId);
        nextMatches = mutatedMatches;
        return mutatedMatches.find((entry) => entry.id === match.id) || match;
      }

      if (match.status !== 'pending') {
        changed = true;
        return { ...match, status: 'pending', updatedAt: getNow() };
      }

      return match;
    });
  }

  return nextMatches;
};

const finalizeTournamentPlacements = (tournament) => {
  const finalMatch = tournament.matches.find(
    (match) => match.bracketType === 'main' && match.round === tournament.mainRounds && match.position === 1
  );
  if (!finalMatch?.winnerEntryId) return tournament;

  const finalistLoser =
    finalMatch.entryAId === finalMatch.winnerEntryId ? finalMatch.entryBId : finalMatch.entryAId;
  const bronzeMatch = tournament.matches.find((match) => match.bracketType === 'third_place');
  const thirdPlaceId = bronzeMatch?.winnerEntryId;

  const entries = tournament.entries.map((entry) => {
    if (entry.id === finalMatch.winnerEntryId) {
      return { ...entry, finalPlacement: 1 };
    }
    if (entry.id === finalistLoser) {
      return { ...entry, finalPlacement: 2 };
    }
    if (entry.id === thirdPlaceId) {
      return { ...entry, finalPlacement: 3 };
    }
    return entry;
  });

  return {
    ...tournament,
    entries,
    status: 'completed',
    finishedAt: getNow(),
    updatedAt: getNow(),
  };
};

const isTournamentComplete = (tournament) => {
  const finalMatch = tournament.matches.find(
    (match) => match.bracketType === 'main' && match.round === tournament.mainRounds && match.position === 1
  );
  if (!finalMatch || finalMatch.status !== 'finished' || !finalMatch.winnerEntryId) return false;

  const bronzeMatch = tournament.matches.find((match) => match.bracketType === 'third_place');
  if (!bronzeMatch) return true;
  return bronzeMatch.status === 'finished' && !!bronzeMatch.winnerEntryId;
};

const buildBracket = (tournament) => {
  const bracketSize = getBracketSize(tournament.entries.length);
  const mainRounds = Math.log2(bracketSize);
  const seededEntries = [...tournament.entries].sort((a, b) => a.seed - b.seed);
  const matches = scheduleMatches(mainRounds, bracketSize, tournament.id, tournament.startsAt, tournament.arbitersNeeded);

  const roundOneMatches = matches.filter((match) => match.bracketType === 'main' && match.round === 1);
  let hydratedMatches = matches;

  roundOneMatches.forEach((match, index) => {
    const entryAId = seededEntries[index * 2]?.id;
    const entryBId = seededEntries[index * 2 + 1]?.id;
    hydratedMatches = hydratedMatches.map((entry) =>
      entry.id === match.id
        ? {
            ...entry,
            entryAId,
            entryBId,
            updatedAt: getNow(),
          }
        : entry
    );
  });

  return {
    matches: normalizeMatches(hydratedMatches, mainRounds),
    mainRounds,
  };
};

const advanceTournament = (tournament, matchId, winnerEntryId, scoreA, scoreB, notes) => {
  const match = tournament.matches.find((entry) => entry.id === matchId);
  if (!match || !match.entryAId || !match.entryBId) return tournament;

  const loserEntryId = match.entryAId === winnerEntryId ? match.entryBId : match.entryAId;
  let matches = tournament.matches.map((entry) =>
    entry.id === matchId
      ? {
          ...entry,
          winnerEntryId,
          loserEntryId,
          scoreA,
          scoreB,
          status: 'finished',
          notes,
          updatedAt: getNow(),
        }
      : entry
  );

  matches = placeWinner(matches, match, tournament.mainRounds, winnerEntryId);
  matches = placeSemifinalLoser(matches, match, tournament.mainRounds, loserEntryId);
  matches = normalizeMatches(matches, tournament.mainRounds);

  const entries = tournament.entries.map((entry) => {
    if (entry.id === winnerEntryId) {
      return { ...entry, wins: Number(entry.wins || 0) + 1 };
    }
    if (entry.id === loserEntryId) {
      return {
        ...entry,
        losses: Number(entry.losses || 0) + 1,
        eliminatedAtRound: match.round,
      };
    }
    return entry;
  });

  const nextTournament = {
    ...tournament,
    matches,
    entries,
    updatedAt: getNow(),
  };

  return isTournamentComplete(nextTournament) ? finalizeTournamentPlacements(nextTournament) : nextTournament;
};

const getPlacementPayout = (tournament, placement) =>
  placement === 1
    ? tournament.payout.first
    : placement === 2
      ? tournament.payout.second
      : placement === 3
        ? tournament.payout.third
        : 0;

const getPlacementXp = (placement) => {
  if (placement === 1) return 180;
  if (placement === 2) return 120;
  if (placement === 3) return 90;
  return 45;
};

const applyTournamentSettlement = async (tournament) => {
  if (tournament.status !== 'completed') return;

  for (const entry of tournament.entries) {
    const payout = roundAmount(getPlacementPayout(tournament, entry.finalPlacement));

    try {
      await withWalletMutex(entry.captainId, async () => {
        if (payout > 0) {
          await releaseWalletWinnings(entry.captainId, payout, tournament.id, 'prize_win', `Gain tournoi ${tournament.name}`);
        } else {
          await settleMatchLossWallet(entry.captainId, tournament.id, `Pass consomme apres ${tournament.name}`);
        }

        const memberUserIds = [...new Set((entry.members || []).map((member) => member.userId).filter(Boolean))];
        for (const userId of memberUserIds) {
          await patchUserForTournamentOutcome(userId, (user) => {
            const isCaptain = userId === entry.captainId;
            const nextStats = {
              ...user.stats,
              tournamentsPlayed: Number(user.stats?.tournamentsPlayed || 0) + 1,
              tournamentsWon: Number(user.stats?.tournamentsWon || 0) + (entry.finalPlacement === 1 ? 1 : 0),
              totalEarnings: roundAmount(Number(user.stats?.totalEarnings || 0) + (isCaptain ? payout : 0)),
            };
            user.stats = nextStats;
            user.progression = addXpToProgression(user.progression, getPlacementXp(entry.finalPlacement));
            return user;
          });
        }
      });
    } catch (err) {
      log.error('Tournament settlement failed for entry', { tournamentId: tournament.id, captainId: entry.captainId, placement: entry.finalPlacement, error: err.message });
    }
  }

  const arbiterShare = roundAmount(tournament.payout.arbiterPool / tournament.arbitersNeeded);
  if (arbiterShare > 0) {
    for (const arbiter of tournament.arbiters) {
      if (!arbiter.userId) continue;
      await withWalletMutex(arbiter.userId, async () => {
        await releaseWalletWinnings(
          arbiter.userId,
          arbiterShare,
          `${tournament.id}-ARB-${arbiter.slot}`,
          'arbitration_fee',
          `Commission arbitre ${tournament.name}`
        );
      });
    }
  }
};

/**
 * Create a new tournament with validated dates, format, and rules.
 * Optionally reserves the creator as the first arbiter.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The user creating the tournament.
 * @param {Object} input - Tournament config (name, format, maxEntries, entryFee, startsAt, rules).
 * @returns {{tournaments: Array, tournament: Object, actorUser: Object}}
 */
export const createTournamentOnServer = (tournaments, actor, input) => {
  const actorUser = requireActorUser(actor);
  const tournamentId = `T-MJ-${Date.now().toString(36).toUpperCase()}`;
  const reserveCreatorAsArbiter = input.reserveCreatorAsArbiter !== false;
  const normalizedStart = normalizePlayableDate(new Date(input.startsAt || getNow())).toISOString();
  const arbitersNeeded = getArbitersNeeded(input.maxEntries);
  const arbiters = Array.from({ length: arbitersNeeded }, (_, index) => ({
    slot: index + 1,
    userId: reserveCreatorAsArbiter && index === 0 ? actorUser.id : undefined,
    pseudo: reserveCreatorAsArbiter && index === 0 ? actorUser.pseudo : undefined,
    trustScore: reserveCreatorAsArbiter && index === 0 ? actorUser.trustScore : undefined,
    assignedAt: reserveCreatorAsArbiter && index === 0 ? getNow() : undefined,
    matchesHandled: 0,
  }));

  const tournament = createTournamentBase({
    id: tournamentId,
    name: normalizeLabel(input.name),
    format: input.format,
    maxEntries: Number(input.maxEntries || 4),
    entryFee: Number(input.entryFee || 0),
    startsAt: normalizedStart,
    deviceRestriction: input.deviceRestriction || 'open',
    controllerRestriction: input.controllerRestriction || 'open',
    arbiters,
    rules: input.rules,
  });

  return {
    tournaments: [tournament, ...cloneTournaments(tournaments)],
    tournament,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Register a player (and teammates for team formats) for a tournament.
 * Validates roster, device/controller restrictions, and locks the entry fee.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The user registering.
 * @param {string} tournamentId - ID of the tournament.
 * @param {Object} [input] - Registration data (pseudo, teammates, squadName, rankMJ).
 * @returns {Promise<{tournaments: Array, tournament: Object, actorUser: Object}>}
 */
export const registerForTournamentOnServer = async (tournaments, actor, tournamentId, input = {}) => {
  const actorUser = requireActorUser(actor);
  const nextTournaments = cloneTournaments(tournaments);
  const tournament = findTournament(nextTournaments, tournamentId);

  if (!tournament) throw makeError('TOURNAMENT_NOT_FOUND', 'Tournoi introuvable.');
  if (tournament.status !== 'recruiting') throw makeError('MATCH_CLOSED', 'Les inscriptions sont deja fermees.');
  if (tournament.entries.length >= tournament.maxEntries) throw makeError('NO_SLOT_AVAILABLE', 'Le tableau est deja complet.');
  if (tournament.entries.some((entry) => entry.members.some((member) => member.userId === actorUser.id))) {
    throw makeError('ALREADY_JOINED', 'Tu es deja inscrit a ce tournoi.');
  }
  if (tournament.arbiters.some((arbiter) => arbiter.userId === actorUser.id)) {
    throw makeError('ROLE_CONFLICT', 'Un arbitre ne peut pas participer a son propre tournoi.');
  }

  const deviceMismatch =
    tournament.deviceRestriction !== 'open' && actorUser.device !== tournament.deviceRestriction;
  const controllerMismatch =
    tournament.controllerRestriction !== 'open' && actorUser.controllerType !== tournament.controllerRestriction;
  if (deviceMismatch || controllerMismatch) {
    throw makeError('MATCH_SEGMENT_MISMATCH', 'Ton appareil ou ton controle ne correspond pas a ce tournoi.');
  }

  const normalizedCaptainPseudo = normalizeLabel(input.pseudo || actorUser.pseudo);
  const normalizedTeammates =
    tournament.teamSize === 1
      ? []
      : (input.teammates || []).map((member) => ({
          ...member,
          pseudo: normalizeLabel(member.pseudo),
        }));

  if (normalizedCaptainPseudo.length < 2) {
    throw makeError('INVALID_REGISTRATION', 'Pseudo capitaine invalide.');
  }
  if (normalizedTeammates.length !== Math.max(0, tournament.teamSize - 1)) {
    throw makeError('INVALID_REGISTRATION', 'Le roster doit etre complet pour valider la squad.');
  }
  if (normalizedTeammates.some((member) => member.pseudo.length < 2)) {
    throw makeError('INVALID_REGISTRATION', 'Chaque coequipier doit avoir un pseudo valide.');
  }

  const rosterPseudos = [normalizedCaptainPseudo, ...normalizedTeammates.map((member) => member.pseudo)];
  const rosterKeys = new Set();
  for (const pseudo of rosterPseudos) {
    const key = pseudo.toLowerCase();
    if (rosterKeys.has(key)) {
      throw makeError('INVALID_REGISTRATION', 'Chaque pseudo de la squad doit etre unique.');
    }
    rosterKeys.add(key);
  }

  const existingPseudoKeys = new Set(
    tournament.entries.flatMap((entry) => entry.members.map((member) => `${member.pseudo || ''}`.toLowerCase()))
  );
  if (rosterPseudos.some((pseudo) => existingPseudoKeys.has(pseudo.toLowerCase()))) {
    throw makeError('INVALID_REGISTRATION', 'Un de ces pseudos est deja reserve sur ce tournoi.');
  }

  const squadName =
    tournament.teamSize === 1
      ? normalizedCaptainPseudo
      : normalizeLabel(input.squadName || `${normalizedCaptainPseudo} Squad`);
  if (squadName.length < 3) {
    throw makeError('INVALID_REGISTRATION', 'Le nom de squad est trop court.');
  }
  if (tournament.entries.some((entry) => entry.squadName.toLowerCase() === squadName.toLowerCase())) {
    throw makeError('INVALID_REGISTRATION', 'Ce nom de squad est deja pris.');
  }

  await withWalletMutex(actorUser.id, async () => {
    await lockEntryFee(actorUser.id, getSquadLockAmount(tournament.entryFee, tournament.teamSize), tournament.id);
  });

  const nextEntry = createRegisteredEntry({
    format: tournament.format,
    seed: tournament.entries.length + 1,
    captainId: actorUser.id,
    captainPseudo: normalizedCaptainPseudo,
    captainRankMJ: input.rankMJ || actorUser.rankMJ,
    squadName,
    teammates: normalizedTeammates,
    joinedAt: getNow(),
  });

  tournament.entries.push(nextEntry);
  tournament.payout = buildPayout(tournament.entryFee, tournament.entries.length, tournament.arbitersNeeded, tournament.teamSize);
  tournament.updatedAt = getNow();

  return {
    tournaments: nextTournaments,
    tournament,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Leave a tournament and refund the locked entry fee (captain only, before start).
 * Recalculates payout pool and re-seeds remaining entries.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The captain leaving the tournament.
 * @param {string} tournamentId - ID of the tournament.
 * @returns {Promise<{tournaments: Array, tournament: Object, actorUser: Object}>}
 */
export const leaveTournamentOnServer = async (tournaments, actor, tournamentId) => {
  const actorUser = requireActorUser(actor);
  const nextTournaments = cloneTournaments(tournaments);
  const tournament = findTournament(nextTournaments, tournamentId);

  if (!tournament) throw makeError('TOURNAMENT_NOT_FOUND', 'Tournoi introuvable.');
  if (tournament.status !== 'recruiting') throw makeError('MATCH_CLOSED', 'Le tournoi a deja demarre.');

  const removedEntry = tournament.entries.find((entry) =>
    entry.members.some((member) => member.userId === actorUser.id)
  );
  if (!removedEntry) throw makeError('PLAYER_NOT_FOUND', 'Tu ne participes pas a ce tournoi.');
  if (removedEntry.captainId !== actorUser.id) {
    throw makeError('FORBIDDEN', 'Seul le capitaine peut retirer cette squad.');
  }

  await withWalletMutex(actorUser.id, async () => {
    await refundLockedEntry(actorUser.id, tournament.id, `Remboursement du pass ${tournament.name}`);
  });

  tournament.entries = tournament.entries
    .filter((entry) => entry.id !== removedEntry.id)
    .map((entry, index) => ({ ...entry, seed: index + 1 }));
  tournament.payout = buildPayout(tournament.entryFee, tournament.entries.length, tournament.arbitersNeeded, tournament.teamSize);
  tournament.updatedAt = getNow();

  return {
    tournaments: nextTournaments,
    tournament,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Assign a user as arbiter to an open slot in a tournament.
 * Validates the actor is not already a participant or arbiter.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The user to assign as arbiter.
 * @param {string} tournamentId - ID of the tournament.
 * @returns {{tournaments: Array, tournament: Object, actorUser: Object}}
 */
export const assignTournamentArbiterOnServer = (tournaments, actor, tournamentId) => {
  const actorUser = requireActorUser(actor);
  const nextTournaments = cloneTournaments(tournaments);
  const tournament = findTournament(nextTournaments, tournamentId);

  if (!tournament) throw makeError('TOURNAMENT_NOT_FOUND', 'Tournoi introuvable.');
  if (tournament.entries.some((entry) => entry.members.some((member) => member.userId === actorUser.id))) {
    throw makeError('ROLE_CONFLICT', 'Un joueur ne peut pas arbitrer son propre tournoi.');
  }
  if (tournament.arbiters.some((arbiter) => arbiter.userId === actorUser.id)) {
    throw makeError('ALREADY_JOINED', 'Tu occupes deja une place d arbitre sur ce tournoi.');
  }

  const emptySlot = tournament.arbiters.find((arbiter) => !arbiter.userId);
  if (!emptySlot) throw makeError('ARBITER_TAKEN', "Il n'y a plus de place d'arbitre disponible.");

  Object.assign(emptySlot, {
    userId: actorUser.id,
    pseudo: actorUser.pseudo,
    trustScore: actorUser.trustScore,
    assignedAt: getNow(),
  });
  tournament.updatedAt = getNow();

  return {
    tournaments: nextTournaments,
    tournament,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Start a tournament by generating the bracket (arbiter or admin only).
 * Validates minimum entries, arbiter slots, and transitions status to live.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The arbiter starting the tournament.
 * @param {string} tournamentId - ID of the tournament.
 * @returns {{tournaments: Array, tournament: Object, actorUser: Object}}
 */
export const startTournamentOnServer = (tournaments, actor, tournamentId) => {
  const actorUser = requireActorUser(actor);
  const nextTournaments = cloneTournaments(tournaments);
  const tournament = findTournament(nextTournaments, tournamentId);

  if (!tournament) throw makeError('TOURNAMENT_NOT_FOUND', 'Tournoi introuvable.');
  const isAssignedArbiter = tournament.arbiters.some((arbiter) => arbiter.userId === actorUser.id);
  if (!isAssignedArbiter && actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un arbitre assigne peut lancer ce tournoi.');
  }
  if (tournament.status !== 'recruiting') throw makeError('MATCH_CLOSED', 'Le tournoi est deja en cours ou termine.');
  if (tournament.entries.length < tournament.minEntries) {
    throw makeError('MATCH_NOT_READY', 'Le nombre minimum de participants n est pas atteint.');
  }
  if (tournament.arbiters.some((arbiter) => !arbiter.userId)) {
    throw makeError('MATCH_NOT_READY', 'Tous les slots arbitres doivent etre couverts avant le lancement.');
  }

  const bracket = buildBracket(tournament);
  tournament.status = 'live';
  tournament.matches = bracket.matches;
  tournament.mainRounds = bracket.mainRounds;
  tournament.updatedAt = getNow();

  return {
    tournaments: nextTournaments,
    tournament,
    actorUser: getUserById(actorUser.id),
  };
};

const requireTournamentMatchAction = (tournaments, actor, tournamentId, matchId) => {
  const actorUser = requireActorUser(actor);
  const nextTournaments = cloneTournaments(tournaments);
  const tournament = findTournament(nextTournaments, tournamentId);

  if (!tournament) throw makeError('TOURNAMENT_NOT_FOUND', 'Tournoi introuvable.');
  if (tournament.status !== 'live') throw makeError('MATCH_CLOSED', 'Le tournoi n accepte plus cette action.');

  const match = findMatch(tournament, matchId);
  if (!match) throw makeError('MATCH_NOT_FOUND', 'Duel de tournoi introuvable.');

  const assignedSlot = tournament.arbiters.find((arbiter) => arbiter.userId === actorUser.id);
  if (actorUser.role !== 'admin' && assignedSlot?.slot !== match.arbiterSlot) {
    throw makeError('FORBIDDEN', 'Seul l arbitre du poste assigne peut agir sur ce duel.');
  }

  return { actorUser, nextTournaments, tournament, match, assignedSlot };
};

/**
 * Set room name and password for a specific tournament match (assigned arbiter only).
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The arbiter setting room details.
 * @param {string} tournamentId - ID of the tournament.
 * @param {string} matchId - ID of the tournament match.
 * @param {string} roomName - Room name to publish.
 * @param {string} roomPassword - Room password to publish.
 * @returns {{tournaments: Array, tournament: Object, match: Object, actorUser: Object}}
 */
export const setTournamentMatchRoomDetailsOnServer = (tournaments, actor, tournamentId, matchId, roomName, roomPassword) => {
  const { actorUser, nextTournaments, tournament, match } = requireTournamentMatchAction(
    tournaments,
    actor,
    tournamentId,
    matchId
  );

  const safeRoomName = sanitizeText(`${roomName || ''}`.trim().slice(0, 100));
  const safeRoomPassword = sanitizeText(`${roomPassword || ''}`.trim().slice(0, 50));
  if (!safeRoomName || !safeRoomPassword) {
    throw makeError('ROOM_INCOMPLETE', 'Entre un nom de salle et un mot de passe valides.');
  }
  if (!match.entryAId || !match.entryBId) {
    throw makeError('MATCH_NOT_READY', 'Ce duel n a pas encore ses deux participants.');
  }

  match.roomName = safeRoomName;
  match.roomPassword = safeRoomPassword;
  match.updatedAt = getNow();
  tournament.updatedAt = getNow();

  return {
    tournaments: nextTournaments,
    tournament,
    match,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Mark a tournament match as live so players can join the room (arbiter only).
 * Requires the match to have both participants and published room details.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The arbiter starting the match.
 * @param {string} tournamentId - ID of the tournament.
 * @param {string} matchId - ID of the tournament match.
 * @returns {{tournaments: Array, tournament: Object, match: Object, actorUser: Object}}
 */
export const setTournamentMatchLiveOnServer = (tournaments, actor, tournamentId, matchId) => {
  const { actorUser, nextTournaments, tournament, match } = requireTournamentMatchAction(
    tournaments,
    actor,
    tournamentId,
    matchId
  );

  if (match.status !== 'ready') {
    throw makeError('MATCH_NOT_READY', 'Ce duel doit etre pret avant de passer en direct.');
  }
  if (!match.roomName || !match.roomPassword) {
    throw makeError('ROOM_INCOMPLETE', 'Publie d abord la salle privee.');
  }

  match.status = 'live';
  match.updatedAt = getNow();
  tournament.updatedAt = getNow();

  return {
    tournaments: nextTournaments,
    tournament,
    match,
    actorUser: getUserById(actorUser.id),
  };
};

/**
 * Submit the result of a tournament match (assigned arbiter only).
 * Advances the winner in the bracket, handles eliminations, and settles payouts if tournament completes.
 * @param {Array} tournaments - Current array of all tournaments.
 * @param {Object} actor - The arbiter submitting the result.
 * @param {string} tournamentId - ID of the tournament.
 * @param {string} matchId - ID of the tournament match.
 * @param {Object} payload - Result data (winnerEntryId, scoreA, scoreB, notes).
 * @returns {Promise<{tournaments: Array, tournament: Object, match: Object, actorUser: Object}>}
 */
export const submitTournamentMatchResultOnServer = async (tournaments, actor, tournamentId, matchId, payload) => {
  const { actorUser, nextTournaments, assignedSlot } = requireTournamentMatchAction(
    tournaments,
    actor,
    tournamentId,
    matchId
  );
  const tournament = findTournament(nextTournaments, tournamentId);
  const targetMatch = findMatch(tournament, matchId);

  if (!targetMatch) throw makeError('MATCH_NOT_FOUND', 'Duel de tournoi introuvable.');
  if (!targetMatch.entryAId || !targetMatch.entryBId) {
    throw makeError('MATCH_NOT_READY', 'Ce duel n a pas encore ses deux participants.');
  }
  if (!['ready', 'live'].includes(targetMatch.status)) {
    throw makeError('MATCH_CLOSED', 'Ce duel a deja ete valide.');
  }

  const winnerEntryId = payload?.winnerEntryId;
  const scoreA = Number(payload?.scoreA);
  const scoreB = Number(payload?.scoreB);
  if (!winnerEntryId || ![targetMatch.entryAId, targetMatch.entryBId].includes(winnerEntryId)) {
    throw makeError('INVALID_REGISTRATION', 'Le vainqueur choisi est invalide pour ce duel.');
  }
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB) {
    throw makeError('INVALID_REGISTRATION', 'Le score final doit designer un vainqueur clair.');
  }

  const wasCompleted = tournament.status === 'completed';
  const nextTournament = advanceTournament(
    tournament,
    matchId,
    winnerEntryId,
    scoreA,
    scoreB,
    `${payload?.notes || ''}`.trim() || undefined
  );
  const tournamentIndex = nextTournaments.findIndex((entry) => entry.id === tournamentId);
  nextTournaments[tournamentIndex] = nextTournament;

  if (assignedSlot) {
    const refreshedArbiter = nextTournament.arbiters.find((arbiter) => arbiter.slot === assignedSlot.slot);
    if (refreshedArbiter) {
      refreshedArbiter.matchesHandled = Number(refreshedArbiter.matchesHandled || 0) + 1;
    }
  }

  if (!wasCompleted && nextTournament.status === 'completed') {
    await applyTournamentSettlement(nextTournament);
  }

  return {
    tournaments: nextTournaments,
    tournament: nextTournament,
    match: nextTournament.matches.find((match) => match.id === matchId),
    actorUser: getUserById(actorUser.id),
  };
};
