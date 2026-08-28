import React from 'react';
import type { TournamentMatch } from '../../../app/stores/tournamentStore';

const matchStatusLabels: Record<TournamentMatch['status'], string> = {
  pending: 'En attente',
  ready: 'Pret',
  live: 'En cours',
  finished: 'Termine',
};

const PlayerLine = React.memo(({ label, active, score }: { label: string; active: boolean; score?: number }) => (
  <div
    className={`flex items-center justify-between py-2 px-3 border border-white/5 mb-1 ${
      active ? 'bg-zoyd-yellow/10 border-zoyd-yellow/30' : 'bg-black/40'
    }`}
  >
    <span className={`font-display font-black text-sm uppercase italic ${active ? 'text-white' : 'text-white/40'}`}>
      {label}
    </span>
    <span className="font-mono font-black text-sm text-white/60">{score ?? '-'}</span>
  </div>
));

const BracketMatchCard = React.memo(({
  match,
  tournamentName,
  selected,
  onSelect,
  entryALabel,
  entryBLabel,
}: {
  match: TournamentMatch;
  tournamentName: string;
  selected: boolean;
  onSelect: () => void;
  entryALabel: string;
  entryBLabel: string;
}) => {
  const statusTone =
    match.status === 'live'
      ? 'text-zoyd-blue'
      : match.status === 'finished'
        ? 'text-white/30'
        : match.status === 'ready'
          ? 'text-zoyd-yellow'
          : 'text-white/40';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left relative border bg-zoyd-surface/30 p-4 transition-all ${
        selected ? 'border-zoyd-blue/40' : 'border-white/10 hover:border-white/20'
      }`}
      aria-label={`Ouvrir le match ${match.id} de ${tournamentName}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">
          {match.bracketType === 'third_place' ? 'Bronze' : `Match ${match.position}`}
        </span>
        <span className={`text-[9px] font-mono uppercase tracking-widest ${statusTone}`}>{matchStatusLabels[match.status]}</span>
      </div>

      <PlayerLine label={entryALabel} active={match.winnerEntryId === match.entryAId} score={match.scoreA} />
      <PlayerLine label={entryBLabel} active={match.winnerEntryId === match.entryBId} score={match.scoreB} />

      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-white/40">
        <span>
          {match.scheduledAt
            ? new Date(match.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            : 'A venir'}
        </span>
        <span>Poste arbitre #{match.arbiterSlot}</span>
      </div>
    </button>
  );
});

export default BracketMatchCard;
