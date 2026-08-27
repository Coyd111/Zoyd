import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BarChart3, CheckCircle2, Clock, MessageCircle, Plus, Swords, Trophy, Wallet, XCircle, Zap } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useChatStore } from '../stores/chatStore';
import { formatZC, getRelativeTime } from '../../lib/utils';
import { Helmet } from 'react-helmet-async';

const quickActions = [
  { label: 'MJ Hub', desc: 'Matchs & wagers', icon: Swords, path: '/mj', color: 'text-zoyd-blue' },
  { label: 'Tournois', desc: 'Competitions', icon: Trophy, path: '/mj/tournois', color: 'text-zoyd-yellow' },
  { label: 'BR League', desc: 'Battle Royale', icon: Zap, path: '/br-league', color: 'text-zoyd-yellow' },
  { label: 'Classements', desc: 'Leaderboard', icon: BarChart3, path: '/classements', color: 'text-zoyd-blue' },
];

const statusLabel: Record<string, string> = {
  recruiting: 'Inscriptions',
  full: 'Complet',
  check_in: 'Check-in',
  ready: 'Pret',
  in_progress: 'En cours',
};

const statusColor: Record<string, string> = {
  recruiting: 'text-green-400',
  full: 'text-zoyd-yellow',
  check_in: 'text-zoyd-blue',
  ready: 'text-zoyd-yellow',
  in_progress: 'text-green-400',
};

