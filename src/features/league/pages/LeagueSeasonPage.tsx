import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Trophy, Crown, Medal, Zap, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../app/components/ui/Tabs';
import { Button } from '../../../app/components/ui/Button';
import { useLeagueStore } from '../../../app/stores/leagueStore';
import { useAuthStore } from '../../../app/stores/authStore';
import {
  fetchServerLeagueSeason,
  joinServerLeagueSeason,
  leaveServerLeagueSeason,
  startServerLeagueDay,
  startServerLeagueQualification,
  advanceToServerLeagueFinal,
  submitServerLeagueFinalResults,
  updateServerLeagueSettings,
  reassignServerLeaguePlayer,
  refundServerLeaguePlayer,
} from '../../../app/lib/leagueApi';
import { toast } from 'sonner';
import { formatZC, getRelativeTime } from '../../../lib/utils';
import { applyServerAccountState } from '../../../app/lib/serverSync';
import { StandingsTable } from '../components/StandingsTable';
import { QualificationPanel } from '../components/QualificationPanel';
import { AdminPanel } from '../components/AdminPanel';
import { FinalResultsForm } from '../components/FinalResultsForm';
import { STATUS_LABELS } from '../components/leagueSeasonConstants';
import { Helmet } from 'react-helmet-async';

const LeagueSeasonPage = () => {
  const { seasonId } = useParams<{ seasonId: string }>();
  const { user } = useAuthStore();
  const { getSeasonById, replaceFromServer } = useLeagueStore();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('standings');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ action: string; payload?: Record<string, unknown>; message: string } | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const response = await fetchServerLeagueSeason(seasonId);
        if (cancelled) return;
        replaceFromServer([response.season]);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Erreur de chargement.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [seasonId, replaceFromServer]);

  const season = seasonId ? getSeasonById(seasonId) : undefined;

  const isRegistered = useMemo(() => {
    if (!season || !user) return false;
    return season.registeredPlayers.some((p) => p.userId === user.id);
  }, [season, user]);

  const myStanding = useMemo(() => {
    if (!season || !user) return null;
    return season.standings.find((s) => s.userId === user.id) || null;
  }, [season, user]);

  const handleJoin = async () => {
    if (!seasonId || actionLoading) return;
    try {
      setActionLoading(true);
      const response = await joinServerLeagueSeason(seasonId);
      replaceFromServer([response.season]);
      if (response.user && response.wallet) applyServerAccountState({ user: response.user, wallet: response.wallet });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de rejoindre la saison.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!seasonId || actionLoading) return;
    try {
      setActionLoading(true);
      const response = await leaveServerLeagueSeason(seasonId);
      replaceFromServer([response.season]);
      if (response.user && response.wallet) applyServerAccountState({ user: response.user, wallet: response.wallet });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de quitter la saison.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdminAction = async (action: string, payload?: Record<string, unknown>) => {
    if (!seasonId || actionLoading || user?.role !== 'admin') return;
    const destructiveActions = ['refund', 'reassign', 'submit-final-results', 'advance-to-final'];
    if (destructiveActions.includes(action)) {
      let message = '';
      switch (action) {
        case 'refund':
          message = `Confirmer le remboursement pour le joueur ${payload?.userId || ''} ?`;
          break;
        case 'reassign':
          message = `Confirmer la reassignation du joueur du ${payload?.fromDay} au ${payload?.toDay} ?`;
          break;
        case 'submit-final-results':
          message = 'Confirmer la soumission des resultats de finale ? Cette action est irreversible.';
          break;
        case 'advance-to-final':
          message = "Confirmer l'avancement vers la finale ? Cette action cloturera les qualifications.";
          break;
      }
      setConfirmAction({ action, payload, message });
      return;
    }
    executeAdminAction(action, payload);
  };

  const executeAdminAction = async (action: string, payload?: Record<string, unknown>) => {
    if (!seasonId || actionLoading || user?.role !== 'admin') return;
    try {
      setActionLoading(true);
      let response;
      switch (action) {
        case 'start-qualification':
          response = await startServerLeagueQualification(seasonId);
          break;
        case 'start-day':
          if (payload?.dayKey) response = await startServerLeagueDay(seasonId, payload.dayKey);
          break;
        case 'advance-to-final':
          response = await advanceToServerLeagueFinal(seasonId);
          break;
        case 'submit-final-results':
          if (payload?.results) response = await submitServerLeagueFinalResults(seasonId, payload.results);
          break;
        case 'update-settings':
          if (payload) {
            response = await updateServerLeagueSettings(seasonId, {
              maxPlayers: payload.maxPlayers,
              entryFee: payload.entryFee,
            });
          }
          break;
        case 'reassign':
          if (payload?.userId && payload?.fromDay && payload?.toDay) {
            response = await reassignServerLeaguePlayer(seasonId, payload.userId, payload.fromDay, payload.toDay);
          }
          break;
        case 'refund':
          if (payload?.userId) {
            response = await refundServerLeaguePlayer(seasonId, payload.userId);
          }
          break;
      }
      if (response) replaceFromServer([response.season]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de l'action admin.");
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-12 md:py-24 relative z-10">
          <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-5 text-sm text-white/60">
            Chargement de la saison...
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !season) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-12 md:py-24 relative z-10">
          <Link to="/br-league" className="flex items-center gap-2 text-sm text-white/40 hover:text-white mb-6">
            <ArrowLeft className="w-4 h-4" />
            Retour aux ligues
          </Link>
          <div className="border border-red-500/30 bg-red-500/10 px-6 py-5 text-sm text-red-400">
            {loadError || 'Saison introuvable.'}
          </div>
        </div>
      </div>
    );
  }

  const badge = STATUS_LABELS[season.status];

  return (
    <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
      <Helmet>
        <title>Saison BR — ZOYD</title>
        <meta name="description" content="Détails d'une saison de la ligue BR ZOYD." />
      </Helmet>
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="max-w-[1500px] mx-auto px-4 md:px-8 relative z-10">
        <div className="pt-8">
          <Link to="/br-league" className="flex items-center gap-2 text-sm text-white/40 hover:text-white mb-6">
            <ArrowLeft className="w-4 h-4" />
            Retour aux ligues
          </Link>
        </div>

        <header className="border-b border-white/5 pb-6 md:pb-10 mb-6 md:mb-10">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
                  <Zap className="w-4 h-4" />
                </div>
                <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 border ${badge.color}`}>
                  {badge.label}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-4xl font-black uppercase tracking-tight">
                BR League — Saison {season.cycleNumber}
              </h1>
              <p className="text-xs text-white/40 mt-2">
                Creee {getRelativeTime(season.createdAt)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {season.status === 'registering' && (
                isRegistered ? (
                  <button
                    onClick={handleLeave}
                    disabled={actionLoading}
                    className="border border-red-500/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                  >
                    Se desinscrire
                  </button>
                ) : (
                  <button
                    onClick={handleJoin}
                    disabled={actionLoading}
                    className="border border-zoyd-yellow/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50"
                  >
                    S&apos;inscrire — {formatZC(season.entryFee)}
                  </button>
                )
              )}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">Joueurs</div>
            <div className="text-xl font-black text-white">{season.registeredPlayers.length}/{season.maxPlayers}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">Pot</div>
            <div className="text-xl font-black text-zoyd-yellow">{formatZC(season.payout.gross)}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">1er</div>
            <div className="text-xl font-black text-green-400">{formatZC(season.payout.first)}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">
              {season.status === 'completed' ? 'Terminee' : myStanding ? 'Ta position' : 'Classement'}
            </div>
            <div className="text-xl font-black text-white">
              {season.status === 'completed'
                ? season.finishedAt ? getRelativeTime(season.finishedAt) : '—'
                : myStanding
                  ? `#${season.standings.indexOf(myStanding) + 1}`
                  : '—'}
            </div>
          </div>
        </div>

        {myStanding && (
          <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-4 py-3 mb-6 flex items-center gap-4">
            <Medal className="w-5 h-5 text-zoyd-yellow flex-shrink-0" />
            <div className="text-sm text-white">
              Tu es <span className="font-bold text-zoyd-yellow">#{season.standings.indexOf(myStanding) + 1}</span> avec{' '}
              <span className="font-bold text-white">{myStanding.totalPoints} points</span>
              {myStanding.bestPlacement > 0 && (
                <> — meilleur placement: <span className="font-bold text-white">#{myStanding.bestPlacement}</span></>
              )}
            </div>
          </div>
        )}

        {season.status === 'completed' && season.podium.first && (
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="border border-zoyd-yellow/30 bg-zoyd-yellow/5 px-4 py-4 text-center">
              <Crown className="w-6 h-6 text-zoyd-yellow mx-auto mb-2" />
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow mb-1">Champion</div>
              <div className="text-sm font-bold text-white">
                {season.registeredPlayers.find((p) => p.userId === season.podium.first)?.pseudo || '—'}
              </div>
              <div className="text-[10px] text-green-400 mt-1">{formatZC(season.payout.first)}</div>
            </div>
            <div className="border border-white/10 bg-white/5 px-4 py-4 text-center">
              <Medal className="w-6 h-6 text-white/40 mx-auto mb-2" />
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 mb-1">Vice-Champion</div>
              <div className="text-sm font-bold text-white">
                {season.registeredPlayers.find((p) => p.userId === season.podium.second)?.pseudo || '—'}
              </div>
              <div className="text-[10px] text-white/40 mt-1">{formatZC(season.payout.second)}</div>
            </div>
            <div className="border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-center">
              <Medal className="w-6 h-6 text-orange-400/60 mx-auto mb-2" />
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-orange-400/60 mb-1">3eme</div>
              <div className="text-sm font-bold text-white">
                {season.registeredPlayers.find((p) => p.userId === season.podium.third)?.pseudo || '—'}
              </div>
              <div className="text-[10px] text-orange-400/60 mt-1">{formatZC(season.payout.third)}</div>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="standings">CLASSEMENT</TabsTrigger>
            <TabsTrigger value="qualification">QUALIFICATION</TabsTrigger>
            {season.status === 'final' && <TabsTrigger value="final">FINALE</TabsTrigger>}
            {user?.role === 'admin' && <TabsTrigger value="admin">ADMIN</TabsTrigger>}
          </TabsList>

          <div className="mt-6">
            <TabsContent value="standings">
              <StandingsTable standings={season.standings} currentUserId={user?.id} />
            </TabsContent>

            <TabsContent value="qualification">
              <QualificationPanel
                season={season}
                currentUserId={user?.id}
                isAdmin={user?.role === 'admin'}
                onAdminAction={handleAdminAction}
                isActionLoading={actionLoading}
              />
            </TabsContent>

            <TabsContent value="final">
              {season.finalMatch.results.length > 0 ? (
                <div className="border border-white/10 bg-zoyd-surface/20 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">#</th>
                          <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
                          <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Kills</th>
                        </tr>
                      </thead>
                      <tbody>
                        {season.finalMatch.results.map((result, index) => {
                          const player = season.registeredPlayers.find((p) => p.userId === result.userId);
                          return (
                            <tr
                              key={result.userId}
                              className={`border-b border-white/5 ${
                                index === 0 ? 'bg-zoyd-yellow/5' : index < 3 ? 'bg-white/[0.02]' : ''
                              }`}
                            >
                              <td className="px-4 py-3">
                                <span className={`text-sm font-bold ${
                                  index === 0 ? 'text-zoyd-yellow' : index < 3 ? 'text-white/80' : 'text-white/40'
                                }`}>
                                  {result.placement}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-white">{player?.pseudo || '—'}</span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="text-sm text-white/60">{result.kills}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : season.status === 'final' && user?.role === 'admin' ? (
                <FinalResultsForm
                  finalists={season.finalists}
                  onsubmit={(results) => handleAdminAction('submit-final-results', { results })}
                  isLoading={actionLoading}
                />
              ) : (
                <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-12 text-center text-sm text-white/40">
                  La finale n&apos;a pas encore eu lieu.
                </div>
              )}
            </TabsContent>

            {user?.role === 'admin' && (
              <TabsContent value="admin">
                <AdminPanel
                  season={season}
                  onAdminAction={handleAdminAction}
                  isActionLoading={actionLoading}
                />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>

      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zoyd-surface border border-white/10 max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-white font-display font-black uppercase tracking-widest text-sm mb-2">
                  Confirmation requise
                </h3>
                <p className="text-white/60 text-sm">{confirmAction.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmAction(null)}
                disabled={actionLoading}
                className="flex-1"
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                onClick={() => executeAdminAction(confirmAction.action, confirmAction.payload)}
                disabled={actionLoading}
                className="flex-1"
              >
                {actionLoading ? 'Traitement...' : 'Confirmer'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeagueSeasonPage;
