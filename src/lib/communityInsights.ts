import type { User } from '../app/stores/authStore';
import type { Friend, Report } from '../app/stores/friendsStore';
import type { Match } from '../app/stores/matchStore';
import type { Tournament, TournamentEntry } from '../app/stores/tournamentStore';
import type { Transaction } from '../app/stores/walletStore';

const roundAmount = (value: number) => Math.round(value * 100) / 100;

const countryCodeMap: Record<string, string> = {
  Benin: 'BJ',
  "Cote d'Ivoire": 'CI',
  Senegal: 'SN',
  Togo: 'TG',
  Cameroon: 'CM',
  Gabon: 'GA',
  RDC: 'CD',
  Nigeria: 'NG',
  Ghana: 'GH',
  Autre: '--',
};

const positiveEarningTypes = new Set<Transaction['type']>([
  'prize_win',
  'arbitration_fee',
  'bonus',
  'referral',
]);

const visibleTransactionTypes = new Set<Transaction['type']>([
  'prize_win',
  'arbitration_fee',
  'refund',
  'bonus',
  'referral',
]);

const normalizePseudo = (pseudo: string) =>
  pseudo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toDayKey = (date: Date | string) => {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

const startOfDay = (date: Date | string) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const isReportOpen = (report: Report) => report.status === 'pending';
const isDisputeOpen = (status?: string) => status === 'open' || status === 'under_review';

const getWinnerPayout = (match: Match) => roundAmount(Math.max(0, match.prizePool - match.zoydFee - match.arbiterFee));

const getTournamentPlacementPayout = (entry: TournamentEntry, tournament: Tournament) => {
  if (entry.finalPlacement === 1) return tournament.payout.first;
  if (entry.finalPlacement === 2) return tournament.payout.second;
  if (entry.finalPlacement === 3) return tournament.payout.third;
  return 0;
};

const getTrustTier = (trustScore?: number) => {
  if (typeof trustScore !== 'number') return 'unknown';
  if (trustScore >= 90) return 'elite';
  if (trustScore >= 75) return 'stable';
  if (trustScore >= 50) return 'watch';
  return 'critical';
};

const getNetCompetitiveAmount = (transaction: Transaction) => {
  if (transaction.status !== 'completed') return 0;

  if (transaction.type === 'deposit' || transaction.type === 'withdraw') {
    return 0;
  }

  if (transaction.type === 'match_loss') {
    const lockedAmount = Number(transaction.metadata?.lockedAmount || 0);
    return lockedAmount > 0 ? -lockedAmount : transaction.amount;
  }

  return transaction.amount;
};

const getPositiveEarningAmount = (transaction: Transaction) => {
  if (transaction.status !== 'completed') return 0;
  return positiveEarningTypes.has(transaction.type) ? Math.max(0, transaction.amount) : 0;
};

const getCountryCode = (country?: string) => {
  if (!country) return '--';
  return countryCodeMap[country] || country.slice(0, 2).toUpperCase();
};

const compareNumbers = (left: number, right: number) => right - left;

type MutablePlayer = {
  key: string;
  pseudo: string;
  userIds: Set<string>;
  primaryUserId?: string;
  hasPublicProfile: boolean;
  isMe: boolean;
  country?: string;
  controllerType?: User['controllerType'];
  device?: User['device'];
  rankMJ?: string;
  trustScore?: number;
  dateJoined?: string;
  isOnline?: boolean;
  wins: number;
  losses: number;
  draws: number;
  totalEarnings: number;
  tournamentsWon: number;
  tournamentsPlayed: number;
  matchActivity: Set<string>;
  tournamentActivity: Set<string>;
  disputedMatches: Set<string>;
  forfeitedMatches: Set<string>;
  reportsCount: number;
  metadataPriority: number;
};

const ensurePlayer = (
  registry: Map<string, MutablePlayer>,
  pseudo: string,
  details?: {
    userId?: string;
    hasPublicProfile?: boolean;
    isMe?: boolean;
    country?: string;
    controllerType?: User['controllerType'];
    device?: User['device'];
    rankMJ?: string;
    trustScore?: number;
    dateJoined?: string;
    isOnline?: boolean;
    priority?: number;
  }
) => {
  const key = normalizePseudo(pseudo || 'unknown-player');
  const current = registry.get(key);

  if (current) {
    if (details?.userId) {
      current.userIds.add(details.userId);
      current.primaryUserId = current.primaryUserId || details.userId;
    }
    current.hasPublicProfile = current.hasPublicProfile || !!details?.hasPublicProfile;
    current.isMe = current.isMe || !!details?.isMe;

    if ((details?.priority || 0) >= current.metadataPriority) {
      current.country = details?.country ?? current.country;
      current.controllerType = details?.controllerType ?? current.controllerType;
      current.device = details?.device ?? current.device;
      current.rankMJ = details?.rankMJ ?? current.rankMJ;
      current.trustScore = details?.trustScore ?? current.trustScore;
      current.dateJoined = details?.dateJoined ?? current.dateJoined;
      current.isOnline = details?.isOnline ?? current.isOnline;
      current.metadataPriority = details?.priority || current.metadataPriority;
    }

    return current;
  }

  const next: MutablePlayer = {
    key,
    pseudo,
    userIds: new Set(details?.userId ? [details.userId] : []),
    primaryUserId: details?.userId,
    hasPublicProfile: !!details?.hasPublicProfile,
    isMe: !!details?.isMe,
    country: details?.country,
    controllerType: details?.controllerType,
    device: details?.device,
    rankMJ: details?.rankMJ,
    trustScore: details?.trustScore,
    dateJoined: details?.dateJoined,
    isOnline: details?.isOnline,
    wins: 0,
    losses: 0,
    draws: 0,
    totalEarnings: 0,
    tournamentsWon: 0,
    tournamentsPlayed: 0,
    matchActivity: new Set<string>(),
    tournamentActivity: new Set<string>(),
    disputedMatches: new Set<string>(),
    forfeitedMatches: new Set<string>(),
    reportsCount: 0,
    metadataPriority: details?.priority || 0,
  };

  registry.set(key, next);
  return next;
};

export interface CommunityPlayer {
  key: string;
  pseudo: string;
  primaryUserId?: string;
  hasPublicProfile: boolean;
  isMe: boolean;
  country?: string;
  countryCode: string;
  controllerType?: User['controllerType'];
  device?: User['device'];
  rankMJ?: string;
  trustScore?: number;
  dateJoined?: string;
  isOnline?: boolean;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  totalEarnings: number;
  winRate: number;
  tournamentsWon: number;
  tournamentsPlayed: number;
  activityCount: number;
  disputedMatches: number;
  forfeits: number;
  reportsCount: number;
  trustTier: 'unknown' | 'elite' | 'stable' | 'watch' | 'critical';
}

export interface TeamRanking {
  key: string;
  squadName: string;
  captainPseudo: string;
  countryCode: string;
  members: number;
  wins: number;
  losses: number;
  winRate: number;
  earnings: number;
  averageTrust?: number;
}

export interface CountryRanking {
  key: string;
  country: string;
  countryCode: string;
  playersCount: number;
  wins: number;
  winRate: number;
  earnings: number;
  averageTrust?: number;
}

export interface ControllerRanking {
  key: string;
  controllerType: string;
  playersCount: number;
  wins: number;
  winRate: number;
  earnings: number;
  averageTrust?: number;
}

export interface ModerationEvent {
  id: string;
  action: string;
  target: string;
  timestamp: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface FlaggedUser {
  key: string;
  pseudo: string;
  primaryUserId?: string;
  hasPublicProfile: boolean;
  trustScore?: number;
  reportsCount: number;
  disputedMatches: number;
  forfeits: number;
  activityCount: number;
  status: 'critical' | 'watch' | 'clean';
}

export interface WalletTrendPoint {
  day: string;
  label: string;
  amount: number;
  delta: number;
}

export interface WalletInsights {
  trend: WalletTrendPoint[];
  currentPeriodEarnings: number;
  previousPeriodEarnings: number;
  currentPeriodNet: number;
  previousPeriodNet: number;
  recentTransactions: Transaction[];
}

export const buildCommunityPlayers = ({
  currentUser,
  friends,
  reports,
  matches,
  tournaments,
}: {
  currentUser?: User | null;
  friends: Friend[];
  reports: Report[];
  matches: Match[];
  tournaments: Tournament[];
}): CommunityPlayer[] => {
  const registry = new Map<string, MutablePlayer>();

  if (currentUser) {
    const current = ensurePlayer(registry, currentUser.pseudo, {
      userId: currentUser.id,
      hasPublicProfile: true,
      isMe: true,
      country: currentUser.country,
      controllerType: currentUser.controllerType,
      device: currentUser.device,
      rankMJ: currentUser.rankMJ,
      trustScore: currentUser.trustScore,
      dateJoined: currentUser.dateJoined,
      isOnline: currentUser.isOnline,
      priority: 5,
    });

    current.wins = Math.max(current.wins, currentUser.stats.wins);
    current.losses = Math.max(current.losses, currentUser.stats.losses);
    current.draws = Math.max(current.draws, currentUser.stats.draws);
    current.totalEarnings = Math.max(current.totalEarnings, currentUser.stats.totalEarnings);
    current.tournamentsWon = Math.max(current.tournamentsWon, currentUser.stats.tournamentsWon);
    current.tournamentsPlayed = Math.max(current.tournamentsPlayed, currentUser.stats.tournamentsPlayed);
  }

  for (const friend of friends) {
    ensurePlayer(registry, friend.pseudo, {
      userId: friend.id,
      hasPublicProfile: true,
      country: friend.country,
      controllerType: friend.controllerType as User['controllerType'],
      trustScore: friend.trustScore,
      isOnline: friend.status === 'online' || friend.status === 'in_match' || friend.status === 'in_lobby',
      priority: 4,
    });
  }

  for (const match of matches) {
    for (const player of match.players) {
      const record = ensurePlayer(registry, player.pseudo, {
        userId: player.userId,
        hasPublicProfile: true,
        controllerType: player.controllerType,
        device: player.device,
        rankMJ: player.rankMJ,
        trustScore: player.trustScore,
        priority: 3,
      });

      record.matchActivity.add(match.id);

      if (match.disputes.some((dispute) => isDisputeOpen(dispute.status)) || match.status === 'disputed') {
        record.disputedMatches.add(match.id);
      }

      if (match.result) {
        if (match.result.resolutionType === 'forfeit' && match.result.forfeitTeam === player.team) {
          record.forfeitedMatches.add(match.id);
        }

        if (player.team === match.result.winnerTeam) {
          record.wins += 1;
          record.totalEarnings = roundAmount(record.totalEarnings + getWinnerPayout(match));
        } else {
          record.losses += 1;
        }
      }
    }
  }

  for (const tournament of tournaments) {
    for (const entry of tournament.entries) {
      const payout = getTournamentPlacementPayout(entry, tournament);

      for (const member of entry.members) {
        const record = ensurePlayer(registry, member.pseudo, {
          userId: member.userId,
          rankMJ: member.rankMJ,
          priority: 2,
        });

        record.tournamentActivity.add(tournament.id);
        record.wins += entry.wins;
        record.losses += entry.losses;
        record.totalEarnings = roundAmount(record.totalEarnings + payout);
        record.tournamentsPlayed += 1;

        if (entry.finalPlacement === 1) {
          record.tournamentsWon += 1;
        }
      }
    }
  }

  for (const report of reports) {
    const existing = [...registry.values()].find((player) => player.userIds.has(report.targetId));

    if (existing) {
      existing.reportsCount += 1;
      continue;
    }

    const placeholder = ensurePlayer(registry, report.targetId, {
      userId: report.targetId,
      hasPublicProfile: false,
      priority: 1,
    });
    placeholder.reportsCount += 1;
  }

  return [...registry.values()]
    .map((player) => {
      const totalMatches = player.wins + player.losses + player.draws;
      const activityCount = player.matchActivity.size + player.tournamentActivity.size;

      return {
        key: player.key,
        pseudo: player.pseudo,
        primaryUserId: player.primaryUserId,
        hasPublicProfile: player.hasPublicProfile,
        isMe: player.isMe,
        country: player.country,
        countryCode: getCountryCode(player.country),
        controllerType: player.controllerType,
        device: player.device,
        rankMJ: player.rankMJ,
        trustScore: player.trustScore,
        dateJoined: player.dateJoined,
        isOnline: player.isOnline,
        wins: player.wins,
        losses: player.losses,
        draws: player.draws,
        totalMatches,
        totalEarnings: roundAmount(player.totalEarnings),
        winRate: totalMatches > 0 ? Math.round((player.wins / totalMatches) * 1000) / 10 : 0,
        tournamentsWon: player.tournamentsWon,
        tournamentsPlayed: player.tournamentsPlayed,
        activityCount,
        disputedMatches: player.disputedMatches.size,
        forfeits: player.forfeitedMatches.size,
        reportsCount: player.reportsCount,
        trustTier: getTrustTier(player.trustScore),
      } satisfies CommunityPlayer;
    })
    .sort((left, right) => compareNumbers(left.totalEarnings, right.totalEarnings) || compareNumbers(left.wins, right.wins));
};

export const buildTeamRankings = (players: CommunityPlayer[], tournaments: Tournament[]): TeamRanking[] => {
  const playerIndex = new Map(players.map((player) => [normalizePseudo(player.pseudo), player]));

  return tournaments
    .flatMap((tournament) =>
      tournament.entries
        .filter((entry) => entry.teamSize > 1 || entry.members.length > 1)
        .map((entry) => {
          const trusts = entry.members
            .map((member) => playerIndex.get(normalizePseudo(member.pseudo))?.trustScore)
            .filter((value): value is number => typeof value === 'number');
          const leaderCountry = playerIndex.get(normalizePseudo(entry.captainPseudo))?.countryCode || '--';
          const wins = entry.wins;
          const losses = entry.losses;
          const totalMatches = wins + losses;

          return {
            key: `${tournament.id}-${entry.id}`,
            squadName: entry.squadName,
            captainPseudo: entry.captainPseudo,
            countryCode: leaderCountry,
            members: entry.members.length,
            wins,
            losses,
            winRate: totalMatches > 0 ? Math.round((wins / totalMatches) * 1000) / 10 : 0,
            earnings: roundAmount(getTournamentPlacementPayout(entry, tournament)),
            averageTrust: trusts.length > 0 ? Math.round((trusts.reduce((sum, value) => sum + value, 0) / trusts.length) * 10) / 10 : undefined,
          } satisfies TeamRanking;
        })
    )
    .sort((left, right) => compareNumbers(left.earnings, right.earnings) || compareNumbers(left.wins, right.wins));
};

export const buildCountryRankings = (players: CommunityPlayer[]): CountryRanking[] => {
  const groups = new Map<string, CommunityPlayer[]>();

  for (const player of players) {
    if (!player.country) continue;
    const current = groups.get(player.country) || [];
    current.push(player);
    groups.set(player.country, current);
  }

  return [...groups.entries()]
    .map(([country, members]) => {
      const totalMatches = members.reduce((sum, member) => sum + member.totalMatches, 0);
      const trustValues = members
        .map((member) => member.trustScore)
        .filter((value): value is number => typeof value === 'number');

      return {
        key: normalizePseudo(country),
        country,
        countryCode: getCountryCode(country),
        playersCount: members.length,
        wins: members.reduce((sum, member) => sum + member.wins, 0),
        winRate: totalMatches > 0 ? Math.round((members.reduce((sum, member) => sum + member.wins, 0) / totalMatches) * 1000) / 10 : 0,
        earnings: roundAmount(members.reduce((sum, member) => sum + member.totalEarnings, 0)),
        averageTrust: trustValues.length > 0 ? Math.round((trustValues.reduce((sum, value) => sum + value, 0) / trustValues.length) * 10) / 10 : undefined,
      } satisfies CountryRanking;
    })
    .sort((left, right) => compareNumbers(left.earnings, right.earnings) || compareNumbers(left.wins, right.wins));
};

export const buildControllerRankings = (players: CommunityPlayer[]): ControllerRanking[] => {
  const groups = new Map<string, CommunityPlayer[]>();

  for (const player of players) {
    if (!player.controllerType) continue;
    const current = groups.get(player.controllerType) || [];
    current.push(player);
    groups.set(player.controllerType, current);
  }

  return [...groups.entries()]
    .map(([controllerType, members]) => {
      const totalMatches = members.reduce((sum, member) => sum + member.totalMatches, 0);
      const trustValues = members
        .map((member) => member.trustScore)
        .filter((value): value is number => typeof value === 'number');

      return {
        key: controllerType,
        controllerType,
        playersCount: members.length,
        wins: members.reduce((sum, member) => sum + member.wins, 0),
        winRate: totalMatches > 0 ? Math.round((members.reduce((sum, member) => sum + member.wins, 0) / totalMatches) * 1000) / 10 : 0,
        earnings: roundAmount(members.reduce((sum, member) => sum + member.totalEarnings, 0)),
        averageTrust: trustValues.length > 0 ? Math.round((trustValues.reduce((sum, value) => sum + value, 0) / trustValues.length) * 10) / 10 : undefined,
      } satisfies ControllerRanking;
    })
    .sort((left, right) => compareNumbers(left.earnings, right.earnings) || compareNumbers(left.wins, right.wins));
};

export const buildAdminInsights = ({
  players,
  matches,
  reports,
}: {
  players: CommunityPlayer[];
  matches: Match[];
  reports: Report[];
}) => {
  const playerIndex = new Map<string, CommunityPlayer>();
  for (const player of players) {
    if (player.primaryUserId) {
      playerIndex.set(player.primaryUserId, player);
    }
    playerIndex.set(player.key, player);
  }

  const openDisputes = [...matches]
    .filter((match) => match.disputes.some((dispute) => isDisputeOpen(dispute.status)) || match.status === 'disputed')
    .sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
    );

  const operationalMatches = matches.filter((match) => !['finished', 'cancelled', 'forfeited'].includes(match.status));

  const recentEvents: ModerationEvent[] = [
    ...reports.map((report) => ({
      id: report.id,
      action: isReportOpen(report) ? 'Signalement recu' : 'Signalement traite',
      target: playerIndex.get(report.targetId)?.pseudo || report.targetId,
      timestamp: report.timestamp,
      tone: isReportOpen(report) ? 'warning' : 'neutral',
    })),
    ...matches.flatMap((match) =>
      match.disputes.flatMap((dispute) => {
        const events: ModerationEvent[] = [
          {
            id: `${dispute.id}-open`,
            action: 'Litige ouvert',
            target: match.id,
            timestamp: dispute.openedAt || dispute.createdAt,
            tone: 'danger',
          },
        ];

        if (dispute.resolvedAt) {
          events.push({
            id: `${dispute.id}-resolved`,
            action: 'Litige resolu',
            target: match.id,
            timestamp: dispute.resolvedAt,
            tone: 'success',
          });
        }

        return events;
      })
    ),
    ...matches
      .filter((match) => match.status === 'cancelled' && match.finishedAt)
      .map((match) => ({
        id: `${match.id}-cancelled`,
        action: 'Match annule',
        target: match.id,
        timestamp: match.finishedAt || match.updatedAt,
        tone: 'warning',
      })),
    ...matches
      .filter((match) => match.result && match.finishedAt)
      .map((match) => ({
        id: `${match.id}-finished`,
        action: 'Resultat valide',
        target: match.id,
        timestamp: match.finishedAt || match.updatedAt,
        tone: 'success',
      })),
  ]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 10);

  const flaggedUsers = players
    .filter(
      (player) =>
        player.reportsCount > 0 || player.disputedMatches > 0 || player.forfeits > 0 || (player.trustScore ?? 100) < 80
    )
    .map((player) => {
      const critical = player.reportsCount >= 2 || player.disputedMatches >= 2 || (player.trustScore ?? 100) < 50 || player.forfeits > 0;
      const watch = critical || player.reportsCount >= 1 || player.disputedMatches >= 1 || (player.trustScore ?? 100) < 80;

      return {
        key: player.key,
        pseudo: player.pseudo,
        primaryUserId: player.primaryUserId,
        hasPublicProfile: player.hasPublicProfile,
        trustScore: player.trustScore,
        reportsCount: player.reportsCount,
        disputedMatches: player.disputedMatches,
        forfeits: player.forfeits,
        activityCount: player.activityCount,
        status: critical ? 'critical' : watch ? 'watch' : 'clean',
      } satisfies FlaggedUser;
    })
    .sort((left, right) => {
      const severityOrder = { critical: 2, watch: 1, clean: 0 };
      return (
        severityOrder[right.status] - severityOrder[left.status] ||
        compareNumbers(left.reportsCount, right.reportsCount) ||
        compareNumbers(left.disputedMatches, right.disputedMatches) ||
        compareNumbers(left.forfeits, right.forfeits)
      );
    });

  return {
    openDisputes,
    operationalMatches,
    totalPrizePool: roundAmount(matches.reduce((sum, match) => sum + match.prizePool, 0)),
    totalFees: roundAmount(matches.reduce((sum, match) => sum + match.zoydFee, 0)),
    recentEvents,
    flaggedUsers,
  };
};

