import React from 'react';
import { Filter } from 'lucide-react';
import { formatZC, getRelativeTime } from '../../../lib/utils';
import { StatusPill, MetaChip, statusToneMap } from './AdminTabShared';
import type { Match } from '../../stores/matchStore';
import type { MatchFilter } from './AdminTabShared';

type AdminMatchesTabProps = {
  filteredMatches: Match[];
  matchFilter: MatchFilter;
  onFilterChange: (filter: MatchFilter) => void;
  onNavigateToTab: (tab: string) => void;
};

const AdminMatchesTab: React.FC<AdminMatchesTabProps> = ({
  filteredMatches,
  matchFilter,
  onFilterChange,
  onNavigateToTab,
}) => (
  <div className="space-y-5">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-display font-black uppercase italic">Operations Match</h2>
        <p className="text-white/35 text-sm">
          Filtre les files pour voir rapidement ce qui attend une decision humaine.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'priority', label: 'Priorite' },
          { id: 'active', label: 'Actifs' },
          { id: 'closed', label: 'Clotures' },
          { id: 'all', label: 'Tous' },
        ].map((filter) => (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id as MatchFilter)}
            className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
              matchFilter === filter.id
                ? 'bg-white text-black border-white'
                : 'border-white/10 text-white/35 hover:text-white hover:border-white/20'
            }`}
          >
            <Filter className="w-3 h-3 inline mr-2" />
            {filter.label}
          </button>
        ))}
      </div>
    </div>

    <div className="grid gap-3">
      {filteredMatches.map((match) => (
        <div key={match.id} className="p-5">
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-5">
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${
                    match.status === 'in_progress'
                      ? 'bg-green-400 animate-pulse'
                      : match.status === 'disputed'
                        ? 'bg-red-400'
                        : 'bg-white/20'
                  }`}
                />
                <div className="font-display font-black text-lg uppercase italic">{match.id}</div>
                <StatusPill label={match.status} tone={statusToneMap[match.status] || ''} />
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 text-[10px] font-mono uppercase tracking-widest text-white/30">
                <MetaChip label="Format" value={match.format} />
                <MetaChip label="Map" value={match.rules.map} />
                <MetaChip label="Roster" value={`${match.players.length}/${match.maxPlayers}`} />
                <MetaChip label="Arbitre" value={match.arbiter ? match.arbiter.pseudo : 'Non assigne'} />
              </div>
              <div className="flex flex-wrap gap-4 text-[11px] text-white/45">
                <span>Prizepool {formatZC(match.prizePool)}</span>
                <span>Maj {getRelativeTime(match.updatedAt || match.createdAt)}</span>
                <span>{match.roomName ? 'Room publiee' : 'Room non publiee'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:flex gap-3 xl:justify-end">
              {match.status === 'disputed' ? (
                <button
                  onClick={() => onNavigateToTab('disputes')}
                  className="bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-red-500/15 transition-colors"
                >
                  Traiter
                </button>
              ) : null}
              <button
                onClick={() => onNavigateToTab('matches')}
                className="bg-white/5 border border-white/10 text-white px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:border-white/25 transition-colors"
              >
                Garder en vue
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default AdminMatchesTab;