const DashboardPage: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const user = useAuthStore((s) => s.user);
  const { getTotalBalance, getAvailableCash, getAvailableToSpend } = useWalletStore();
  const matches = useMatchStore((s) => s.matches);
  const tournaments = useTournamentStore((s) => s.tournaments);
  const getUnreadTotal = useChatStore((s) => s.getUnreadTotal);

  const totalBalance = getTotalBalance();
  const unreadMessages = getUnreadTotal();

  const myActiveMatches = useMemo(
    () =>
      matches.filter(
        (m) =>
          m.players.some((p) => p.userId === user?.id) &&
          ['recruiting', 'full', 'check_in', 'ready', 'in_progress'].includes(m.status)
      ),
    [matches, user?.id]
  );

  const recentFinished = useMemo(() => {
    if (!user) return [];
    return matches
      .filter((m) => m.players.some((p) => p.userId === user.id) && m.status === 'finished' && m.result)
      .sort((a, b) => new Date(b.finishedAt || b.updatedAt).getTime() - new Date(a.finishedAt || a.updatedAt).getTime())
      .slice(0, 3);
  }, [matches, user]);

  const upcomingTournaments = useMemo(
    () =>
      tournaments
        .filter((t) => ['recruiting', 'full'].includes(t.status))
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .slice(0, 3),
    [tournaments]
  );

  if (!user) return null;

  const totalWins = recentFinished.filter((m) => {
    const myPlayer = m.players.find((p) => p.userId === user.id);
    return myPlayer && m.result?.winnerTeam === myPlayer.team;
  }).length;

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline safe-top">
      <Helmet>
        <title>Tableau de bord — ZOYD</title>
        <meta name="description" content="Ton espace ZOYD — matchs, wallet, progression." />
      </Helmet>

      <main className="max-w-[1600px] mx-auto px-5 md:px-8 pt-20 md:pt-28 pb-28 safe-bottom">
        {/* Hero greeting */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 md:mb-14"
        >
          <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-zoyd-yellow mb-3">
            Tableau de bord
          </div>
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-display font-black uppercase italic tracking-[-0.04em] leading-[0.9] mb-3">
            Bonjour,{' '}
            <span className="text-zoyd-yellow">{user.pseudo}</span>
          </h1>
          <p className="text-white/40 text-base md:text-lg max-w-2xl">
            {user.role === 'admin'
              ? 'Panel admin actif — tu as le controle total.'
              : 'Ton espace de competition. Matchs, gains et progression au meme endroit.'}
          </p>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.45 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10 md:mb-14"
        >
          <StatCard label="Wallet" value={formatZC(totalBalance)} accent />
          <StatCard label="Matchs actifs" value={String(myActiveMatches.length)} />
          <StatCard label="Victoires recentes" value={String(totalWins)} icon="win" />
          <StatCard label="Messages" value={String(unreadMessages)} />
        </motion.div>

        {/* Quick actions */}
        <div className="mb-10 md:mb-14">
          <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/40 mb-5">
            Acces rapide
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickActions.map((action, i) => (
              <motion.div
                key={action.path}
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + i * 0.06, duration: 0.4 }}
              >
                <Link
                  to={action.path}
                  className="group block p-5 md:p-6 border border-white/5 bg-zoyd-surface/20 hover:border-white/10 hover:bg-zoyd-surface/40 transition-all"
                >
                  <action.icon className={`w-5 h-5 ${action.color} mb-4`} />
                  <div className="font-display font-black text-sm md:text-base uppercase italic tracking-tight text-white mb-1">
                    {action.label}
                  </div>
                  <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                    {action.desc}
                  </div>
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] font-display font-black uppercase tracking-[0.2em] text-white/30 group-hover:text-zoyd-yellow transition-colors">
                    Entrer <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Two columns: Recent Activity + Upcoming Tournaments */}
        <div className="grid lg:grid-cols-5 gap-6 mb-10 md:mb-14">
          {/* Recent Activity — 3/5 */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.45 }}
            className="lg:col-span-3"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/40">
                Activite recente
              </div>
              {recentFinished.length > 0 && (
                <Link
                  to="/classements"
                  className="text-[10px] font-mono uppercase tracking-[0.2em] text-zoyd-yellow hover:text-white transition-colors"
                >
                  Tout voir
                </Link>
              )}
            </div>
            {recentFinished.length === 0 ? (
              <div className="p-6 border border-white/5 bg-zoyd-surface/20 text-center">
                <Swords className="w-8 h-8 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">Aucun match termine pour l&apos;instant.</p>
                <Link
                  to="/mj"
                  className="inline-flex items-center gap-2 mt-4 text-[10px] font-display font-black uppercase tracking-[0.2em] text-zoyd-yellow hover:text-white transition-colors"
                >
                  Jouer maintenant <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentFinished.map((match) => {
                  const myPlayer = match.players.find((p) => p.userId === user.id);
                  const won = myPlayer && match.result?.winnerTeam === myPlayer.team;
                  const scores = match.result?.scores;

                  return (
                    <Link
                      key={match.id}
                      to={`/mj/match/${match.id}`}
                      className="group flex items-center justify-between p-4 border border-white/5 bg-zoyd-surface/20 hover:border-white/10 transition-all"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 flex items-center justify-center border ${
                          won ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'
                        }`}>
                          {won ? (
                            <CheckCircle2 className="w-5 h-5 text-green-400" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`font-display font-black text-sm uppercase italic tracking-tight ${
                              won ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {won ? 'Victoire' : 'Defaite'}
                            </span>
                            <span className="text-[10px] font-mono text-white/30">
                              {match.format} • {match.rules.mode}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-1">
                            {scores ? `${scores.team0} - ${scores.team1}` : '—'} • {formatZC(match.entryFee)} • {getRelativeTime(match.finishedAt || match.updatedAt)}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" />
                    </Link>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* Upcoming Tournaments — 2/5 */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.36, duration: 0.45 }}
            className="lg:col-span-2"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/40">
                Tournois a venir
              </div>
              <Link
                to="/mj/tournois"
                className="text-[10px] font-mono uppercase tracking-[0.2em] text-zoyd-yellow hover:text-white transition-colors"
              >
                Voir tout
              </Link>
            </div>
            {upcomingTournaments.length === 0 ? (
              <div className="p-6 border border-white/5 bg-zoyd-surface/20 text-center">
                <Trophy className="w-8 h-8 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm">Pas de tournoi programmé.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingTournaments.map((t) => (
                  <Link
                    key={t.id}
                    to={`/mj/tournois/${t.id}`}
                    className="group block p-4 border border-white/5 bg-zoyd-surface/20 hover:border-white/10 transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-display font-black text-sm text-white uppercase italic tracking-tight truncate max-w-[70%]">
                        {t.name}
                      </div>
                      <span className={`text-[9px] font-mono uppercase tracking-widest ${statusColor[t.status] || 'text-white/40'}`}>
                        {statusLabel[t.status] || t.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-white/40">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(t.startsAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span>
                      <span>{t.format}</span>
                      <span>{formatZC(t.entryFee)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-[9px] font-mono text-white/30">
                        {t.entries.length}/{t.maxEntries} inscrits
                      </div>
                      <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-zoyd-yellow transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {/* Wallet + Profile row */}
        <div className="grid md:grid-cols-2 gap-4 mb-10 md:mb-14">
          {/* Wallet card */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.45 }}
            className="p-6 md:p-8 border border-zoyd-yellow/10 bg-zoyd-surface/20"
          >
            <div className="flex items-center gap-3 mb-6">
              <Wallet className="w-5 h-5 text-zoyd-yellow" />
              <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-zoyd-yellow">Mon wallet</div>
            </div>
            <div className="text-4xl md:text-5xl font-display font-black text-zoyd-yellow italic mb-6">
              {formatZC(totalBalance)}
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Cash</div>
                <div className="font-display font-black text-sm text-white italic">{formatZC(getAvailableCash())}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Disponible</div>
                <div className="font-display font-black text-sm text-white italic">{formatZC(getAvailableToSpend())}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                to="/wallet"
                className="flex-1 text-center bg-zoyd-yellow text-black py-3 font-display font-black text-[10px] uppercase tracking-[0.2em] italic hover:bg-white transition-colors"
              >
                Gérer
              </Link>
              <Link
                to="/wallet"
                className="flex-1 text-center border border-white/10 text-white/60 py-3 font-display font-black text-[10px] uppercase tracking-[0.2em] italic hover:text-white hover:border-white/20 transition-colors"
              >
                Historique
              </Link>
            </div>
          </motion.div>

          {/* Profile card */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.48, duration: 0.45 }}
            className="p-6 md:p-8 border border-white/5 bg-zoyd-surface/20"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 flex items-center justify-center font-display font-black text-xl text-white border border-white/10">
                {user.pseudo.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-display font-black text-lg text-white uppercase italic tracking-tight">{user.pseudo}</div>
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">{user.role}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Niveau</div>
                <div className="font-display font-black text-sm text-white italic">{user.progression?.level || 'DEBUTANT'}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Elo</div>
                <div className="font-display font-black text-sm text-zoyd-blue italic">{user.stats?.elo || 1000}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Trust</div>
                <div className="font-display font-black text-sm text-white italic">{user.trustScore || 50}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-1">Win rate</div>
                <div className="font-display font-black text-sm text-white italic">{user.stats?.winRate || 0}%</div>
              </div>
            </div>
            {/* XP Progress bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[9px] font-mono uppercase tracking-widest text-white/30">Progression XP</div>
                <div className="text-[9px] font-mono text-white/40">
                  {user.progression?.xp || 0} / {user.progression?.nextLevelXp || 100}
                </div>
              </div>
              <div className="h-1.5 bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-zoyd-yellow transition-all duration-500"
                  style={{
                    width: `${Math.min(100, ((user.progression?.xp || 0) / (user.progression?.nextLevelXp || 100)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <Link
              to="/profil"
              className="block text-center border border-white/10 text-white/60 py-3 font-display font-black text-[10px] uppercase tracking-[0.2em] italic hover:text-white hover:border-white/20 transition-colors"
            >
              Voir mon profil
            </Link>
          </motion.div>
        </div>

        {/* Active matches */}
        {myActiveMatches.length > 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.54, duration: 0.45 }}
          >
            <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/40 mb-5">
              Matchs actifs ({myActiveMatches.length})
            </div>
            <div className="space-y-3">
              {myActiveMatches.slice(0, 3).map((match) => (
                <Link
                  key={match.id}
                  to={`/mj/match/${match.id}`}
                  className="flex items-center justify-between p-4 border border-white/5 bg-zoyd-surface/20 hover:border-white/10 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${
                      match.status === 'in_progress' ? 'bg-green-500 animate-pulse' : 'bg-zoyd-yellow'
                    }`} />
                    <div>
                      <div className="font-display font-black text-sm text-white uppercase italic tracking-tight">
                        {match.format} — {match.rules.mode}
                      </div>
                      <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                        {match.entryFee} ZC • {match.players.length}/{match.maxPlayers} joueurs
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-white/30" />
                </Link>
              ))}
            </div>
          </motion.div>
        )}

        {/* CTA bottom */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.45 }}
          className="mt-10 md:mt-14 p-6 md:p-8 border border-white/5 bg-zoyd-surface/20 text-center"
        >
          <h2 className="text-xl md:text-2xl font-display font-black uppercase italic tracking-tight text-white mb-3">
            Pret a jouer ?
          </h2>
          <p className="text-white/40 text-sm mb-6 max-w-lg mx-auto">
            Cree un match instantane ou rejoins un tournoi en cours.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/mj/creer"
              className="inline-flex items-center gap-2 bg-zoyd-yellow text-black px-6 py-3 font-display font-black text-[10px] uppercase tracking-[0.2em] italic hover:bg-white transition-colors"
            >
              <Plus className="w-4 h-4" /> Creer un match
            </Link>
            <Link
              to="/chat"
              className="inline-flex items-center gap-2 border border-white/10 text-white/60 px-6 py-3 font-display font-black text-[10px] uppercase tracking-[0.2em] italic hover:text-white hover:border-white/20 transition-colors"
            >
              <MessageCircle className="w-4 h-4" /> Messages
              {unreadMessages > 0 && (
                <span className="bg-zoyd-blue text-white text-[9px] px-1.5 py-0.5 font-bold">{unreadMessages}</span>
              )}
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

const StatCard = React.memo(function StatCard({ label, value, accent, icon }: { label: string; value: string; accent?: boolean; icon?: 'win' }) {
  return (
    <div className="p-4 md:p-5 border border-white/5 bg-zoyd-surface/20">
      <div className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-2">{label}</div>
      <div className={`font-display font-black text-xl md:text-2xl italic ${
        accent ? 'text-zoyd-yellow' : icon === 'win' ? 'text-green-400' : 'text-white'
      }`}>
        {value}
      </div>
    </div>
  );
});

export default DashboardPage;
