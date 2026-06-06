import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Trophy, TrendingUp, Users, Flag, Gamepad2, Crown, Medal, Target } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import {
  buildCommunityPlayers,
  buildControllerRankings,
  buildCountryRankings,
  buildTeamRankings,
} from '../../lib/communityInsights';
import { formatZC } from '../../lib/utils';

type RankingTab = 'earnings' | 'winrate' | 'activity' | 'teams' | 'country' | 'controller';

interface RankingRow {
  key: string;
  rank: number;
  label: string;
  href?: string;
  countryCode: string;
  detail: string;
  value: number;
  rate: number;
  earnings: number;
  trust?: number;
  isMe?: boolean;
}

const tabs: { id: RankingTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'earnings', label: 'TOP GAINS', icon: Trophy },
  { id: 'winrate', label: 'VICTOIRES', icon: Target },
  { id: 'activity', label: 'ACTIVITE', icon: TrendingUp },
  { id: 'teams', label: 'EQUIPES', icon: Users },
  { id: 'country', label: 'PAR PAYS', icon: Flag },
  { id: 'controller', label: 'PAR CONTROLE', icon: Gamepad2 },
];

const tabColumns: Record<
  RankingTab,
  { primary: string; detail: string; value: string; rate: string; trust: string }
> = {
  earnings: { primary: 'JOUEUR', detail: 'SETUP', value: 'V', rate: 'WR%', trust: 'FIAB.' },
  winrate: { primary: 'JOUEUR', detail: 'SETUP', value: 'V', rate: 'WR%', trust: 'FIAB.' },
  activity: { primary: 'JOUEUR', detail: 'ACTIVITE', value: 'MATCHS', rate: 'WR%', trust: 'FIAB.' },
  teams: { primary: 'EQUIPE', detail: 'EFFECTIF', value: 'V', rate: 'WR%', trust: 'FIAB.' },
  country: { primary: 'ZONE', detail: 'VOLUME', value: 'V', rate: 'WR%', trust: 'FIAB.' },
  controller: { primary: 'SETUP', detail: 'VOLUME', value: 'V', rate: 'WR%', trust: 'FIAB.' },
};

const rankIcon = (rank: number) => {
  if (rank === 1) return <Crown className="w-5 h-5 text-zoyd-yellow" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-white/60" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />;
  return <span className="text-sm font-display font-black text-white/20 w-5 text-center">{rank}</span>;
};

const sortWithRank = <T,>(items: T[], sorter: (left: T, right: T) => number) =>
  [...items].sort(sorter).map((item, index) => ({ item, rank: index + 1 }));

