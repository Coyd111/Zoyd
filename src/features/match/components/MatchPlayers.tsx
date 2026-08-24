import React from 'react';
import { Clock3, CreditCard, ShieldCheck, Trophy } from 'lucide-react';
import { formatZC } from '../../../lib/utils';
import type { Match, MatchPlayer } from '../../../app/stores/matchStore';

const InfoCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="hud-panel p-5 bg-zoyd-surface/20">
    <div className="flex items-center gap-3 mb-3">
      {icon}
      <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">{label}</span>
    </div>
    <div className="text-2xl font-display font-black italic text-white">{value}</div>
  </div>
);

const TeamCard = ({
  title,
  players,
  teamSize,
  accent,
}: {
  title: string;
  players: MatchPlayer[];
  teamSize: number;
  accent: 'blue' | 'white';
}) => (
  <div className="hud-panel p-6 bg-zoyd-surface/20">
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-lg font-display font-black uppercase italic">{title}</h2>
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
        {players.length}/{teamSize} places
      </div>
    </div>
    <div className="space-y-3">
      {players.map((player) => (
        <div key={player.userId} className="flex items-center justify-between border border-white/5 px-4 py-3 bg-black/40">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${accent === 'blue' ? 'bg-zoyd-blue' : 'bg-white'}`} />
            <div>
              <div className="font-display font-black text-sm uppercase italic text-white">
                {player.pseudo}
                {player.isCaptain ? ' / Capitaine' : ''}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/20">
                {player.isCheckedIn ? 'Presence confirmee' : 'En attente'}
              </div>
            </div>
          </div>
          <div className={`text-[10px] font-mono uppercase tracking-widest ${player.isReady ? 'text-green-400' : 'text-white/20'}`}>
            {player.isReady ? 'Pret' : 'En attente'}
          </div>
        </div>
      ))}
      {Array.from({ length: Math.max(0, teamSize - players.length) }).map((_, index) => (
        <div key={index} className="border border-dashed border-white/10 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-white/20">
          Slot libre
        </div>
      ))}
    </div>
  </div>
);

interface MatchPlayersProps {
  match: Match;
  teamAlpha: MatchPlayer[];
  teamBravo: MatchPlayer[];
  countdown: string | null;
}

export const MatchPlayers: React.FC<MatchPlayersProps> = ({ match, teamAlpha, teamBravo, countdown }) => (
  <>
    <div className="grid md:grid-cols-4 gap-4">
      <InfoCard icon={<CreditCard className="w-5 h-5 text-zoyd-yellow" />} label="Mise" value={formatZC(match.entryFee)} />
      <InfoCard icon={<Trophy className="w-5 h-5 text-green-400" />} label="Cash Prize" value={formatZC(match.prizePool)} />
      <InfoCard icon={<ShieldCheck className="w-5 h-5 text-zoyd-blue" />} label="Arbitre" value={match.arbiter ? match.arbiter.pseudo : 'Libre'} />
      <InfoCard icon={<Clock3 className="w-5 h-5 text-white/50" />} label="Horaire" value={match.scheduledAt ? countdown || '00:00:00' : 'A fixer'} />
    </div>

    <div className="grid lg:grid-cols-2 gap-6">
      <TeamCard title="Squad Alpha" players={teamAlpha} teamSize={match.teamSize} accent="blue" />
      <TeamCard title="Squad Bravo" players={teamBravo} teamSize={match.teamSize} accent="white" />
    </div>
  </>
);
