/**
 * Ordre d'un classement avec le joueur courant non classe.
 *
 * INVARIANT (audit production 2026-11-19, ZD-03) : un joueur sans activite
 * n'a pas de rang. Il garde sa ligne (sinon son absence ressemble a un bug)
 * mais elle est placee APRES le classement et son rang vaut `null`. Le meme
 * ecran ne doit jamais dire « Pas encore classé » et afficher « #11 ».
 * PIEGE : ne pas simplement masquer le rang a l'affichage. Le tri par defaut
 * peut placer un compte inactif au milieu (ELO initial) : il faut le sortir
 * du calcul de rang, sinon le joueur suivant herite d'un rang decale.
 */
export interface RankedItem<T> {
  item: T;
  /** Rang dans le classement, `null` pour un joueur non classe. */
  rank: number | null;
}

export const rankWithUnrankedLast = <T>(
  items: ReadonlyArray<T>,
  isRanked: (item: T) => boolean,
  isMe: (item: T) => boolean,
  sorter: (left: T, right: T) => number
): Array<RankedItem<T>> => {
  const ranked = items
    .filter(isRanked)
    .slice()
    .sort(sorter)
    .map((item, index) => ({ item, rank: index + 1 }));
  const unrankedMe = items
    .filter((item) => !isRanked(item) && isMe(item))
    .map((item) => ({ item, rank: null }));
  return [...ranked, ...unrankedMe];
};
