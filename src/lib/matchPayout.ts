/**
 * matchPayout.ts - lecture de la partition d'un pot de match, cote front.
 *
 * Expose la commission d'arbitre, le total de l'equipe gagnante et deux
 * helpers de compatibilite. Source de verite : la projection `projectedPayouts`
 * calculee par le serveur sur la cagnotte REELLEMENT bloquee.
 *
 * INVARIANT : la projection serveur prime. Ne jamais recalculer
 * `prizePool - zoydFee - arbiterFee` pour l'affichage : prizePool vaut
 * maxPlayers x entryFee des la creation, alors que le serveur calcule sur
 * les fonds reellement bloques. Un roster incomplet verse moins.
 * PIEGE : `getWinnerPayoutPerPlayer` et `hasAuthoritativePayout` n'ont AUCUN
 * appelant : c'est du code mort. `perWinner` n'est lu par aucun composant
 * et Rollup l'elague du build. Le serveur calcule de surcroit autrement
 * (match-engine.mjs) : la projection divise par le nombre TOTAL de joueurs,
 * le reglement reel par le nombre de GAGNANTS (ecart de 2x en 2v2, 5x en
 * 5v5). Ne pas ressusciter ces helpers sans corriger le serveur d'abord.
 * PIEGE : `getWinnerPayout` renvoie le TOTAL DE L'EQUIPE, pas la part
 * individuelle. L'utiliser pour afficher un gain personnel gonfle le profil
 * (voir profileMetrics et communityInsights).
 * PIEGE : la commission d'arbitre (2 %) ne s'applique que s'il y a un
 * arbitre. L'afficher sur un match sans arbitre est faux.
 *
 * Voir aussi : docs/08-frontend.md - section 12 (Le champ perWinner)
 */
// Partition d'un pot de match, cote front.
//
// Le serveur calcule `projectedPayouts` sur la CAGNOTTE REELLEMENT
// VERROUILLEE (somme des `lockedEntries` des joueurs presents), pas sur
// `match.prizePool` qui vaut `maxPlayers * entryFee` des la creation. Deux
// consequences :
//  - un match a roster incomplet verse moins que `prizePool` ;
//  - la commission d'arbitre (2 %) ne s'applique que s'il y a un arbitre.
//
// Recalculer `prizePool - zoydFee - arbiterFee` dans le front affichait donc
// un montant different du verse. Ces helpers preferring la valeur serveur
// tombent sur l'ancien calcul uniquement pour un match sans projection
// (payloads locaux, tests, anciens matchs en base).

const roundAmount = (value: number) => Math.round(value * 100) / 100;

export interface MatchPayoutProjection {
  /** Cagnotte de reference (reelle si des fonds sont bloques, sinon theorique). */
  basis: number;
  /** true si des fonds sont actuellement bloques. */
  locked: boolean;
  arbiterFee: number;
  /** Part totale de l'equipe gagnante. */
  winner: number;
  /** Part par joueur gagnant. */
  perWinner: number;
}

interface PayoutMatch {
  prizePool?: number;
  zoydFee?: number;
  arbiterFee?: number;
  projectedPayouts?: MatchPayoutProjection;
}

/** Commission d'arbitre retenue : projection serveur si presente, sinon champ du match. */
export const getArbiterFee = (match: PayoutMatch): number =>
  match.projectedPayouts?.arbiterFee ?? Number(match.arbiterFee || 0);

/** Part totale de l'equipe gagnante (base reelle si projection disponible). */
export const getWinnerPayout = (match: PayoutMatch): number => {
  if (match.projectedPayouts) return roundAmount(match.projectedPayouts.winner);
  return roundAmount(
    Math.max(0, Number(match.prizePool || 0) - Number(match.zoydFee || 0) - Number(match.arbiterFee || 0)),
  );
};

/**
 * Part par joueur gagnant. Le serveur partage entre les joueurs de l'equipe
 * gagnante (5 en 5VS5), pas entre tous les inscrits.
 */
export const getWinnerPayoutPerPlayer = (match: PayoutMatch, winnerTeamSize?: number): number => {
  if (match.projectedPayouts?.perWinner) return roundAmount(match.projectedPayouts.perWinner);
  const size = winnerTeamSize && winnerTeamSize > 0 ? winnerTeamSize : 1;
  return roundAmount(getWinnerPayout(match) / size);
};

/** true si le montant provient du serveur (donc fiable), false si reconstruit. */
export const hasAuthoritativePayout = (match: PayoutMatch): boolean => Boolean(match.projectedPayouts);
