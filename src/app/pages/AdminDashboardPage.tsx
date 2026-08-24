import React, { useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { Shield, Swords, AlertTriangle, TrendingUp, DollarSign, Users, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { adminAwardServerMatch, adminCancelServerMatch, adminResolveServerDispute } from '../lib/matchApi';
import { applyServerAccountState } from '../lib/serverSync';
import { useAuthStore, type User } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore, type Match } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { buildAdminInsights, buildCommunityPlayers } from '../../lib/communityInsights';
import { formatZC } from '../../lib/utils';
import type { WalletSnapshot } from '../lib/walletApi';
import { FocusCard, StatCard } from '../components/admin/AdminTabShared';
import AdminOverviewTab from '../components/admin/AdminOverviewTab';
import AdminMatchesTab from '../components/admin/AdminMatchesTab';
import AdminUrgencyTab from '../components/admin/AdminUrgencyTab';
import AdminUsersTab from '../components/admin/AdminUsersTab';
import type { MatchFilter, UserFilter, DisputeFilter } from '../components/admin/AdminTabShared';

const AdminDashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;
  const { friends, reports } = useFriendsStore();
  const { matches } = useMatchStore();
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const { tournaments } = useTournamentStore();
  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'disputes' | 'users'>('overview');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('priority');
  const [userFilter, setUserFilter] = useState<UserFilter>('critical');
  const [disputeFilter, setDisputeFilter] = useState<DisputeFilter>('escalated');
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [pendingResolve, setPendingResolve] = useState<{ matchId: string; type: 'alpha' | 'bravo' | 'none' } | null>(null);
  const players = useMemo(() => buildCommunityPlayers({ currentUser: user, friends, reports, matches, tournaments }), [friends, matches, reports, tournaments, user]);
  const adminInsights = useMemo(() => buildAdminInsights({ players, matches, reports }), [matches, players, reports]);
  const playerById = useMemo(() => {
    const index = new Map<string, (typeof players)[number]>();
    for (const player of players) if (player.primaryUserId) index.set(player.primaryUserId, player);
    return index;
  }, [players]);
  const pendingReports = useMemo(() => reports.filter((r) => r.status === 'pending').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [reports]);
  const matchQueues = useMemo(() => {
    const live: typeof matches = [];
    const ready: typeof matches = [];
    for (const match of matches) {
      if (match.status === 'in_progress') live.push(match);
      else if (match.status === 'ready' || match.status === 'check_in') ready.push(match);
    }
    return { live, ready };
  }, [matches]);
  const frozenPools = useMemo(() => adminInsights.openDisputes.filter((m) => m.disputes.some((d) => d.prizePoolFrozen && (d.status === 'open' || d.status === 'under_review'))).length, [adminInsights.openDisputes]);
  const escalatedDisputes = useMemo(() => adminInsights.openDisputes.filter((m) => m.disputes.some((d) => (d.level || 1) >= 2)), [adminInsights.openDisputes]);
  const filteredDisputes = useMemo(() => {
    if (disputeFilter === 'escalated') return escalatedDisputes;
    if (disputeFilter === 'level1') return adminInsights.openDisputes.filter((m) => m.disputes.every((d) => (d.level || 1) < 2));
    return adminInsights.openDisputes;
  }, [disputeFilter, adminInsights.openDisputes, escalatedDisputes]);
  const filteredMatches = useMemo(() => {
    const sorted = [...matches].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
    if (matchFilter === 'priority') return sorted.filter((m) => ['disputed', 'check_in', 'ready', 'in_progress'].includes(m.status));
    if (matchFilter === 'active') return sorted.filter((m) => !['finished', 'cancelled', 'forfeited'].includes(m.status));
    if (matchFilter === 'closed') return sorted.filter((m) => ['finished', 'cancelled', 'forfeited'].includes(m.status));
    return sorted;
  }, [matchFilter, matches]);
  const priorityQueue = useMemo(() => {
    const disputeItems = adminInsights.openDisputes.map((match) => {
      const isEscalated = match.disputes.some((d) => (d.level || 1) >= 2);
      return { id: `dispute-${match.id}`, kind: 'litige' as const, label: match.id, body: `${match.format} / ${match.rules.map} / ${match.players.length} joueurs impactes${isEscalated ? ' — ⚠ Escaladé' : ''}`, timestamp: match.dispute?.openedAt || match.disputes[0]?.openedAt || match.updatedAt || match.createdAt, severity: isEscalated ? 4 : 3, action: () => setActiveTab('disputes'), actionLabel: isEscalated ? 'Traiter en urgence' : 'Traiter le litige' };
    });
    const reportItems = pendingReports.map((report) => {
      const targetPlayer = playerById.get(report.targetId);
      return { id: report.id, kind: 'signalement' as const, label: targetPlayer?.pseudo || report.targetId, body: report.description || report.reason, timestamp: report.timestamp, severity: 2, action: () => setActiveTab('users'), actionLabel: 'Voir la watchlist' };
    });
    const operationalItems = matchQueues.ready.slice(0, 3).map((match) => ({ id: `ops-${match.id}`, kind: 'ops' as const, label: match.id, body: match.status === 'ready' ? 'Match pret a lancer' : 'Check-in incomplet a debloquer', timestamp: match.updatedAt || match.createdAt, severity: 1, action: () => setActiveTab('matches'), actionLabel: 'Ouvrir les matchs' }));
    return [...disputeItems, ...reportItems, ...operationalItems].sort((a, b) => b.severity - a.severity || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8);
  }, [adminInsights.openDisputes, pendingReports, playerById, matchQueues.ready]);
  const filteredUsers = useMemo(() => {
    if (userFilter === 'critical') return adminInsights.flaggedUsers.filter((u) => u.status === 'critical');
    if (userFilter === 'watch') return adminInsights.flaggedUsers.filter((u) => u.status !== 'clean');
    return adminInsights.flaggedUsers;
  }, [adminInsights.flaggedUsers, userFilter]);
  const applyAdminMatchResponse = (payload: { match: Match; user?: Partial<User>; wallet?: WalletSnapshot | null }) => { hydrateMatches([payload.match]); applyServerAccountState(payload); };
  const handleResolveWinner = async (matchId: string, winnerTeam: 0 | 1) => { try { const response = await adminAwardServerMatch(matchId, winnerTeam, 'Resolution admin depuis le command center.'); applyAdminMatchResponse(response); toast.success('Resultat admin applique.'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Resolution admin impossible.'); } };
  const handleResolveDisputeOnly = async (matchId: string) => { try { const response = await adminResolveServerDispute(matchId, 'Litige clos par moderation ZOYD.'); applyAdminMatchResponse(response); toast.success('Litige clos sans modifier le vainqueur.'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Cloture du litige impossible.'); } };
  const handleCancelMatch = async (matchId: string) => { try { const response = await adminCancelServerMatch(matchId, 'Match annule par moderation locale.'); applyAdminMatchResponse(response); toast.success('Match annule et rembourse cote serveur.'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Annulation admin impossible.'); } };
  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui pb-24 lg:pb-0 scanline pt-safe-top">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
      <header className="relative overflow-hidden border-b border-white/5">
        <img src="/assets/images/codm-8.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
        <img src="/assets/images/codm-1.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-4 md:px-8 py-10">
          <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-8">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <div className="w-10 h-10 flex items-center justify-center text-zoyd-yellow"><Shield className="w-5 h-5" aria-hidden="true" /></div>
                <span className="text-[10px] font-mono font-black text-zoyd-yellow uppercase tracking-widest italic">Administration</span>
              </div>
              <h1 className="text-3xl md:text-6xl font-display font-black uppercase tracking-tighter italic">Command <span className="text-white/40">Center</span></h1>
              <p className="text-white/40 max-w-2xl mt-2">Vue operationnelle pour prioriser les litiges, garder un oeil sur les passes bloques et agir vite sur les comptes qui degringolent en trust.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0 xl:min-w-[650px]">
              <FocusCard icon={<AlertTriangle className="w-4 h-4 text-red-300" aria-hidden="true" />} label="Litiges" value={adminInsights.openDisputes.length.toString()} detail="A trancher" tone="danger" />
              <FocusCard icon={<Users className="w-4 h-4 text-zoyd-yellow" aria-hidden="true" />} label="Reports" value={pendingReports.length.toString()} detail="En attente" tone="warning" />
              <FocusCard icon={<Swords className="w-4 h-4 text-green-400" aria-hidden="true" />} label="Salon live" value={matchQueues.live.length.toString()} detail="En cours" tone="success" />
              <FocusCard icon={<Lock className="w-4 h-4 text-zoyd-blue" aria-hidden="true" />} label="Pools geles" value={frozenPools.toString()} detail="Sous hold" tone="neutral" />
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-[1500px] mx-auto px-4 sm:px-4 md:px-8 py-8 md:py-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <StatCard icon={<Swords className="w-5 h-5 text-zoyd-blue" aria-hidden="true" />} label="MATCHS OUVERTS" value={adminInsights.operationalMatches.length.toString()} />
          <StatCard icon={<AlertTriangle className="w-5 h-5 text-red-400" aria-hidden="true" />} label="LITIGES OUVERTS" value={adminInsights.openDisputes.length.toString()} />
          <StatCard icon={<DollarSign className="w-5 h-5 text-zoyd-yellow" aria-hidden="true" />} label="PRIZEPOOLS" value={formatZC(adminInsights.totalPrizePool)} />
          <StatCard icon={<TrendingUp className="w-5 h-5 text-green-400" aria-hidden="true" />} label="COMMISSIONS" value={formatZC(adminInsights.totalFees)} />
        </div>
        <div role="tablist" className="flex flex-wrap gap-2 mb-8">
          {[
            { id: 'overview', label: 'overview', count: priorityQueue.length },
            { id: 'matches', label: 'matches', count: filteredMatches.length },
            { id: 'disputes', label: 'disputes', count: adminInsights.openDisputes.length, urgent: escalatedDisputes.length },
            { id: 'users', label: 'users', count: filteredUsers.length },
          ].map((tab: { id: string; label: string; count: number; urgent?: number }) => (
            <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} aria-label={`${tab.label} (${tab.count}${tab.urgent ? `, ${tab.urgent} urgents` : ''})`} onClick={() => setActiveTab(tab.id as typeof activeTab)} className={`relative px-4 sm:px-6 py-2.5 text-[10px] font-display font-black uppercase tracking-[0.15em] transition-all touch-target ${activeTab === tab.id ? 'bg-white text-black' : 'text-white/30 hover:text-white hover:bg-white/5'}`}>
              {tab.label} <span className="opacity-60">({tab.count})</span>
              {'urgent' in tab && tab.urgent !== undefined && tab.urgent > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-mono font-black text-white flex items-center justify-center">{tab.urgent}</span>}
            </button>
          ))}
        </div>
        {activeTab === 'overview' && <AdminOverviewTab priorityQueue={priorityQueue} readyMatchesCount={matchQueues.ready.length} liveMatchesCount={matchQueues.live.length} pendingReportsCount={pendingReports.length} recentEvents={adminInsights.recentEvents} onNavigateToTab={(tab) => setActiveTab(tab as typeof activeTab)} />}
        {activeTab === 'matches' && <AdminMatchesTab filteredMatches={filteredMatches} matchFilter={matchFilter} onFilterChange={setMatchFilter} onNavigateToTab={(tab) => setActiveTab(tab as typeof activeTab)} />}
        {activeTab === 'disputes' && <AdminUrgencyTab filteredDisputes={filteredDisputes} disputeFilter={disputeFilter} onFilterChange={setDisputeFilter} escalatedCount={escalatedDisputes.length} totalCount={adminInsights.openDisputes.length} pendingResolve={pendingResolve} onSetPendingResolve={setPendingResolve} pendingCancelId={pendingCancelId} onSetPendingCancelId={setPendingCancelId} onResolveWinner={handleResolveWinner} onResolveDisputeOnly={handleResolveDisputeOnly} onCancelMatch={handleCancelMatch} />}
        {activeTab === 'users' && <AdminUsersTab filteredUsers={filteredUsers} userFilter={userFilter} onFilterChange={setUserFilter} />}
      </main>
    </div>
  );
};

export default AdminDashboardPage;
