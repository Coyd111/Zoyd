/**
 * LiveTicker - bandeau defilant des matchs en direct.
 *
 * Lit `liveMatches` dans le store socket et fait defiler les matchs whose
 * status est `ready` ou `in_progress`. Se rend null s'il n'y en a aucun.
 *
 * INVARIANT : la source est le store socket, pas une liste locale. Ce
 * composant ne declenche aucune requete.
 * PIEGE : `liveMatches` est reconstruit par syncFromMatches toutes les 15 s.
 * La liste affichee est donc un instantane, pas un flux : un match qui
 * demarre peut apparaitre avec 15 s de retard.
 * PIEGE : le composant est memoise (React.memo) et ne rend RIEN quand la
 * liste est vide : ne pas remplacer ce null par un conteneur vide, cela
 * laisserait une bande vide au-dessus du contenu.
 *
 * Voir aussi : docs/08-frontend.md - section 7 (Le client temps reel)
 */
import React from 'react';
import { Badge } from './ui/Badge';
import { useSocketStore } from '../stores/socketStore';
import { formatZC } from '../../lib/utils';

const LiveTicker: React.FC = React.memo(() => {
  const liveMatches = useSocketStore((s) => s.liveMatches);

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
});

LiveTicker.displayName = 'LiveTicker';

export { LiveTicker };