const ClassementsPage: React.FC = () => {
  const { user } = useAuthStore();
  const { friends, reports } = useFriendsStore();
  const { matches } = useMatchStore();
  const { tournaments } = useTournamentStore();
  const [activeTab, setActiveTab] = useState<RankingTab>('earnings');

  const players = useMemo(
    () =>
      buildCommunityPlayers({
        currentUser: user,
        friends,
        reports,
        matches,
        tournaments,
      }),
    [friends, matches, reports, tournaments, user]
  );

  const teamRankings = useMemo(() => buildTeamRankings(players, tournaments), [players, tournaments]);
  const countryRankings = useMemo(() => buildCountryRankings(players), [players]);
  const controllerRankings = useMemo(() => buildControllerRankings(players), [players]);

  const rowsByTab = useMemo(() => {
    const indexedPlayers = players.filter(
      (player) => player.activityCount > 0 || player.totalEarnings > 0 || player.totalMatches > 0 || player.isMe
    );

    const earnings = sortWithRank(
      indexedPlayers,
      (left, right) =>
        right.totalEarnings - left.totalEarnings ||
        right.wins - left.wins ||
        (right.trustScore ?? 0) - (left.trustScore ?? 0)
    ).map(({ item, rank }) => ({
      key: `${item.key}-earnings`,
      rank,
      label: item.pseudo,
      href: item.hasPublicProfile && item.primaryUserId ? `/profil/${item.primaryUserId}` : undefined,
      countryCode: item.countryCode,
      detail: item.controllerType || item.rankMJ || '--',
      value: item.wins,
      rate: item.winRate,
      earnings: item.totalEarnings,
      trust: item.trustScore,
      isMe: item.isMe,
    } satisfies RankingRow));

    const winrate = sortWithRank(
      indexedPlayers.filter((player) => player.totalMatches > 0),
      (left, right) =>
        right.winRate - left.winRate || right.totalMatches - left.totalMatches || right.totalEarnings - left.totalEarnings
    ).map(({ item, rank }) => ({
      key: `${item.key}-winrate`,
      rank,
      label: item.pseudo,
      href: item.hasPublicProfile && item.primaryUserId ? `/profil/${item.primaryUserId}` : undefined,
      countryCode: item.countryCode,
      detail: item.controllerType || item.rankMJ || '--',
      value: item.wins,
      rate: item.winRate,
      earnings: item.totalEarnings,
      trust: item.trustScore,
      isMe: item.isMe,
    } satisfies RankingRow));

    const activity = sortWithRank(
      indexedPlayers.filter((player) => player.activityCount > 0),
      (left, right) =>
        right.activityCount - left.activityCount || right.totalMatches - left.totalMatches || right.totalEarnings - left.totalEarnings
    ).map(({ item, rank }) => ({
      key: `${item.key}-activity`,
      rank,
      label: item.pseudo,
      href: item.hasPublicProfile && item.primaryUserId ? `/profil/${item.primaryUserId}` : undefined,
      countryCode: item.countryCode,
      detail: `${item.activityCount} sessions`,
      value: item.totalMatches,
      rate: item.winRate,
      earnings: item.totalEarnings,
      trust: item.trustScore,
      isMe: item.isMe,
    } satisfies RankingRow));

    const teams = sortWithRank(
      teamRankings,
      (left, right) => right.earnings - left.earnings || right.wins - left.wins || right.winRate - left.winRate
    ).map(({ item, rank }) => ({
      key: `${item.key}-teams`,
      rank,
      label: item.squadName,
      countryCode: item.countryCode,
      detail: `${item.members} joueurs`,
      value: item.wins,
      rate: item.winRate,
      earnings: item.earnings,
      trust: item.averageTrust,
    } satisfies RankingRow));

    const countries = sortWithRank(
      countryRankings,
      (left, right) => right.earnings - left.earnings || right.wins - left.wins || right.playersCount - left.playersCount
    ).map(({ item, rank }) => ({
      key: `${item.key}-country`,
      rank,
      label: item.country,
      countryCode: item.countryCode,
      detail: `${item.playersCount} joueurs`,
      value: item.wins,
      rate: item.winRate,
      earnings: item.earnings,
      trust: item.averageTrust,
    } satisfies RankingRow));

    const controllers = sortWithRank(
      controllerRankings,
      (left, right) => right.earnings - left.earnings || right.wins - left.wins || right.playersCount - left.playersCount
    ).map(({ item, rank }) => ({
      key: `${item.key}-controller`,
      rank,
      label: item.controllerType,
      countryCode: '--',
      detail: `${item.playersCount} joueurs`,
      value: item.wins,
      rate: item.winRate,
      earnings: item.earnings,
      trust: item.averageTrust,
    } satisfies RankingRow));

    return {
      earnings,
      winrate,
      activity,
      teams,
      country: countries,
      controller: controllers,
    } satisfies Record<RankingTab, RankingRow[]>;
  }, [controllerRankings, countryRankings, players, teamRankings]);

  const entries = rowsByTab[activeTab];
  const activeColumns = tabColumns[activeTab];
  const myRank = rowsByTab.earnings.find((entry) => entry.isMe)?.rank;
  const topPercent =
    myRank && rowsByTab.earnings.length > 0
      ? Math.max(1, Math.round((myRank / rowsByTab.earnings.length) * 100))
      : undefined;

  return (
    <div className="min-h-screen bg-zoyd-black text-white scanline pb-24">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-black overflow-hidden pt-16">
        <div className="absolute inset-0 z-0">
          <img src="/assets/illustrations/ranked_arena.jpg" alt="Ranked Arena" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale" />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent" />
        </div>
        <div className="relative z-10 max-w-[1400px] mx-auto px-8 pb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
              <Trophy className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
              Classements joueurs
            </span>
          </div>
          <h1 className="text-5xl md:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9]">
            Les
            <br />
            <span className="text-white/20 underline decoration-zoyd-yellow/50 underline-offset-8">
              meilleurs
            </span>
          </h1>
          <p className="mt-5 max-w-3xl text-sm text-white/40">
            Ces classements bougent avec les matchs et tournois deja joues sur ZOYD. Rien n&apos;est affiche tant
            que l&apos;activite n&apos;existe pas encore.
          </p>
          {user && myRank ? (
            <div className="mt-6 flex flex-wrap items-center gap-6 text-sm font-mono text-white/40 uppercase tracking-widest">
              <span>
                Ton rang: <span className="text-zoyd-yellow font-display font-black text-lg italic">#{myRank}</span>
              </span>
              {topPercent ? (
                <span>
                  Top <span className="text-white">{topPercent}%</span>
                </span>
              ) : null}
              <span>
                Zone: <span className="text-white">{user.country}</span>
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-8 py-12 relative z-10">
        <div className="flex flex-wrap gap-2 mb-12 border-b border-white/5 pb-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 font-display font-black text-[10px] tracking-[0.15em] italic uppercase transition-all border ${
                  isActive
                    ? 'bg-white text-black border-white'
                    : 'text-white/30 border-white/5 hover:border-white/20 hover:text-white/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {entries.length === 0 ? (
          <div className="border border-white/5 bg-zoyd-surface/10 p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-white/10 text-white/20">
              <Users className="w-6 h-6" />
            </div>
            <h2 className="font-display font-black text-xl uppercase italic text-white mb-2">
              Aucun classement pour le moment
            </h2>
            <p className="text-sm text-white/35 max-w-xl mx-auto">
              Cette vue se remplira des que suffisamment de matchs, d&apos;equipes ou de joueurs auront ete vus par ZOYD.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-[9px] font-mono font-black uppercase tracking-widest text-white/20 italic">
              <div className="col-span-1">RANK</div>
              <div className="col-span-3">{activeColumns.primary}</div>
              <div className="col-span-1 text-center">PAYS</div>
              <div className="col-span-2">{activeColumns.detail}</div>
              <div className="col-span-1 text-right">{activeColumns.value}</div>
              <div className="col-span-1 text-right">{activeColumns.rate}</div>
              <div className="col-span-2 text-right">GAINS</div>
              <div className="col-span-1 text-right">{activeColumns.trust}</div>
            </div>

            {entries.map((entry, index) => {
              const content = (
                <>
                  <div className="col-span-1 flex items-center">{rankIcon(entry.rank)}</div>
                  <div className="col-span-3 flex items-center gap-3">
                    <div className="w-8 h-8 border border-white/10 flex items-center justify-center font-display font-black text-white text-xs bg-black">
                      {entry.label.slice(0, 2).toUpperCase()}
                    </div>
                      <div>
                        <div className="font-display font-black text-white text-sm uppercase italic">{entry.label}</div>
                        {entry.isMe ? <div className="text-[8px] font-mono text-zoyd-yellow uppercase">TOI</div> : null}
                      </div>
                    </div>
                  <div className="col-span-1 text-center font-display font-black text-white/40 text-xs">{entry.countryCode}</div>
                  <div className="col-span-2 text-[10px] font-mono text-white/30 uppercase">{entry.detail}</div>
                  <div className="col-span-1 text-right font-display font-black text-white text-sm">{entry.value}</div>
                  <div className="col-span-1 text-right font-display font-black text-zoyd-blue text-sm">{entry.rate}%</div>
                  <div className="col-span-2 text-right font-display font-black text-zoyd-yellow text-sm italic">
                    {formatZC(entry.earnings)}
                  </div>
                  <div className="col-span-1 text-right">
                    <span
                      className={`text-[10px] font-mono font-black ${
                        typeof entry.trust === 'number'
                          ? entry.trust >= 90
                            ? 'text-green-400'
                            : entry.trust >= 70
                              ? 'text-white/60'
                              : 'text-red-300'
                          : 'text-white/20'
                      }`}
                    >
                      {typeof entry.trust === 'number' ? entry.trust : '--'}
                    </span>
                  </div>
                </>
              );

              return (
                <motion.div
                  key={entry.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className={`border transition-all ${
                    entry.isMe
                      ? 'border-zoyd-yellow/30 bg-zoyd-yellow/5'
                      : 'border-white/5 bg-zoyd-surface/10 hover:bg-zoyd-surface/20'
                  }`}
                >
                  {entry.href ? (
                    <Link
                      to={entry.href}
                      className="grid grid-cols-12 gap-4 px-4 py-4 items-center"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="grid grid-cols-12 gap-4 px-4 py-4 items-center">{content}</div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClassementsPage;
