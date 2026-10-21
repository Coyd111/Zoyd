/**
 * server/match-status.mjs - Source unique des statuts de match.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Les statuts etaient redecrites a cinq endroits, dans deux langages :
 * `server/match-engine.mjs` (MATCH_ETATS_CLOS, ACTIVE_STATUSES,
 * TERMINAL_STATUSES), `server/match-engine.mjs:getMatchActivityForUser`
 * (la liste d'historique), `src/app/stores/matchStore.ts` et
 * `src/app/pages/DashboardPage.tsx` (deux listes encore differentes).
 *
 * Elles ne se contredisaient pas de la meme facon : le serveur ignorait
 * `awaiting_arbiter` dans les matchs actifs, le front l'ignorait aussi, et la
 * page tableau de bord l'ignorait ailleurs. Consequence : un match en attente
 * d'arbitre disparait de la liste des matchs actifs du joueur, alors qu'il
 * est vivant et que son pot est bloque.
 *
 * Inversement, `archived` etait absent des statuts terminaux : un match
 * archive pouvait etre reclasse actif par la derivation de statut, et il
 * disparaissait de l'historique du joueur.
 *
 * Le contenu vit dans `shared/match-status.json`, que le serveur ET le front
 * importent. Une seule source, deux consommateurs : ils ne peuvent plus
 * diverger.
 *
 * SETS
 * ----
 * ACTIVE  : le match vit et peut encore evoluer (cagnotte gelee comprise).
 *           `awaiting_confirmation` y figure : la cagnotte est gelee, donc le
 *           match reste actif du point de vue du joueur.
 * CLOSED  : le match est termine. Plus aucune action de jeu, plus de
 *           balayage. `disputed` n'y figure PAS : un litige est ferme au jeu
 *           mais reste ouvert a l administration, qui tranche.
 * HISTORY : ce qu'un joueur voit dans son historique. `disputed` y figure
 *           (le match est fini pour le joueur, l'admin doit encore trancher).
 *
 * `full` est un statut LEGACY : plus rien ne le produit depuis que
 * `awaiting_arbiter` l'a remplace. Il est conserve pour les donnees
 * anciennes, et signale comme tel dans `server/match-status-consistency.test.mjs`.
 */
import { readFileSync } from 'node:fs';

const source = JSON.parse(
  readFileSync(new URL('../shared/match-status.json', import.meta.url), 'utf8')
);

/** Matchs en cours de vie : ils peuvent encore evoluer. */
export const ACTIVE_STATUSES = Object.freeze([...source.ACTIVE]);

/** Matchs termines : plus d'action de jeu, plus de balayage. */
export const CLOSED_STATUSES = Object.freeze([...source.CLOSED]);

/** Ce qu'un joueur voit dans son historique. */
export const HISTORY_STATUSES = Object.freeze([...source.HISTORY]);

/** Tous les statuts connus. Sert au test de coherence. */
export const ALL_MATCH_STATUSES = Object.freeze([...source.ALL]);

/**
 * Le match est-il encore vivant ?
 * @param {string} status
 * @returns {boolean}
 */
export const isActiveStatus = (status) => ACTIVE_STATUSES.includes(status);

/**
 * Le match est-il termine ? Un litige n'est PAS termine : l'admin doit
 * encore trancher.
 * @param {string} status
 * @returns {boolean}
 */
export const isClosedStatus = (status) => CLOSED_STATUSES.includes(status);
