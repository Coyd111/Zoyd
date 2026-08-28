import { createLogger } from './logger.mjs';
import { getUserById, updateUserAccount } from './persistence.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  settleMatchLossWallet,
} from './wallet-engine.mjs';
import { withWalletMutex } from './mutex.mjs';
import { roundAmount, getNow, makeError, addXpToProgression } from './utils.mjs';

const log = createLogger('league-engine');

const LEAGUE_ENTRY_FEE = 50;
const LEAGUE_MAX_PLAYERS = 500;
const LEAGUE_QUALIFY_DAYS = 5;
const LEAGUE_PLAYERS_PER_DAY = 100;
const LEAGUE_FINALISTS_COUNT = 40;
const LEAGUE_FINAL_TABLE_SIZE = 100;
const LEAGUE_REWARD_FIRST = 0.60;
const LEAGUE_REWARD_SECOND = 0.25;
const LEAGUE_REWARD_THIRD = 0.15;

const PLACEMENT_POINTS = (() => {
  const map = {};
  map[1] = 25;
  map[2] = 20;
  map[3] = 17;
  map[4] = 15;
  map[5] = 13;
  for (let i = 6; i <= 10; i++) map[i] = 10;
  for (let i = 11; i <= 20; i++) map[i] = 6;
  for (let i = 21; i <= 40; i++) map[i] = 3;
  for (let i = 41; i <= 100; i++) map[i] = 0;
  return map;
})();

const KILL_POINTS_PER_ELIMINATION = 2;

const DAY_KEYS = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const buildLeaguePayout = (totalPool) => ({
  gross: roundAmount(totalPool),
  first: roundAmount(totalPool * LEAGUE_REWARD_FIRST),
  second: roundAmount(totalPool * LEAGUE_REWARD_SECOND),
  third: roundAmount(totalPool * LEAGUE_REWARD_THIRD),
});

const normalizeDaySlot = (slot) => {
  if (!slot || typeof slot !== 'object') return { players: [], matchId: null, results: [], status: 'pending' };
  return {
    players: Array.isArray(slot.players) ? slot.players : [],
    matchId: slot.matchId || null,
    results: Array.isArray(slot.results) ? slot.results : [],
    status: slot.status || 'pending',
  };
};

const normalizeStanding = (standing) => ({
  userId: standing?.userId || '',
  pseudo: standing?.pseudo || '',
  totalPoints: Number(standing?.totalPoints || 0),
  bestPlacement: Number(standing?.bestPlacement || 0),
  matchesPlayed: Number(standing?.matchesPlayed || 0),
  placements: Array.isArray(standing?.placements) ? standing.placements : [],
});

export const normalizeLeagueSeason = (season) => {
  const now = getNow();
  const createdAt = season?.createdAt || now;
  const updatedAt = season?.updatedAt || createdAt;

  const qualificationGroups = {};
  for (const day of DAY_KEYS) {
    qualificationGroups[day] = normalizeDaySlot(season?.qualificationGroups?.[day]);
  }

  const registeredPlayers = Array.isArray(season?.registeredPlayers) ? season.registeredPlayers : [];
  const standings = Array.isArray(season?.standings)
    ? season.standings.map(normalizeStanding)
    : [];
  const finalists = Array.isArray(season?.finalists) ? season.finalists : [];

  return {
    ...season,
    id: season?.id || `LS-${Date.now().toString(36).toUpperCase()}`,
    cycleNumber: Number(season?.cycleNumber || 1),
    status: season?.status || 'registering',
    entryFee: Number(season?.entryFee || LEAGUE_ENTRY_FEE),
    maxPlayers: Number(season?.maxPlayers || LEAGUE_MAX_PLAYERS),
    registeredPlayers,
    qualificationGroups,
    standings,
    finalists,
    finalMatch: {
      matchId: season?.finalMatch?.matchId || null,
      results: Array.isArray(season?.finalMatch?.results) ? season.finalMatch.results : [],
      status: season?.finalMatch?.status || 'pending',
    },
    podium: {
      first: season?.podium?.first || null,
      second: season?.podium?.second || null,
      third: season?.podium?.third || null,
    },
    payout: season?.payout || buildLeaguePayout(registeredPlayers.length * LEAGUE_ENTRY_FEE),
    schedule: {
      registrationOpens: season?.schedule?.registrationOpens || createdAt,
      registrationCloses: season?.schedule?.registrationCloses || null,
      qualifyingStarts: season?.schedule?.qualifyingStarts || null,
      qualifyingEnds: season?.schedule?.qualifyingEnds || null,
      finalAt: season?.schedule?.finalAt || null,
    },
    createdAt,
    updatedAt,
    finishedAt: season?.finishedAt || null,
  };
};

