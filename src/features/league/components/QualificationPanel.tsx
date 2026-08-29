import { Trophy, Play, Clock, CheckCircle } from 'lucide-react';
import type { LeagueSeason, LeagueDayKey } from '../../../app/stores/leagueStore';
import { DAY_KEYS, DAY_LABELS, DAY_STATUS_ICONS } from './leagueSeasonConstants';

export const QualificationPanel = ({
  season,
  currentUserId,
  isAdmin,
  onAdminAction,
  isActionLoading,
}: {
  season: LeagueSeason;
  currentUserId?: string;
  isAdmin: boolean;
  onAdminAction: (action: string, payload?: Record<string, unknown>) => void;
  isActionLoading: boolean;
}) => {
  return (
    <div className="space-y-4">
      {isAdmin && season.status === 'registering' && (
        <button
          onClick={() => onAdminAction('start-qualification')}
          disabled={isActionLoading || season.registeredPlayers.length < 10}
          className="flex items-center gap-2 border border-zoyd-yellow/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
        >
          <Play className="w-3.5 h-3.5" />
          Lancer la qualification ({season.registeredPlayers.length} joueurs)
        </button>
      )}

      {DAY_KEYS.map((day) => {
        const slot = season.qualificationGroups[day];
        const status = slot?.status || 'pending';
        const Icon = DAY_STATUS_ICONS[status] || Clock;
        const myGroup = slot?.players.includes(currentUserId || '');

        return (
          <div
            key={day}
            className={`border p-4 ${
              myGroup ? 'border-zoyd-yellow/30 bg-zoyd-yellow/5' : 'border-white/10 bg-zoyd-surface/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 flex items-center justify-center border ${
                  status === 'finished'
                    ? 'border-green-400/30 text-green-400'
                    : status === 'live'
                      ? 'border-zoyd-yellow/30 text-zoyd-yellow'
                      : 'border-white/10 text-white/40'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{DAY_LABELS[day]}</div>
                  <div className="text-[10px] text-white/40">{slot?.players.length || 0} joueurs</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {myGroup && status !== 'finished' && (
                  <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/10">
                    TON GROUPE
                  </span>
                )}
                <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border ${
                  status === 'finished'
                    ? 'border-green-400/30 text-green-400 bg-green-400/10'
                    : status === 'live'
                      ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/10'
                      : 'border-white/10 text-white/30 bg-white/5'
                }`}>
                  {status === 'finished' ? 'Terminé' : status === 'live' ? 'En cours' : status === 'scheduled' ? 'Planifié' : 'En attente'}
                </span>
                {isAdmin && status === 'scheduled' && (
                  <button
                    onClick={() => onAdminAction('start-day', { dayKey: day })}
                    disabled={isActionLoading}
                    className="text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
                  >
                    Demarrer
                  </button>
                )}
              </div>
            </div>

            {slot?.results && slot.results.length > 0 && (
              <div className="mt-3 border-t border-white/5 pt-3">
                <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 mb-2">Top 10</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
                  {slot.results.slice(0, 10).map((result, i) => (
                    <div
                      key={result.userId}
                      className={`text-[10px] px-2 py-1 border ${
                        i === 0
                          ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/5'
                          : i < 3
                            ? 'border-white/10 text-white/70 bg-white/[0.02]'
                            : 'border-white/5 text-white/40'
                      }`}
                    >
                      #{result.placement} — {result.points}pts
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {isAdmin && season.status === 'qualifying' && DAY_KEYS.every((d) => season.qualificationGroups[d]?.status === 'finished') && (
        <button
          onClick={() => onAdminAction('advance-to-final')}
          disabled={isActionLoading}
          className="flex items-center gap-2 border border-orange-400/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-orange-400 hover:bg-orange-400/10 transition-colors disabled:opacity-50 touch-target"
        >
          <Trophy className="w-3.5 h-3.5" />
          Avancer vers la finale (Top 40)
        </button>
      )}
    </div>
  );
};
