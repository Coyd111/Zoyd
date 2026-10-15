import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { Shield, Swords, AlertTriangle, TrendingUp, DollarSign, Users, Lock, Scale, Download } from 'lucide-react';
import { toast } from '../lib/toast';
import { adminAwardServerMatch, adminCancelServerMatch, adminResolveServerDispute, downloadMatchHistory } from '../lib/matchApi';
import { applyServerAccountState } from '../lib/serverSync';
import { useAuthStore, type User } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore, type Match } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { buildAdminInsights, buildCommunityPlayers } from '../../lib/communityInsights';
import { formatZC } from '../../lib/utils';
import type { WalletSnapshot } from '../lib/walletApi';
import { fetchAdminCommissions, type CommissionStats } from '../lib/walletApi';
import { fetchAdminReports, resolveAdminReport, fetchActiveSanctions, revokeAdminSanction, type ActiveSanction } from '../lib/socialApi';
import { FocusCard, StatCard } from '../components/admin/AdminTabShared';
import AdminOverviewTab from '../components/admin/AdminOverviewTab';
import AdminMatchesTab from '../components/admin/AdminMatchesTab';
import AdminReportsTab, { type Resolution, type QueueReport } from '../components/admin/AdminReportsTab';
import AdminUrgencyTab from '../components/admin/AdminUrgencyTab';
import AdminUsersTab from '../components/admin/AdminUsersTab';
import type { MatchFilter, UserFilter, DisputeFilter } from '../components/admin/AdminTabShared';
import { SEOHead } from '../components/SEOHead';

const EMPTY_WALLET: WalletSnapshot = {
  cashBalance: 0,
  bonusBalance: 0,
  lockedBalance: 0,
  pendingWinnings: 0,
  transactions: [],
  lockedEntries: {},
};

const AdminDashboardPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const friends = useFriendsStore((s) => s.friends);
  const reports = useFriendsStore((s) => s.reports);
  const matches = useMatchStore((s) => s.matches);
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const tournaments = useTournamentStore((s) => s.tournaments);
  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'disputes' | 'users' | 'reports'>('overview');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('priority');
  const [userFilter, setUserFilter] = useState<UserFilter>('critical');
  const [disputeFilter, setDisputeFilter] = useState<DisputeFilter>('escalated');
  const [pendingResolve, setPendingResolve] = useState<{ matchId: string; type: 'alpha' | 'bravo' | 'none' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);
  // Commissions ZOYD reellement encaissees, calculees par le serveur sur
  // l'ensemble des portefeuilles (`/api/admin/commissions`, 2FA requise).
  // Avant, la carte sommait `match.zoydFee`, fige a 0 a la creation des matchs :
  // la carte affichait donc 0 en permanence, y compris apres des retraits.
  const [commissions, setCommissions] = useState<CommissionStats>({ revenue: 0, withdrawalFees: 0, withdrawalCount: 0, arbiterPayouts: 0 });
  // Les signalements ne venaient que du navigateur courant : la table
  // accumulait sans que rien ne la lise. Un etat `reportsUnavailable` permet
  // d'afficher un echec de lecture, et non une liste vide qui se lirait
  // comme « personne ne signale rien ».
  const [reportsUnavailable, setReportsUnavailable] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [sanctions, setSanctions] = useState<ActiveSanction[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const hydrateReportsFromServer = useFriendsStore((s) => s.hydrateReportsFromServer);
  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    fetchAdminCommissions()
      .then((data) => { if (!cancelled) setCommissions(data); })
      .catch(() => { /* 2FA absente ou reseau : on garde 0 plutot que de mentir */ });
    // Signalements ET sanctions en cours : la vue de moderation doit montrer
    // qui est actuellement sanctionne, pas seulement la file a traiter.
    Promise.all([fetchAdminReports(), fetchActiveSanctions()])
      .then(([data, actifs]) => {
        if (cancelled) return;
        hydrateReportsFromServer(data.reports || []);
        setSanctions(actifs.sanctions || []);
        setReportsUnavailable(data.degraded === true);
      })
      .catch(() => {
        // 503 (table injoignable) ou reseau : mieux vaut le dire que
        // laisser croire a une file de moderation vide.
        if (!cancelled) setReportsUnavailable(true);
      });
    return () => { cancelled = true; };
  }, [user?.role, matches.length]);
  const handleExportHistory = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      const filename = await downloadMatchHistory(undefined, undefined, format);
      toast.success('Export prêt', `${filename} téléchargé. Range-le hors de ce projet.`);
    } catch (err) {
      toast.error('Export impossible', err instanceof Error ? err.message : 'Réessaie dans un instant.');
    } finally {
      setExporting(false);
    }
  };
  const reloadReports = async () => {
    try {
      const [data, actifs] = await Promise.all([fetchAdminReports(), fetchActiveSanctions()]);
      hydrateReportsFromServer(data.reports || []);
      setSanctions(actifs.sanctions || []);
      setReportsUnavailable(data.degraded === true);
    } catch {
      setReportsUnavailable(true);
    }
  };

  // Levee d'une sanction. La liste est rechargee apres coup : la sanction
  // disparait de la vue « en cours » sans qu'on ait a le deviner.
  const handleRevokeSanction = async (sanctionId: string) => {
    setRevokingId(sanctionId);
    try {
      await revokeAdminSanction(sanctionId);
      toast.success('Sanction levée', 'Le joueur retrouve immédiatement accès.');
      await reloadReports();
    } catch {
      toast.error('Levée impossible', 'La sanction a peut-être déjà été levée, ou la session a expiré.');
    } finally {
      setRevokingId(null);
    }
  };

  // Applique la sanction et trace la decision. La liste est rechargee
  // depuis le serveur apres coup : le statut local prevaudrait sinon, et un
  // echec partiel (sanction appliquee, statut non ecrit) resterait invisible.
  const handleResolveReport = async (reportId: string, resolution: Resolution, note: string, durationDays?: number) => {
    setResolvingId(reportId);
    try {
      await resolveAdminReport(reportId, resolution, note, durationDays);
      toast.success(
        'Signalement traité',
        resolution === 'dismissed'
          ? 'Classé, aucune sanction appliquée.'
          : `Sanction appliquée : ${resolution.replace('_', ' ')}.`
      );
      await reloadReports();
    } catch (err) {
      // `apiClient` rejette avec une `Error` enrichie d'un `code` serveur.
      // On lit le code sans_typer le tout en `any` : le message exact
      // determine ce qu'on affiche a l admin.
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      toast.error(
        'Traitement impossible',
        code === 'ALREADY_REVIEWED'
          ? 'Ce signalement a déjà été traité.'
          : code === 'AUTH_REQUIRED' || code === '2FA_REQUIRED'
            ? 'Session ou 2FA expirée, reconnecte-toi.'
            : 'Le traitement a échoué, réessaie dans un instant.'
      );
    } finally {
      setResolvingId(null);
    }
  };

  const players = useMemo(() => buildCommunityPlayers({ currentUser: user, friends, reports, matches, tournaments }), [friends, matches, reports, tournaments, user]);
  const queueReports: QueueReport[] = reports.map((r) => ({
    id: r.id,
    targetId: r.targetId,
    targetPseudo: players.find((p) => p.userId === r.targetId)?.pseudo || r.targetId,
    reporterId: null,
    reporterPseudo: r.reporterPseudo || '',
    reason: r.reason,
    description: r.description,
    status: r.status,
    severity: r.severity || 'a_qualifier',
    createdAt: r.timestamp,
    resolution: r.resolution,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
  }));


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
    const operationalItems = matchQueues.ready.slice(0, 3).map((match) => ({ id: `ops-${match.id}`, kind: 'ops' as const, label: match.id, body: match.status === 'ready' ? 'Match prêt à lancer' : 'Check-in incomplet à débloquer', timestamp: match.updatedAt || match.createdAt, severity: 1, action: () => setActiveTab('matches'), actionLabel: 'Ouvrir les matchs' }));
    return [...disputeItems, ...reportItems, ...operationalItems].sort((a, b) => b.severity - a.severity || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8);
  }, [adminInsights.openDisputes, pendingReports, playerById, matchQueues.ready]);
  const filteredUsers = useMemo(() => {
    const flagged = userFilter === 'critical'
      ? adminInsights.flaggedUsers.filter((u) => u.status === 'critical')
      : userFilter === 'watch'
        ? adminInsights.flaggedUsers.filter((u) => u.status !== 'clean')
        : adminInsights.flaggedUsers;
    return flagged.map((u) => ({ ...u, trustScore: u.trustScore ?? '--' }));
  }, [adminInsights.flaggedUsers, userFilter]);

  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;

  const applyAdminMatchResponse = (payload: { match: Match; user?: Partial<User>; wallet?: Partial<WalletSnapshot> | null }) => { hydrateMatches([payload.match]); applyServerAccountState({ user: payload.user, wallet: payload.wallet ? { ...EMPTY_WALLET, ...payload.wallet } : null }); };
  const handleResolveWinner = async (matchId: string, winnerTeam: 0 | 1) => {
    if (loadingAction) return;
    setLoadingAction(true);
    try {
      const response = await adminAwardServerMatch(matchId, winnerTeam, 'Résolution admin depuis le centre de commandement.');
      applyAdminMatchResponse(response);
      toast.success('Résultat admin appliqué.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Résolution admin impossible.');
    } finally {
      setLoadingAction(false);
    }
  };
  const handleResolveDisputeOnly = async (matchId: string) => {
    if (loadingAction) return;
    setLoadingAction(true);
    try {
      // "Clore sans vainqueur" = aucun gagnant désigné. L'argent ne peut pas
      // rester gelé indéfiniment : on REMBOURSE les passes et on annule le
      // match. Sans `action`, le serveur applique `settle` par défaut et
      // PAIE le résultat en attente — l'inverse de ce qu'annonce le bouton.
      const response = await adminResolveServerDispute(
        matchId,
        'Litige clos sans vainqueur : passes remboursées.',
        'refund'
      );
      applyAdminMatchResponse(response);
      toast.success('Litige clos, passes remboursées aux joueurs.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cloture du litige impossible.');
    } finally {
      setLoadingAction(false);
    }
  };
  const handleCancelMatch = async (matchId: string) => {
    if (loadingAction) return;
    setLoadingAction(true);
    try {
      const response = await adminCancelServerMatch(matchId, 'Match annulé par modération locale.');
      applyAdminMatchResponse(response);
      toast.success('Match annulé et remboursé côté serveur.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Annulation admin impossible.');
    } finally {
      setLoadingAction(false);
    }
  };
  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui pb-24 lg:pb-0 scanline pt-safe-top">
      <SEOHead title="Administration — ZOYD" description="Tableau de bord d'administration ZOYD." path="/admin" noindex />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
      <header className="relative overflow-hidden border-b border-white/5">
        <img src="/assets/images/codm-8.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
        <img src="/assets/images/codm-1.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-4 md:px-8 py-10">
          <div className="flex flex-col 2xl:flex-row 2xl:items-end 2xl:justify-between gap-8">
            <div className="min-w-0">
              <div className="flex items-center gap-4 mb-2">
                <div className="w-10 h-10 flex items-center justify-center text-zoyd-yellow"><Shield className="w-5 h-5" aria-hidden="true" /></div>
                <span className="text-[10px] font-mono font-black text-zoyd-yellow uppercase tracking-widest italic">Administration</span>
              </div>
              <h1 className="text-3xl md:text-6xl font-display font-black uppercase tracking-tighter italic">Centre de <span className="text-white/70">commandement</span></h1>
              <p className="text-white/70 max-w-2xl mt-2">Vue opérationnelle pour prioriser les litiges, garder un oeil sur les passes bloqués et agir vite sur les comptes qui degringolent en trust.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0 2xl:min-w-[650px] 2xl:max-w-[720px]">
              <FocusCard icon={<AlertTriangle className="w-4 h-4 text-red-300" aria-hidden="true" />} label="Litiges" value={adminInsights.openDisputes.length.toString()} detail="A trancher" tone="danger" />
              <FocusCard icon={<Users className="w-4 h-4 text-zoyd-yellow" aria-hidden="true" />} label="Reports" value={pendingReports.length.toString()} detail="En attente" tone="warning" />
              <FocusCard icon={<Swords className="w-4 h-4 text-green-400" aria-hidden="true" />} label="Salon live" value={matchQueues.live.length.toString()} detail="En cours" tone="success" />
              <FocusCard icon={<Lock className="w-4 h-4 text-zoyd-blue" aria-hidden="true" />} label="Pools gelés" value={frozenPools.toString()} detail="Sous hold" tone="neutral" />
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-[1500px] mx-auto px-4 sm:px-4 md:px-8 py-8 md:py-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-12">
          <StatCard icon={<Swords className="w-5 h-5 text-zoyd-blue" aria-hidden="true" />} label="MATCHS OUVERTS" value={adminInsights.operationalMatches.length.toString()} />
          <StatCard icon={<AlertTriangle className="w-5 h-5 text-red-400" aria-hidden="true" />} label="LITIGES OUVERTS" value={adminInsights.openDisputes.length.toString()} />
          <StatCard icon={<DollarSign className="w-5 h-5 text-zoyd-yellow" aria-hidden="true" />} label="PRIZEPOOLS" value={formatZC(adminInsights.totalPrizePool)} />
          // Revenu ZOYD = la commission de retrait (2 %). Les parts d'arbitre sont
