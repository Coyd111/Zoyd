import type { User, UserStats } from '../app/stores/authStore';
import type { Match, MatchPlayer } from '../app/stores/matchStore';
import type { Tournament } from '../app/stores/tournamentStore';

export interface TournamentPlacement {
  tournamentId: string;
  name: string;
  format: string;
  placement: number;
  payout: number;
  finishedAt?: string;
}

export interface TrustSummary {
  overall: number;
  completedMatches: number;
  disputedMatches: number;
  forfeits: number;
  memberSinceDate?: string;
  memberSinceDays?: number;
}

export interface CompetitiveSummary {
  stats: UserStats;
  recentMatches: Match[];
  tournamentPlacements: TournamentPlacement[];
  trust: TrustSummary;
}

const roundAmount = (value: number) => Math.round(value * 100) / 100;

const getWinnerPayout = (match: Match) => roundAmount(Math.max(0, match.prizePool - match.zoydFee - match.arbiterFee));

export const getPlayerMatches = (userId: string, matches: Match[]) =>
  matches.filter((match) => match.players.some((player) => player.userId === userId));

export const getObservedPlayerSnapshot = (userId: string, matches: Match[]): MatchPlayer | undefined => {
  for (const match of matches) {
    const player = match.players.find((entry) => entry.userId === userId);
    if (player) return player;
  }
  return undefined;
};

export const getTournamentPlacements = (userId: string, tournaments: Tournament[]): TournamentPlacement[] =>
  tournaments
    .map((tournament) => {
      const entry = tournament.entries.find((candidate) =>
        candidate.members.some((member) => member.userId === userId)
      );
      if (!entry?.finalPlacement) return null;

      const payout =
        entry.finalPlacement === 1
          ? tournament.payout.first
          : entry.finalPlacement === 2
            ? tournament.payout.second
            : entry.finalPlacement === 3
              ? tournament.payout.third
              : 0;

      return {
        tournamentId: tournament.id,
        name: tournament.name,
        format: tournament.format,
        placement: entry.finalPlacement,
        payout,
        finishedAt: tournament.finishedAt,
      };
    })
    .filter((entry): entry is TournamentPlacement => !!entry)
    .sort((a, b) => new Date(b.finishedAt || 0).getTime() - new Date(a.finishedAt || 0).getTime());

export const buildCompetitiveSummary = ({
  userId,
  overallTrustScore,
  matches,
  tournaments,
  fallbackStats,
  dateJoined,
}: {
  userId: string;
  overallTrustScore: number;
  matches: Match[];
  tournaments: Tournament[];
  fallbackStats?: UserStats;
  dateJoined?: string;
}): CompetitiveSummary => {
  const playerMatches = getPlayerMatches(userId, matches);
  const settledMatches = playerMatches.filter((match) => !!match.result);
  const disputedMatches = playerMatches.filter(
    (match) => match.status === 'disputed' || match.disputes.length > 0
  );
  const forfeits = playerMatches.filter((match) => {
    const participant = match.players.find((player) => player.userId === userId);
    return !!participant && match.result?.resolutionType === 'forfeit' && match.result.forfeitTeam === participant.team;
  }).length;

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let matchEarnings = 0;

  for (const match of settledMatches) {
    const participant = match.players.find((player) => player.userId === userId);
    if (!participant || !match.result) continue;

    if (participant.team === match.result.winnerTeam) {
      wins += 1;
      matchEarnings += getWinnerPayout(match);
    } else {
      losses += 1;
    }
  }

  const tournamentPlacements = getTournamentPlacements(userId, tournaments);
  const tournamentEarnings = tournamentPlacements.reduce((sum, placement) => sum + placement.payout, 0);
  const derivedStats: UserStats = {
    wins,
    losses,
    draws,
    totalMatches: wins + losses + draws,
    totalEarnings: roundAmount(matchEarnings + tournamentEarnings),
    winRate: wins + losses + draws > 0 ? Math.round((wins / (wins + losses + draws)) * 1000) / 10 : 0,
    tournamentsWon: tournamentPlacements.filter((placement) => placement.placement === 1).length,
    tournamentsPlayed: tournamentPlacements.length,
  };

  const stats = fallbackStats
    ? {
        ...fallbackStats,
        totalEarnings: Math.max(fallbackStats.totalEarnings, derivedStats.totalEarnings),
        tournamentsWon: Math.max(fallbackStats.tournamentsWon, derivedStats.tournamentsWon),
        tournamentsPlayed: Math.max(fallbackStats.tournamentsPlayed, derivedStats.tournamentsPlayed),
      }
    : derivedStats;

  const memberSinceDays = dateJoined
    ? Math.max(1, Math.floor((Date.now() - new Date(dateJoined).getTime()) / (1000 * 60 * 60 * 24)))
    : undefined;

  return {
    stats,
    recentMatches: [...playerMatches]
      .sort(
        (a, b) =>
          new Date(b.finishedAt || b.updatedAt || b.createdAt).getTime() -
          new Date(a.finishedAt || a.updatedAt || a.createdAt).getTime()
      )
      .slice(0, 10),
    tournamentPlacements: tournamentPlacements.slice(0, 6),
    trust: {
      overall: overallTrustScore,
      completedMatches: settledMatches.length,
      disputedMatches: disputedMatches.length,
      forfeits,
      memberSinceDate: dateJoined,
      memberSinceDays,
    },
  };
};

export const createPublicProfile = ({
  userId,
  currentUser,
  observedPlayer,
  observedArbiter,
  friendRecord,
}: {
  userId: string;
  currentUser?: User | null;
  observedPlayer?: MatchPlayer;
  observedArbiter?: { userId: string; pseudo: string; trustScore: number };
  friendRecord?: {
    pseudo: string;
    country: string;
    controllerType: string;
    trustScore: number;
    isStreamer: boolean;
    status: string;
  };
}) => {
  if (currentUser?.id === userId) {
    return {
      id: currentUser.id,
      pseudo: currentUser.pseudo,
      gameId: currentUser.gameId,
      country: currentUser.country,
      controllerType: currentUser.controllerType,
      rankMJ: currentUser.rankMJ,
      rankBR: currentUser.rankBR,
      levelCODM: currentUser.levelCODM,
      streamerMode: currentUser.streamerMode,
      streamerPseudo: currentUser.streamerPseudo,
      trustScore: currentUser.trustScore,
      bio: currentUser.bio,
      dateJoined: currentUser.dateJoined,
      isOnline: currentUser.isOnline,
    };
  }

  const pseudo = observedPlayer?.pseudo || observedArbiter?.pseudo || friendRecord?.pseudo;
  if (!pseudo) return null;

  return {
    id: userId,
    pseudo,
    gameId: undefined,
    country: friendRecord?.country,
    controllerType:
      observedPlayer?.controllerType ||
      (friendRecord?.controllerType as User['controllerType'] | undefined) ||
      undefined,
    rankMJ: observedPlayer?.rankMJ,
    rankBR: undefined,
    levelCODM: undefined,
    streamerMode: friendRecord?.isStreamer || false,
    streamerPseudo: undefined,
    trustScore: observedPlayer?.trustScore || observedArbiter?.trustScore || friendRecord?.trustScore || 60,
    bio: undefined,
    dateJoined: undefined,
    isOnline: friendRecord?.status === 'online' || friendRecord?.status === 'in_match' || false,
  };
};
