import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  Award,
  Calendar,
  ChevronRight,
  Flag,
  Gamepad2,
  Globe,
  Joystick,
  LogOut,
  Monitor,
  ShieldCheck,
  Smartphone,
  Swords,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import EmptyPanel from '../components/EmptyPanel';
import { buildCompetitiveSummary } from '../../lib/profileMetrics';
import { formatZC } from '../../lib/utils';

const defaultLevel = { label: 'BEGINNER', color: 'text-white/40', bg: 'bg-white/5' } as const;

const levelConfig: Record<string, { label: string; color: string; bg: string }> = {
  BEGINNER: { label: 'BEGINNER', color: 'text-white/40', bg: 'bg-white/5' },
  COMPETITOR: { label: 'COMPETITOR', color: 'text-zoyd-yellow', bg: 'bg-zoyd-yellow/10' },
  CHALLENGER: { label: 'CHALLENGER', color: 'text-zoyd-blue', bg: 'bg-zoyd-blue/10' },
  ELITE: { label: 'ELITE', color: 'text-purple-400', bg: 'bg-purple-400/10' },
  PRO: { label: 'PRO', color: 'text-red-400', bg: 'bg-red-400/10' },
};

const controllerIcons: Record<string, React.ReactNode> = {
  touch: <Smartphone className="w-4 h-4" />,
  controller: <Joystick className="w-4 h-4" />,
  emulator: <Monitor className="w-4 h-4" />,
  pc: <Gamepad2 className="w-4 h-4" />,
  other: <Globe className="w-4 h-4" />,
};

