import React from 'react';
import { ArrowRight, Clock3, Radio, Trophy, Users } from 'lucide-react';
import type { Tournament } from '../../../app/stores/tournamentStore';
import { formatZC, getRelativeTime } from '../../../lib/utils';

interface TournamentCardProps {
  tournament: Tournament;
}

const statusConfig: Record<Tournament['status'], { label: string; dot: string; tone: string; cta: string }> = {
  recruiting: {
    label: 'Inscriptions ouvertes',
    dot: 'bg-zoyd-yellow',
    tone: 'text-zoyd-yellow',
    cta: 'Voir le tournoi',
  },
  live: {
    label: 'Tournoi en cours',
    dot: 'bg-zoyd-blue animate-pulse',
    tone: 'text-zoyd-blue',
    cta: 'Suivre le tournoi',
  },
  completed: {
    label: 'Tournoi termine',
    dot: 'bg-white/20',
    tone: 'text-white/30',
    cta: 'Voir le resultat',
  },
  cancelled: {
    label: 'Annule',
    dot: 'bg-red-400/70',
    tone: 'text-red-300',
    cta: 'Consulter',
  },
};

export const TournamentCard: React.FC<TournamentCardProps> = React.memo(({ tournament }) => {
  const status = statusConfig[tournament.status];
  const completion = Math.min(100, (tournament.entries.length / tournament.maxEntries) * 100);
  const winner = tournament.entries.find((entry) => entry.finalPlacement === 1);
  const slotLabel = tournament.teamSize > 1 ? 'Equipes inscrites' : 'Places prises';
  const payoutLabel = tournament.teamSize > 1 ? 'Top 3 equipes recompensees' : 'Top 3 recompenses';
  const entryLabel = tournament.teamSize > 1 ? `${tournament.entries.length}/${tournament.maxEntries} equipes` : `${tournament.entries.length}/${tournament.maxEntries} inscrits`;

  return (
    <div
      className={`hud-panel h-full p-6 bg-zoyd-surface/20 transition-all duration-300 group ${
        tournament.status === 'live' ? 'border-zoyd-blue/40' : 'hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className={`text-[10px] font-mono font-black uppercase tracking-widest ${status.tone}`}>
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-white/40 uppercase">
          <Users className="w-3 h-3" />
          {entryLabel}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-3xl font-display font-black text-white italic uppercase tracking-tighter leading-tight mb-4 group-hover:text-zoyd-yellow transition-colors">
          {tournament.name}
        </h3>
        <div className="flex flex-wrap gap-3 text-[10px] font-mono uppercase tracking-widest text-white/30">
          <span>{tournament.format}</span>
          <span>{tournament.rules.mode}</span>
          <span>{tournament.rules.mapPool.join(' / ')}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-y border-white/5 py-4 mb-8">
        <div className="flex items-center gap-3">
          <Clock3 className="w-4 h-4 text-white/40" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">Depart</div>
            <div className="text-[10px] font-display font-black uppercase italic text-white">
              {tournament.status === 'completed'
                ? `Termine ${getRelativeTime(tournament.finishedAt || tournament.startsAt)}`
                : new Date(tournament.startsAt).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <Trophy className="w-4 h-4 text-zoyd-yellow" />
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">A gagner</div>
            <div className="text-[10px] font-display font-black uppercase italic text-zoyd-yellow">
              {formatZC(tournament.payout.playerPool)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto space-y-6">
        {winner ? (
          <div className="bg-white/5 border border-white/5 p-4 flex items-center justify-between group-hover:bg-zoyd-yellow/10 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 border border-white/10 flex items-center justify-center font-display font-black text-white bg-black">
                {winner.squadName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="text-[10px] font-display font-black text-zoyd-yellow uppercase italic tracking-widest">
                  Champion
                </div>
                <div className="font-display font-black text-white uppercase italic">{winner.squadName}</div>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">#1</span>
          </div>
        ) : (
          <div>
            <div className="flex justify-between text-[10px] font-mono font-black text-white/40 uppercase tracking-widest mb-2">
              <span>{slotLabel}</span>
              <span>
                {tournament.entries.length} / {tournament.maxEntries}
              </span>
            </div>
            <div className="w-full bg-white/5 h-1.5 overflow-hidden mb-4">
              <div
                className="bg-white h-full transition-all duration-700 w-[var(--progress)]"
                style={{ '--progress': `${completion}%` } as React.CSSProperties}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-white/30">
              <span className="inline-flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                Inscription {formatZC(tournament.entryFee)} / joueur
              </span>
              <span className="inline-flex items-center gap-2">
                <Radio className="w-3.5 h-3.5" />
                {payoutLabel}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/5 pt-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">
            Inscription {formatZC(tournament.entryFee)} / joueur
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-display font-black uppercase tracking-[0.18em] italic text-white group-hover:text-zoyd-yellow transition-colors">
            {status.cta}
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>
  );
});
