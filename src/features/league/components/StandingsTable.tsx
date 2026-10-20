/**
 * StandingsTable - tableau des classements d'une saison de ligue.
 *
 * Affiche le classement par points, la meilleure place, le nombre de
 * matchs joues, et met en avant la ligne du joueur courant.
 *
 * INVARIANT : le classement vient du serveur (standings). Ne pas le
 * recalculer cote client : le bareme de points est une regle serveur.
 * INVARIANT : la ligne du joueur courant est identifiee par userId, qui
 * reste lisible dans les donnees de ligue. C'est une exception au usage
 * general de `isMe` (propre aux matchs et tournois diffuses).
 * PIEGE : une saison sans classement doit afficher un etat vide explicite,
 * pas un tableau a zero ligne qui se lirait comme ' personne n'a joue '.
 *
 * Voir aussi : docs/08-frontend.md - section 6 (Les stores Zustand)
 */
import type { LeagueStanding } from '../../../app/stores/leagueStore';

export const StandingsTable = ({ standings, currentUserId }: { standings: LeagueStanding[]; currentUserId?: string }) => {
  if (!standings.length) {
    return (
      <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-12 text-center text-sm text-white/70">
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
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/70">#</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/70">Joueur</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/70 text-right">Points</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/70 text-right">Meilleur</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/70 text-right">Matchs</th>
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
                      {isMe && <span className="text-[10px] ml-2 text-zoyd-yellow/60">(TOI)</span>}
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
