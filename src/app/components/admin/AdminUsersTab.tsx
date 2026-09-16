import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Eye, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusPill, SignalBadge, userStatusLabelFR } from './AdminTabShared';
import type { FlaggedUser, UserFilter } from './AdminTabShared';

type AdminUsersTabProps = {
  filteredUsers: FlaggedUser[];
  userFilter: UserFilter;
  onFilterChange: (filter: UserFilter) => void;
};

const PAGE_SIZE = 20;

const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  filteredUsers,
  userFilter,
  onFilterChange,
}) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedUsers = useMemo(
    () => filteredUsers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredUsers, safePage]
  );

  return (
  <div className="space-y-5">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-display font-black uppercase italic">Watchlist Joueurs</h2>
        <p className="text-white/70 text-sm">
          Les profils sont tries pour mettre devant les signaux qui melangent reports, litiges et perte de
          trust.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'critical', label: 'Critiques' },
          { id: 'watch', label: 'Surveillés' },
          { id: 'all', label: 'Tous' },
        ].map((filter) => (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id as UserFilter)}
            className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
              userFilter === filter.id
                ? 'bg-white text-black border-white'
                : 'border-white/10 text-white/70 hover:text-white hover:border-white/20'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>

    {filteredUsers.length === 0 ? (
      <p className="text-white/60 text-sm font-mono">Aucun compte remonte dans cette vue.</p>
    ) : (
      <>
        <div className="grid gap-3">
          {paginatedUsers.map((flaggedUser) => (
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
                      : 'bg-white/10 text-white/70'
                }`}
              >
                {flaggedUser.pseudo[0]}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="font-display font-black text-sm uppercase italic">{flaggedUser.pseudo}</div>
                  <StatusPill
                    label={userStatusLabelFR[flaggedUser.status] || flaggedUser.status}
                    tone={
                      flaggedUser.status === 'critical'
                        ? 'text-red-400 border-red-500/30'
                        : flaggedUser.status === 'watch'
                          ? 'text-zoyd-yellow border-zoyd-yellow/30'
                          : 'text-white/60 border-white/10'
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest text-white/60">
                  <SignalBadge label={`Trust ${typeof flaggedUser.trustScore === 'number' ? flaggedUser.trustScore : '--'}`} />
                  <SignalBadge label={`${flaggedUser.reportsCount} signalement(s)`} />
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
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/60">
                  <Users className="w-3 h-3" />
                  Profil non indexe
                </div>
              )}
            </div>
          </div>
        ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <span className="text-[10px] font-mono text-white/60 uppercase tracking-widest">
              {filteredUsers.length} joueur(s) — page {safePage} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="touch-target px-3 py-2 border border-white/10 text-[10px] font-display font-black uppercase tracking-widest disabled:opacity-30 hover:border-white/30 transition-colors"
                aria-label="Page precedente"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="touch-target px-3 py-2 border border-white/10 text-[10px] font-display font-black uppercase tracking-widest disabled:opacity-30 hover:border-white/30 transition-colors"
                aria-label="Page suivante"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </>
    )}
  </div>
  );
};

export default AdminUsersTab;