const ProfilPage: React.FC = () => {
  const { user } = useAuthStore();
  const { matches } = useMatchStore();
  const { tournaments } = useTournamentStore();
  const prefersReducedMotion = useReducedMotion();

  if (!user) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Profil non disponible</h2>
          <Link to="/auth/login">
            <Button variant="primary">Connexion</Button>
          </Link>
        </div>
      </div>
    );
  }

  const summary = useMemo(
    () =>
      buildCompetitiveSummary({
        userId: user.id,
        overallTrustScore: user.trustScore,
        matches,
        tournaments,
        fallbackStats: user.stats,
        dateJoined: user.dateJoined,
      }),
    [matches, tournaments, user]
  );

  const progression = user.progression || { level: 'BEGINNER', xp: 0, nextLevelXp: 100 };
  const lvl = levelConfig[progression.level] || defaultLevel;
  const progressPercent =
    progression.nextLevelXp > 0
      ? Math.min(100, Math.round((progression.xp / progression.nextLevelXp) * 100))
      : 100;

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-24">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-black overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src="/assets/images/codm-2.jpg" alt="" loading="lazy" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none" />
          <img src="/assets/images/codm-3.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black via-zoyd-black/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-transparent to-transparent" />
        </div>
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 py-12">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-8">
            <div className="relative">
              <div className="w-20 h-20 sm:w-28 sm:h-28 border-2 border-white/10 bg-zoyd-surface flex items-center justify-center">
                <span className="text-3xl sm:text-5xl font-display font-black text-white/40 italic">
                  {user.pseudo.slice(0, 2).toUpperCase()}
                </span>
              </div>
              {user.isOnline ? (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-2 border-zoyd-black" />
              ) : null}
            </div>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-black uppercase tracking-tighter italic">
                  {user.pseudo}
                </h1>
                {user.streamerMode && user.streamerPseudo ? (
                  <Badge variant="yellow">STREAMER: {user.streamerPseudo}</Badge>
                ) : null}
                <Badge variant={user.trustScore >= 80 ? 'success' : user.trustScore >= 50 ? 'default' : 'disabled'}>
                  FIABILITE {user.trustScore}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm text-white/40 font-mono uppercase tracking-widest">
                <span className="flex items-center gap-2">
                  <Flag className="w-4 h-4" /> {user.country}
                </span>
                <span className="flex items-center gap-2">
                  {controllerIcons[user.controllerType] || controllerIcons.other} {user.controllerType}
                </span>
                <span className="flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4" /> ID CODM: {user.gameId}
                </span>
                <span className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Membre depuis {new Date(user.dateJoined).toLocaleDateString('fr-FR')}
                </span>
              </div>

              {user.bio ? <p className="mt-5 max-w-3xl text-white/52">{user.bio}</p> : null}
            </div>

            <div className={`${lvl.bg} border border-white/5 p-4 min-w-[210px] w-full sm:w-auto`}>
              <div className={`text-[10px] font-mono font-black uppercase tracking-widest mb-2 ${lvl.color}`}>
                {lvl.label}
              </div>
              <div className="text-3xl font-display font-black text-white italic">{progression.xp}</div>
              <div className="text-[9px] font-mono text-white/40 mt-1 mb-3">/ {progression.nextLevelXp} XP</div>
              <ProgressBar
                value={progressPercent}
                barClassName={
                  progression.level === 'PRO'
                    ? 'bg-red-400'
                    : progression.level === 'ELITE'
                      ? 'bg-purple-400'
                      : progression.level === 'CHALLENGER'
                        ? 'bg-zoyd-blue'
                        : 'bg-zoyd-yellow'
                }
              />
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mt-4">
                <Link to="/parametres" className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-white touch-target">
                  Modifier le profil <ChevronRight className="w-3 h-3" />
                </Link>
                <button
                  onClick={() => {
                    useAuthStore.getState().logout();
                  }}
                  className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-red-400/50 hover:text-red-400 touch-target"
                >
                  <LogOut className="w-3 h-3" aria-hidden="true" />
                  Se deconnecter
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        className="max-w-[1500px] mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-8 relative z-10"
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-mono uppercase tracking-widest text-zoyd-blue mb-3">Carrière Joueur</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatCard icon={<Trophy className="w-5 h-5 text-zoyd-yellow" />} label="Cash Prize Gagne" value={formatZC(summary.stats.totalEarnings)} />
                <StatCard icon={<Swords className="w-5 h-5 text-zoyd-blue" />} label="Matchs joues" value={summary.stats.totalMatches.toString()} />
                <StatCard icon={<Target className="w-5 h-5 text-green-400" />} label="Win rate" value={`${summary.stats.winRate}%`} />
                <StatCard icon={<Award className="w-5 h-5 text-purple-400" />} label="Tournois" value={`${summary.stats.tournamentsWon} / ${summary.stats.tournamentsPlayed}`} />
              </div>
            </div>

            <div className="pt-4 mt-2 border-t border-white/5">
              <h3 className="text-sm font-mono uppercase tracking-widest text-zoyd-yellow mb-3">Carrière Arbitre</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatCard icon={<ShieldCheck className="w-5 h-5 text-zoyd-yellow" />} label="Matchs arbitres" value={summary.arbiterStats.arbitratedMatches.toString()} />
                <StatCard icon={<Trophy className="w-5 h-5 text-green-400" />} label="Commissions generees" value={formatZC(summary.arbiterStats.totalCommissions)} />
              </div>
            </div>
          </div>

          <div className="hud-panel p-6 bg-zoyd-surface/20">
            <div className="flex items-center gap-3 mb-5">
              <ShieldCheck className="w-5 h-5 text-zoyd-yellow" />
              <h2 className="text-lg font-display font-black uppercase italic">Score de Fiabilité (Trust Score)</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <TrustCell label="Score global" value={`${summary.trust.overall}/100`} accent="text-zoyd-yellow" />
              <TrustCell label="Matchs completes" value={summary.trust.completedMatches.toString()} accent="text-white" />
              <TrustCell label="Litiges rencontres" value={summary.trust.disputedMatches.toString()} accent="text-zoyd-blue" />
              <TrustCell label="Forfaits connus" value={summary.trust.forfeits.toString()} accent={summary.trust.forfeits > 0 ? 'text-red-300' : 'text-green-400'} />
            </div>
            <p className="text-xs text-white/35 mt-4">
              Un bon Trust Score te permet d'acceder aux wagers High Rollers et de postuler comme Arbitre remunere sur ZOYD.
            </p>
          </div>

          <div className="hud-panel p-6 bg-zoyd-surface/20">
            <div className="flex items-center gap-3 mb-5">
              <Zap className="w-5 h-5 text-zoyd-blue" />
              <h2 className="text-lg font-display font-black uppercase italic">Tes reperes CODM</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <InfoRow label="Niveau CODM" value={`${user.levelCODM}`} />
              <InfoRow label="Rank MJ" value={user.rankMJ} />
              <InfoRow label="Rank BR" value={user.rankBR} />
              <InfoRow label="Pays" value={user.country} />
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-display font-black uppercase tracking-tighter italic">Tes derniers matchs</h2>
              <Link to="/mj" className="text-[10px] font-mono text-zoyd-blue uppercase tracking-widest flex items-center gap-1 hover:underline">
                Hub MJ <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            {summary.recentMatches.length === 0 ? (
              <EmptyPanel
                icon={<Swords className="w-8 h-8 text-white/10" />}
                image="/assets/images/codm-8.jpg"
                title="Aucun match recent"
                body="Tes prochaines parties terminees apparaitront ici, avec leur resultat et ce qu'elles t'ont rapporte."
              />
            ) : (
              <div className="space-y-3">
                {summary.recentMatches.map((match) => {
                  const player = match.players.find((entry) => entry.userId === user.id);
                  const isWin = !!match.result && !!player && player.team === match.result.winnerTeam;
                  return (
                    <div
                      key={match.id}
                      className="hud-panel p-4 bg-zoyd-surface/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zoyd-surface/30 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 ${isWin ? 'bg-green-500' : 'bg-white/20'}`} />
                        <div>
                          <div className="font-display font-black text-white text-sm uppercase italic">
                            {match.rules.map} <span className="text-white/40">///</span> {match.rules.mode}
                          </div>
                          <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
                            {match.format} / {new Date(match.finishedAt || match.createdAt).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-display font-black italic text-sm ${isWin ? 'text-zoyd-yellow' : 'text-white/50'}`}>
                          {isWin ? `+${formatZC(Math.max(0, match.prizePool - match.zoydFee - match.arbiterFee))}` : formatZC(match.entryFee)}
                        </div>
                        <div className="text-[10px] font-mono text-white/40 uppercase">
                          {match.status === 'disputed' ? 'LITIGE' : match.status}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-display font-black uppercase tracking-tighter italic">Tournois recents</h2>
              <Link to="/mj/tournois" className="text-[10px] font-mono text-zoyd-blue uppercase tracking-widest flex items-center gap-1 hover:underline">
                Voir les tournois <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            {summary.tournamentPlacements.length === 0 ? (
              <EmptyPanel
                icon={<Trophy className="w-8 h-8 text-white/10" />}
                image="/assets/images/codm-1.jpg"
                title="Aucun tournoi recent"
                body="Tes participations et tes podiums apparaitront ici des que tu auras boucle tes premiers tournois."
              />
            ) : (
              <div className="space-y-3">
                {summary.tournamentPlacements.map((placement) => (
                  <div
                    key={`${placement.tournamentId}-${placement.placement}`}
                    className="hud-panel p-4 bg-zoyd-surface/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zoyd-surface/30 transition-colors"
                  >
                    <div>
                      <div className="font-display font-black text-white text-sm uppercase italic">
                        {placement.name}
                      </div>
                      <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
                        {placement.format} / {placement.finishedAt ? new Date(placement.finishedAt).toLocaleDateString('fr-FR') : 'Resultat valide'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display font-black text-zoyd-yellow italic text-sm">
                        Top {placement.placement}
                      </div>
                      <div className="text-[10px] font-mono text-white/40 uppercase">
                        {placement.payout > 0 ? formatZC(placement.payout) : 'Participation'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </div>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="hud-panel p-4 sm:p-5 bg-zoyd-surface/20 flex items-center gap-4">
    <div className="w-10 h-10 border border-white/10 flex items-center justify-center bg-black">{icon}</div>
    <div>
      <div className="text-[9px] font-mono font-black uppercase tracking-widest text-white/30 mb-1">{label}</div>
      <div className="text-xl font-display font-black text-white italic">{value}</div>
    </div>
  </div>
);

const TrustCell = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className={`font-display font-black italic ${accent}`}>{value}</div>
  </div>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black italic text-white">{value}</div>
  </div>
);

export default ProfilPage;
