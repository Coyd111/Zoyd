import React from 'react';
import { Badge } from './ui/Badge';
import { useSocketStore } from '../stores/socketStore';
import { formatZC } from '../../lib/utils';

const LiveTicker: React.FC = () => {
  const { liveMatches } = useSocketStore();

  if (liveMatches.length === 0) {
    return null;
  }

  return (
    <div className="bg-white/5 border-y border-white/10 py-3 overflow-hidden">
      <div className="flex items-center gap-6">
        <Badge variant="live" className="ml-4 flex-shrink-0">
          EN DIRECT
        </Badge>
        <div className="flex w-max gap-8 animate-marquee">
          {[...liveMatches, ...liveMatches].map((match, index) => (
            <div key={index} className="flex items-center gap-2 text-sm whitespace-nowrap">
              <span className="text-zoyd-yellow">DIRECT</span>
              <span className="text-white font-display font-semibold">
                {match.player1} vs {match.player2}
              </span>
              <span className="text-white/60">|</span>
              <span className="text-white/60">{match.format}</span>
              <span className="text-white/60">|</span>
              <span className="text-zoyd-yellow font-display font-bold">{formatZC(match.pot)}</span>
              <span className="text-white/60">|</span>
              <span className="text-white/60 uppercase">
                {match.status === 'ready' ? 'Salon pret' : 'Partie en cours'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export { LiveTicker };
