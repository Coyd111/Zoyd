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

/**
 * Le couple (libelle joueur, accent visuel) de CHAQUE statut, en table
 * exportee : un seul endroit ecrit, plusieurs ecrans lus.
 *
 * Audit UI 2026-11-03 : trois ecrans divergeaient sur le meme objet.
 * - le hub MJ projetait `awaiting_arbiter`, `disputed` et `archived` sur
 *   « Partie terminée » (cascade de l.237 a HubMJPage) : un match dont la
 *   cagnotte est gelee (litige) se lisait comme un match clos ;
 * - MatchCard declarait un statut SANS `disputed` ni `archived` : une carte
 *   ne pouvait JAMAIS presenter un litige ;
 * - la page detail faillait sur `awaiting_arbiter`/`archived` et affichait
 *   l'enum brut (« awaiting_arbiter ») a la place d'un libelle joueur.
 *
 * Cf. AdminTabShared (statusToneMap / statusLabelFR) de son cote admin :
 * l'admin a sa table (vocabulaire telegraphique en MAJUSCULES), le joueur a
 * celle-ci (phrases). Les deux partagent la meme source de domain
 * (`MatchStatus`) : ajouter un statut sans l'inscrire ici ou dans
 * AdminTabShared fait echouer TypeScript (Record sur l'union complete),
 * exactement comme pour les listes ACTIVE/CLOSED ci-dessus.
 */
export const MATCH_STATUS_COPY: Record<MatchStatus, { label: string; accent: string }> = {
  recruiting: { label: 'Inscriptions ouvertes', accent: 'text-zoyd-yellow' },
  full: { label: 'Joueurs complets', accent: 'text-white' },
  awaiting_arbiter: { label: "En attente d'un arbitre", accent: 'text-zoyd-yellow' },
  check_in: { label: 'Présence à confirmer', accent: 'text-zoyd-blue' },
  ready: { label: 'Prêt à jouer', accent: 'text-green-400' },
  in_progress: { label: 'Partie en cours', accent: 'text-zoyd-blue' },
  awaiting_confirmation: { label: 'Confirmation en attente', accent: 'text-zoyd-yellow' },
  finished: { label: 'Partie terminée', accent: 'text-white/70' },
  /** Litige : rouge, comme le ton admin (AdminTabShared.statusToneMap). */
  disputed: { label: 'Litige ouvert', accent: 'text-red-400' },
  cancelled: { label: 'Match annulé', accent: 'text-red-300' },
  forfeited: { label: 'Victoire par forfait', accent: 'text-zoyd-yellow' },
  /** Terminal (cron d'archivage) : neutre et au-dessous de finished (fini). */
  archived: { label: 'Archivé', accent: 'text-white/60' },
};
