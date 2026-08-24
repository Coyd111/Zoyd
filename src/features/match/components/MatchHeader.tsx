import React from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Radio, Swords } from 'lucide-react';
import { formatZC } from '../../../lib/utils';
import { getMapImage } from '../../../lib/competition';
import type { Match } from '../../../app/stores/matchStore';

interface MatchHeaderProps {
  match: Match;
  statusLabel: string;
}

export const MatchHeader: React.FC<MatchHeaderProps> = ({ match, statusLabel }) => (
  <>
    <div className="flex items-center justify-between gap-4 mb-8">
      <Link to="/mj" className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest">
        <ArrowLeft className="w-4 h-4" />
        Retour aux matchs
      </Link>
      <div className="inline-flex items-center gap-2 border border-white/10 px-4 py-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/50">
        <Radio className="w-3.5 h-3.5 text-zoyd-blue" />
        {statusLabel}
      </div>
    </div>

    <header className="relative mb-10 overflow-hidden min-h-[300px] flex flex-col justify-end p-5 sm:p-8 -mx-4 sm:-mx-6 md:mx-0">
      {getMapImage(match.rules.map) && (
        <img
          src={getMapImage(match.rules.map)}
          alt={match.rules.map}
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/80 to-transparent" />
      <div className="absolute inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="relative z-10">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="w-12 h-12 flex items-center justify-center text-zoyd-yellow">
            <Swords className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.35em] text-zoyd-yellow">LOBBY DU WAGER</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-display font-black italic uppercase tracking-tighter">
          {match.rules.map} <span className="text-white/20">/</span> {match.rules.mode}
        </h1>
        <p className="text-white/40 mt-3 max-w-3xl">
          {match.format} / Wager: {formatZC(match.entryFee)} / Cash Prize: {formatZC(match.prizePool)} / Créé par {match.creatorPseudo}
        </p>
      </div>
    </header>
  </>
);
