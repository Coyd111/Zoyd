import React from 'react';
import { CheckCircle2, Trophy } from 'lucide-react';
import { formatZC } from '../../../lib/utils';
import type { Tournament, TournamentMatch } from '../../../app/stores/tournamentStore';
import BracketMatchCard from './BracketMatchCard';

const getRoundLabel = (round: number, totalRounds: number) => {
  if (round === totalRounds) return 'Finale';
  if (round === totalRounds - 1) return 'Demies';
  if (round === totalRounds - 2) return 'Quarts';
  return `Round ${round}`;
};

const PayoutCard = ({ title, rows }: { title: string; rows: Array<[string, string]> }) => (
  <div className="hud-panel p-6 bg-zoyd-surface/20">
    <div className="flex items-center gap-3 mb-4">
      <Trophy className="w-4 h-4 text-zoyd-yellow" />
      <h2 className="text-lg font-display font-black uppercase italic">{title}</h2>
    </div>
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between border border-white/5 bg-black/30 px-4 py-3">
          <span className="text-sm font-display font-black uppercase italic text-white">{label}</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

interface BracketGridProps {
  tournament: Tournament;
  selectedMatchId: string;
  onSelectMatch: (id: string) => void;
  champion?: { squadName: string };
  bronzeMatch?: TournamentMatch;
}

const BracketGrid: React.FC<BracketGridProps> = ({
  tournament,
  selectedMatchId,
  onSelectMatch,
  champion,
  bronzeMatch,
}) => {
  const bracketRounds = Array.from({ length: tournament.mainRounds }, (_, index) => index + 1);

  return (
    <>
      <div className="hud-panel p-6 bg-zoyd-surface/20">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-display font-black uppercase italic">Tableau du tournoi</h2>
          {champion ? (
            <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow border border-zoyd-yellow/20 px-3 py-1">
              Champion: {champion.squadName}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-zoyd-black to-transparent z-10" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-zoyd-black to-transparent z-10" />
          <div className="flex gap-8 overflow-x-auto pb-4 scrollbar-hide">
          {bracketRounds.map((round) => (
            <div key={round} className="min-w-[280px] flex flex-col gap-5">
              <div className="text-center">
                <span className="text-[10px] font-mono font-black text-white/40 uppercase tracking-[0.35em] italic">
                  {getRoundLabel(round, tournament.mainRounds)}
                </span>
              </div>
              {tournament.matches
                .filter((match) => match.bracketType === 'main' && match.round === round)
                .map((match) => (
                  <BracketMatchCard
                    key={match.id}
                    match={match}
                    tournamentName={tournament.name}
                    selected={selectedMatchId === match.id}
                    onSelect={() => onSelectMatch(match.id)}
                    entryALabel={tournament.entries.find((entry) => entry.id === match.entryAId)?.squadName || 'A confirmer'}
                    entryBLabel={tournament.entries.find((entry) => entry.id === match.entryBId)?.squadName || 'A confirmer'}
                  />
                ))}
            </div>
          ))}

          {bronzeMatch ? (
            <div className="min-w-[280px] flex flex-col gap-5">
              <div className="text-center">
                <span className="text-[10px] font-mono font-black text-white/40 uppercase tracking-[0.35em] italic">
                  Bronze
                </span>
              </div>
              <BracketMatchCard
                match={bronzeMatch}
                tournamentName={tournament.name}
                selected={selectedMatchId === bronzeMatch.id}
                onSelect={() => onSelectMatch(bronzeMatch.id)}
                entryALabel={tournament.entries.find((entry) => entry.id === bronzeMatch.entryAId)?.squadName || 'A confirmer'}
                entryBLabel={tournament.entries.find((entry) => entry.id === bronzeMatch.entryBId)?.squadName || 'A confirmer'}
              />
            </div>
          ) : null}
        </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <PayoutCard
          title={tournament.teamSize > 1 ? 'Top 3 squads' : 'Top 3 joueurs'}
          rows={[
            ['1er', formatZC(tournament.payout.first)],
            ['2e', formatZC(tournament.payout.second)],
            ['3e', formatZC(tournament.payout.third)],
          ]}
        />
        <PayoutCard
          title="Supervision"
          rows={[
            ['Total', formatZC(tournament.payout.arbiterPool)],
            ['Par poste', formatZC(tournament.payout.arbiterPool / tournament.arbitersNeeded)],
            ['Retrait', '2% au cash-out'],
          ]}
        />
      </div>

      {champion ? (
        <div className="hud-panel p-6 bg-zoyd-surface/20">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <h2 className="text-lg font-display font-black uppercase italic">Podium final</h2>
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((placement) => {
              const entry = tournament.entries.find((candidate) => candidate.finalPlacement === placement);
              return (
                <div
                  key={placement}
                  className="border border-white/5 bg-black/40 px-4 py-3 flex items-center justify-between"
                >
                  <div className="font-display font-black text-sm uppercase italic text-white">
                    #{placement} {entry?.squadName || 'TBD'}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
                    {placement === 1
                      ? formatZC(tournament.payout.first)
                      : placement === 2
                        ? formatZC(tournament.payout.second)
                        : formatZC(tournament.payout.third)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
};

export default BracketGrid;