// une sortie de cagnotte, affichees a part pour ne pas les compter comme
// des recettes.
<StatCard
            icon={<TrendingUp className="w-5 h-5 text-green-400" aria-hidden="true" />}
            label="REVENUS ZOYD (2 % RETRAITS)"
            value={formatZC(commissions.revenue)}
            hint={`${commissions.withdrawalCount} retrait(s) honoré(s)`}
          />
          <StatCard
            icon={<Scale className="w-5 h-5 text-white/60" aria-hidden="true" />}
            label="SORTIES ARBITRES"
            value={formatZC(commissions.arbiterPayouts)}
            hint="Part de cagnotte versée aux arbitres (sortie, pas revenu)"
          />
        </div>

        {/*
          Sauvegarde periodique. L historique reste dans la base, mais une
          base n est pas une sauvegarde tant que personne n a produit de copie
          a conserver ailleurs — et le fichier doit pouvoir etre genere
          SANS connexion SQL ni intervention du developpeur.
        */}
        <div className="flex flex-wrap items-center gap-2 mb-8 border border-white/10 p-3">
          <button
            type="button"
            onClick={() => handleExportHistory('csv')}
            disabled={exporting}
            className="flex items-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest hover:bg-white/10 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {exporting ? 'EXPORT...' : 'EXPORTER L HISTORIQUE (CSV)'}
          </button>
          <button
            type="button"
            onClick={() => handleExportHistory('json')}
            disabled={exporting}
            className="border border-white/20 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest hover:bg-white/10 disabled:opacity-40"
          >
            JSON
          </button>
          <span className="text-[10px] text-white/50">
            Sauvegarde a faire tous les 3 mois. 2FA requise.
          </span>
        </div>

        <div role="tablist" className="flex flex-wrap gap-2 mb-8">
          {[
            { id: 'overview', label: 'vue d\'ensemble', count: priorityQueue.length },
            { id: 'matches', label: 'matchs', count: filteredMatches.length },
            { id: 'disputes', label: 'litiges', count: adminInsights.openDisputes.length, urgent: escalatedDisputes.length },
            { id: 'users', label: 'utilisateurs', count: filteredUsers.length },
            { id: 'reports', label: 'signalements', count: pendingReports.length },
          ].map((tab: { id: string; label: string; count: number; urgent?: number }) => (
            <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} aria-label={`${tab.label} (${tab.count}${tab.urgent ? `, ${tab.urgent} urgents` : ''})`} onClick={() => setActiveTab(tab.id as typeof activeTab)} className={`relative px-4 sm:px-6 py-2.5 text-[10px] font-display font-black uppercase tracking-[0.15em] transition-all touch-target ${activeTab === tab.id ? 'bg-white text-black' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
              {tab.label} <span className="opacity-60">({tab.count})</span>
              {'urgent' in tab && tab.urgent !== undefined && tab.urgent > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] font-mono font-black text-white flex items-center justify-center">{tab.urgent}</span>}
            </button>
          ))}
        </div>
        {/*
          Une liste de signalements vide et une table injoignable sont
          identiques a l'ecran. Sans cet avertissement, l admin verrait
          « 0 signalement » et en conclurait que personne ne signale rien —
          alors que la lecture a peut-etre echoue. C'est la meme raison qui
          fait repondre 503 a la route plutot que `[]`.
        */}
        {reportsUnavailable && (
          <div className="mb-4 border border-orange-500/30 bg-orange-500/10 p-3 text-xs text-orange-200 flex items-start gap-2" role="status">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Signalements indisponibles : la table n'a pas pu etre lue. Les compteurs ci-dessous ne reflètent pas la file reelle — ne conclu pas que personne ne signale.
            </span>
          </div>
        )}
        {activeTab === 'overview' && <AdminOverviewTab priorityQueue={priorityQueue} readyMatchesCount={matchQueues.ready.length} liveMatchesCount={matchQueues.live.length} pendingReportsCount={pendingReports.length} recentEvents={adminInsights.recentEvents} onNavigateToTab={(tab) => setActiveTab(tab as typeof activeTab)} />}
        {activeTab === 'matches' && <AdminMatchesTab filteredMatches={filteredMatches} matchFilter={matchFilter} onFilterChange={setMatchFilter} onNavigateToTab={(tab) => setActiveTab(tab as typeof activeTab)} />}
        {activeTab === 'disputes' && <AdminUrgencyTab filteredDisputes={filteredDisputes} disputeFilter={disputeFilter} onFilterChange={setDisputeFilter} escalatedCount={escalatedDisputes.length} totalCount={adminInsights.openDisputes.length} pendingResolve={pendingResolve} onSetPendingResolve={setPendingResolve} onRequestCancel={(matchId) => setConfirmAction(matchId)} onResolveWinner={handleResolveWinner} onResolveDisputeOnly={handleResolveDisputeOnly} loadingAction={loadingAction} />}
        {activeTab === 'users' && <AdminUsersTab filteredUsers={filteredUsers} userFilter={userFilter} onFilterChange={setUserFilter} />}
        {activeTab === 'reports' && <AdminReportsTab reports={queueReports} unavailable={reportsUnavailable} resolvingId={resolvingId} sanctions={sanctions} revokingId={revokingId} onResolve={handleResolveReport} onRevoke={handleRevokeSanction} />}
      </main>

      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Confirmer l'annulation du match">
          <div className="bg-zoyd-surface border border-white/10 max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-white font-display font-black uppercase tracking-widest text-sm mb-2">
                  Confirmer l&apos;annulation ?
                </h3>
                <p className="text-white/60 text-sm">
                  Ce match sera annulé et les joueurs seront remboursés. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 border border-white/10 px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/60 hover:text-white transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => { const matchId = confirmAction; setConfirmAction(null); if (matchId) void handleCancelMatch(matchId); }}
                disabled={loadingAction}
                className="flex-1 border border-red-500/30 bg-red-500/10 px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
              >
                {loadingAction ? 'En cours...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboardPage;