export const normalizeLeagueCollection = (seasons) =>
  (Array.isArray(seasons) ? seasons : [])
    .map(normalizeLeagueSeason)
    .sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt || 0).getTime() -
        new Date(left.updatedAt || left.createdAt || 0).getTime()
    );

const cloneLeagues = (seasons) => normalizeLeagueCollection(seasons).map((s) => structuredClone(s));
const findSeason = (seasons, seasonId) => seasons.find((s) => s.id === seasonId);

const requireActorUser = (actor) => {
  const user = getUserById(actor.id);
  if (!user) throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');
  return user;
};

const patchUserForLeagueOutcome = async (userId, updater) => {
  if (!userId || !getUserById(userId)) return null;
  return await updateUserAccount(userId, (user) => {
    const next = updater(structuredClone(user));
    next.lastSeen = getNow();
    return next;
  });
};

const getNextCycleNumber = (seasons) => {
  if (!seasons.length) return 1;
  return Math.max(...seasons.map((s) => Number(s.cycleNumber || 0))) + 1;
};

const buildScheduleDefaults = (registrationOpens) => {
  const opens = new Date(registrationOpens);
  const closes = new Date(opens);
  closes.setDate(closes.getDate() + 4);
  closes.setHours(0, 0, 0, 0);

  const qualifyingStarts = new Date(closes);
  qualifyingStarts.setDate(qualifyingStarts.getDate() + 1);
  qualifyingStarts.setHours(18, 0, 0, 0);

  const qualifyingEnds = new Date(qualifyingStarts);
  qualifyingEnds.setDate(qualifyingEnds.getDate() + 4);
  qualifyingEnds.setHours(23, 59, 59, 999);

  const finalAt = new Date(qualifyingEnds);
  finalAt.setDate(finalAt.getDate() + 1);
  finalAt.setHours(18, 0, 0, 0);

  return {
    registrationOpens: opens.toISOString(),
    registrationCloses: closes.toISOString(),
    qualifyingStarts: qualifyingStarts.toISOString(),
    qualifyingEnds: qualifyingEnds.toISOString(),
    finalAt: finalAt.toISOString(),
  };
};

