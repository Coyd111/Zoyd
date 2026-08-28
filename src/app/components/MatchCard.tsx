import React from 'react';
import { ShieldCheck, Clock, Radio, Users } from 'lucide-react';
import { formatZC, getRelativeTime } from '../../lib/utils';
import { getMapImage } from '../../lib/competition';
import { motion } from 'motion/react';
import { Link } from 'react-router';

interface MatchCardProps {
  id: string;
  map: string;
  format: string;
  pot: number;
  entryFee: number;
  createdAt: string;
  scheduledAt?: string;
  gameMode: string;
  rules: {
    weapons?: string;
    score: number;
    bestOf: number;
  };
  teams: {
    team1: { slots: number; filled: number };
    team2: { slots: number; filled: number };
  };
  arbitre: boolean;
  status: 'open' | 'full' | 'check_in' | 'ready' | 'in_progress' | 'finished' | 'forfeited' | 'cancelled';
  trustScoreMin?: number;
}

const statusCopy: Record<MatchCardProps['status'], { label: string; accent: string }> = {
  open: { label: 'Inscriptions ouvertes', accent: 'text-zoyd-yellow' },
  full: { label: 'Joueurs complets', accent: 'text-white' },
  check_in: { label: 'Presence a confirmer', accent: 'text-zoyd-blue' },
  ready: { label: 'Pret a jouer', accent: 'text-green-400' },
  in_progress: { label: 'Partie en cours', accent: 'text-zoyd-blue' },
  finished: { label: 'Partie terminee', accent: 'text-white/40' },
  forfeited: { label: 'Victoire par forfait', accent: 'text-zoyd-yellow' },
  cancelled: { label: 'Match annule', accent: 'text-red-300' },
};

const MatchCard: React.FC<MatchCardProps> = React.memo(({
  id,
  map,
  format,
  pot,
  entryFee,
  createdAt,
  scheduledAt,
  gameMode,
  rules,
  teams,
  arbitre,
  status,
  trustScoreMin,
}) => {
  const renderSlots = (filled: number, total: number, colorClass: string) => (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          className={`w-3.5 h-3.5 ${index < filled ? colorClass : 'bg-white/10'}`}
        />
      ))}
    </div>
  );

  const statusMeta = statusCopy[status];
  const totalPlayers = teams.team1.filled + teams.team2.filled;
  const maxPlayers = teams.team1.slots + teams.team2.slots;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="group"
    >
      <div className="p-6 transition-all duration-500 overflow-hidden">
        <div className="flex justify-between items-center mb-6 gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full ${status === 'in_progress' ? 'bg-zoyd-blue animate-pulse shadow-[0_0_8px_rgba(0,112,255,0.8)]' : 'bg-zoyd-yellow shadow-[0_0_8px_rgba(255,230,0,0.8)]'}`} />
            <span className={`text-[10px] font-display font-black uppercase tracking-[0.15em] ${statusMeta.accent}`}>
              {statusMeta.label}
            </span>
          </div>
          {trustScoreMin ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-black uppercase tracking-wider text-zoyd-yellow">
              <ShieldCheck className="w-3 h-3" />
              FIABILITE {trustScoreMin}+
            </div>
          ) : null}
        </div>

        <div className="relative h-24 -mx-6 mb-6 transition-colors overflow-hidden">
          {getMapImage(map) && (
            <img 
              src={getMapImage(map)}
              alt={map}
              className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity group-hover:opacity-60 transition-opacity duration-500"
            />
          )}
          <div className="absolute inset-0 w-full h-full tactical-grid opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent" />
          <div className="absolute inset-y-0 left-6 flex items-center z-10">
            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-zoyd-yellow uppercase tracking-widest font-black mb-1">Carte choisie</span>
              <h3 className="text-3xl font-display font-black tracking-tighter italic leading-none">
                {map} <span className="text-white/40">/</span> {format}
              </h3>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-3">
            <div className="text-[10px] font-mono text-white/40 uppercase mb-1">A gagner</div>
            <div className="font-display font-black text-xl text-white tracking-tight">{formatZC(pot)}</div>
            <div className="text-[10px] font-mono text-white/40 uppercase mt-1">Inscription: {formatZC(entryFee)}</div>
          </div>
          <div className="p-3">
            <div className="text-[10px] font-mono text-white/40 uppercase mb-1">Mode de jeu</div>
            <div className="font-display font-bold text-sm text-white uppercase truncate">
              {gameMode}
            </div>
            <div className="text-[10px] font-mono text-white/40 uppercase mt-1">
              BO{rules.bestOf} / {rules.score} pts
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-[10px] font-mono uppercase tracking-widest">
          <div className="flex items-center gap-2 text-white/40">
            <Users className="w-3.5 h-3.5" />
            {totalPlayers}/{maxPlayers} joueurs
          </div>
          <div className="flex items-center gap-2 text-white/40">
            <ShieldCheck className={`w-3.5 h-3.5 ${arbitre ? 'text-zoyd-blue' : 'text-white/40'}`} />
            {arbitre ? 'Arbitre confirme' : 'Arbitre a confirmer'}
          </div>
          <div className="flex items-center gap-2 text-white/30">
            <Clock className="w-3.5 h-3.5" />
            Publie {getRelativeTime(createdAt)}
          </div>
          <div className="flex items-center gap-2 text-white/30">
            <Radio className="w-3.5 h-3.5" />
            {scheduledAt ? new Date(scheduledAt).toLocaleString('fr-FR') : 'Horaire a fixer'}
          </div>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-black text-white/40 uppercase tracking-widest">
              Equipe Alpha
            </span>
            {renderSlots(teams.team1.filled, teams.team1.slots, 'bg-zoyd-blue')}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-black text-white/40 uppercase tracking-widest">
              Equipe Bravo
            </span>
            {renderSlots(teams.team2.filled, teams.team2.slots, 'bg-white')}
          </div>
        </div>

        <Link
          to={`/mj/match/${id}`}
          className="flex items-center justify-center p-4 border border-white/5 hover:border-white hover:bg-white hover:text-black transition-all font-display font-black tracking-widest uppercase text-xs italic"
        >
          {status === 'in_progress' ? 'Suivre la partie' : 'Voir le match'}
        </Link>
      </div>
    </motion.div>
  );
});

export { MatchCard };
