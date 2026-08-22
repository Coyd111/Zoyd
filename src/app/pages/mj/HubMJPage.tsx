import React, { useMemo, useState } from 'react';
import { Crosshair, Search, Activity, Swords, ShieldCheck, Radio } from 'lucide-react';
import { MatchCard } from '../../components/MatchCard';
import { Link } from 'react-router';
import FriendsWidget from '../../components/social/FriendsWidget';
import { useMatchStore } from '../../stores/matchStore';

const MATCH_FORMATS = ['TOUS', '1VS1', '2VS2', '3VS3', '5VS5'] as const;
const STATUS_FILTERS = [
  { label: 'TOUS', value: 'all' },
  { label: 'OUVERTS', value: 'recruiting' },
  { label: 'PRESENCE', value: 'check_in' },
  { label: 'PRETS', value: 'ready' },
  { label: 'EN COURS', value: 'in_progress' },
] as const;

const HubMJPage: React.FC = () => {
  const { filters, setFilters, getFilteredMatches } = useMatchStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [needsArbiter, setNeedsArbiter] = useState(false);

  const filteredMatches = useMemo(() => {
    let baseMatches = getFilteredMatches();
    if (needsArbiter) {
      baseMatches = baseMatches.filter((match) => !match.arbiter && match.status !== 'finished' && match.status !== 'cancelled' && match.status !== 'forfeited');
    }
    return baseMatches.filter((match) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      const rules = typeof match.rules === 'string' ? {} : match.rules;
      return (
        (rules.map || '').toLowerCase().includes(query) ||
        (rules.mode || '').toLowerCase().includes(query) ||
        match.creatorPseudo.toLowerCase().includes(query)
      );
    });
  }, [getFilteredMatches, searchQuery, needsArbiter]);

  const metrics = useMemo(() => {
    const livePool = filteredMatches.reduce((sum, match) => sum + match.prizePool, 0);
    const arbitersNeeded = filteredMatches.filter((match) => !match.arbiter && match.status !== 'finished' && match.status !== 'cancelled' && match.status !== 'forfeited').length;
    return {
      active: filteredMatches.length,
      livePool,
      arbitersNeeded,
    };
  }, [filteredMatches]);

  return (
    <div className="min-h-screen bg-zoyd-black text-white scanline font-ui">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-black pt-14 md:pt-16 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src="/assets/maps/crash.jpg" alt="" loading="lazy" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none" />
          <img src="/assets/maps/standoff.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black via-transparent to-zoyd-black/50" />
        </div>
        <div className="relative z-10 max-w-[1600px] mx-auto px-4 md:px-8 pb-10 md:pb-20 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 md:gap-12">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 border border-zoyd-blue flex items-center justify-center text-zoyd-blue">
                <Swords className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-blue uppercase">Mode multijoueur</span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9] mb-4">
              L'Arène <br /><span className="text-white/20 underline decoration-zoyd-blue/50 underline-offset-8">ZOYD</span>
            </h1>
            <p className="text-white/40 text-lg md:text-xl font-light max-w-xl">
              Crée un wager, défie des adversaires de ton niveau, ou postule pour arbitrer les matchs en attente.
            </p>
          </div>

          <div className="hidden md:flex gap-10 border-l border-white/10 pl-10 py-4">
            <Metric label="Matchs Actifs" value={metrics.active.toString()} accent="text-white" />
            <Metric label="Prize Pool Global" value={`${metrics.livePool.toLocaleString()} ZC`} accent="text-zoyd-yellow" />
            <Metric label="Arbitres Demandés" value={metrics.arbitersNeeded.toString()} accent="text-zoyd-blue" />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-8 md:py-16 relative z-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        <div>
          <div className="flex flex-col lg:flex-row gap-8 mb-12 items-start lg:items-center">
            <div className="flex flex-wrap gap-2 flex-1">
              {MATCH_FORMATS.map((format) => (
                <button
                  key={format}
                  onClick={() => setFilters({ format: format === 'TOUS' ? 'all' : format })}
                  className={`px-6 py-4 text-[10px] font-display font-black tracking-widest uppercase italic transition-all border ${
                    (format === 'TOUS' && (!filters.format || filters.format === 'all')) || filters.format === format
                      ? 'bg-white text-black border-white'
                      : 'bg-black text-white/40 border-white/5 hover:border-white/20'
                  }`}
                >
                  {format}
                </button>
              ))}
              <div className="w-px h-10 bg-white/5 mx-2" />
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status.label}
                  onClick={() => setFilters({ status: status.value })}
                  className={`px-4 py-4 text-[10px] font-display font-black tracking-widest uppercase italic transition-all border flex items-center gap-2 ${
                    ((!filters.status || filters.status === 'all') && status.value === 'all') || filters.status === status.value
                      ? 'bg-zoyd-blue text-black border-zoyd-blue'
                      : 'bg-black text-white/40 border-white/5 hover:border-white/20'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  {status.label}
                </button>
              ))}
              <div className="w-px h-10 bg-white/5 mx-2" />
              <button
                onClick={() => setNeedsArbiter(!needsArbiter)}
                className={`px-4 py-4 text-[10px] font-display font-black tracking-widest uppercase italic transition-all border flex items-center gap-2 ${
                  needsArbiter
                    ? 'bg-zoyd-yellow text-black border-zoyd-yellow'
                    : 'bg-black text-white/40 border-white/5 hover:border-white/20'
                }`}
              >
                <ShieldCheck className="w-3 h-3" />
                SANS ARBITRE
              </button>
              <button
                onClick={() => setFilters({ minTrustScore: filters.minTrustScore ? undefined : 50 })}
                className={`px-4 py-4 text-[10px] font-display font-black tracking-widest uppercase italic transition-all border flex items-center gap-2 ${
                  filters.minTrustScore
                    ? 'bg-zoyd-blue text-black border-zoyd-blue'
                    : 'bg-black text-white/40 border-white/5 hover:border-white/20'
                }`}
              >
                FIABILITE 50+
              </button>
            </div>

            <div className="flex gap-4 w-full lg:w-[420px]">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Chercher une carte, un mode ou un joueur..."
                  className="w-full bg-black border border-white/5 text-xs font-display font-bold uppercase tracking-widest py-4 pl-12 pr-4 focus:outline-none focus:border-zoyd-blue transition-colors"
                />
              </div>
              <Link to="/mj/creer" className="bg-zoyd-yellow text-black px-8 py-4 flex items-center justify-center gap-3 font-display font-black uppercase tracking-widest text-xs hover:bg-white transition-colors italic whitespace-nowrap">
                <Activity className="w-4 h-4" /> CRÉER UN WAGER
              </Link>
            </div>
          </div>

          {filteredMatches.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {filteredMatches.map((match) => {
                const rules = typeof match.rules === 'string' ? {} : match.rules;
                return (
                <MatchCard
                  key={match.id}
                  id={match.id}
                  map={rules.map || ''}
                  format={match.format}
                  pot={match.prizePool}
                  entryFee={match.entryFee}
                  createdAt={match.createdAt}
                  scheduledAt={match.scheduledAt}
                  gameMode={rules.mode || ''}
                  rules={{
                    weapons: rules.weaponRestrictions,
                    score: rules.scoreTarget,
                    bestOf: rules.bestOf,
                  }}
                  teams={{
                    team1: { slots: match.teamSize, filled: match.players.filter((player) => player.team === 0).length },
                    team2: { slots: match.teamSize, filled: match.players.filter((player) => player.team === 1).length },
                  }}
                  arbitre={!!match.arbiter}
                  status={
                    match.status === 'recruiting'
                      ? 'open'
                      : match.status === 'full'
                        ? 'full'
                        : match.status === 'check_in'
                          ? 'check_in'
                          : match.status === 'ready'
                            ? 'ready'
                            : match.status === 'in_progress'
                              ? 'in_progress'
                              : match.status === 'forfeited'
                                ? 'forfeited'
                                : match.status === 'cancelled'
                                  ? 'cancelled'
                                  : 'finished'
                  }
                  trustScoreMin={match.trustScoreMin}
                />
                );
              })}
            </div>
          ) : (
            <div className="py-40 flex flex-col items-center justify-center text-center border-y border-dashed border-white/10 group bg-zoyd-surface/20">
              <div className="w-16 h-16 border border-white/10 flex items-center justify-center mb-8 text-white/10 group-hover:border-zoyd-yellow transition-colors">
                <Crosshair className="w-8 h-8" />
              </div>
              <h3 className="text-3xl font-display font-black text-white italic mb-4 uppercase tracking-tighter">L'arène est calme.</h3>
              <p className="text-white/40 max-w-md font-light mb-12">
                Sois le premier à imposer le respect. Lance un Wager et attends que tes adversaires relèvent le défi.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link to="/mj/creer" className="hud-panel px-12 py-5 text-sm font-display font-black tracking-widest uppercase hover:bg-white hover:text-black transition-colors">
                  Lancer un Wager
                </Link>
                <Link to="/wallet" className="border border-white/10 px-10 py-5 text-sm font-display font-black tracking-widest uppercase hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors">
                  Recharger Wallet
                </Link>
              </div>
            </div>
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-6">
            <FriendsWidget />
          </div>
        </aside>
      </main>
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

export default HubMJPage;