const shuffleArray = (arr) => {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const assignPlayersToDays = (playerIds) => {
  const shuffled = shuffleArray(playerIds);
  const groups = {};
  for (const day of DAY_KEYS) groups[day] = [];

  for (let i = 0; i < shuffled.length; i++) {
    const dayIndex = i % LEAGUE_QUALIFY_DAYS;
    groups[DAY_KEYS[dayIndex]].push(shuffled[i]);
  }

  return groups;
};

export const createLeagueSeasonOnServer = (seasons, actor, input = {}) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut creer une ligue.');

  const nextSeasons = cloneLeagues(seasons);
  const cycleNumber = getNextCycleNumber(nextSeasons);
  const now = getNow();
  const registrationOpens = input.registrationOpens || now;
  const schedule = buildScheduleDefaults(registrationOpens);
  const totalPool = 0;
  const seasonId = `LS-${Date.now().toString(36).toUpperCase()}`;

  const season = normalizeLeagueSeason({
    id: seasonId,
    cycleNumber,
    status: 'registering',
    entryFee: LEAGUE_ENTRY_FEE,
    maxPlayers: LEAGUE_MAX_PLAYERS,
    registeredPlayers: [],
    qualificationGroups: {},
    standings: [],
    finalists: [],
    finalMatch: { matchId: null, results: [], status: 'pending' },
    podium: { first: null, second: null, third: null },
    payout: buildLeaguePayout(totalPool),
    schedule,
    createdAt: now,
    updatedAt: now,
  });

  return {
    seasons: [season, ...nextSeasons],
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const joinLeagueSeasonOnServer = async (seasons, actor, seasonId) => {
  const actorUser = requireActorUser(actor);
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'registering') throw makeError('REGISTRATION_CLOSED', 'Les inscriptions sont fermees.');
  if (season.registeredPlayers.length >= season.maxPlayers) {
    throw makeError('NO_SLOT_AVAILABLE', 'La ligue est pleine (500/500).');
  }
  if (season.registeredPlayers.some((p) => p.userId === actorUser.id)) {
    throw makeError('ALREADY_JOINED', 'Tu es deja inscrit a cette ligue.');
  }

  await withWalletMutex(actorUser.id, async () => {
    await lockEntryFee(actorUser.id, season.entryFee, seasonId);
  });

  season.registeredPlayers.push({
    userId: actorUser.id,
    pseudo: actorUser.pseudo,
    joinedAt: getNow(),
  });

  season.payout = buildLeaguePayout(season.registeredPlayers.length * season.entryFee);
  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const leaveLeagueSeasonOnServer = async (seasons, actor, seasonId) => {
  const actorUser = requireActorUser(actor);
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'registering') throw makeError('REGISTRATION_CLOSED', 'Les inscriptions sont fermees.');

  const playerIndex = season.registeredPlayers.findIndex((p) => p.userId === actorUser.id);
  if (playerIndex === -1) throw makeError('NOT_JOINED', 'Tu n es pas inscrit a cette ligue.');

  await withWalletMutex(actorUser.id, async () => {
    await refundLockedEntry(actorUser.id, seasonId, 'Remboursement inscription ligue');
  });

  season.registeredPlayers.splice(playerIndex, 1);
  season.payout = buildLeaguePayout(season.registeredPlayers.length * season.entryFee);
  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const startLeagueQualificationOnServer = (seasons, actor, seasonId) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut lancer la qualification.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'registering') throw makeError('MATCH_CLOSED', 'La ligue n est plus en phase d inscription.');
  if (season.registeredPlayers.length < 10) {
    throw makeError('NOT_ENOUGH_PLAYERS', 'Il faut au moins 10 joueurs inscrits pour lancer.');
  }

  const playerIds = season.registeredPlayers.map((p) => p.userId);
  const groups = assignPlayersToDays(playerIds);

  for (const day of DAY_KEYS) {
    season.qualificationGroups[day] = {
      players: groups[day],
      matchId: null,
      results: [],
      status: 'scheduled',
    };
  }

  const initStandings = season.registeredPlayers.map((p) => ({
    userId: p.userId,
    pseudo: p.pseudo,
    totalPoints: 0,
    bestPlacement: 0,
    matchesPlayed: 0,
    placements: [],
  }));

  season.standings = initStandings;
  season.status = 'qualifying';
  season.schedule.qualifyingStarts = getNow();
  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const startLeagueDayOnServer = (seasons, actor, seasonId, dayKey) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut demarrer une journee.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'qualifying') throw makeError('MATCH_CLOSED', 'La ligue n est pas en phase de qualification.');
  if (!season.qualificationGroups[dayKey]) {
    throw makeError('INVALID_DAY', 'Journee invalide.');
  }

  const daySlot = season.qualificationGroups[dayKey];
  if (daySlot.status === 'live') throw makeError('MATCH_ALREADY_LIVE', 'Cette journee est deja en cours.');
  if (daySlot.status === 'finished') throw makeError('MATCH_CLOSED', 'Cette journee est deja terminee.');
  if (!daySlot.players.length) throw makeError('NO_PLAYERS', 'Aucun joueur assigne a cette journee.');

  daySlot.status = 'live';
  daySlot.matchId = `LM-${seasonId}-${dayKey.toUpperCase()}`;
  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    dayKey,
    actorUser: getUserById(actorUser.id),
  };
};

