/**
 * Affichage des champs optionnels d'un match.
 *
 * INVARIANT : un match ancien peut ne pas porter `rules.bestOf`,
 * `rules.scoreTarget` ou `result.scores` (la production en contient :
 * M-MWHYO9FS). Une valeur absente s'affiche comme absente. Interpoler
 * directement produisait « BOundefined » et « SCORE ALPHA undefined »,
 * c'est-a-dire une donnee fausse presentee comme un score.
 */

/** Tiret cadratin : la valeur n'est pas connue, elle n'est pas nulle. */
export const MISSING_VALUE = '—';

const estNombre = (valeur: unknown): valeur is number =>
  typeof valeur === 'number' && Number.isFinite(valeur);

export const formatBestOf = (bestOf: unknown): string =>
  estNombre(bestOf) && bestOf > 0 ? `BO${bestOf}` : MISSING_VALUE;

export const formatScoreTarget = (scoreTarget: unknown): string =>
  estNombre(scoreTarget) ? String(scoreTarget) : MISSING_VALUE;

export const formatTeamScore = (score: unknown): string =>
  estNombre(score) ? String(score) : MISSING_VALUE;
