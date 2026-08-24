import React from 'react';
import { Link } from 'react-router';
import { Eye, Users } from 'lucide-react';
import { StatusPill, SignalBadge } from './AdminTabShared';
import type { FlaggedUser, UserFilter } from './AdminTabShared';

type AdminUsersTabProps = {
  filteredUsers: FlaggedUser[];
  userFilter: UserFilter;
  onFilterChange: (filter: UserFilter) => void;
};

const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  filteredUsers,
  userFilter,
  onFilterChange,
}) => (
  <div className="space-y-5">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-display font-black uppercase italic">Watchlist Joueurs</h2>
        <p className="text-white/35 text-sm">
          Les profils sont tries pour mettre devant les signaux qui melangent reports, litiges et perte de
          trust.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'critical', label: 'Critiques' },
          { id: 'watch', label: 'Sous watch' },
          { id: 'all', label: 'Tous' },
        ].map((filter) => (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id as UserFilter)}
            className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
              userFilter === filter.id
                ? 'bg-white text-black border-white'
                : 'border-white/10 text-white/35 hover:text-white hover:border-white/20'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>

    {filteredUsers.length === 0 ? (
      <p className="text-white/20 text-sm font-mono">Aucun compte remonte dans cette vue.</p>
    ) : (
      <div className="grid gap-3">
        {filteredUsers.map((flaggedUser) => (
          <div
            key={flaggedUser.key}
            className="flex flex-col xl:flex-row xl:items-center justify-between p-4 gap-4"
          >
            <div className="flex items-start gap-4 min-w-0">
              <div
                className={`w-10 h-10 flex items-center justify-center font-display font-black text-sm shrink-0 ${
                  flaggedUser.status === 'critical'
                    ? 'bg-red-500 text-black'
                    : flaggedUser.status === 'watch'
                      ? 'bg-zoyd-yellow text-black'
                      : 'bg-white/10 text-white/40'
                }`}
              >
                {flaggedUser.pseudo[0]}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="font-display font-black text-sm uppercase italic">{flaggedUser.pseudo}</div>
                  <StatusPill
                    label={flaggedUser.status}
                    tone={
                      flaggedUser.status === 'critical'
                        ? 'text-red-400 border-red-500/30'
                        : flaggedUser.status === 'watch'
                          ? 'text-zoyd-yellow border-zoyd-yellow/30'
                          : 'text-white/30 border-white/10'
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest text-white/25">
                  <SignalBadge label={`Trust ${typeof flaggedUser.trustScore === 'number' ? flaggedUser.trustScore : '--'}`} />
                  <SignalBadge label={`${flaggedUser.reportsCount} report(s)`} />
                  <SignalBadge label={`${flaggedUser.disputedMatches} litige(s)`} />
                  <SignalBadge label={`${flaggedUser.forfeits} forfait(s)`} />
                  <SignalBadge label={`${flaggedUser.activityCount} session(s)`} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {flaggedUser.hasPublicProfile && flaggedUser.primaryUserId ? (
                <Link
                  to={`/profil/${flaggedUser.primaryUserId}`}
                  className="bg-white text-black px-3 sm:px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:bg-zoyd-yellow transition-colors touch-target"
                >
                  <Eye className="w-3 h-3 inline mr-2" />
                  Ouvrir profil
                </Link>
              ) : (
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/25">
                  <Users className="w-3 h-3" />
                  Profil non indexe
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default AdminUsersTab;
