import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Trophy, Users, Calendar, Crown, Zap, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../app/components/ui/Tabs';
import { useLeagueStore, type LeagueSeason, type LeagueSeasonStatus } from '../../../app/stores/leagueStore';
import { useAuthStore } from '../../../app/stores/authStore';
import {
  fetchServerLeagues,
  joinServerLeagueSeason,
  leaveServerLeagueSeason,
  createServerLeagueSeason,
  startServerLeagueQualification,
} from '../../../app/lib/leagueApi';
import { toast } from 'sonner';
import { formatZC, formatFCFA, getRelativeTime } from '../../../lib/utils';
import { applyServerAccountState } from '../../../app/lib/serverSync';
import { Helmet } from 'react-helmet-async';

const STATUS_TABS: Array<{ value: LeagueSeasonStatus | 'all'; label: string }> = [
  { value: 'all', label: 'TOUT' },
  { value: 'registering', label: 'INSCRIPTIONS' },
  { value: 'qualifying', label: 'QUALIFICATION' },
  { value: 'final', label: 'FINALE' },
  { value: 'completed', label: 'TERMINE' },
];

const DAY_LABELS: Record<string, string> = {
  tuesday: 'Mar',
  wednesday: 'Mer',
  thursday: 'Jeu',
  friday: 'Ven',
  saturday: 'Sam',
};

