import type { LeagueStanding } from '../../../app/stores/leagueStore';

export const StandingsTable = ({ standings, currentUserId }: { standings: LeagueStanding[]; currentUserId?: string }) => {
  if (!standings.length) {
    return (
      <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-12 text-center text-sm text-white/40">
        Aucun classement disponible.
      </div>
    );
  }

  return (
    <div className="border border-white/10 bg-zoyd-surface/20 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">#</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Points</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Meilleur</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Matchs</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing, index) => {
              const isMe = standing.userId === currentUserId;
              const isTop3 = index < 3;
              return (
                <tr
                  key={standing.userId}
                  className={`border-b border-white/5 ${
                    isMe ? 'bg-zoyd-yellow/5' : isTop3 ? 'bg-white/[0.02]' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className={`text-sm font-bold ${isTop3 ? 'text-zoyd-yellow' : 'text-white/60'}`}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${isMe ? 'text-zoyd-yellow font-bold' : 'text-white'}`}>
                      {standing.pseudo}
                      {isMe && <span className="text-[9px] ml-2 text-zoyd-yellow/60">(TOI)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-white">{standing.totalPoints}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-white/60">{standing.bestPlacement > 0 ? `#${standing.bestPlacement}` : '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-white/60">{standing.matchesPlayed}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
