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
    * PIEGE : `perWinner` est la part par joueur GAGNANT. Le serveur la calcule
    * sur la taille de l'equipe gagnante (donc divise par 2 en 2VS2, par 5 en
    * 5VS5) — et sur le nombre REEL de gagnants quand le resultat est soumis.
    * Avant la correction, elle divisait par le nombre TOTAL de joueurs : la
    * part annoncee etait deux fois trop petite en 2VS2, cinq fois trop
    * petite en 5VS5, et un test figeait la valeur erronee. Le calcul vit
    * maintenant dans `server/match-engine.mjs` (`getProjectedPayouts`), et un
    * test verifie que l affichage annonce exactement ce que le reglement
    * verse.
    * PIEGE : `getWinnerPayout` renvoie le TOTAL DE L'EQUIPE, pas la part
    * individuelle. L'utiliser pour afficher un gain personnel gonfle le profil
    * du facteur taille d'equipe — 2x en 2VS2, 5x en 5VS5 — et c'est un chiffre
    * PUBLIC. Pour un gain individuel, utiliser `getWinnerPayoutPerPlayer`.
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
  teamSize?: number;
  projectedPayouts?: MatchPayoutProjection;
  /** Versements reels (A9) : l'UUID du paye est remplace par `isMe`. */
  payouts?: Array<{ amount: number; type: string; isMe?: boolean }>;
}

/** Part du lecteur dans les versements reels, si le serveur l'a remappee. */
const getMyPayout = (match: PayoutMatch, type: 'prize_win' | 'arbitration_fee') => {
  const entry = match.payouts?.find((payout) => payout?.isMe === true && payout?.type === type);
  return entry && Number(entry.amount) > 0 ? roundAmount(Number(entry.amount)) : undefined;
};

/**
 * Part par joueur GAGNANT.
 *
 * `getWinnerPayout` renvoie le TOTAL de l'equipe gagnante. L'additionner
 * comme gain personnel gonfle le profil du facteur taille d'equipe : 2x en
 * 2VS2, 5x en 5VS5. C'est un chiffre PUBLIC - c'est la reputation du joueur.
 *
 * La source de verite est la projection serveur (`projectedPayouts.perWinner`),
 * qui divise par la taille de l'equipe gagnante, et par le nombre REEL de
 * gagnants quand le resultat est soumis. Le repli divise par la taille
 * d'equipe, pour les matchs sans projection (anciens payloads, tests).
 *
 * A9 : sur un profil possede (`isMe`), la part REELLEMENT versee au lecteur
 * sert avant toute projection - le reglement a pu tourner a un pot different
 * (roster incomplet, arrondi absorbe par le premier). Les profils vus par un
 * tiers n'ont aucun `isMe` et retombent sur la projection, qui est en base
 * reelle depuis le correctif (A9 cote serveur).
 */
export const getWinnerPayoutPerPlayer = (match: PayoutMatch): number => {
  const maPart = getMyPayout(match, 'prize_win');
  if (maPart !== undefined) return maPart;
  const projection = match.projectedPayouts?.perWinner;
  if (typeof projection === 'number' && projection > 0) return roundAmount(projection);
  const size = match.teamSize && match.teamSize > 0 ? match.teamSize : 1;
  return roundAmount(getWinnerPayout(match) / size);
};

/** Commission d'arbitre retenue : projection serveur si presente, sinon champ du match. */
export const getArbiterFee = (match: PayoutMatch): number => {
  const maCommission = getMyPayout(match, 'arbitration_fee');
  if (maCommission !== undefined) return maCommission;
  return match.projectedPayouts?.arbiterFee ?? Number(match.arbiterFee || 0);
};

/** Part totale de l'equipe gagnante (base reelle si projection disponible). */
export const getWinnerPayout = (match: PayoutMatch): number => {
  if (match.projectedPayouts) return roundAmount(match.projectedPayouts.winner);
  return roundAmount(
    Math.max(0, Number(match.prizePool || 0) - Number(match.zoydFee || 0) - Number(match.arbiterFee || 0)),
  );
};

