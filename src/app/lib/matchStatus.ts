/**
 * src/app/lib/matchStatus.ts - Statuts de match, source unique cote front.
 *
 * Le contenu vient de `shared/match-status.json`, que le serveur importe
 * aussi. Une seule source, deux consommateurs : le front et le serveur ne
 * peuvent plus diverger sur la question « ce match est-il encore vivant ? ».
 *
 * Ils divergeaient. Trois listes, deux langages :
 * - le serveur ignorait `awaiting_arbiter` dans les matchs actifs ;
 * - `matchStore.ts` l'ignorait aussi ;
 * - `DashboardPage.tsx` l'ignorait ailleurs, et ignorait `awaiting_confirmation`.
 *
 * Consequence concrete : un match en attente d'arbitre disparait de la liste
 * des matchs actifs du joueur. Il est pourtant vivant, et son pot est bloque.
 */
import source from '../../../shared/match-status.json';

/**
 * Les statuts qu'un match peut porter.
 *
 * `archived` manquait ici : le serveur l'ecrit (cron d'archivage), le type
 * du front pretendait que le cas n'existait pas. Un type qui ment sur le
 * domaine est pire que pas de type.
 */
export type MatchStatus =
  | 'recruiting'
  /** LEGACY : plus rien ne le produit depuis que `awaiting_arbiter` l'a remplace. */
  | 'full'
  /** Le match ne peut pas avancer : pas d'arbitre. */
  | 'awaiting_arbiter'
  | 'check_in'
  | 'ready'
  | 'in_progress'
  /** Resultat soumis, cagnotte gelee : les deux equipes doivent confirmer. */
  | 'awaiting_confirmation'
  | 'finished'
  /** Litige ouvert : l'admin tranche. */
  | 'disputed'
  | 'cancelled'
  | 'forfeited'
  /** Archive par le cron : le match n'existe plus pour le joueur. */
  | 'archived';

/** Matchs en cours de vie : ils peuvent encore evoluer. */
export const ACTIVE_STATUSES = source.ACTIVE as MatchStatus[];

/** Matchs termines : plus d'action de jeu, plus de balayage. */
export const CLOSED_STATUSES = source.CLOSED as MatchStatus[];

/** Ce qu'un joueur voit dans son historique. */
export const HISTORY_STATUSES = source.HISTORY as MatchStatus[];

/**
 * File de priorite de l administration : les matchs sur lesquels un admin a
 * quelque chose a faire.
 *
 * `awaiting_arbiter` y figure — et c est precisement ce qui manquait. Un
 * match sans arbitre attend quelqu un : sans lui, il ne se passe rien, et
 * l admin ne le voyait pas. C est le match qu un admin peut lui-meme arbitrer,
 * ou faire arbitrer.
 *
 * `recruiting` n y est pas : le match attend des joueurs, ce n est pas de
 * l administration. `awaiting_confirmation` non plus : la cagnotte est
 * gelee, elle attend les equipes.
 */
export const PRIORITY_STATUSES: MatchStatus[] = [
  'disputed',
  'awaiting_arbiter',
  'check_in',
  'ready',
  'in_progress',
];
