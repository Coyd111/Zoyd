import React, { useMemo, Suspense } from 'react';
import { motion } from 'motion/react';
import {
  TrendingUp,
  DollarSign,
  Trophy,
  Activity,
  Clock,
  ShieldCheck,
  Zap,
  Wallet,
  Lock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';

const LazyEarningsAreaChart = React.lazy(() =>
  import('./EarningsCharts').then((m) => ({ default: m.EarningsAreaChart }))
);
const LazyMatchResultsBarChart = React.lazy(() =>
  import('./EarningsCharts').then((m) => ({ default: m.MatchResultsBarChart }))
);

const ChartFallback = () => (
  <div className="h-full w-full flex items-center justify-center">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/20 animate-pulse">Chargement...</div>
  </div>
);
import { useWalletStore } from '../stores/walletStore';
import { buildCompetitiveSummary } from '../../lib/profileMetrics';
import { buildWalletInsights } from '../../lib/communityInsights';
import { formatZC } from '../../lib/utils';

const getDeltaLabel = (current: number, previous: number, emptyLabel: string) => {
  if (current === 0 && previous === 0) return emptyLabel;
  if (previous === 0) return 'Premiere periode comparee';

  const delta = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  if (delta === 0) return 'Stable par rapport a avant';
  return `${delta > 0 ? '+' : ''}${delta}% par rapport a avant`;
};

const getTrustStatus = (trustScore?: number) => {
  if (typeof trustScore !== 'number') return 'A construire';
  if (trustScore >= 90) return 'Tres fiable';
  if (trustScore >= 75) return 'Solide';
  if (trustScore >= 50) return 'A surveiller';
  return 'Fragile';
};

const EarningsDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const { matches } = useMatchStore();
  const { tournaments } = useTournamentStore();
  const wallet = useWalletStore();

  const summary = useMemo(() => {
    if (!user) return null;
    return buildCompetitiveSummary({
      userId: user.id,
      overallTrustScore: user.trustScore,
      matches,
      tournaments,
      fallbackStats: user.stats,
      dateJoined: user.dateJoined,
    });
  }, [matches, tournaments, user]);

  const walletInsights = useMemo(() => buildWalletInsights(wallet.transactions, 30), [wallet.transactions]);

  const matchResultsData = useMemo(() => {
    const totalPlayed = summary?.stats.totalMatches || 0;
    const arbitrated = summary?.arbiterStats.arbitratedMatches || 0;
    return [
      { name: 'Matchs Joués', value: totalPlayed, color: '#FFCC00' },
      { name: 'Matchs Arbitrés', value: arbitrated, color: '#009EE2' },
    ];
  }, [summary]);

  if (!user || !summary) {
    return (
      <div className="min-h-screen bg-zoyd-black text-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase italic">Vue des gains indisponible</h2>
          <p className="mt-3 text-white/35">Connecte-toi pour retrouver ce que tes matchs et tournois t'ont rapporte.</p>
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: 'Total Généré',
      value: formatZC(summary.stats.totalEarnings + summary.arbiterStats.totalCommissions),
      subValue: '',
      icon: DollarSign,
      color: 'text-zoyd-yellow',
    },
    {
      label: 'Cash Prize (Joueur)',
      value: formatZC(summary.stats.totalEarnings),
      subValue: '',
      icon: Trophy,
      color: 'text-white',
    },
    {
      label: 'Commissions (Arbitre)',
      value: formatZC(summary.arbiterStats.totalCommissions),
      subValue: '',
      icon: ShieldCheck,
      color: 'text-green-400',
    },
    {
      label: 'Bilan de jeu (30j)',
      value: formatZC(walletInsights.currentPeriodNet),
      subValue: getDeltaLabel(walletInsights.currentPeriodNet, walletInsights.previousPeriodNet, 'Pas de mouvements'),
      icon: Activity,
      color: walletInsights.currentPeriodNet >= 0 ? 'text-zoyd-blue' : 'text-red-400',
    },
  ];

  return (
    <div className="min-h-screen bg-zoyd-black p-4 md:p-8 font-ui scanline relative overflow-hidden">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        <header className="mb-10 relative overflow-hidden border border-white/5">
          <img src="/assets/illustrations/tournament_cup.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
          <img src="/assets/maps/firing_range.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
          <div className="relative z-10 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 border border-zoyd-yellow/50 flex items-center justify-center text-zoyd-yellow bg-zoyd-yellow/5">
                <Zap className="w-6 h-6 fill-zoyd-yellow" />
              </div>
              <div>
                <h1 className="text-4xl font-display font-black text-white italic uppercase tracking-tighter">
                  TABLEAU DE BORD FINANCIER
                </h1>
                <p className="text-white/40 font-mono text-[10px] uppercase tracking-widest">
                  Suivi de tes Cash Prizes et de tes Commissions d'arbitrage
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
            >
              <Card className="bg-zoyd-surface/20 border-white/5 hover:border-white/10 transition-all group">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2 bg-white/5 border border-white/5 group-hover:border-white/20 transition-colors">
                      <stat.icon className={`w-5 h-5 ${stat.color}`} />
                    </div>
                    <Badge variant="default" className="bg-white/5 text-[9px] font-mono">
                      TON COMPTE
                    </Badge>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1">
                      {stat.label}
                    </div>
                    <div className="text-3xl font-display font-black text-white italic tracking-tighter mb-1">
                      {stat.value}
                    </div>
                    <div className="text-[11px] font-mono text-white/20 uppercase">{stat.subValue}</div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <Card className="lg:col-span-2 bg-zoyd-surface/20 border-white/5">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-xl font-display font-black italic uppercase text-white tracking-tighter">
                    Ton evolution sur 30 jours
                  </CardTitle>
                  <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest mt-1">
                    Gains, remboursements et mises deja passes par ton compte
                  </p>
                </div>
                <div className="px-3 py-1 bg-white/5 text-white text-[9px] font-mono font-black uppercase">
                  30 jours
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[350px] w-full mt-4">
                <Suspense fallback={<ChartFallback />}>
                  <LazyEarningsAreaChart data={walletInsights.trend} />
                </Suspense>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="bg-zoyd-surface/20 border-white/5">
              <CardHeader>
                <CardTitle className="text-sm font-mono font-black uppercase tracking-widest text-white/60">
                  Répartition de l'activité
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summary.stats.totalMatches + summary.arbiterStats.arbitratedMatches === 0 ? (
                  <div className="py-10 text-center text-[10px] font-mono uppercase tracking-widest text-white/20">
                    Pas assez de parties pour afficher cette vue
                  </div>
                ) : (
                  <>
                    <div className="h-[200px] w-full">
                      <Suspense fallback={<ChartFallback />}>
                        <LazyMatchResultsBarChart data={matchResultsData} />
                      </Suspense>
                    </div>
                    <div className="flex justify-around mt-4">
                      <div className="text-center">
                        <div className="text-2xl font-display font-black text-zoyd-yellow italic">
                          {summary.stats.totalMatches}
                        </div>
                        <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
                          Matchs Joués
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-display font-black text-zoyd-blue italic">
                          {summary.arbiterStats.arbitratedMatches}
                        </div>
                        <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
                          Matchs Arbitrés
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-zoyd-surface/20 border-white/5 border-l-4 border-l-zoyd-blue">
              <CardContent className="p-6 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 border border-zoyd-blue/20 flex items-center justify-center bg-zoyd-blue/5">
                    <ShieldCheck className="w-6 h-6 text-zoyd-blue" />
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-zoyd-blue uppercase font-black tracking-widest">
                      Fiabilite
                    </div>
                    <div className="text-2xl font-display font-black text-white italic tracking-tighter">
                      {user.trustScore}/100
                    </div>
                    <p className="text-[9px] font-mono text-white/20 uppercase mt-1">
                      Statut: {getTrustStatus(user.trustScore)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <MetricTile icon={<Wallet className="w-4 h-4 text-zoyd-yellow" />} label="Disponible" value={formatZC(wallet.getAvailableToSpend())} />
                  <MetricTile icon={<Lock className="w-4 h-4 text-zoyd-blue" />} label="En jeu" value={formatZC(wallet.lockedBalance)} />
                  <MetricTile icon={<TrendingUp className="w-4 h-4 text-green-400" />} label="Retirable" value={formatZC(wallet.cashBalance)} />
                  <MetricTile icon={<Clock className="w-4 h-4 text-white" />} label="En attente" value={formatZC(wallet.pendingWinnings)} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="bg-zoyd-surface/20 border-white/5 mb-8">
          <CardHeader>
            <CardTitle className="text-xl font-display font-black italic uppercase text-white tracking-tighter">
              Derniers mouvements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {walletInsights.recentTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                   className="flex items-center justify-between p-4 bg-black border border-white/5 group hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 border border-white/10 flex items-center justify-center bg-white/5">
                      <Trophy className="w-5 h-5 text-zoyd-yellow" />
                    </div>
                    <div>
                      <div className="text-xs font-display font-black text-white uppercase italic tracking-widest">
                        {transaction.description}
                      </div>
                      <div className="text-[10px] font-mono text-white/20 uppercase mt-1">
                        {new Date(transaction.timestamp).toLocaleDateString('fr-FR')} / {transaction.type}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-lg font-display font-black italic ${
                        transaction.amount >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {transaction.amount >= 0 ? '+' : ''}
                      {formatZC(transaction.amount)}
                    </div>
                    <div className="text-[9px] font-mono text-white/20 uppercase tracking-tighter">
                      Mouvement ZC
                    </div>
                  </div>
                </div>
              ))}

              {walletInsights.recentTransactions.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-12 h-12 border border-white/10 flex items-center justify-center mx-auto mb-4">
                    <Clock className="w-6 h-6 text-white/10" />
                  </div>
                  <p className="text-white/20 font-mono text-[10px] uppercase tracking-widest">
                    Aucun mouvement recent enregistre
                  </p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const MetricTile = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="border border-white/5 bg-black/30 p-3">
    <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest text-white/30 mb-2">
      {icon}
      {label}
    </div>
    <div className="font-display font-black italic text-white">{value}</div>
  </div>
);

export default EarningsDashboard;
