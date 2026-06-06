import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from './authStore';
import { useAuthStore } from './authStore';
import { useNotificationStore } from './notificationStore';
import { useWalletStore } from './walletStore';
import type { MatchFormat } from './matchStore';
import { MJ_MAP_POOL, MJ_MODE_OPTIONS } from '../../lib/competition';

export type TournamentStatus = 'recruiting' | 'live' | 'completed' | 'cancelled';
export type TournamentMatchStatus = 'pending' | 'ready' | 'live' | 'finished';
export type TournamentBracketType = 'main' | 'third_place';
export type TournamentControllerRestriction = User['controllerType'] | 'open';
export type TournamentDeviceRestriction = User['device'] | 'open';

export interface TournamentRules {
  mode: string;
  mapPool: string[];
  scoreTarget: number;
  bestOf: number;
  weaponRestrictions?: string;
  pointstreaks: 'allowed' | 'restricted';
  meleeAllowed: boolean;
  notes?: string;
}

export interface TournamentEntryMember {
  userId: string;
  pseudo: string;
  joinedAt: string;
  isCaptain: boolean;
  rankMJ?: string;
}

export interface TournamentEntry {
  id: string;
  seed: number;
  squadName: string;
  captainId: string;
  captainPseudo: string;
  teamSize: number;
  members: TournamentEntryMember[];
  checkedIn: boolean;
  joinedAt: string;
  wins: number;
  losses: number;
  eliminatedAtRound?: number;
  finalPlacement?: number;
}

export interface TournamentArbiterSlot {
  slot: 1 | 2;
  userId?: string;
  pseudo?: string;
  trustScore?: number;
  assignedAt?: string;
  matchesHandled: number;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  bracketType: TournamentBracketType;
  round: number;
  position: number;
  entryAId?: string;
  entryBId?: string;
  winnerEntryId?: string;
  loserEntryId?: string;
  scoreA?: number;
  scoreB?: number;
  status: TournamentMatchStatus;
  scheduledAt?: string;
  arbiterSlot?: 1 | 2;
  roomName?: string;
  roomPassword?: string;
  notes?: string;
  updatedAt: string;
}

export interface TournamentPayout {
  grossPool: number;
  playerPool: number;
  arbiterPool: number;
  first: number;
  second: number;
  third: number;
}

