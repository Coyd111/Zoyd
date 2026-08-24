import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Match, MatchPlayer } from '../../../app/stores/matchStore';

const RuleRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

const EvidencePanel = ({ title, items }: { title: string; items: string[] }) => (
  <div className="border border-white/5 bg-black/30 px-4 py-3">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">{title}</div>
    {items.length > 0 ? (
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="text-xs text-white/70 break-all">
            {item}
          </div>
        ))}
      </div>
    ) : (
      <div className="text-xs text-white/25">Aucune piece jointe.</div>
    )}
  </div>
);

interface MatchResultsProps {
  match: Match;
  forfeitLabel: string | null;
  currentPlayer: MatchPlayer | undefined;
  onConfirmResult: () => void;
}

export const MatchResults: React.FC<MatchResultsProps> = ({ match, forfeitLabel, currentPlayer, onConfirmResult }) => {
  if (!match.result) return null;

  const resultProofSummary = match.result.proofs;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg font-display font-black uppercase italic">Score confirme</h2>
        <div className="text-[10px] font-mono uppercase tracking-widest text-green-400 border border-green-400/20 px-3 py-1">
          Gains distribues
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <RuleRow label="Vainqueur" value={match.result.winnerTeam === 0 ? 'Squad Alpha' : 'Squad Bravo'} />
        <RuleRow label="Score Alpha" value={`${match.result.scores.team0}`} />
        <RuleRow label="Score Bravo" value={`${match.result.scores.team1}`} />
      </div>
      {forfeitLabel ? (
        <div className="mt-4 border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-4 py-3 text-sm text-white/70">
          {forfeitLabel}. Le gain a ete distribue automatiquement.
        </div>
      ) : null}
      {resultProofSummary ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <EvidencePanel title="Scoreboard" items={resultProofSummary.scoreboard} />
          <EvidencePanel title="Ecran final" items={resultProofSummary.finalResult} />
          <EvidencePanel title="Salle / room" items={resultProofSummary.roomCapture} />
          <EvidencePanel title="Autres preuves" items={resultProofSummary.extraEvidence} />
        </div>
      ) : null}
      {match.result.proofHash ? (
        <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-white/25">
          Proof hash: {match.result.proofHash}
        </div>
      ) : null}
      {currentPlayer && !match.result.confirmedByTeams.includes(currentPlayer.userId) && (
        <button
          onClick={onConfirmResult}
          className="mt-6 inline-flex items-center gap-2 border border-white/10 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest hover:border-zoyd-blue hover:text-zoyd-blue transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          Confirmer le score
        </button>
      )}
    </div>
  );
};