const STATUS_BADGES: Record<LeagueSeasonStatus, { label: string; color: string }> = {
  registering: { label: 'Inscriptions ouvertes', color: 'text-green-400 border-green-400/30 bg-green-400/10' },
  qualifying: { label: 'Qualification en cours', color: 'text-zoyd-yellow border-zoyd-yellow/30 bg-zoyd-yellow/10' },
  final: { label: 'Finale', color: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  completed: { label: 'Termine', color: 'text-white/40 border-white/10 bg-white/5' },
};

const SeasonCard: React.FC<{
  season: LeagueSeason;
  currentUserId?: string;
  onJoin: (seasonId: string) => void;
  onLeave: (seasonId: string) => void;
  isActionLoading: boolean;
}> = React.memo(({ season, currentUserId, onJoin, onLeave, isActionLoading }) => {
  const isRegistered = season.registeredPlayers.some((p) => p.userId === currentUserId);
  const slotsLeft = season.maxPlayers - season.registeredPlayers.length;
  const badge = STATUS_BADGES[season.status];

  return (
    <Link
      to={`/br-league/${season.id}`}
      className="block border border-white/10 bg-zoyd-surface/30 hover:bg-zoyd-surface/50 transition-colors p-5 group"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-[10px] font-mono font-black tracking-[0.3em] text-zoyd-yellow uppercase mb-1">
            Cycle #{season.cycleNumber}
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-zoyd-yellow transition-colors">
            BR League — Saison {season.cycleNumber}
          </h3>
        </div>
        <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 border ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="border border-white/5 bg-white/5 px-3 py-2">
          <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Joueurs</div>
          <div className="text-sm font-bold text-white">{season.registeredPlayers.length}/{season.maxPlayers}</div>
        </div>
        <div className="border border-white/5 bg-white/5 px-3 py-2">
          <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Pot</div>
          <div className="text-sm font-bold text-zoyd-yellow">{formatZC(season.payout.gross)}</div>
        </div>
        <div className="border border-white/5 bg-white/5 px-3 py-2">
          <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">1er</div>
          <div className="text-sm font-bold text-green-400">{formatZC(season.payout.first)}</div>
        </div>
        <div className="border border-white/5 bg-white/5 px-3 py-2">
          <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Entree</div>
          <div className="text-sm font-bold text-white">{formatZC(season.entryFee)}</div>
        </div>
      </div>

      {season.status === 'registering' && (
        <div className="flex items-center justify-between border-t border-white/5 pt-3">
          <div className="text-[10px] text-white/40">
            {slotsLeft > 0 ? `${slotsLeft} place(s) restante(s)` : 'Complet'}
          </div>
          {currentUserId && (
            isRegistered ? (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLeave(season.id); }}
                disabled={isActionLoading}
                className="text-[10px] font-mono font-bold tracking-wider uppercase px-3 py-1.5 border border-red-500/30 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50 touch-target"
                aria-label="Se désinscrire de la saison"
              >
                Se desinscrire
              </button>
            ) : (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJoin(season.id); }}
                disabled={isActionLoading || slotsLeft <= 0}
                className="text-[10px] font-mono font-bold tracking-wider uppercase px-3 py-1.5 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
                aria-label="S'inscrire à la saison"
              >
                S'inscrire
              </button>
            )
          )}
        </div>
      )}

      {season.status === 'qualifying' && (
        <div className="border-t border-white/5 pt-3">
          <div className="flex gap-1.5">
            {Object.entries(season.qualificationGroups).map(([day, slot]) => (
              <div
                key={day}
                className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border ${
                  slot?.status === 'finished'
                    ? 'border-green-400/30 text-green-400 bg-green-400/10'
                    : slot?.status === 'live'
                      ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/10'
                      : 'border-white/10 text-white/30 bg-white/5'
                }`}
              >
                {DAY_LABELS[day] || day.slice(0, 3)}
              </div>
            ))}
          </div>
        </div>
      )}

      {season.status === 'completed' && season.podium.first && (
        <div className="border-t border-white/5 pt-3 flex items-center gap-2">
          <Crown className="w-4 h-4 text-zoyd-yellow" aria-hidden="true" />
          <span className="text-xs text-white/60">
            Vainqueur : <span className="text-white font-bold">{season.registeredPlayers.find((p) => p.userId === season.podium.first)?.pseudo || '—'}</span>
          </span>
        </div>
      )}
    </Link>
  );
});

SeasonCard.displayName = 'SeasonCard';

const LeaguePage: React.FC = () => {
  const { user } = useAuthStore();
  const { filters, setFilters, getFilteredSeasons, replaceFromServer, getActiveSeason } = useLeagueStore();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const response = await fetchServerLeagues();
        if (cancelled) return;
        replaceFromServer(response.seasons);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Erreur de chargement.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [replaceFromServer]);

  const seasons = useMemo(() => getFilteredSeasons(), [getFilteredSeasons]);
  const activeSeason = getActiveSeason();

  const handleJoin = async (seasonId: string) => {
    if (actionLoading) return;
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

  const handleLeave = async (seasonId: string) => {
    if (actionLoading) return;
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

  const handleCreateSeason = async () => {
    if (actionLoading || user?.role !== 'admin') return;
    try {
      setActionLoading(true);
      const response = await createServerLeagueSeason();
      replaceFromServer([response.season]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la création.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartQualification = async (seasonId: string) => {
    if (actionLoading || user?.role !== 'admin') return;
    try {
      setActionLoading(true);
      const response = await startServerLeagueQualification(seasonId);
      replaceFromServer([response.season]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors du lancement.");
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-12 md:py-24 relative z-10">
          <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-5 text-sm text-white/60">
            Chargement de la ligue BR...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
      <Helmet>
        <title>Battle Royale League — ZOYD</title>
        <meta name="description" content="Classement et saisons de la ligue BR ZOYD." />
      </Helmet>
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 pt-16">
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 pb-10 md:pb-20 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 md:gap-12">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-4 md:mb-6">
              <div className="w-8 h-8 md:w-10 md:h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
                <Zap className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
              </div>
              <span className="text-[10px] md:text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
                Battle Royale League
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-black uppercase tracking-tight leading-[0.9] mb-3 md:mb-5">
              BR<br />
              <span className="text-zoyd-yellow">League</span>
            </h1>
            <p className="text-xs md:text-sm text-white/50 max-w-lg leading-relaxed">
              500 joueurs. 5 jours de qualification. 1 finale. Le meilleur joueur de la semaine remporte le pot.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {activeSeason && (
              <Link
                to={`/br-league/${activeSeason.id}`}
                className="flex items-center gap-2 border border-zoyd-yellow/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors touch-target"
                aria-label={`Voir la saison active cycle ${activeSeason.cycleNumber}`}
              >
                <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                Saison active — Cycle #{activeSeason.cycleNumber}
                <ChevronRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            )}
            {user?.role === 'admin' && (
              <button
                onClick={handleCreateSeason}
                disabled={actionLoading}
                className="flex items-center gap-2 border border-white/10 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-white/60 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50 touch-target"
                aria-label="Créer une nouvelle saison de ligue"
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                Créer une saison
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 md:px-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 py-6 md:py-10 border-b border-white/5">
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] md:text-[10px] font-mono text-white/40 uppercase tracking-wider mb-1">Cycle en cours</div>
            <div className="text-xl md:text-2xl font-black text-white">
              {activeSeason ? `#${activeSeason.cycleNumber}` : '—'}
            </div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] md:text-[10px] font-mono text-white/40 uppercase tracking-wider mb-1">Joueurs inscrits</div>
            <div className="text-xl md:text-2xl font-black text-zoyd-yellow">
              {activeSeason?.registeredPlayers.length || 0}
            </div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] md:text-[10px] font-mono text-white/40 uppercase tracking-wider mb-1">Pot total</div>
            <div className="text-xl md:text-2xl font-black text-green-400">
              {activeSeason ? formatZC(activeSeason.payout.gross) : '—'}
            </div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] md:text-[10px] font-mono text-white/40 uppercase tracking-wider mb-1">Places restantes</div>
            <div className="text-xl md:text-2xl font-black text-white">
              {activeSeason ? Math.max(0, activeSeason.maxPlayers - activeSeason.registeredPlayers.length) : '—'}
            </div>
          </div>
        </div>

        {loadError && (
          <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 mt-6">
            {loadError}
          </div>
        )}

        <Tabs value={filters.status} onValueChange={(v) => setFilters({ status: v as LeagueSeasonStatus | 'all' })}>
          <div className="relative">
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-zoyd-black to-transparent z-10" />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-zoyd-black to-transparent z-10" />
            <div className="flex items-center gap-3 md:gap-4 py-4 md:py-6 overflow-x-auto scrollbar-hide">
            <TabsList>
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          </div>

          <TabsContent value={filters.status}>
            {seasons.length === 0 ? (
              <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-16 text-center">
                <Zap className="w-8 h-8 text-white/40 mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-white/40">
                  {filters.status === 'all'
                    ? 'Aucune saison de ligue pour le moment.'
                    : 'Aucune saison dans cette categorie.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
                {seasons.map((season) => (
                  <SeasonCard
                    key={season.id}
                    season={season}
                    currentUserId={user?.id}
                    onJoin={handleJoin}
                    onLeave={handleLeave}
                    isActionLoading={actionLoading}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default LeaguePage;
