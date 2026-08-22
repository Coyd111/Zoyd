import React, { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { motion } from 'motion/react';
import {
  Shield,
  Swords,
  AlertTriangle,
  CheckCircle2,
  Ban,
  TrendingUp,
  DollarSign,
  Users,
  Lock,
  Filter,
  ArrowRight,
  Eye,
  Flame,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminAwardServerMatch, adminCancelServerMatch, adminResolveServerDispute } from '../lib/matchApi';
import { applyServerAccountState } from '../lib/serverSync';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { buildAdminInsights, buildCommunityPlayers } from '../../lib/communityInsights';
import { formatZC, getRelativeTime } from '../../lib/utils';

const statusToneMap = {
  recruiting: 'text-white/50 border-white/10',
  full: 'text-zoyd-yellow border-zoyd-yellow/30',
  check_in: 'text-zoyd-blue border-zoyd-blue/30',
  ready: 'text-green-400 border-green-500/30',
  in_progress: 'text-green-400 border-green-500/30',
  disputed: 'text-red-400 border-red-500/30',
  finished: 'text-white/30 border-white/10',
  cancelled: 'text-red-300 border-red-500/20',
  forfeited: 'text-red-300 border-red-500/20',
} as const;

const moderationToneMap = {
  success: 'text-green-400 border-green-500/20 bg-green-500/5',
  warning: 'text-zoyd-yellow border-zoyd-yellow/20 bg-zoyd-yellow/5',
  danger: 'text-red-300 border-red-500/20 bg-red-500/5',
  neutral: 'text-white/40 border-white/10 bg-black/40',
} as const;

const disputeCategoryLabels = {
  result: 'Score conteste',
  room_issue: 'Probleme de salle',
  no_show: 'Absence / retard',
  conduct: 'Comportement',
  other: 'Autre',
} as const;

type MatchFilter = 'all' | 'priority' | 'active' | 'closed';
type UserFilter = 'all' | 'critical' | 'watch';
type DisputeFilter = 'all' | 'escalated' | 'level1';

// M-07: Admin analytics computed from local stores. Server-side aggregation
// recommended when match count exceeds ~500 for real-time accuracy.
const AdminDashboardPage: React.FC = () => {
  const { user } = useAuthStore();

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  const { friends, reports } = useFriendsStore();
  const { matches } = useMatchStore();
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const { tournaments } = useTournamentStore();
  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'disputes' | 'users'>('overview');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('priority');
  const [userFilter, setUserFilter] = useState<UserFilter>('critical');
  const [disputeFilter, setDisputeFilter] = useState<DisputeFilter>('escalated');
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);

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

  const adminInsights = useMemo(
    () =>
      buildAdminInsights({
        players,
        matches,
        reports,
      }),
    [matches, players, reports]
  );

  const playerById = useMemo(() => {
    const index = new Map<string, (typeof players)[number]>();
    for (const player of players) {
      if (player.primaryUserId) {
        index.set(player.primaryUserId, player);
      }
    }
    return index;
  }, [players]);

  const pendingReports = useMemo(
    () =>
      reports
        .filter((report) => report.status === 'pending')
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()),
    [reports]
  );

  const matchQueues = useMemo(() => {
    const live: typeof matches = [];
    const ready: typeof matches = [];
    for (const match of matches) {
      if (match.status === 'in_progress') live.push(match);
      else if (match.status === 'ready' || match.status === 'check_in') ready.push(match);
    }
    return { live, ready };
  }, [matches]);

  const liveMatches = matchQueues.live;
  const readyMatches = matchQueues.ready;

  const frozenPools = useMemo(
    () =>
      adminInsights.openDisputes.filter((match) =>
        match.disputes.some((dispute) => dispute.prizePoolFrozen && (dispute.status === 'open' || dispute.status === 'under_review'))
      ).length,
    [adminInsights.openDisputes]
  );

  const escalatedDisputes = useMemo(
    () =>
      adminInsights.openDisputes.filter((match) =>
        match.disputes.some((d) => (d.level || 1) >= 2)
      ),
    [adminInsights.openDisputes]
  );

  const filteredDisputes = useMemo(() => {
    if (disputeFilter === 'escalated') return escalatedDisputes;
    if (disputeFilter === 'level1')
      return adminInsights.openDisputes.filter((match) =>
        match.disputes.every((d) => (d.level || 1) < 2)
      );
    return adminInsights.openDisputes;
  }, [disputeFilter, adminInsights.openDisputes, escalatedDisputes]);

  const filteredMatches = useMemo(() => {
    const sorted = [...matches].sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
    );

    if (matchFilter === 'priority') {
      return sorted.filter((match) => ['disputed', 'check_in', 'ready', 'in_progress'].includes(match.status));
    }
    if (matchFilter === 'active') {
      return sorted.filter((match) => !['finished', 'cancelled', 'forfeited'].includes(match.status));
    }
    if (matchFilter === 'closed') {
      return sorted.filter((match) => ['finished', 'cancelled', 'forfeited'].includes(match.status));
    }
    return sorted;
  }, [matchFilter, matches]);

  const priorityQueue = useMemo(() => {
    const disputeItems = adminInsights.openDisputes.map((match) => {
      const isEscalated = match.disputes.some((d) => (d.level || 1) >= 2);
      return {
        id: `dispute-${match.id}`,
        kind: 'litige' as const,
        label: match.id,
        body: `${match.format} / ${match.rules.map} / ${match.players.length} joueurs impactes${isEscalated ? ' — ⚠ Escaladé' : ''}`,
        timestamp: match.dispute?.openedAt || match.disputes[0]?.openedAt || match.updatedAt || match.createdAt,
        severity: isEscalated ? 4 : 3,
        action: () => setActiveTab('disputes'),
        actionLabel: isEscalated ? 'Traiter en urgence' : 'Traiter le litige',
      };
    });

    const reportItems = pendingReports.map((report) => {
      const targetPlayer = playerById.get(report.targetId);
      return {
        id: report.id,
        kind: 'signalement' as const,
        label: targetPlayer?.pseudo || report.targetId,
        body: report.description || report.reason,
        timestamp: report.timestamp,
        severity: 2,
        action: () => setActiveTab('users'),
        actionLabel: 'Voir la watchlist',
      };
    });

    const operationalItems = readyMatches.slice(0, 3).map((match) => ({
      id: `ops-${match.id}`,
      kind: 'ops' as const,
      label: match.id,
      body: match.status === 'ready' ? 'Match pret a lancer' : 'Check-in incomplet a debloquer',
      timestamp: match.updatedAt || match.createdAt,
      severity: 1,
      action: () => setActiveTab('matches'),
      actionLabel: 'Ouvrir les matchs',
    }));

    return [...disputeItems, ...reportItems, ...operationalItems]
      .sort(
        (left, right) =>
          right.severity - left.severity || new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
      )
      .slice(0, 8);
  }, [adminInsights.openDisputes, pendingReports, playerById, readyMatches]);

  const filteredUsers = useMemo(() => {
    if (userFilter === 'critical') {
      return adminInsights.flaggedUsers.filter((flaggedUser) => flaggedUser.status === 'critical');
    }
    if (userFilter === 'watch') {
      return adminInsights.flaggedUsers.filter((flaggedUser) => flaggedUser.status !== 'clean');
    }
    return adminInsights.flaggedUsers;
  }, [adminInsights.flaggedUsers, userFilter]);

  const applyAdminMatchResponse = (payload: { match: any; user?: any; wallet?: any }) => {
    hydrateMatches([payload.match]);
    applyServerAccountState(payload);
  };

  const handleResolveWinner = async (matchId: string, winnerTeam: 0 | 1) => {
    try {
      const response = await adminAwardServerMatch(matchId, winnerTeam, 'Resolution admin depuis le command center.');
      applyAdminMatchResponse(response);
      toast.success('Resultat admin applique.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Resolution admin impossible.');
    }
  };

  const handleResolveDisputeOnly = async (matchId: string) => {
    try {
      const response = await adminResolveServerDispute(matchId, 'Litige clos par moderation ZOYD.');
      applyAdminMatchResponse(response);
      toast.success('Litige clos sans modifier le vainqueur.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cloture du litige impossible.');
    }
  };

  const handleCancelMatch = async (matchId: string) => {
    try {
      const response = await adminCancelServerMatch(matchId, 'Match annule par moderation locale.');
      applyAdminMatchResponse(response);
      toast.success('Match annule et rembourse cote serveur.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Annulation admin impossible.');
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui pb-24 lg:pb-0 scanline pt-safe-top">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative overflow-hidden border-b border-white/5">
        <img src="/assets/maps/highrise.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
        <img src="/assets/maps/scrapyard.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
            <div className="relative z-10 max-w-[1600px] mx-auto px-4 sm:px-4 md:px-8 py-10">
          <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-8">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <div className="w-10 h-10 flex items-center justify-center text-zoyd-yellow">
                  <Shield className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-mono font-black text-zoyd-yellow uppercase tracking-widest italic">
                  Administration
                </span>
              </div>
              <h1 className="text-3xl md:text-6xl font-display font-black uppercase tracking-tighter italic">
                Command <span className="text-white/20">Center</span>
              </h1>
              <p className="text-white/40 max-w-2xl mt-2">
                Vue operationnelle pour prioriser les litiges, garder un oeil sur les passes bloques et agir vite sur
                les comptes qui degringolent en trust.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0 xl:min-w-[650px]">
              <FocusCard
                icon={<AlertTriangle className="w-4 h-4 text-red-300" />}
                label="Litiges"
                value={adminInsights.openDisputes.length.toString()}
                detail="A trancher"
                tone="danger"
              />
              <FocusCard
                icon={<Users className="w-4 h-4 text-zoyd-yellow" />}
                label="Reports"
                value={pendingReports.length.toString()}
                detail="En attente"
                tone="warning"
              />
              <FocusCard
                icon={<Swords className="w-4 h-4 text-green-400" />}
                label="Salon live"
                value={liveMatches.length.toString()}
                detail="En cours"
                tone="success"
              />
              <FocusCard
                icon={<Lock className="w-4 h-4 text-zoyd-blue" />}
                label="Pools geles"
                value={frozenPools.toString()}
                detail="Sous hold"
                tone="neutral"
              />
            </div>
          </div>
        </div>
      </header>

        <main className="max-w-[1600px] mx-auto px-4 sm:px-4 md:px-8 py-8 md:py-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <StatCard
            icon={<Swords className="w-5 h-5 text-zoyd-blue" />}
            label="MATCHS OUVERTS"
            value={adminInsights.operationalMatches.length.toString()}
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
            label="LITIGES OUVERTS"
            value={adminInsights.openDisputes.length.toString()}
          />
          <StatCard
            icon={<DollarSign className="w-5 h-5 text-zoyd-yellow" />}
            label="PRIZEPOOLS"
            value={formatZC(adminInsights.totalPrizePool)}
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5 text-green-400" />}
            label="COMMISSIONS"
            value={formatZC(adminInsights.totalFees)}
          />
        </div>

        <div role="tablist" className="flex flex-wrap gap-2 mb-8">
          {[
            { id: 'overview', label: 'overview', count: priorityQueue.length },
            { id: 'matches', label: 'matches', count: filteredMatches.length },
            {
              id: 'disputes',
              label: 'disputes',
              count: adminInsights.openDisputes.length,
              urgent: escalatedDisputes.length,
            },
            { id: 'users', label: 'users', count: filteredUsers.length },
          ].map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
                      className={`relative px-4 sm:px-6 py-2.5 text-[10px] font-display font-black uppercase tracking-[0.15em] transition-all touch-target ${
                activeTab === tab.id ? 'bg-white text-black' : 'text-white/30 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label} <span className="opacity-60">({tab.count})</span>
              {'urgent' in tab && (tab as any).urgent > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-mono font-black text-white flex items-center justify-center">
                  {(tab as any).urgent}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="grid xl:grid-cols-[1.2fr_0.8fr] gap-6">
              <section className="p-6">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">
                      PRIORITY QUEUE
                    </div>
                    <h2 className="text-xl font-display font-black uppercase italic">Ce qui doit bouger maintenant</h2>
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/20">
                    {priorityQueue.length} cartes actives
                  </div>
                </div>

                {priorityQueue.length === 0 ? (
                  <p className="text-white/20 text-sm font-mono">Aucune urgence locale remontee.</p>
                ) : (
                  <div className="space-y-3">
                    {priorityQueue.map((item) => (
                      <button
                        key={item.id}
                        onClick={item.action}
                        className="w-full text-left p-4 transition-colors"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <PriorityBadge kind={item.kind} />
                              <span className="font-display font-black text-sm uppercase italic text-white">
                                {item.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-white/45">{item.body}</div>
                          </div>
                          <div className="flex items-center justify-between lg:justify-end gap-4 shrink-0">
                            <span className="text-[10px] font-mono uppercase tracking-widest text-white/25">
                              {getRelativeTime(item.timestamp)}
                            </span>
                            <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow">
                              {item.actionLabel}
                              <ArrowRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-6">
                <div className="p-6">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-4">
                    OPERATIONS HEALTH
                  </div>
                  <div className="space-y-3">
                    <StatusLane
                      label="Check-in / Ready"
                      count={readyMatches.length}
                      body="Slots complets mais encore bloques dans le tunnel avant match."
                      accent="bg-zoyd-blue"
                    />
                    <StatusLane
                      label="Matchs live"
                      count={liveMatches.length}
                      body="Salons actuellement en cours et a surveiller."
                      accent="bg-green-500"
                    />
                    <StatusLane
                      label="Reports pending"
                      count={pendingReports.length}
                      body="Signalements utilisateurs qui attendent un triage."
                      accent="bg-zoyd-yellow"
                    />
                  </div>
                </div>

                <div className="p-6">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">
                        RECENT SIGNALS
                      </div>
                      <h2 className="text-lg font-display font-black uppercase italic">Journal moderation</h2>
                    </div>
                    <button
                      onClick={() => setActiveTab('users')}
                      className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow"
                    >
                      Ouvrir la watchlist
                    </button>
                  </div>

                  {adminInsights.recentEvents.length === 0 ? (
                    <p className="text-white/20 text-sm font-mono">Aucun evenement recent.</p>
                  ) : (
                    <div className="space-y-3">
                      {adminInsights.recentEvents.slice(0, 5).map((event) => (
                        <div
                          key={event.id}
                          className={`flex items-center justify-between gap-4 border p-3 ${moderationToneMap[event.tone]}`}
                        >
                          <div>
                            <div className="font-display font-black text-sm uppercase italic">{event.action}</div>
                            <div className="text-[10px] font-mono text-white/30">{event.target}</div>
                          </div>
                          <span className="text-[10px] font-mono text-white/25">
                            {getRelativeTime(event.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        ) : null}

        {activeTab === 'matches' ? (
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-display font-black uppercase italic">Operations Match</h2>
                <p className="text-white/35 text-sm">
                  Filtre les files pour voir rapidement ce qui attend une decision humaine.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'priority', label: 'Priorite' },
                  { id: 'active', label: 'Actifs' },
                  { id: 'closed', label: 'Clotures' },
                  { id: 'all', label: 'Tous' },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setMatchFilter(filter.id as MatchFilter)}
                    className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
                      matchFilter === filter.id
                        ? 'bg-white text-black border-white'
                        : 'border-white/10 text-white/35 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <Filter className="w-3 h-3 inline mr-2" />
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3">
              {filteredMatches.map((match) => (
                <div key={match.id} className="p-5">
                  <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-5">
                    <div className="space-y-3 min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            match.status === 'in_progress'
                              ? 'bg-green-400 animate-pulse'
                              : match.status === 'disputed'
                                ? 'bg-red-400'
                                : 'bg-white/20'
                          }`}
                        />
                        <div className="font-display font-black text-lg uppercase italic">{match.id}</div>
                        <StatusPill label={match.status} tone={statusToneMap[match.status]} />
                      </div>
                      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 text-[10px] font-mono uppercase tracking-widest text-white/30">
                        <MetaChip label="Format" value={match.format} />
                        <MetaChip label="Map" value={match.rules.map} />
                        <MetaChip label="Roster" value={`${match.players.length}/${match.maxPlayers}`} />
                        <MetaChip label="Arbitre" value={match.arbiter ? match.arbiter.pseudo : 'Non assigne'} />
                      </div>
                      <div className="flex flex-wrap gap-4 text-[11px] text-white/45">
                        <span>Prizepool {formatZC(match.prizePool)}</span>
                        <span>Maj {getRelativeTime(match.updatedAt || match.createdAt)}</span>
                        <span>{match.roomName ? 'Room publiee' : 'Room non publiee'}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:flex gap-3 xl:justify-end">
                      {match.status === 'disputed' ? (
                        <button
                          onClick={() => setActiveTab('disputes')}
                          className="bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-red-500/15 transition-colors"
                        >
                          Traiter
                        </button>
                      ) : null}
                      <button
                        onClick={() => setActiveTab('matches')}
                        className="bg-white/5 border border-white/10 text-white px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:border-white/25 transition-colors"
                      >
                        Garder en vue
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === 'disputes' ? (
          <div className="space-y-6">
            {/* Header + filtres */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-display font-black uppercase italic">Litiges en Cours</h2>
                <p className="text-white/35 text-sm">
                  Chaque carte remonte le contexte utile pour décider vite sans chercher l&apos;info ailleurs.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {escalatedDisputes.length > 0 && (
                  <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-3 py-2">
                    <Flame className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-red-400">
                      {escalatedDisputes.length} escaladé(s) — intervention admin requise
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'escalated', label: 'Escaladés', count: escalatedDisputes.length },
                    { id: 'level1', label: 'Niveau 1', count: adminInsights.openDisputes.length - escalatedDisputes.length },
                    { id: 'all', label: 'Tous', count: adminInsights.openDisputes.length },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setDisputeFilter(f.id as DisputeFilter)}
                    className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
                        disputeFilter === f.id
                          ? 'bg-white text-black border-white'
                          : 'border-white/10 text-white/35 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <Filter className="w-3 h-3 inline mr-2" />
                      {f.label} ({f.count})
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredDisputes.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-white/20 text-sm font-mono">
                  {disputeFilter === 'escalated' ? 'Aucun litige escaladé. Bonne nouvelle !' : 'Aucun litige dans ce filtre.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-5">
                {filteredDisputes.map((match) => {
                  const activeDispute =
                    match.disputes.find((d) => d.status === 'open' || d.status === 'under_review') ||
                    match.dispute ||
                    match.disputes[0];
                  const isEscalated = (activeDispute?.level || 1) >= 2;

                  return (
                    <div
                      key={match.id}
                      className="p-6"
                    >
                      {/* Bandeau escalade */}
                      {isEscalated && (
                        <div className="flex items-center gap-3 mb-5 border-b border-red-500/20 pb-4">
                          <Flame className="w-4 h-4 text-red-400 shrink-0" />
                          <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-red-400">
                              Litige Escaladé — Niveau Admin
                            </div>
                            <div className="text-xs text-white/40">
                              Escaladé par {activeDispute?.escalatedByPseudo || 'l\'arbitre'}
                              {activeDispute?.escalatedAt
                                ? ` · ${getRelativeTime(activeDispute.escalatedAt)}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-5">
                        <div>
                          <div className="flex flex-wrap items-center gap-3 mb-2">
                            <div className="font-display font-black text-lg uppercase italic">{match.id}</div>
                            <StatusPill
                              label={isEscalated ? 'Niveau Admin' : 'litige ouvert'}
                              tone={isEscalated ? 'text-red-400 border-red-500/40' : 'text-red-300 border-red-500/30'}
                            />
                            {activeDispute?.prizePoolFrozen ? (
                              <StatusPill label="pool gelé" tone="text-zoyd-yellow border-zoyd-yellow/30" />
                            ) : null}
                          </div>
                          <div className="text-[11px] text-white/45">
                            {match.format} / {match.rules.map} / {match.players.length} joueurs / ouvert{' '}
                            {getRelativeTime(activeDispute?.openedAt || activeDispute?.createdAt || match.createdAt)}
                          </div>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-3 text-sm font-mono text-white/40 min-w-0">
                          <DisputeStat label="Ouvert par" value={activeDispute?.openedByPseudo || 'Inconnu'} />
                          <DisputeStat
                            label="Catégorie"
                            value={activeDispute ? disputeCategoryLabels[activeDispute.category] : 'N/A'}
                          />
                          <DisputeStat label="Prizepool" value={formatZC(match.prizePool)} />
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 mb-5">
                        <div className="p-4">
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">ROSTER IMPACTÉ</div>
                          <div className="flex flex-wrap gap-2">
                            {match.players.map((player) => (
                              <PlayerPill key={`${match.id}-${player.userId}`} label={player.pseudo} team={player.team} />
                            ))}
                          </div>
                        </div>
                        <div className="border border-white/5 bg-black/30 p-4">
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">CONTEXTE</div>
                          <div className="space-y-2 text-sm text-white/45">
                            <div>Preuves: {activeDispute?.evidence.length || 0} pièce(s)</div>
                            <div>Arbitre: {match.arbiter?.pseudo || 'Non assigné'}</div>
                            <div>Résolution existante: {match.result ? 'Oui, contestée' : 'Aucune'}</div>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 mb-5">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">DOSSIER</div>
                        <div className="space-y-3">
                          <div className="text-sm text-white/60">{activeDispute?.reason || 'Aucun motif fourni'}</div>
                          {activeDispute?.evidence && activeDispute.evidence.length > 0 && (
                            <div className="border-t border-white/5 pt-3">
                              <div className="text-[10px] font-mono uppercase tracking-widest text-white/20 mb-2">
                                Pièces jointes ({activeDispute.evidence.length})
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {activeDispute.evidence.map((item: string, i: number) => (
                                  <a
                                    key={i}
                                    href={item.startsWith('http') ? item : undefined}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zoyd-blue hover:text-white transition-colors border border-zoyd-blue/20 px-2 py-1"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                    Preuve {i + 1}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => handleResolveWinner(match.id, 0)}
                          className="bg-green-500 text-black px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-green-400 transition-colors touch-target"
                        >
                          <CheckCircle2 className="w-3 h-3 inline mr-2" />
                          Valider Alpha
                        </button>
                        <button
                          onClick={() => handleResolveWinner(match.id, 1)}
                          className="bg-white text-black px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-zoyd-yellow transition-colors touch-target"
                        >
                          Valider Bravo
                        </button>
                        <button
                          onClick={() => handleResolveDisputeOnly(match.id)}
                          className="border border-zoyd-blue/30 text-zoyd-blue px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-zoyd-blue hover:text-black transition-colors touch-target"
                        >
                          Clore sans vainqueur
                        </button>
                        <Link
                          to={`/mj/match/${match.id}`}
                          className="border border-white/10 text-white/40 px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic hover:text-white hover:border-white transition-colors flex items-center gap-2 touch-target"
                        >
                          <Eye className="w-3 h-3" />
                          Voir le match
                        </Link>
                        <button
                          onClick={() => {
                            if (pendingCancelId === match.id) {
                              setPendingCancelId(null);
                              void handleCancelMatch(match.id);
                            } else {
                              setPendingCancelId(match.id);
                            }
                          }}
                          onMouseLeave={() => {
                            if (pendingCancelId === match.id) setPendingCancelId(null);
                          }}
                          className={`border px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic transition-colors touch-target ${
                            pendingCancelId === match.id
                              ? 'border-red-500/50 bg-red-500/10 text-red-300'
                              : 'border-white/10 text-white/30 hover:text-red-300 hover:border-red-500/30'
                          }`}
                        >
                          <Ban className="w-3 h-3 inline mr-2" />
                          {pendingCancelId === match.id ? 'Confirmer l\'annulation' : 'Annuler'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'users' ? (
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-display font-black uppercase italic">Watchlist Joueurs</h2>
                <p className="text-white/35 text-sm">
                  Les profils sont tries pour mettre devant les signaux qui melangent reports, litiges et perte de
                  trust.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'critical', label: 'Critiques' },
                  { id: 'watch', label: 'Sous watch' },
                  { id: 'all', label: 'Tous' },
                ].map((filter) => (
                      <button
                        key={f.id}
                        onClick={() => setDisputeFilter(f.id as DisputeFilter)}
                        className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
                      userFilter === filter.id
                        ? 'bg-white text-black border-white'
                        : 'border-white/10 text-white/35 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <p className="text-white/20 text-sm font-mono">Aucun compte remonte dans cette vue.</p>
            ) : (
              <div className="grid gap-3">
                {filteredUsers.map((flaggedUser) => (
                  <div
                    key={flaggedUser.key}
                    className="flex flex-col xl:flex-row xl:items-center justify-between p-4 gap-4"
                  >
                    <div className="flex items-start gap-4 min-w-0">
                      <div
                        className={`w-10 h-10 flex items-center justify-center font-display font-black text-sm shrink-0 ${
                          flaggedUser.status === 'critical'
                            ? 'bg-red-500 text-black'
                            : flaggedUser.status === 'watch'
                              ? 'bg-zoyd-yellow text-black'
                              : 'bg-white/10 text-white/40'
                        }`}
                      >
                        {flaggedUser.pseudo[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <div className="font-display font-black text-sm uppercase italic">{flaggedUser.pseudo}</div>
                          <StatusPill
                            label={flaggedUser.status}
                            tone={
                              flaggedUser.status === 'critical'
                                ? 'text-red-400 border-red-500/30'
                                : flaggedUser.status === 'watch'
                                  ? 'text-zoyd-yellow border-zoyd-yellow/30'
                                  : 'text-white/30 border-white/10'
                            }
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest text-white/25">
                          <SignalBadge label={`Trust ${typeof flaggedUser.trustScore === 'number' ? flaggedUser.trustScore : '--'}`} />
                          <SignalBadge label={`${flaggedUser.reportsCount} report(s)`} />
                          <SignalBadge label={`${flaggedUser.disputedMatches} litige(s)`} />
                          <SignalBadge label={`${flaggedUser.forfeits} forfait(s)`} />
                          <SignalBadge label={`${flaggedUser.activityCount} session(s)`} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {flaggedUser.hasPublicProfile && flaggedUser.primaryUserId ? (
                        <Link
                          to={`/profil/${flaggedUser.primaryUserId}`}
                          className="bg-white text-black px-3 sm:px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-zoyd-yellow transition-colors touch-target"
                        >
                          <Eye className="w-3 h-3 inline mr-2" />
                          Ouvrir profil
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/25">
                          <Users className="w-3 h-3" />
                          Profil non indexe
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="p-6 flex items-center gap-4">
    <div className="w-12 h-12 flex items-center justify-center">{icon}</div>
    <div>
      <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-2xl font-display font-black italic">{value}</div>
    </div>
  </div>
);

const FocusCard = ({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) => (
  <div className={`p-4 ${moderationToneMap[tone]}`}>
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest mb-3">
      {icon}
      {label}
    </div>
    <div className="text-2xl font-display font-black italic text-white">{value}</div>
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mt-1">{detail}</div>
  </div>
);

const StatusLane = ({
  label,
  count,
  body,
  accent,
}: {
  label: string;
  count: number;
  body: string;
  accent: string;
}) => (
  <div className="p-4">
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="font-display font-black text-sm uppercase italic">{label}</div>
      <div className="text-xl font-display font-black italic text-white">{count}</div>
    </div>
    <div className="h-1 bg-white/5 mb-3 overflow-hidden">
      <div className={`${accent} h-full`} style={{ width: `${Math.min(100, count * 18)}%` }} />
    </div>
    <p className="text-[11px] text-white/40">{body}</p>
  </div>
);

const MetaChip = ({ label, value }: { label: string; value: string }) => (
  <div className="px-3 py-2">
    <div className="text-[9px] text-white/20 mb-1">{label}</div>
    <div className="text-white/65">{value}</div>
  </div>
);

const DisputeStat = ({ label, value }: { label: string; value: string }) => (
  <div className="px-4 py-3">
    <div className="text-[9px] uppercase tracking-widest text-white/20 mb-1">{label}</div>
    <div className="text-white">{value}</div>
  </div>
);

const PlayerPill = ({ label, team }: { label: string; team: 0 | 1 }) => (
  <span
    className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest ${
      team === 0 ? 'text-zoyd-blue' : 'text-zoyd-yellow'
    }`}
  >
    {team === 0 ? 'A' : 'B'} / {label}
  </span>
);

const SignalBadge = ({ label }: { label: string }) => (
  <span className="px-2 py-1 text-white/50">{label}</span>
);

const PriorityBadge = ({ kind }: { kind: 'litige' | 'signalement' | 'ops' }) => {
  if (kind === 'litige') {
    return <StatusPill label="litige" tone="text-red-300 border-red-500/30" />;
  }
  if (kind === 'signalement') {
    return <StatusPill label="report" tone="text-zoyd-yellow border-zoyd-yellow/30" />;
  }
  return <StatusPill label="ops" tone="text-zoyd-blue border-zoyd-blue/30" />;
};

const StatusPill = ({ label, tone }: { label: string; tone: string }) => (
  <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 border ${tone}`}>{label}</span>
);

export default AdminDashboardPage;
