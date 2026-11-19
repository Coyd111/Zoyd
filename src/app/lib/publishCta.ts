/**
 * Libelle et badge du bouton de publication d'un match (recap /mj/creer).
 *
 * INVARIANT (ZD-05, audit production 2026-11-19) : le libelle dit ce que le
 * clic FAIT. Avec un solde insuffisant, le clic ouvre le depot (wallet) :
 * annoncer « Verrouiller la mise et publier » promet une publication qui ne
 * peut pas aboutir. Le badge suit la meme verite : « Financement requis »
 * remplace « Prêt à publier » tant que le compte est a decouvert.
 * PIEGE : un createur-arbitre ne paie aucun pass (`requiredTopUp` vaut 0
 * cote page) : il doit garder le libelle de publication.
 */
export interface PublishCtaInput {
  isArbiterCreator: boolean;
  requiredTopUp: number;
}

export interface PublishCtaState {
  label: string;
  badge: string;
}

export const getPublishCtaState = ({
  isArbiterCreator,
  requiredTopUp,
}: PublishCtaInput): PublishCtaState => {
  if (requiredTopUp > 0) {
    return {
      label: `Ajouter ${requiredTopUp.toFixed(1)} ZC pour publier`,
      badge: 'Financement requis',
    };
  }
  return {
    label: isArbiterCreator ? 'Publier le match' : 'Verrouiller la mise et publier',
    badge: 'Prêt à publier',
  };
};