export const buildWalletInsights = (transactions: Transaction[], days = 30): WalletInsights => {
  const today = startOfDay(new Date());
  const periodStart = shiftDays(today, -(days - 1));
  const previousStart = shiftDays(periodStart, -days);

  const completedTransactions = transactions.filter((transaction) => transaction.status === 'completed');

  const currentPeriodTransactions = completedTransactions.filter((transaction) => {
    const timestamp = new Date(transaction.timestamp).getTime();
    return timestamp >= periodStart.getTime() && timestamp <= shiftDays(today, 1).getTime();
  });

  const previousPeriodTransactions = completedTransactions.filter((transaction) => {
    const timestamp = new Date(transaction.timestamp).getTime();
    return timestamp >= previousStart.getTime() && timestamp < periodStart.getTime();
  });

  const currentPeriodEarnings = roundAmount(
    currentPeriodTransactions.reduce((sum, transaction) => sum + getPositiveEarningAmount(transaction), 0)
  );
  const previousPeriodEarnings = roundAmount(
    previousPeriodTransactions.reduce((sum, transaction) => sum + getPositiveEarningAmount(transaction), 0)
  );
  const currentPeriodNet = roundAmount(
    currentPeriodTransactions.reduce((sum, transaction) => sum + getNetCompetitiveAmount(transaction), 0)
  );
  const previousPeriodNet = roundAmount(
    previousPeriodTransactions.reduce((sum, transaction) => sum + getNetCompetitiveAmount(transaction), 0)
  );

  const dailyDeltas = new Map<string, number>();
  for (const transaction of currentPeriodTransactions) {
    const dayKey = toDayKey(transaction.timestamp);
    dailyDeltas.set(dayKey, roundAmount((dailyDeltas.get(dayKey) || 0) + getNetCompetitiveAmount(transaction)));
  }

  let runningAmount = 0;
  const trend: WalletTrendPoint[] = [];

  for (let index = 0; index < days; index += 1) {
    const day = shiftDays(periodStart, index);
    const dayKey = toDayKey(day);
    const delta = dailyDeltas.get(dayKey) || 0;
    runningAmount = roundAmount(runningAmount + delta);

    trend.push({
      day: String(day.getDate()).padStart(2, '0'),
      label: `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`,
      amount: runningAmount,
      delta,
    });
  }

  return {
    trend,
    currentPeriodEarnings,
    previousPeriodEarnings,
    currentPeriodNet,
    previousPeriodNet,
    recentTransactions: completedTransactions
      .filter((transaction) => visibleTransactionTypes.has(transaction.type))
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 6),
  };
};
