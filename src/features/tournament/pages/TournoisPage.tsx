import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Search, Swords, Trophy, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../app/components/ui/Tabs';
import { TournamentCard } from '../components/TournamentCard';
import { useTournamentStore } from '../../../app/stores/tournamentStore';
import type { MatchFormat } from '../../../app/stores/matchStore';
import { fetchServerTournaments } from '../../../app/lib/tournamentApi';
import { formatZC } from '../../../lib/utils';

const FORMAT_FILTERS: Array<'TOUS' | MatchFormat> = ['TOUS', '1VS1', '2VS2', '3VS3', '5VS5'];

const TournoisPage: React.FC = () => {
  const { filters, setFilters, getFilteredTournaments, replaceFromServer } = useTournamentStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadTournaments = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const response = await fetchServerTournaments();
        if (cancelled) return;
        replaceFromServer(response.tournaments);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Impossible de charger les tournois.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTournaments();

    return () => {
      cancelled = true;
    };
  }, [replaceFromServer]);

  const tournaments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return getFilteredTournaments().filter((tournament) => {
      if (!query) return true;
      return (
        tournament.name.toLowerCase().includes(query) ||
        tournament.rules.mode.toLowerCase().includes(query) ||
        tournament.rules.mapPool.some((map) => map.toLowerCase().includes(query))
      );
    });
  }, [getFilteredTournaments, searchQuery]);

  const recruiting = tournaments.filter((tournament) => tournament.status === 'recruiting');
  const live = tournaments.filter((tournament) => tournament.status === 'live');
  const archive = tournaments.filter((tournament) => tournament.status === 'completed' || tournament.status === 'cancelled');

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
      <div className="min-h-screen bg-zoyd-black text-white scanline font-ui pb-20">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1650px] mx-auto px-8 py-24 relative z-10">
          <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-5 text-sm text-white/60">
            Chargement du circuit tournoi...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zoyd-black text-white scanline font-ui pb-20">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 pt-16">
        <div className="max-w-[1650px] mx-auto px-8 pb-20 flex flex-col lg:flex-row justify-between items-end gap-12">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
                <Trophy className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
                Tournois competitifs
              </span>
            </div>
            <h1 className="text-5xl md:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9] mb-4">
              Tournois <br />
              <span className="text-white/20 underline decoration-zoyd-yellow/50 underline-offset-8">ZOYD</span>
            </h1>
            <p className="text-white/40 text-lg md:text-xl font-light max-w-2xl">
              Retrouve les tournois ouverts, ceux qui se jouent deja et ceux qui viennent de se terminer.
              Ce que tu vois ici correspond deja a ton profil de jeu.
            </p>
            <div className="mt-6">
              <Link
                to="/mj/tournois/creer"
                className="inline-flex items-center gap-3 bg-zoyd-yellow text-black px-6 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Creer un tournoi
              </Link>
            </div>
          </div>

          <div className="hidden md:flex gap-10 border-l border-white/10 pl-10 py-4">
            <Metric label="Tournois visibles" value={metrics.visible.toString()} accent="text-white" />
            <Metric label="A gagner" value={formatZC(metrics.playerPool)} accent="text-zoyd-yellow" />
            <Metric label="Places ouvertes" value={metrics.openSlots.toString()} accent="text-zoyd-blue" />
          </div>
        </div>
      </header>

      <main className="max-w-[1650px] mx-auto px-8 py-16 relative z-10">
        {loadError ? (
          <div className="mb-8 border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-200">
            {loadError}
          </div>
        ) : null}
        <Tabs defaultValue="upcoming" className="w-full">
          <div className="flex flex-col gap-8 mb-12">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-8 border-b border-white/5 pb-10">
              <TabsList className="bg-white/5 p-1 border border-white/5 flex h-auto">
                <TabsTrigger
                  value="upcoming"
                  className="px-8 py-3 text-[10px] font-display font-black uppercase tracking-[0.15em] italic data-[state=active]:bg-white data-[state=active]:text-black transition-all rounded-none"
                >
                  A rejoindre
                </TabsTrigger>
                <TabsTrigger
                  value="live"
                  className="px-8 py-3 text-[10px] font-display font-black uppercase tracking-[0.15em] italic text-white/30 data-[state=active]:bg-zoyd-blue data-[state=active]:text-black transition-all rounded-none"
                >
                  En cours
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="px-8 py-3 text-[10px] font-display font-black uppercase tracking-[0.15em] italic text-white/30 data-[state=active]:bg-zoyd-surface data-[state=active]:text-white transition-all rounded-none"
                >
                  Termines
                </TabsTrigger>
              </TabsList>

              <div className="flex gap-4 w-full xl:w-[420px]">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Chercher un tournoi, un mode ou une carte..."
                    className="w-full bg-black border border-white/5 p-4 pl-12 text-[10px] font-mono font-black uppercase tracking-widest text-white focus:outline-none focus:border-zoyd-yellow transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {FORMAT_FILTERS.map((format) => (
                <button
                  key={format}
                  onClick={() => setFilters({ format: format === 'TOUS' ? 'all' : format })}
                  className={`px-5 py-3 text-[10px] font-display font-black tracking-widest uppercase italic transition-all border ${
                    (format === 'TOUS' && (!filters.format || filters.format === 'all')) || filters.format === format
                      ? 'bg-white text-black border-white'
                      : 'bg-black text-white/40 border-white/5 hover:border-white/20'
                  }`}
                >
                  {format}
                </button>
              ))}
              <div className="inline-flex items-center gap-2 border border-white/5 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-white/30">
                <Users className="w-3.5 h-3.5" />
                Solo et equipe
              </div>
              <div className="inline-flex items-center gap-2 border border-white/5 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-white/30">
                <Swords className="w-3.5 h-3.5" />
                Elimination directe
              </div>
              <div className="inline-flex items-center gap-2 border border-zoyd-yellow/20 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow/80">
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
        <div className="py-32 flex flex-col items-center justify-center text-center border-y border-dashed border-white/10 bg-zoyd-surface/20">
          <div className="w-16 h-16 border border-white/10 flex items-center justify-center mb-8 text-white/10">
            <Trophy className="w-8 h-8" />
          </div>
        <h3 className="text-3xl font-display font-black text-white italic mb-4 uppercase tracking-tighter">
          {emptyTitle}
        </h3>
        <p className="text-white/40 max-w-md font-light mb-8">{emptyBody}</p>
        <Link
          to="/mj/tournois/creer"
          className="inline-flex items-center gap-3 bg-zoyd-yellow text-black px-6 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          Creer un tournoi
        </Link>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-8">
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

const Metric = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="flex flex-col">
    <span className="text-[9px] font-mono font-bold text-white/30 uppercase tracking-widest mb-3 italic">{label}</span>
    <div className="flex items-baseline gap-2">
      <span className={`text-4xl font-display font-black italic ${accent}`}>{value}</span>
    </div>
  </div>
);

export default TournoisPage;