export const submitLeagueDayResultsOnServer = (seasons, actor, seasonId, dayKey, results) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut soumettre les resultats.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'qualifying') throw makeError('MATCH_CLOSED', 'La ligue n est pas en phase de qualification.');

  const daySlot = season.qualificationGroups[dayKey];
  if (!daySlot) throw makeError('INVALID_DAY', 'Journee invalide.');
  if (daySlot.status !== 'live') throw makeError('MATCH_CLOSED', 'Cette journee n est pas en cours.');
  if (!Array.isArray(results) || results.length === 0) {
    throw makeError('INVALID_RESULTS', 'Les resultats sont invalides.');
  }

  const registeredIds = new Set(daySlot.players);
  for (const r of results) {
    if (!r.userId || !registeredIds.has(r.userId)) {
      throw makeError('INVALID_RESULTS', 'Un resultats reference un joueur non inscrit a cette journee.');
    }
    if (Number(r.placement) < 1 || Number(r.placement) > 100) {
      throw makeError('INVALID_RESULTS', 'Le classement doit etre entre 1 et 100.');
    }
  }

  const processedResults = results.map((r) => {
    const placement = Number(r.placement);
    const kills = Number(r.kills || 0);
    const survivalPoints = PLACEMENT_POINTS[placement] || 0;
    const killPoints = kills * KILL_POINTS_PER_ELIMINATION;
    return {
      userId: r.userId,
      placement,
      kills,
      survivalPoints,
      killPoints,
      points: survivalPoints + killPoints,
    };
  });

  daySlot.results = processedResults;
  daySlot.status = 'finished';

  for (const result of processedResults) {
    const standing = season.standings.find((s) => s.userId === result.userId);
    if (!standing) continue;

    standing.totalPoints += result.points;
    standing.matchesPlayed += 1;
    standing.placements.push(result.placement);
    if (standing.bestPlacement === 0 || result.placement < standing.bestPlacement) {
      standing.bestPlacement = result.placement;
    }
  }

  season.standings.sort((a, b) => b.totalPoints - a.totalPoints || a.bestPlacement - b.bestPlacement);
  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    dayKey,
    actorUser: getUserById(actorUser.id),
  };
};

export const advanceToFinalOnServer = (seasons, actor, seasonId) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut avancer vers la finale.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'qualifying') throw makeError('MATCH_CLOSED', 'La ligue n est pas en phase de qualification.');

  const allDaysFinished = DAY_KEYS.every((day) => season.qualificationGroups[day]?.status === 'finished');
  if (!allDaysFinished) {
    throw makeError('QUALIFICATION_INCOMPLETE', 'Toutes les journees de qualification ne sont pas terminees.');
  }

  const topPlayers = season.standings.slice(0, LEAGUE_FINALISTS_COUNT);
  season.finalists = topPlayers.map((s) => ({
    userId: s.userId,
    pseudo: s.pseudo,
    totalPoints: s.totalPoints,
    bestPlacement: s.bestPlacement,
  }));

  season.status = 'final';
  season.schedule.qualifyingEnds = getNow();
  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const submitLeagueFinalResultsOnServer = async (seasons, actor, seasonId, finalResults) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut soumettre les resultats de la finale.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'final') throw makeError('MATCH_CLOSED', 'La ligue n est pas en phase de finale.');
  if (!Array.isArray(finalResults) || finalResults.length === 0) {
    throw makeError('INVALID_RESULTS', 'Les resultats de la finale sont invalides.');
  }

  const finalistIds = new Set(season.finalists.map((f) => f.userId));
  for (const r of finalResults) {
    if (!r.userId || !finalistIds.has(r.userId)) {
      throw makeError('INVALID_RESULTS', 'Un resultats reference un joueur non qualifie pour la finale.');
    }
    if (Number(r.placement) < 1 || Number(r.placement) > LEAGUE_FINAL_TABLE_SIZE) {
      throw makeError('INVALID_RESULTS', `Le classement doit etre entre 1 et ${LEAGUE_FINAL_TABLE_SIZE}.`);
    }
  }

  const processedFinal = finalResults.map((r) => ({
    userId: r.userId,
    placement: Number(r.placement),
    kills: Number(r.kills || 0),
  }));

  processedFinal.sort((a, b) => a.placement - b.placement);

  const first = processedFinal.find((r) => r.placement === 1);
  const second = processedFinal.find((r) => r.placement === 2);
  const third = processedFinal.find((r) => r.placement === 3);

  season.podium = {
    first: first?.userId || null,
    second: second?.userId || null,
    third: third?.userId || null,
  };

  season.finalMatch = {
    matchId: `LMF-${seasonId}`,
    results: processedFinal,
    status: 'finished',
  };

  season.status = 'completed';
  season.finishedAt = getNow();
  season.schedule.finalAt = getNow();
  season.updatedAt = getNow();

  await applyLeagueSettlement(season);

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

