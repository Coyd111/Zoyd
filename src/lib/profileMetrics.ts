import type { User, UserStats } from '../app/stores/authStore';
import { isMatchPayoutSettled, type Match, type MatchPlayer } from '../app/stores/matchStore';
import type { Tournament, TournamentEntry, TournamentEntryMember } from '../app/stores/tournamentStore';

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
  arbiterStats: {
    arbitratedMatches: number;
    totalCommissions: number;
  };
  recentMatches: Match[];
  tournamentPlacements: TournamentPlacement[];
  trust: TrustSummary;
}

const roundAmount = (value: number) => Math.round(value * 100) / 100;

const getWinnerPayout = (match: Match) => roundAmount(Math.max(0, match.prizePool - match.zoydFee - match.arbiterFee));

/**
 * Cible d'un profil dans un payload de match.
 *
 * Le serveur retire le `userId` de chaque joueur : on ne peut plus le comparer
 * à un identifiant de profil. Deux substituts existent, et un seul est valide
 * selon le cas :
 *  - `isOwnProfile: true` -> `player.isMe`, calculé par le serveur POUR le
 *    demandeur. Autoritaire, y compris si le joueur a changé de pseudo depuis
 *    le match (les matchs gardent l'ancien pseudo) ;
 *  - `isOwnProfile: false` -> `player.pseudo`, unique et présent à
 *    l'inscription. Seul moyen de rattacher un match à un profil tiers, sur
 *    lequel `isMe` vaudra `false` pour tout le monde.
 */
export interface MatchProfileTarget {
  isOwnProfile: boolean;
  pseudo: string;
}

export const findTargetPlayerInMatch = (match: Match, target: MatchProfileTarget) =>
  match.players.find((player) => (target.isOwnProfile ? player.isMe : player.pseudo === target.pseudo));

const isTargetArbiterInMatch = (match: Match, target: MatchProfileTarget) =>
  target.isOwnProfile ? match.arbiter?.isMe === true : match.arbiter?.pseudo === target.pseudo;

/**
 * Membre d'entrée de tournoi correspondant au profil ciblé.
 * Meme regle que `findTargetPlayerInMatch` : `isMe` sur son propre profil,
 * `pseudo` sur celui d'un tiers (le serveur retire le userId des membres).
 */
const findTargetPlayerInMember = (
  _entry: TournamentEntry,
  target: MatchProfileTarget,
  member: TournamentEntryMember
) => (target.isOwnProfile ? member.isMe === true : member.pseudo === target.pseudo);

export const getPlayerMatches = (target: MatchProfileTarget, matches: Match[]) =>
  matches.filter((match) => !!findTargetPlayerInMatch(match, target));

export const getObservedPlayerSnapshot = (target: MatchProfileTarget, matches: Match[]): MatchPlayer | undefined => {
  for (const match of matches) {
    const player = findTargetPlayerInMatch(match, target);
    if (player) return player;
  }
  return undefined;
};

/**
 * Palmarès en tournoi du profil ciblé.
 *
 * Même problème que pour les matchs : `sanitizeTournamentForBroadcast` retire
 * le `userId` des membres d'entrée, donc la comparaison par userId ne
 * meme couple `isMe` / `pseudo` que `findTargetPlayerInMatch`.
 */
export const getTournamentPlacements = (
  target: MatchProfileTarget,
  tournaments: Tournament[]
): TournamentPlacement[] =>
  tournaments
    // Annotation du retour du map : sans elle le type inféré est
    // `{...} | null` et le prédicat de filter plus bas est invalide (TS2677),
    // car TournamentPlacement.format (string) n'est pas assignable au
    // MatchFormat du littéral.
    .map((tournament): TournamentPlacement | null => {
      const entry = tournament.entries.find((candidate) =>
        candidate.members.some((member) => findTargetPlayerInMember(candidate, target, member))
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
    .filter((entry): entry is TournamentPlacement => entry !== null)
    .sort((a, b) => new Date(b.finishedAt || 0).getTime() - new Date(a.finishedAt || 0).getTime());

export const buildCompetitiveSummary = ({
  target,
  overallTrustScore,
  matches,
  tournaments,
  fallbackStats,
  dateJoined,
}: {
  /**
   * `userId` a ete retire : l'identite ne peut plus se lire dans le payload
   * d'un match (le serveur retire `userId` et ajoute `isMe`). `target` porte
   * toute l'information necessaire (`isOwnProfile` + `pseudo`).
   */
  target: MatchProfileTarget;
  overallTrustScore: number;
  matches: Match[];
  tournaments: Tournament[];
  fallbackStats?: UserStats;
  dateJoined?: string;
}): CompetitiveSummary => {
  const playerMatches = getPlayerMatches(target, matches);
  // Un résultat existe dès la soumission de l'arbitre, mais l'argent ne part
  // qu'à la confirmation des deux équipes : ne compter que les matchs dont la
  // cagnotte est effectivement distributed, sinon un match en attente s'ajoute
  // en victoire/défaite et en gains avant tout versement.
  const settledMatches = playerMatches.filter(isMatchPayoutSettled);
  const disputedMatches = playerMatches.filter(
    (match) => match.status === 'disputed' || match.disputes.length > 0
  );
  const forfeits = playerMatches.filter((match) => {
    const participant = findTargetPlayerInMatch(match, target);
    return !!participant && match.result?.resolutionType === 'forfeit' && match.result.forfeitTeam === participant.team;
  }).length;

  let arbitratedMatches = 0;
  let totalCommissions = 0;

  for (const match of matches) {
    if (isTargetArbiterInMatch(match, target) && (match.status === 'finished' || match.status === 'disputed') && match.result) {
      arbitratedMatches += 1;
      totalCommissions += match.arbiterFee;
    }
  }

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let matchEarnings = 0;

  for (const match of settledMatches) {
    const participant = findTargetPlayerInMatch(match, target);
    if (!participant || !match.result) continue;

    if (participant.team === match.result.winnerTeam) {
      wins += 1;
      matchEarnings += getWinnerPayout(match);
    } else {
      losses += 1;
    }
  }

  const tournamentPlacements = getTournamentPlacements(target, tournaments);
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
    // `elo` n'est pas dérivable des matchs (notation gérée par le serveur) :
    // sans ce repli, `stats.elo` valait undefined sur les profils dont le
    // compte n'a pas encore de stats persistées. `arbitratedMatches` en
    // revanche est calculé plus haut.
    elo: fallbackStats?.elo ?? 1200,
    arbitratedMatches,
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
    arbiterStats: {
      arbitratedMatches,
      totalCommissions: roundAmount(totalCommissions),
    },
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
  // `userId` retiré : le serveur ne l'envoie plus sur l'arbitre d'un match
  // (sanitizeMatchForBroadcast). Seuls `pseudo` et `trustScore` sont lus.
  observedArbiter?: { pseudo: string; trustScore: number };
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
