import { describe, it, expect } from 'vitest';
import { getPublishCtaState } from './publishCta';

/**
 * Verrou ZD-05 (audit production 2026-11-19).
 *
 * Au recap, avec 0 ZC de solde, le bouton principal annoncait « Verrouiller
 * la mise et publier » alors que le clic ouvre le depot. Le libelle doit dire
 * ce que le clic FAIT : « Ajouter 50.0 ZC pour publier ».
 */
describe('getPublishCtaState', () => {
  it('annonce le depot quand le solde est insuffisant', () => {
    expect(getPublishCtaState({ isArbiterCreator: false, requiredTopUp: 50 })).toEqual({
      label: 'Ajouter 50.0 ZC pour publier',
      badge: 'Financement requis',
    });
  });

  it('garde le libelle de mise quand le solde suffit', () => {
    expect(getPublishCtaState({ isArbiterCreator: false, requiredTopUp: 0 })).toEqual({
      label: 'Verrouiller la mise et publier',
      badge: 'Prêt à publier',
    });
  });

  it('un createur-arbitre publie sans mise ni depot', () => {
    expect(getPublishCtaState({ isArbiterCreator: true, requiredTopUp: 0 })).toEqual({
      label: 'Publier le match',
      badge: 'Prêt à publier',
    });
  });
});