const getPlacementXp = (placement) => {
  if (placement === 1) return 200;
  if (placement === 2) return 150;
  if (placement === 3) return 120;
  if (placement <= 10) return 60;
  return 30;
};

const applyLeagueSettlement = async (season) => {
  if (season.status !== 'completed') return;

  const { payout, podium } = season;

  if (podium.first) {
    try {
      await withWalletMutex(podium.first, async () => {
        await releaseWalletWinnings(podium.first, payout.first, `${season.id}-1ST`, 'prize_win', `1er ligue cycle ${season.cycleNumber}`);
        await patchUserForLeagueOutcome(podium.first, (user) => {
          user.stats = {
            ...user.stats,
            leaguesPlayed: Number(user.stats?.leaguesPlayed || 0) + 1,
            leaguesWon: Number(user.stats?.leaguesWon || 0) + 1,
            totalEarnings: roundAmount(Number(user.stats?.totalEarnings || 0) + payout.first),
          };
          user.progression = addXpToProgression(user.progression, getPlacementXp(1));
          return user;
        });
      });
    } catch (err) {
      log.error('League settlement error for 1st place', { seasonId: season.id, userId: podium.first, error: err.message });
    }
  }

  if (podium.second) {
    try {
      await withWalletMutex(podium.second, async () => {
        await releaseWalletWinnings(podium.second, payout.second, `${season.id}-2ND`, 'prize_win', `2eme ligue cycle ${season.cycleNumber}`);
        await patchUserForLeagueOutcome(podium.second, (user) => {
          user.stats = {
            ...user.stats,
            leaguesPlayed: Number(user.stats?.leaguesPlayed || 0) + 1,
            totalEarnings: roundAmount(Number(user.stats?.totalEarnings || 0) + payout.second),
          };
          user.progression = addXpToProgression(user.progression, getPlacementXp(2));
          return user;
        });
      });
    } catch (err) {
      log.error('League settlement error for 2nd place', { seasonId: season.id, userId: podium.second, error: err.message });
    }
  }

  if (podium.third) {
    try {
      await withWalletMutex(podium.third, async () => {
        await releaseWalletWinnings(podium.third, payout.third, `${season.id}-3RD`, 'prize_win', `3eme ligue cycle ${season.cycleNumber}`);
        await patchUserForLeagueOutcome(podium.third, (user) => {
          user.stats = {
            ...user.stats,
            leaguesPlayed: Number(user.stats?.leaguesPlayed || 0) + 1,
            totalEarnings: roundAmount(Number(user.stats?.totalEarnings || 0) + payout.third),
          };
          user.progression = addXpToProgression(user.progression, getPlacementXp(3));
          return user;
        });
      });
    } catch (err) {
      log.error('League settlement error for 3rd place', { seasonId: season.id, userId: podium.third, error: err.message });
    }
  }

  for (const player of season.registeredPlayers) {
    try {
      const isPodium = [podium.first, podium.second, podium.third].includes(player.userId);
      if (!isPodium) {
        await withWalletMutex(player.userId, async () => {
          await settleMatchLossWallet(player.userId, season.id, `Pass consomme ligue cycle ${season.cycleNumber}`);
          await patchUserForLeagueOutcome(player.userId, (user) => {
            user.stats = {
              ...user.stats,
              leaguesPlayed: Number(user.stats?.leaguesPlayed || 0) + 1,
            };
            user.progression = addXpToProgression(user.progression, getPlacementXp(0));
            return user;
          });
        });
      }
    } catch (err) {
      log.error('League settlement error for player', { seasonId: season.id, playerId: player.userId, error: err.message });
    }
  }
};

export const getLeagueLeaderboard = (seasons, seasonId) => {
  const season = seasons.find((s) => s.id === seasonId);
  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  return season.standings;
};

