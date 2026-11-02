/**
 * PublicClassementsPage - /classements pour un visiteur ANONYME.
 *
 * La promesse produit : un visiteur sans session voit le VRAI classement
 * de la communaute, pas une vitrine figee ni une redirection login.
 *
 * Donnees : les deux endpoints DEJA publics du serveur
 * (server/routes/public.mjs) :
 * - GET /api/leaderboard : joueurs Avec activite, tries par ELO, cache
 *   60 s, sanitises (sanitizeUserPayload), rate-limits 'default'.
 * - GET /api/stats : comptes actifs, matchs joues, ZC distribues taux de
 *   paiements honores (cache 60 s).
 *
 * INVARIANT : un seule chargement par visite de page — PAS de socket, PAS
 * de bootstrap : photographie reelle rafraichie a chaque entree.
 * INVARIANT : AUCUN lien vers /profil/:id : la fiche publique exige une
 * session (gardes routes.tsx) — reciter un lien mort est un bug produit.
 * INVARIANT : rien de NOUVEAU n'est expose ici : pseudo, pays, stats,
 * presence sont deja publics dans la projection serveur (sanitizeUserPayload).
 * PIEGE : ne PAS brancher cette page sur les stores authentifies
 * (matchStore/tournamentStore/socketStore) : un visiteur anonyme ne
 * bootstrape pas — la page resterait vide et ressemblerait a une panne.
 * PIEGE : credentials 'omit' : la route publique ignore la session, et
 * envoyer un cookie sur un GET public ne sert a rien.
 * PIEGE : /api/stats est accessoire : sa panne n'arrete PAS le classement.
 *
 * Voir aussi : ClassementsGateway.tsx (arbitrage), ClassementsPage.tsx
 * (version authentifiee), server/routes/public.mjs, docs/08-frontend.md 10.1.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Crown, Medal, Target, TrendingUp, Trophy, Users } from 'lucide-react';
import { getApiUrl } from '../lib/apiClient';
import { Skeleton } from '../components/ui/Skeleton';
import { SEOHead } from '../components/SEOHead';
import { getTrustColor } from '../stores/trustScoreStore';
import { formatZC } from '../../lib/utils';

interface PublicPlayer {
  // id est deja expose par /api/leaderboard (sanitizeUserPayload) — deja
  // public depuis l'invention de la route. Utilise ici pour les CLE de
  // lignes uniquement (PAS de lien /profil/:id —see INVARIANT).
  id: string | number;
  pseudo: string;
  country: string;
  elo: number;
  winRate: number;
  totalMatches: number;
  totalEarnings: number;
  wins: number;
  trustScore: number;
  isOnline: boolean;
}

interface PublicStatsSnapshot {
  players: number;
  matchesPlayed: number;
  zcDistributed: number;
  payoutRate: number;
}

type PublicTab = 'elo' | 'earnings' | 'wins';

const visibleCount = 50; // = la requete : la vitrine d'un premier ecran, pas l'export admin.

const tabs: { id: PublicTab; label: string; icon: React.ComponentType<{ className?: string }>; metric: string }[] = [
  { id: 'elo', label: 'TOP ELO', icon: Trophy, metric: 'ELO' },
  { id: 'earnings', label: 'TOP GAINS', icon: TrendingUp, metric: 'GAINS' },
  { id: 'wins', label: 'VICTOIRES', icon: Target, metric: 'V' },
];

const rankIcon = (rank: number) => {
  if (rank === 1) return <Crown className="w-5 h-5 text-zoyd-yellow" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-white/60" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-orange-400" />;
  return <span className="text-sm font-display font-black text-white/70 w-5 text-center">{rank}</span>;
};

const sorters: Record<PublicTab, (left: PublicPlayer, right: PublicPlayer) => number> = {
  elo: (left, right) =>
    right.elo - left.elo || right.winRate - left.winRate || right.totalMatches - left.totalMatches,
  earnings: (left, right) =>
    right.totalEarnings - left.totalEarnings || right.wins - left.wins || right.elo - left.elo,
  wins: (left, right) =>
    right.wins - left.wins || right.winRate - left.winRate || right.totalMatches - left.totalMatches,
};

type PublicLoad =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; players: PublicPlayer[]; total: number; stats: PublicStatsSnapshot | null };

const PublicClassementsPage: React.FC = () => {
  const [state, setState] = useState<PublicLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState<PublicTab>('elo');
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState({ status: 'loading' });
      try {
        // Deux GET publics — la route leaderboard nexige PAS de session;
        // credentials 'omit' : pas de cookie sur un GET public.
        const [playersRes, statsRes] = await Promise.all([
          fetch(getApiUrl(`/api/leaderboard?limit=${visibleCount}`), { credentials: 'omit' }),
          fetch(getApiUrl('/api/stats'), { credentials: 'omit' }),
        ]);
        if (!playersRes.ok) throw new Error(`HTTP ${playersRes.status}`);
        const playersPayload = (await playersRes.json()) as { ok?: boolean; players?: PublicPlayer[]; total?: number };
        // /api/stats est accessoire : sa panne n'arrete pas le classement.
        let stats: PublicStatsSnapshot | null = null;
        if (statsRes.ok) {
          try {
            const statsPayload = (await statsRes.json()) as { stats?: PublicStatsSnapshot };
            if (statsPayload.stats) stats = statsPayload.stats;
          } catch {
            /* JSON trouble sur stats : on affiche sans la bande */
          }
        }
        if (cancelled) return;
        setState({
          status: 'ready',
          players: Array.isArray(playersPayload.players) ? playersPayload.players : [],
          total: typeof playersPayload.total === 'number' ? playersPayload.total : 0,
          stats,
        });
      } catch {
        if (cancelled) return;
        setState({ status: 'error' });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const entries = useMemo(() => {
    if (state.status !== 'ready') return [];
    return [...state.players].slice(0, visibleCount).sort(sorters[activeTab]).map((player, index) => ({
      player,
      rank: index + 1,
    }));
  }, [state, activeTab]);

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline">
      <SEOHead
        title="Classements publics — ZOYD"
        description="Le classement reel des joueurs ZOYD par Elo, gains et victoires. Aucune session requise."
        path="/classements"
      />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-black pt-16">
        <div className="absolute inset-0 z-0">
          <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none" />
          <img src="/assets/images/codm-6.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent" />
        </div>
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 pb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
              <Trophy className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
              Classements joueurs
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9]">
            Les
            <br />
            <span className="text-white/70 underline decoration-zoyd-yellow/50 underline-offset-8">
              meilleurs
            </span>
          </h1>
          <p className="mt-5 max-w-3xl text-sm text-white/70">
            Le classement reel de la communaute ZOYD, servi par le serveur et rafraichi a
            chaque visite. Connecte-toi pour voir TON rang, tes amis et tes gains detailles.
          </p>
          {state.status === 'ready' && state.stats ? (
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-[10px] font-mono uppercase tracking-widest text-white/70">
              <span>
                <span className="text-white font-black">{state.stats.players}</span> joueurs actifs
              </span>
              <span>
                <span className="text-white font-black">{state.stats.matchesPlayed}</span> matchs joues
              </span>
              <span>
                <span className="text-white font-black">{formatZC(state.stats.zcDistributed)}</span> distribues
              </span>
              <span>
                <span className="text-white font-black">{state.stats.payoutRate}%</span> paiements honores
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12 relative z-10">
        <div
          role="tablist"
          aria-label="Types de classements publics"
          className="flex flex-nowrap gap-2 mb-12 border-b border-white/5 pb-4 overflow-x-auto scrollbar-hide"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 font-display font-black text-[10px] tracking-[0.15em] italic uppercase transition-all border whitespace-nowrap touch-target ${
                  isActive
                    ? 'bg-white text-black border-white'
                    : 'text-white/60 border-white/5 hover:border-white/20 hover:text-white/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {state.status === 'loading' ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 bg-white/5" />
            ))}
          </div>
        ) : state.status === 'error' ? (
          <div className="border border-white/5 bg-zoyd-surface/10 p-6 md:p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-white/10 text-white/70">
              <Users className="w-6 h-6" />
            </div>
            <h2 className="font-display font-black text-xl uppercase italic text-white mb-2">
              Classement indisponible
            </h2>
            <p className="text-sm text-white/70 max-w-xl mx-auto mb-6">
              Le serveur n&apos;a pas repondu. Aucun rang invente n&apos;est affiche : reessaie
              dans un instant.
            </p>
            <button
              onClick={() => setAttempt((value) => value + 1)}
              className="border border-zoyd-yellow px-6 py-3 font-display font-black text-[10px] tracking-[0.2em] uppercase italic text-zoyd-yellow hover:bg-zoyd-yellow hover:text-black transition-colors touch-target"
            >
              Reessayer
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="border border-white/5 bg-zoyd-surface/10 p-6 md:p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-white/10 text-white/70">
              <Users className="w-6 h-6" />
            </div>
            <h2 className="font-display font-black text-xl uppercase italic text-white mb-2">
              Aucun classement pour le moment
            </h2>
            <p className="text-sm text-white/70 max-w-xl mx-auto">
              Cette vue se remplira des que des matchs auront ete joues et arbitres sur ZOYD.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-mono font-black uppercase tracking-widest text-white/70 italic">
              <div className="col-span-1">RANG</div>
              <div className="col-span-3">JOUEUR</div>
              <div className="col-span-1 text-center">PAYS</div>
              <div className="col-span-2">{tabs.find((tab) => tab.id === activeTab)?.metric}</div>
              <div className="col-span-1 text-right">WR%</div>
              <div className="col-span-2 text-right">GAINS</div>
              <div className="col-span-2 text-right">FIAB.</div>
            </div>

            {entries.map(({ player, rank }, index) => (
              <motion.div
                key={player.id}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                transition={prefersReducedMotion ? { duration: 0 } : { delay: Math.min(index * 0.04, 0.4) }}
                className="border border-white/5 bg-zoyd-surface/10 hover:bg-zoyd-surface/20 transition-all"
                data-testid="classements-public-row"
              >
                {/* Desktop */}
                <div className="hidden md:grid grid-cols-12 gap-4 items-center px-4 py-4">
                  <div className="col-span-1 flex items-center">{rankIcon(rank)}</div>
                  <div className="col-span-3 flex items-center gap-3">
                    <div className="w-8 h-8 border border-white/10 flex items-center justify-center font-display font-black text-white text-xs bg-black shrink-0">
                      {player.pseudo.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        data-testid="classements-public-pseudo"
                        className="font-display font-black text-white text-sm uppercase italic truncate"
                      >
                        {player.pseudo}
                      </div>
                      {player.isOnline ? (
                        <span aria-label="En ligne" className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      ) : null}
                    </div>
                  </div>
                  <div className="col-span-1 text-center text-[10px] font-mono text-white/70 uppercase truncate">
                    {player.country || '--'}
                  </div>
                  <div className="col-span-2 font-display font-black text-white text-sm italic">
                    {activeTab === 'earnings' ? formatZC(player.totalEarnings) : player[activeTab === 'elo' ? 'elo' : 'wins']}
                  </div>
                  <div className="col-span-1 text-right font-display font-black text-zoyd-blue text-sm">{player.winRate}%</div>
                  <div className="col-span-2 text-right font-display font-black text-zoyd-yellow text-sm italic">
                    {formatZC(player.totalEarnings)}
                  </div>
                  <div className="col-span-2 text-right">
                    <span className={`text-[10px] font-mono font-black ${getTrustColor(player.trustScore)}`}>
                      {player.trustScore}
                    </span>
                  </div>
                </div>

                {/* Mobile */}
                <div className="md:hidden flex items-center gap-3 px-4 py-3">
                  <div className="shrink-0">{rankIcon(rank)}</div>
                  <div className="w-8 h-8 border border-white/10 flex items-center justify-center font-display font-black text-white text-xs bg-black shrink-0">
                    {player.pseudo.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-black text-white text-sm uppercase italic truncate">
                      {player.pseudo}
                      {player.isOnline ? (
                        <span aria-label="En ligne" className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono text-white/60">
                      <span>{player.country || '--'}</span>
                      <span className="text-white/80">
                        {activeTab === 'earnings' ? formatZC(player.totalEarnings) : player[activeTab === 'elo' ? 'elo' : 'wins']}{' '}
                        {tabs.find((tab) => tab.id === activeTab)?.metric}
                      </span>
                      <span>{player.winRate}%</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-black text-zoyd-yellow text-sm italic">{formatZC(player.totalEarnings)}</div>
                    <div className={`text-[10px] font-mono font-black ${getTrustColor(player.trustScore)}`}>{player.trustScore}</div>
                  </div>
                </div>
              </motion.div>
            ))}

            {state.total > entries.length ? (
              <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-white/50">
                {state.total} joueurs classes — le top {entries.length} est affiche.
              </div>
            ) : null}
          </div>
        )}

        {/* CTA auth : la version authentifiee offre rang perso, amis, gains detailles. */}
        <div className="mt-10 border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="font-display font-black uppercase italic text-zoyd-yellow text-xl leading-tight mb-1">
              Vois TON rang aussi
            </div>
            <div className="text-sm text-white/70 max-w-xl">
              Cree un compte, joue un match arbitre, et entre dans les classements — ELO strict,
              gains Mobile Money, reputation verifiee.
            </div>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <Link
              to="/auth/register"
              className="bg-zoyd-yellow text-black px-7 py-3.5 font-display font-black uppercase tracking-[0.22em] text-xs md:text-sm italic hover:bg-white transition-colors touch-target"
            >
              Créer un compte
            </Link>
            <Link
              to="/auth/login"
              className="border border-white/10 px-7 py-3.5 font-display font-black uppercase tracking-[0.22em] text-xs md:text-sm italic text-white/60 hover:text-white hover:border-white/20 transition-colors touch-target"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicClassementsPage;
