import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Search, Swords, Trophy, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../app/components/ui/Tabs';
import { TournamentCard } from '../components/TournamentCard';
import { useTournamentStore } from '../../../app/stores/tournamentStore';
import type { MatchFormat } from '../../../app/stores/matchStore';
import { fetchServerTournaments } from '../../../app/lib/tournamentApi';
import { formatZC } from '../../../lib/utils';
import { useDebounce } from '../../../app/hooks/useDebounce';
import { Helmet } from 'react-helmet-async';

const FORMAT_FILTERS: Array<'TOUS' | MatchFormat> = ['TOUS', '1VS1', '2VS2', '3VS3', '5VS5'];

const TournoisPage: React.FC = () => {
  const filters = useTournamentStore((s) => s.filters);
  const setFilters = useTournamentStore((s) => s.setFilters);
  const getFilteredTournaments = useTournamentStore((s) => s.getFilteredTournaments);
  const replaceFromServer = useTournamentStore((s) => s.replaceFromServer);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setIsLoading(true);
        setLoadError(null);
        const response = await fetchServerTournaments();
        if (!controller.signal.aborted) {
          replaceFromServer(response.tournaments);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setLoadError(e instanceof Error ? e.message : 'Impossible de charger les tournois.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [replaceFromServer, reloadKey]);

  const tournaments = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    return getFilteredTournaments().filter((tournament) => {
      if (!query) return true;
      return (
        tournament.name.toLowerCase().includes(query) ||
        tournament.rules.mode.toLowerCase().includes(query) ||
        tournament.rules.mapPool.some((map) => map.toLowerCase().includes(query))
      );
    });
  }, [getFilteredTournaments, debouncedQuery]);

  const recruiting = useMemo(() => tournaments.filter((tournament) => tournament.status === 'recruiting'), [tournaments]);
  const live = useMemo(() => tournaments.filter((tournament) => tournament.status === 'live'), [tournaments]);
  const archive = useMemo(() => tournaments.filter((tournament) => tournament.status === 'completed' || tournament.status === 'cancelled'), [tournaments]);

  const metrics = useMemo(() => {
    const playerPool = tournaments.reduce((sum, tournament) => sum + tournament.payout.playerPool, 0);
    const openSlots = tournaments.reduce(
      (sum, tournament) => sum + Math.max(0, tournament.maxEntries - tournament.entries.length),
      0
    );
    return {
      visible: tournaments.length,
      playerPool,
      openSlots,
    };
  }, [tournaments]);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 safe-top">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-12 md:py-24 relative z-10">
          <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-5 text-sm text-white/60">
            Chargement du circuit tournoi...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 safe-top">
      <Helmet>
        <title>Tournois — ZOYD</title>
        <meta name="description" content="Parcours les tournois disponibles sur ZOYD." />
      </Helmet>
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 pt-16">
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 pb-10 md:pb-20 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 md:gap-12">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-4 md:mb-6">
              <div className="w-8 h-8 md:w-10 md:h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
                <Trophy className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <span className="text-[9px] md:text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
                Tournois competitifs
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9] mb-4">
              Tournois <br className="hidden sm:block" />
              <span className="text-white/40 underline decoration-zoyd-yellow/50 underline-offset-4 md:underline-offset-8 ml-2 sm:ml-0">ZOYD</span>
            </h1>
            <p className="text-white/40 text-base md:text-xl font-light max-w-2xl mb-6">
              Retrouve les tournois ouverts, ceux qui se jouent déjà et ceux qui viennent de se terminer.
              Ce que tu vois ici correspond déjà à ton profil de jeu.
            </p>
            <div className="mt-4 md:mt-6">
              <Link
                to="/mj/tournois/creer"
                className="inline-flex items-center justify-center w-full sm:w-auto gap-3 bg-zoyd-yellow text-black px-6 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Créer un tournoi
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap lg:flex-nowrap gap-6 md:gap-10 border-t lg:border-t-0 lg:border-l border-white/10 pt-6 lg:pt-0 lg:pl-10 py-2 md:py-4 w-full lg:w-auto mt-4 lg:mt-0">
            <Metric label="Tournois visibles" value={metrics.visible.toString()} accent="text-white" />
            <Metric label="A gagner" value={formatZC(metrics.playerPool)} accent="text-zoyd-yellow" />
            <Metric label="Places ouvertes" value={metrics.openSlots.toString()} accent="text-zoyd-blue" />
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 md:px-8 py-8 md:py-16 relative z-10">
        {loadError ? (
          <div className="mb-8 border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-200">
            {loadError}
            <button onClick={() => setReloadKey((k) => k + 1)} className="ml-4 underline hover:text-white">
              Réessayer
            </button>
          </div>
        ) : null}
        <Tabs defaultValue="upcoming" className="w-full">
          <div className="flex flex-col gap-6 md:gap-8 mb-8 md:mb-12">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 md:gap-8 border-b border-white/5 pb-6 md:pb-10">
              <TabsList className="bg-white/5 p-1 border border-white/5 flex flex-wrap sm:flex-nowrap h-auto w-full xl:w-auto">
                <TabsTrigger
                  value="upcoming"
                  aria-label="Tournois à rejoindre"
                  className="flex-1 sm:flex-none px-2 sm:px-6 md:px-8 py-3 text-[9px] md:text-[10px] font-display font-black uppercase tracking-[0.1em] md:tracking-[0.15em] italic data-[state=active]:bg-white data-[state=active]:text-black transition-all rounded-none"
                >
                  A rejoindre
                </TabsTrigger>
                <TabsTrigger
                  value="live"
                  aria-label="Tournois en cours"
                  className="flex-1 sm:flex-none px-2 sm:px-6 md:px-8 py-3 text-[9px] md:text-[10px] font-display font-black uppercase tracking-[0.1em] md:tracking-[0.15em] italic text-white/30 data-[state=active]:bg-zoyd-blue data-[state=active]:text-black transition-all rounded-none"
                >
                  En cours
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  aria-label="Historique des tournois terminés"
                  className="flex-1 sm:flex-none px-2 sm:px-6 md:px-8 py-3 text-[9px] md:text-[10px] font-display font-black uppercase tracking-[0.1em] md:tracking-[0.15em] italic text-white/30 data-[state=active]:bg-zoyd-surface data-[state=active]:text-white transition-all rounded-none"
                >
                  Termines
                </TabsTrigger>
              </TabsList>

              <div className="flex gap-4 w-full xl:w-[420px]">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Chercher un tournoi, un mode ou une carte..."
                    aria-label="Rechercher un tournoi par nom, mode ou carte"
                    className="w-full bg-black border border-white/5 p-4 pl-12 text-[10px] font-mono font-black uppercase tracking-widest text-white focus:border-zoyd-yellow transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 md:gap-3">
              {FORMAT_FILTERS.map((format) => (
                <button
                  key={format}
                  onClick={() => setFilters({ format: format === 'TOUS' ? 'all' : format })}
                  className={`px-4 sm:px-5 py-2.5 sm:py-3 text-[9px] sm:text-[10px] font-display font-black tracking-widest uppercase italic transition-all border ${
                    (format === 'TOUS' && (!filters.format || filters.format === 'all')) || filters.format === format
                      ? 'bg-white text-black border-white'
                      : 'bg-black text-white/40 border-white/5 hover:border-white/20'
                  }`}
                >
                  {format}
                </button>
              ))}
              <div className="inline-flex items-center gap-2 border border-white/5 px-3 sm:px-4 py-2.5 sm:py-3 text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-white/30">
                <Users className="w-3.5 h-3.5" />
                Solo et equipe
              </div>
              <div className="inline-flex items-center gap-2 border border-white/5 px-3 sm:px-4 py-2.5 sm:py-3 text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-white/30">
                <Swords className="w-3.5 h-3.5" />
                Elimination directe
              </div>
              <div className="inline-flex items-center gap-2 border border-zoyd-yellow/20 px-3 sm:px-4 py-2.5 sm:py-3 text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow/80">
                <Trophy className="w-3.5 h-3.5" />
                Selon ton profil
              </div>
            </div>
          </div>

          <TabsContent value="upcoming" className="mt-0 outline-none">
            <TournamentGrid
              tournaments={recruiting}
              emptyTitle="Aucun tournoi ouvert"
              emptyBody="Aucune inscription n'est ouverte pour tes filtres du moment. Le prochain tournoi disponible apparaitra ici."
            />
          </TabsContent>

          <TabsContent value="live" className="mt-0 outline-none">
            <TournamentGrid
              tournaments={live}
              emptyTitle="Aucun tournoi en cours"
              emptyBody="Aucun tournoi n'est en train de se jouer pour tes filtres du moment. Les rencontres en cours apparaitront ici."
            />
          </TabsContent>

          <TabsContent value="history" className="mt-0 outline-none">
            <TournamentGrid
              tournaments={archive}
              emptyTitle="Aucune archive disponible"
              emptyBody="Les tournois termines et leurs resultats apparaitront ici."
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