export interface Tournament {
  id: string;
  name: string;
  format: MatchFormat;
  teamSize: number;
  maxEntries: number;
  minEntries: number;
  entryFee: number;
  status: TournamentStatus;
  rules: TournamentRules;
  startsAt: string;
  estimatedDurationHours: number;
  controllerRestriction: TournamentControllerRestriction;
  deviceRestriction: TournamentDeviceRestriction;
  entries: TournamentEntry[];
  arbitersNeeded: 1 | 2;
  arbiters: TournamentArbiterSlot[];
  payout: TournamentPayout;
  matches: TournamentMatch[];
  mainRounds: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface TournamentFilters {
  format?: MatchFormat | 'all';
  status?: TournamentStatus | 'all';
}

export interface CreateTournamentInput {
  creatorId: string;
  creatorPseudo: string;
  creatorTrustScore: number;
  format: MatchFormat;
  name: string;
  maxEntries: number;
  entryFee: number;
  startsAt: string;
  deviceRestriction?: TournamentDeviceRestriction;
  controllerRestriction?: TournamentControllerRestriction;
  reserveCreatorAsArbiter?: boolean;
  rules: TournamentRules;
}

export interface TournamentRegistrationMemberInput {
  pseudo: string;
  rankMJ?: string;
  userId?: string;
}

export interface TournamentRegistrationInput {
  tournamentId: string;
  userId: string;
  pseudo: string;
  rankMJ?: string;
  squadName?: string;
  teammates?: TournamentRegistrationMemberInput[];
}

export interface TournamentState {
  tournaments: Tournament[];
  filters: TournamentFilters;
  hydrateFromServer: (tournaments: Tournament[]) => void;
  replaceFromServer: (tournaments: Tournament[]) => void;
  setFilters: (partial: Partial<TournamentFilters>) => void;
  getFilteredTournaments: () => Tournament[];
  getTournamentById: (id: string) => Tournament | undefined;
  createTournament: (input: CreateTournamentInput) => string;
  registerForTournament: (input: TournamentRegistrationInput) => boolean;
  leaveTournament: (tournamentId: string, userId: string) => void;
  assignArbiter: (tournamentId: string, userId: string, pseudo: string, trustScore: number) => boolean;
  startTournament: (tournamentId: string) => boolean;
  setMatchRoomDetails: (tournamentId: string, matchId: string, roomName: string, roomPassword: string) => void;
  setMatchLive: (tournamentId: string, matchId: string) => void;
  submitMatchResult: (
    tournamentId: string,
    matchId: string,
    winnerEntryId: string,
    scoreA: number,
    scoreB: number,
    notes?: string
  ) => void;
}

const roundAmount = (value: number) => Math.round(value * 100) / 100;
const getNow = () => new Date().toISOString();
const getTeamSize = (format: MatchFormat) => parseInt(format.split('VS')[0], 10);
const getBracketSize = (entriesCount: number) => {
  let size = 2;
  while (size < entriesCount) size *= 2;
  return size;
};
const getArbitersNeeded = (maxEntries: number): 1 | 2 => (maxEntries > 8 ? 2 : 1);
const normalizeLabel = (value: string) => value.trim().replace(/\s+/g, ' ');
const toEntityKey = (value: string) =>
  normalizeLabel(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ENTRY';
const getSquadLockAmount = (entryFee: number, teamSize: number) => roundAmount(entryFee * teamSize);

const buildPayout = (
  entryFee: number,
  entriesCount: number,
  arbitersNeeded: 1 | 2,
  teamSize = 1
): TournamentPayout => {
  const grossPool = roundAmount(entryFee * entriesCount * teamSize);
  const arbiterRate = arbitersNeeded === 2 ? 0.1 : 0.05;
  const arbiterPool = roundAmount(grossPool * arbiterRate);
  const playerPool = roundAmount(grossPool - arbiterPool);
  return {
    grossPool,
    playerPool,
    arbiterPool,
    first: roundAmount(playerPool * 0.5),
    second: roundAmount(playerPool * 0.3),
    third: roundAmount(playerPool * 0.2),
  };
};

const normalizePlayableDate = (date: Date) => {
  const next = new Date(date);
  if (next.getHours() >= 0 && next.getHours() < 7) {
    next.setHours(7, 0, 0, 0);
  }
  return next;
};

const addPlayableMinutes = (isoDate: string, minutes: number) => {
  const next = new Date(isoDate);
  next.setMinutes(next.getMinutes() + minutes);
  if (next.getHours() >= 0 && next.getHours() < 7) {
    next.setHours(7, 0, 0, 0);
  }
  return next.toISOString();
};

const normalizePersistedTournament = (tournament: any): Tournament => {
  const format = tournament?.format || '1VS1';
  const teamSize = tournament?.teamSize || getTeamSize(format);
  const entries = Array.isArray(tournament?.entries)
    ? tournament.entries.map((entry: any, index: number) => ({
        ...entry,
        seed: entry?.seed || index + 1,
        teamSize: entry?.teamSize || teamSize,
        members: Array.isArray(entry?.members) ? entry.members : [],
      }))
    : [];
  const arbitersNeeded = tournament?.arbitersNeeded || getArbitersNeeded(tournament?.maxEntries || 4);

  return {
    ...tournament,
    format,
    teamSize,
    entries,
    arbitersNeeded,
    payout: buildPayout(Number(tournament?.entryFee || 0), entries.length, arbitersNeeded, teamSize),
  };
};

const mergeTournamentsByFreshness = (currentTournaments: Tournament[], incomingTournaments: Tournament[]) => {
  const merged = new Map<string, Tournament>();

  for (const tournament of currentTournaments) {
    merged.set(tournament.id, tournament);
  }

  for (const rawTournament of incomingTournaments) {
    const incoming = normalizePersistedTournament(rawTournament);
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

const normalizeTournamentCollection = (tournaments: Tournament[]) =>
  (Array.isArray(tournaments) ? tournaments : [])
    .map((tournament) => normalizePersistedTournament(tournament))
    .sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
    );

const getEntryById = (tournament: Tournament, entryId?: string) =>
  tournament.entries.find((entry) => entry.id === entryId);

const setMatchField = (
  matches: TournamentMatch[],
  matchId: string,
  field: 'entryAId' | 'entryBId',
  entryId?: string
) =>
  matches.map((match) =>
    match.id === matchId
      ? {
          ...match,
          [field]: entryId,
          updatedAt: getNow(),
        }
      : match
  );

const getMatchKey = (bracketType: TournamentBracketType, round: number, position: number) =>
  `${bracketType}:${round}:${position}`;

const scheduleMatches = (
  mainRounds: number,
  bracketSize: number,
  tournamentId: string,
  startsAt: string,
  arbitersNeeded: 1 | 2
) => {
  const matches: TournamentMatch[] = [];
  let roundCursor = normalizePlayableDate(new Date(startsAt)).toISOString();

  for (let round = 1; round <= mainRounds; round += 1) {
    const matchesInRound = bracketSize / 2 ** round;
    for (let index = 0; index < matchesInRound; index += 1) {
      const batchIndex = Math.floor(index / arbitersNeeded);
      const arbiterSlot = ((index % arbitersNeeded) + 1) as 1 | 2;
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

const getSourceMatch = (
  matches: TournamentMatch[],
  bracketType: TournamentBracketType,
  round: number,
  position: number
) => matches.find((match) => match.bracketType === bracketType && match.round === round && match.position === position);

const getNextMainMatchMeta = (match: TournamentMatch, mainRounds: number) => {
  if (match.bracketType !== 'main' || match.round >= mainRounds) return null;
  return {
    round: match.round + 1,
    position: Math.ceil(match.position / 2),
    field: match.position % 2 === 1 ? ('entryAId' as const) : ('entryBId' as const),
  };
};

const shouldAutoAdvance = (match: TournamentMatch, matches: TournamentMatch[], mainRounds: number) => {
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

const placeWinner = (matches: TournamentMatch[], match: TournamentMatch, mainRounds: number, winnerEntryId: string) => {
  const nextMeta = getNextMainMatchMeta(match, mainRounds);
  if (!nextMeta) return matches;
  const nextMatch = getSourceMatch(matches, 'main', nextMeta.round, nextMeta.position);
  if (!nextMatch) return matches;
  return setMatchField(matches, nextMatch.id, nextMeta.field, winnerEntryId);
};

const placeSemifinalLoser = (
  matches: TournamentMatch[],
  match: TournamentMatch,
  mainRounds: number,
  loserEntryId?: string
) => {
  if (!loserEntryId || mainRounds < 2 || match.bracketType !== 'main' || match.round !== mainRounds - 1) {
    return matches;
  }
  const bronzeMatch = matches.find((entry) => entry.bracketType === 'third_place');
  if (!bronzeMatch) return matches;
  return setMatchField(matches, bronzeMatch.id, match.position === 1 ? 'entryAId' : 'entryBId', loserEntryId);
};

const normalizeMatches = (matches: TournamentMatch[], mainRounds: number) => {
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
                status: 'finished' as const,
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

const finalizeTournamentPlacements = (tournament: Tournament) => {
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
    status: 'completed' as const,
    finishedAt: getNow(),
    updatedAt: getNow(),
  };
};

const isTournamentComplete = (tournament: Tournament) => {
  const finalMatch = tournament.matches.find(
    (match) => match.bracketType === 'main' && match.round === tournament.mainRounds && match.position === 1
  );
  if (!finalMatch || finalMatch.status !== 'finished' || !finalMatch.winnerEntryId) return false;

  const bronzeMatch = tournament.matches.find((match) => match.bracketType === 'third_place');
  if (!bronzeMatch) return true;
  return bronzeMatch.status === 'finished' && !!bronzeMatch.winnerEntryId;
};

const buildBracket = (tournament: Tournament) => {
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

const advanceTournament = (
  tournament: Tournament,
  matchId: string,
  winnerEntryId: string,
  scoreA: number,
  scoreB: number,
  notes?: string
) => {
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
          status: 'finished' as const,
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
      return { ...entry, wins: entry.wins + 1 };
    }
    if (entry.id === loserEntryId) {
      return { ...entry, losses: entry.losses + 1, eliminatedAtRound: match.round };
    }
    return entry;
  });

  const nextTournament = {
    ...tournament,
    matches,
    entries,
    updatedAt: getNow(),
  };

  return isTournamentComplete(nextTournament)
    ? finalizeTournamentPlacements(nextTournament)
    : nextTournament;
};

const settleLocalTournamentOutcome = (tournament: Tournament) => {
  const currentUser = useAuthStore.getState().user;
  if (!currentUser || tournament.status !== 'completed') return;

  const wallet = useWalletStore.getState();
  const auth = useAuthStore.getState();
  const localEntry = tournament.entries.find((entry) =>
    entry.members.some((member) => member.userId === currentUser.id)
  );
  const localArbiter = tournament.arbiters.find((arbiter) => arbiter.userId === currentUser.id);

  if (localEntry) {
    const placement = localEntry.finalPlacement;
    const payout =
      placement === 1
        ? tournament.payout.first
        : placement === 2
          ? tournament.payout.second
          : placement === 3
            ? tournament.payout.third
            : 0;

    if (payout > 0) {
      wallet.releaseWinnings(
        payout,
        tournament.id,
        'prize_win',
        `Gain tournoi ${tournament.name}`
      );
      auth.updateStats({
        tournamentsPlayed: currentUser.stats.tournamentsPlayed + 1,
        tournamentsWon: currentUser.stats.tournamentsWon + (placement === 1 ? 1 : 0),
        totalEarnings: roundAmount(currentUser.stats.totalEarnings + payout),
      });
      auth.addXp(placement === 1 ? 180 : placement === 2 ? 120 : 90);
      useNotificationStore.getState().addNotification({
        type: 'result_ready',
        title: 'Tournoi termine',
        message: `${tournament.name}: placement #${placement} et ${payout.toFixed(1)} ZC credites.`,
        priority: 'high',
        actionUrl: `/mj/tournois/${tournament.id}`,
      });
    } else {
      wallet.settleMatchLoss(tournament.id, `Pass consomme apres ${tournament.name}`);
      auth.updateStats({
        tournamentsPlayed: currentUser.stats.tournamentsPlayed + 1,
      });
      auth.addXp(45);
    }
  }

  if (localArbiter) {
    const arbiterShare = roundAmount(tournament.payout.arbiterPool / tournament.arbitersNeeded);
    if (arbiterShare > 0) {
      wallet.releaseWinnings(
        arbiterShare,
        `${tournament.id}-ARB-${localArbiter.slot}`,
        'arbitration_fee',
        `Commission arbitre ${tournament.name}`
      );
    }
  }
};

const createEntry = (
  pseudo: string,
  index: number,
  format: MatchFormat,
  userId?: string,
  joinedAt?: string,
  rankMJ?: string
): TournamentEntry => {
  const seed = index + 1;
  const teamSize = getTeamSize(format);
  const createdAt = joinedAt || getNow();
  const captainPseudo = normalizeLabel(pseudo);
  const squadName = teamSize === 1 ? captainPseudo : `${captainPseudo} Squad`;
  const entryId = `ENTRY-${toEntityKey(squadName)}-${seed}`;

  return {
    id: entryId,
    seed,
    squadName,
    captainId: userId || `seed-user-${seed}`,
    captainPseudo,
    teamSize,
    members: [
      {
        userId: userId || `seed-user-${seed}`,
        pseudo: captainPseudo,
        joinedAt: createdAt,
        isCaptain: true,
        rankMJ,
      },
    ],
    checkedIn: false,
    joinedAt: createdAt,
    wins: 0,
    losses: 0,
  };
};

const createRegisteredEntry = (options: {
  format: MatchFormat;
  seed: number;
  captainId: string;
  captainPseudo: string;
  captainRankMJ?: string;
  squadName?: string;
  teammates?: TournamentRegistrationMemberInput[];
  joinedAt: string;
}): TournamentEntry => {
  const teamSize = getTeamSize(options.format);
  const captainPseudo = normalizeLabel(options.captainPseudo);
  const squadName =
    teamSize === 1 ? captainPseudo : normalizeLabel(options.squadName || `${captainPseudo} Squad`);
  const entryId = `ENTRY-${toEntityKey(squadName)}-${options.seed}`;
  const members: TournamentEntryMember[] = [
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

const createTournamentBase = (options: {
  id: string;
  name: string;
  format: MatchFormat;
  maxEntries: number;
  entryFee: number;
  startsAt: string;
  status?: TournamentStatus;
  entries?: TournamentEntry[];
  arbiters?: TournamentArbiterSlot[];
  deviceRestriction?: TournamentDeviceRestriction;
  controllerRestriction?: TournamentControllerRestriction;
  rules?: Partial<TournamentRules>;
}) => {
  const teamSize = getTeamSize(options.format);
  const arbitersNeeded = getArbitersNeeded(options.maxEntries);
  const entries = options.entries || [];
  const now = getNow();

  return {
    id: options.id,
    name: options.name,
    format: options.format,
    teamSize,
    maxEntries: options.maxEntries,
    minEntries: Math.min(4, options.maxEntries),
    entryFee: roundAmount(options.entryFee),
    status: options.status || 'recruiting',
    rules: {
      mode: options.rules?.mode || MJ_MODE_OPTIONS[0].name,
      mapPool: options.rules?.mapPool || [...MJ_MAP_POOL.slice(0, 3)],
      scoreTarget: options.rules?.scoreTarget || 7,
      bestOf: options.rules?.bestOf || 1,
      weaponRestrictions: options.rules?.weaponRestrictions || 'Toutes armes selon reglement',
      pointstreaks: options.rules?.pointstreaks || 'restricted',
      meleeAllowed: options.rules?.meleeAllowed ?? false,
      notes: options.rules?.notes || 'Pas de matchs entre 00h00 et 07h00.',
    },
    startsAt: options.startsAt,
    estimatedDurationHours: options.maxEntries > 8 ? 3 : 2,
    controllerRestriction: options.controllerRestriction || ('touch' as const),
    deviceRestriction: options.deviceRestriction || ('phone' as const),
    entries,
    arbitersNeeded,
    arbiters:
      options.arbiters ||
      Array.from({ length: arbitersNeeded }, (_, index) => ({
        slot: (index + 1) as 1 | 2,
        matchesHandled: 0,
      })),
    payout: buildPayout(options.entryFee, entries.length, arbitersNeeded, teamSize),
    matches: [],
    mainRounds: 0,
    createdAt: now,
    updatedAt: now,
  } satisfies Tournament;
};

const buildSeedTournaments = (): Tournament[] => {
  const upcoming = createTournamentBase({
    id: 'T-MJ-SHIPMENT-SNIPER',
    name: 'Shipment Sniper Solo',
    format: '1VS1',
    maxEntries: 20,
    entryFee: 1,
    startsAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    entries: ['ShadowX', 'Nova', 'Titan', 'Blaze', 'Ghost', 'Mamba', 'Rogue'].map((pseudo, index) =>
      createEntry(pseudo, index, '1VS1')
    ),
    rules: {
      mode: 'FRONTLINE',
      mapPool: ['Shipment', 'Nuketown'],
      scoreTarget: 15,
      bestOf: 3,
      weaponRestrictions: 'Snipers uniquement',
      pointstreaks: 'restricted',
      meleeAllowed: false,
    },
  });

  const liveEntries = [
    'Phoenix',
    'Viper',
    'Ares',
    'Karma',
    'Zed',
    'Helix',
    'Saber',
    'Drift',
    'Onyx',
    'Riot',
    'Echo',
    'Vanta',
  ].map((pseudo, index) => createEntry(pseudo, index, '1VS1'));
  let live = createTournamentBase({
    id: 'T-MJ-RAID-CASH',
    name: 'Raid S&D Cash Cup',
    format: '1VS1',
    maxEntries: 16,
    entryFee: 1,
    startsAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    entries: liveEntries,
    arbiters: [
      { slot: 1, userId: 'arb-1', pseudo: 'Arbitre Prime', trustScore: 94, assignedAt: getNow(), matchesHandled: 3 },
      { slot: 2, userId: 'arb-2', pseudo: 'Arbitre Echo', trustScore: 91, assignedAt: getNow(), matchesHandled: 2 },
    ],
    rules: {
      mode: 'S&D',
      mapPool: ['Raid', 'Standoff', 'Crash'],
      scoreTarget: 7,
      bestOf: 1,
      weaponRestrictions: 'Reglement ZOYD officiel',
      pointstreaks: 'restricted',
      meleeAllowed: false,
    },
  });
  const liveBracket = buildBracket(live);
  live = {
    ...live,
    status: 'live',
    matches: liveBracket.matches,
    mainRounds: liveBracket.mainRounds,
    payout: buildPayout(live.entryFee, live.entries.length, live.arbitersNeeded, live.teamSize),
  };

  const liveReadyMatches = live.matches
    .filter((match) => match.status === 'ready' && match.bracketType === 'main')
    .slice(0, 4);

  liveReadyMatches.forEach((match, index) => {
    if (!match.entryAId || !match.entryBId) return;
    const winner = index % 2 === 0 ? match.entryAId : match.entryBId;
    live = advanceTournament(live, match.id, winner, winner === match.entryAId ? 7 : 5, winner === match.entryAId ? 5 : 7, 'Round 1 seed');
  });

  const historyEntries = ['Nyx', 'Milo', 'Rex', 'Sora', 'Jinx', 'Volt', 'Lux', 'Kiro'].map((pseudo, index) =>
    createEntry(pseudo, index, '1VS1')
  );
  let history = createTournamentBase({
    id: 'T-MJ-NUKETOWN-MAJOR',
    name: 'Nuketown Major Solo',
    format: '1VS1',
    maxEntries: 8,
    entryFee: 1,
    startsAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    entries: historyEntries,
    arbiters: [{ slot: 1, userId: 'arb-9', pseudo: 'Senior Ref', trustScore: 97, assignedAt: getNow(), matchesHandled: 7 }],
    rules: {
      mode: 'HARDPOINT',
      mapPool: ['Nuketown', 'Firing Range'],
      scoreTarget: 150,
      bestOf: 1,
      weaponRestrictions: 'Toutes armes permises',
      pointstreaks: 'restricted',
      meleeAllowed: true,
    },
  });
  const historyBracket = buildBracket(history);
  history = {
    ...history,
    status: 'live',
    matches: historyBracket.matches,
    mainRounds: historyBracket.mainRounds,
    payout: buildPayout(history.entryFee, history.entries.length, history.arbitersNeeded, history.teamSize),
  };

  while (history.status !== 'completed') {
    const nextMatch = history.matches.find((match) => match.status === 'ready');
    if (!nextMatch || !nextMatch.entryAId || !nextMatch.entryBId) break;
    history = advanceTournament(history, nextMatch.id, nextMatch.entryAId, 7, 4, 'Seed history resolution');
  }

  return [upcoming, live, history];
};

export const useTournamentStore = create<TournamentState>()(
  persist(
    (set, get) => {
      const notify = (
        type: 'system' | 'tournament_reminder' | 'result_ready',
        title: string,
        message: string,
        actionUrl?: string
      ) => {
        useNotificationStore.getState().addNotification({
          type,
          title,
          message,
          priority: type === 'result_ready' ? 'high' : 'normal',
          actionUrl,
        });
      };

      return {
        tournaments: [],
        filters: {
          format: 'all',
          status: 'all',
        },

        hydrateFromServer: (tournaments) => {
          set((state) => ({
            tournaments: mergeTournamentsByFreshness(state.tournaments, tournaments),
          }));
        },

        replaceFromServer: (tournaments) => {
          set(() => ({
            tournaments: normalizeTournamentCollection(tournaments),
          }));
        },

        setFilters: (partial) =>
          set((state) => ({
            filters: {
              ...state.filters,
              ...partial,
            },
          })),

        getFilteredTournaments: () => {
          const { tournaments, filters } = get();
          const currentUser = useAuthStore.getState().user;

          return tournaments.filter((tournament) => {
            if (currentUser) {
              const deviceAllowed =
                tournament.deviceRestriction === 'open' || tournament.deviceRestriction === currentUser.device;
              const controllerAllowed =
                tournament.controllerRestriction === 'open' || tournament.controllerRestriction === currentUser.controllerType;

              if (!deviceAllowed || !controllerAllowed) return false;
            }

            if (filters.format && filters.format !== 'all' && filters.format !== tournament.format) return false;
            if (filters.status && filters.status !== 'all' && filters.status !== tournament.status) return false;
            return true;
          });
        },

        getTournamentById: (id) => get().tournaments.find((tournament) => tournament.id === id),

        createTournament: (input) => {
          const tournamentId = `T-MJ-${Date.now().toString(36).toUpperCase()}`;
          const reserveCreatorAsArbiter = input.reserveCreatorAsArbiter !== false;
          const normalizedStart = normalizePlayableDate(new Date(input.startsAt || getNow())).toISOString();
          const arbitersNeeded = getArbitersNeeded(input.maxEntries);
          const arbiters = Array.from({ length: arbitersNeeded }, (_, index) => ({
            slot: (index + 1) as 1 | 2,
            userId: reserveCreatorAsArbiter && index === 0 ? input.creatorId : undefined,
            pseudo: reserveCreatorAsArbiter && index === 0 ? input.creatorPseudo : undefined,
            trustScore: reserveCreatorAsArbiter && index === 0 ? input.creatorTrustScore : undefined,
            assignedAt: reserveCreatorAsArbiter && index === 0 ? getNow() : undefined,
            matchesHandled: 0,
          }));

          const tournament = createTournamentBase({
            id: tournamentId,
            name: input.name,
            format: input.format,
            maxEntries: input.maxEntries,
            entryFee: input.entryFee,
            startsAt: normalizedStart,
            deviceRestriction: input.deviceRestriction || 'open',
            controllerRestriction: input.controllerRestriction || 'open',
            arbiters,
            rules: input.rules,
          });

          set((state) => ({
            tournaments: [tournament, ...state.tournaments],
          }));

          notify(
            'tournament_reminder',
            'Tournoi publie',
            reserveCreatorAsArbiter
              ? `${input.name} est maintenant visible. Ton slot arbitre principal est reserve.`
              : `${input.name} est maintenant visible dans le circuit MJ.`,
            `/mj/tournois/${tournamentId}`
          );

          return tournamentId;
        },

        registerForTournament: ({ tournamentId, userId, pseudo, rankMJ, squadName, teammates = [] }) => {
          const tournament = get().tournaments.find((entry) => entry.id === tournamentId);
          const currentUser = useAuthStore.getState().user;
          if (!tournament || !currentUser) return false;
          if (currentUser.id !== userId) return false;
          if (tournament.status !== 'recruiting') return false;
          if (tournament.entries.length >= tournament.maxEntries) return false;
          if (tournament.entries.some((entry) => entry.members.some((member) => member.userId === userId))) return false;
          if (tournament.arbiters.some((arbiter) => arbiter.userId === userId)) return false;
          const deviceAllowed =
            tournament.deviceRestriction === 'open' || currentUser.device === tournament.deviceRestriction;
          const controllerAllowed =
            tournament.controllerRestriction === 'open' ||
            currentUser.controllerType === tournament.controllerRestriction;
          if (!deviceAllowed || !controllerAllowed) {
            return false;
          }

          const normalizedCaptainPseudo = normalizeLabel(pseudo || currentUser.pseudo);
          const normalizedTeammates =
            tournament.teamSize === 1
              ? []
              : teammates.map((member) => ({
                  ...member,
                  pseudo: normalizeLabel(member.pseudo),
                }));

          if (normalizedCaptainPseudo.length < 2) return false;
          if (normalizedTeammates.length !== Math.max(0, tournament.teamSize - 1)) return false;
          if (normalizedTeammates.some((member) => member.pseudo.length < 2)) return false;

          const rosterPseudos = [normalizedCaptainPseudo, ...normalizedTeammates.map((member) => member.pseudo)];
          const rosterKeys = new Set<string>();
          for (const rosterPseudo of rosterPseudos) {
            const key = rosterPseudo.toLowerCase();
            if (rosterKeys.has(key)) return false;
            rosterKeys.add(key);
          }

          const existingPseudoKeys = new Set(
            tournament.entries.flatMap((entry) => entry.members.map((member) => member.pseudo.toLowerCase()))
          );
          if (rosterPseudos.some((memberPseudo) => existingPseudoKeys.has(memberPseudo.toLowerCase()))) {
            return false;
          }

          const nextSquadName =
            tournament.teamSize === 1
              ? normalizedCaptainPseudo
              : normalizeLabel(squadName || `${normalizedCaptainPseudo} Squad`);

          if (nextSquadName.length < 3) return false;
          if (
            tournament.entries.some(
              (entry) => entry.squadName.toLowerCase() === nextSquadName.toLowerCase()
            )
          ) {
            return false;
          }

          const lockAmount = getSquadLockAmount(tournament.entryFee, tournament.teamSize);
          const locked = useWalletStore.getState().deductEntryFee(lockAmount, tournament.id);
          if (!locked) return false;

          const nextEntry = createRegisteredEntry({
            format: tournament.format,
            seed: tournament.entries.length + 1,
            captainId: userId,
            captainPseudo: normalizedCaptainPseudo,
            captainRankMJ: rankMJ || currentUser.rankMJ,
            squadName: nextSquadName,
            teammates: normalizedTeammates,
            joinedAt: getNow(),
          });

          set((state) => ({
            tournaments: state.tournaments.map((entry) =>
              entry.id === tournamentId
                ? {
                    ...entry,
                    entries: [...entry.entries, nextEntry],
                    payout: buildPayout(
                      entry.entryFee,
                      entry.entries.length + 1,
                      entry.arbitersNeeded,
                      entry.teamSize
                    ),
                    updatedAt: getNow(),
                  }
                : entry
            ),
          }));

          notify(
            'tournament_reminder',
            'Inscription validee',
            tournament.teamSize === 1
              ? `Ton pass est maintenant bloque pour ${tournament.name}.`
              : `${nextEntry.squadName} est maintenant verrouillee sur ${tournament.name} pour ${lockAmount.toFixed(1)} ZC.`,
            `/mj/tournois/${tournament.id}`
          );
          return true;
        },

        leaveTournament: (tournamentId, userId) => {
          const tournament = get().tournaments.find((entry) => entry.id === tournamentId);
          if (!tournament || tournament.status !== 'recruiting') return;

          const removedEntry = tournament.entries.find((entry) =>
            entry.members.some((member) => member.userId === userId)
          );
          if (!removedEntry) return;

          set((state) => ({
            tournaments: state.tournaments.map((entry) =>
              entry.id === tournamentId
                ? {
                    ...entry,
                    entries: entry.entries
                      .filter((team) => !team.members.some((member) => member.userId === userId))
                      .map((team, index) => ({ ...team, seed: index + 1 })),
                    payout: buildPayout(
                      entry.entryFee,
                      entry.entries.length - 1,
                      entry.arbitersNeeded,
                      entry.teamSize
                    ),
                    updatedAt: getNow(),
                  }
                : entry
            ),
          }));

          if (useAuthStore.getState().user?.id === userId) {
            useWalletStore
              .getState()
              .unlockFunds(getSquadLockAmount(tournament.entryFee, removedEntry.teamSize), tournament.id);
          }
        },

        assignArbiter: (tournamentId, userId, pseudo, trustScore) => {
          const tournament = get().tournaments.find((entry) => entry.id === tournamentId);
          if (!tournament) return false;
          if (tournament.entries.some((entry) => entry.members.some((member) => member.userId === userId))) return false;
          if (tournament.arbiters.some((arbiter) => arbiter.userId === userId)) return false;
          const emptySlot = tournament.arbiters.find((arbiter) => !arbiter.userId);
          if (!emptySlot) return false;

          set((state) => ({
            tournaments: state.tournaments.map((entry) =>
              entry.id === tournamentId
                ? {
                    ...entry,
                    arbiters: entry.arbiters.map((arbiter) =>
                      arbiter.slot === emptySlot.slot
                        ? {
                            ...arbiter,
                            userId,
                            pseudo,
                            trustScore,
                            assignedAt: getNow(),
                          }
                        : arbiter
                    ),
                    updatedAt: getNow(),
                  }
                : entry
            ),
          }));

          notify(
            'system',
            'Slot arbitre reserve',
            `${pseudo} couvre maintenant le slot arbitre #${emptySlot.slot} sur ${tournament.name}.`,
            `/mj/tournois/${tournament.id}`
          );
          return true;
        },

        startTournament: (tournamentId) => {
          const tournament = get().tournaments.find((entry) => entry.id === tournamentId);
          if (!tournament) return false;
          if (tournament.status !== 'recruiting') return false;
          if (tournament.entries.length < tournament.minEntries) return false;
          if (tournament.arbiters.some((arbiter) => !arbiter.userId)) return false;

          const bracket = buildBracket(tournament);

          set((state) => ({
            tournaments: state.tournaments.map((entry) =>
              entry.id === tournamentId
                ? {
                    ...entry,
                    status: 'live',
                    matches: bracket.matches,
                    mainRounds: bracket.mainRounds,
                    updatedAt: getNow(),
                  }
                : entry
            ),
          }));

          notify(
            'tournament_reminder',
            'Bracket genere',
            `${tournament.name} passe en direct avec ${tournament.entries.length} inscrits confirmes.`,
            `/mj/tournois/${tournament.id}`
          );
          return true;
        },

        setMatchRoomDetails: (tournamentId, matchId, roomName, roomPassword) => {
          set((state) => ({
            tournaments: state.tournaments.map((tournament) =>
              tournament.id === tournamentId
                ? {
                    ...tournament,
                    matches: tournament.matches.map((match) =>
                      match.id === matchId
                        ? {
                            ...match,
                            roomName,
                            roomPassword,
                            updatedAt: getNow(),
                          }
                        : match
                    ),
                    updatedAt: getNow(),
                  }
                : tournament
            ),
          }));
        },

        setMatchLive: (tournamentId, matchId) => {
          set((state) => ({
            tournaments: state.tournaments.map((tournament) =>
              tournament.id === tournamentId
                ? {
                    ...tournament,
                    matches: tournament.matches.map((match) =>
                      match.id === matchId && match.status === 'ready'
                        ? {
                            ...match,
                            status: 'live',
                            updatedAt: getNow(),
                          }
                        : match
                    ),
                    updatedAt: getNow(),
                  }
                : tournament
            ),
          }));
        },

        submitMatchResult: (tournamentId, matchId, winnerEntryId, scoreA, scoreB, notes) => {
          const tournament = get().tournaments.find((entry) => entry.id === tournamentId);
          if (!tournament) return;

          const nextTournament = advanceTournament(tournament, matchId, winnerEntryId, scoreA, scoreB, notes);

          set((state) => ({
            tournaments: state.tournaments.map((entry) => (entry.id === tournamentId ? nextTournament : entry)),
          }));

          const winner = getEntryById(nextTournament, winnerEntryId);
          if (winner) {
            notify(
              nextTournament.status === 'completed' ? 'result_ready' : 'system',
              nextTournament.status === 'completed' ? 'Tournoi boucle' : 'Resultat de round valide',
              `${winner.squadName} avance dans ${nextTournament.name}.`,
              `/mj/tournois/${nextTournament.id}`
            );
          }

          if (nextTournament.status === 'completed') {
            settleLocalTournamentOutcome(nextTournament);
          }
        },
      };
    },
    {
      name: 'zoyd-tournament',
      version: 3,
      migrate: (persistedState: any) => {
        return {
          tournaments: [],
          filters: persistedState?.filters || {
            format: 'all',
            status: 'all',
          },
        };
      },
    }
  )
);