export const updateLeagueSettingsOnServer = (seasons, actor, seasonId, settings) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut modifier les parametres.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'registering') {
    throw makeError('MATCH_CLOSED', 'On ne peut modifier les parametres qu avant le lancement.');
  }

  if (settings.maxPlayers !== undefined) {
    const newMax = Number(settings.maxPlayers);
    if (newMax < 10 || newMax > 1000) {
      throw makeError('INVALID_REGISTRATION', 'Le nombre max de joueurs doit etre entre 10 et 1000.');
    }
    if (newMax < season.registeredPlayers.length) {
      throw makeError('INVALID_REGISTRATION', `Il y a deja ${season.registeredPlayers.length} inscrits. Le max ne peut pas etre inferieur.`);
    }
    season.maxPlayers = newMax;
  }

  if (settings.entryFee !== undefined) {
    const newFee = Number(settings.entryFee);
    if (newFee < 0 || newFee > 500) {
      throw makeError('INVALID_REGISTRATION', 'Le pass d entree doit etre entre 0 et 500 ZC.');
    }
    season.entryFee = newFee;
    season.payout = buildLeaguePayout(season.registeredPlayers.length * newFee);
  }

  if (settings.registrationOpens !== undefined) {
    season.schedule.registrationOpens = settings.registrationOpens;
  }
  if (settings.registrationCloses !== undefined) {
    season.schedule.registrationCloses = settings.registrationCloses;
  }

  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const reassignPlayerOnServer = (seasons, actor, seasonId, userId, fromDay, toDay) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut reassigner les joueurs.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');
  if (season.status !== 'qualifying') {
    throw makeError('MATCH_CLOSED', 'La reassignment n est possible que pendant la qualification.');
  }
  if (!DAY_KEYS.includes(fromDay) || !DAY_KEYS.includes(toDay)) {
    throw makeError('INVALID_DAY', 'Journee invalide.');
  }
  if (fromDay === toDay) throw makeError('INVALID_DAY', 'Les jours source et cible sont identiques.');

  const fromSlot = season.qualificationGroups[fromDay];
  const toSlot = season.qualificationGroups[toDay];
  if (!fromSlot || !toSlot) throw makeError('INVALID_DAY', 'Journee introuvable.');
  if (fromSlot.status === 'finished' || toSlot.status === 'finished') {
    throw makeError('MATCH_CLOSED', 'On ne peut pas reassigner apres la fin d une journee.');
  }

  const playerIndex = fromSlot.players.indexOf(userId);
  if (playerIndex === -1) {
    throw makeError('NOT_JOINED', 'Ce joueur n est pas assigne a cette journee.');
  }

  fromSlot.players.splice(playerIndex, 1);
  toSlot.players.push(userId);

  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const refundLeaguePlayerOnServer = async (seasons, actor, seasonId, userId) => {
  const actorUser = requireActorUser(actor);
  if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut effectuer des remboursements.');
  const nextSeasons = cloneLeagues(seasons);
  const season = findSeason(nextSeasons, seasonId);

  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');

  const playerIndex = season.registeredPlayers.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) throw makeError('NOT_JOINED', 'Ce joueur n est pas inscrit a cette ligue.');

  await withWalletMutex(userId, async () => {
    await refundLockedEntry(userId, seasonId, `Remboursement admin ligue cycle ${season.cycleNumber}`);
  });

  season.registeredPlayers.splice(playerIndex, 1);
  season.payout = buildLeaguePayout(season.registeredPlayers.length * season.entryFee);

  const standingIndex = season.standings.findIndex((s) => s.userId === userId);
  if (standingIndex !== -1) season.standings.splice(standingIndex, 1);

  const finalIndex = season.finalists.findIndex((f) => f.userId === userId);
  if (finalIndex !== -1) season.finalists.splice(finalIndex, 1);

  season.updatedAt = getNow();

  return {
    seasons: nextSeasons,
    season,
    actorUser: getUserById(actorUser.id),
  };
};

export const getLeaguePayments = (seasons, seasonId) => {
  const season = seasons.find((s) => s.id === seasonId);
  if (!season) throw makeError('LEAGUE_NOT_FOUND', 'Ligue introuvable.');

  return season.registeredPlayers.map((player) => {
    const user = getUserById(player.userId);
    const wallet = user?.wallet;
    const hasLocked = wallet?.lockedEntries?.[seasonId];
    return {
      userId: player.userId,
      pseudo: player.pseudo,
      joinedAt: player.joinedAt,
      paid: !!hasLocked,
      amount: hasLocked?.amount || 0,
      cashAmount: hasLocked?.cashAmount || 0,
      bonusAmount: hasLocked?.bonusAmount || 0,
    };
  });
};