const TournamentGrid = ({
  tournaments,
  emptyTitle,
  emptyBody,
}: {
  tournaments: ReturnType<typeof useTournamentStore.getState>['tournaments'];
  emptyTitle: string;
  emptyBody: string;
}) => {
  if (tournaments.length === 0) {
    return (
        <div className="py-20 md:py-32 px-4 flex flex-col items-center justify-center text-center border-y border-dashed border-white/10 bg-zoyd-surface/20">
          <div className="w-12 h-12 md:w-16 md:h-16 border border-white/10 flex items-center justify-center mb-6 md:mb-8 text-white/10">
            <Trophy className="w-6 h-6 md:w-8 md:h-8" />
          </div>
        <h3 className="text-2xl sm:text-3xl font-display font-black text-white italic mb-4 uppercase tracking-tighter">
          {emptyTitle}
        </h3>
        <p className="text-white/40 max-w-md font-light mb-6 md:mb-8 text-sm md:text-base">{emptyBody}</p>
        <Link
          to="/mj/tournois/creer"
          className="inline-flex items-center gap-3 bg-zoyd-yellow text-black px-6 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          Créer un tournoi
        </Link>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6 md:gap-8">
      {tournaments.map((tournament) => (
        <Link
          key={tournament.id}
          to={`/mj/tournois/${tournament.id}`}
          className="block hover:opacity-95 transition-opacity"
        >
          <TournamentCard tournament={tournament} />
        </Link>
      ))}
    </div>
  );
};

const Metric = React.memo(({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="flex flex-col">
    <span className="text-[10px] md:text-[9px] font-mono font-bold text-white/40 uppercase tracking-[0.2em] md:tracking-widest mb-2 md:mb-3 italic">{label}</span>
    <div className="flex items-baseline gap-2">
      <span className={`text-3xl sm:text-4xl font-display font-black italic ${accent}`}>{value}</span>
    </div>
  </div>
));

export default TournoisPage;
