import { describe, it, expect } from 'vitest';
import { percentToRate, rateToPercent } from './payoutDisplay';

/**
 * ZD-17 : le formulaire BR affichait des fractions (0,4) sous un total en
 * pourcentage (100 %). Deux unites dans la meme section : le joueur ne peut
 * pas verifier ce qu il saisit. La conversion vit ici, testee, plutot que
 * dispersee dans le JSX.
 */
describe('affichage de la repartition BR', () => {
  it('convertit les taux du serveur en pourcentages lisibles', () => {
    expect(rateToPercent(0.4)).toBe(40);
    expect(rateToPercent(0.22)).toBe(22);
    expect(rateToPercent(0.05)).toBe(5);
    expect(rateToPercent(0.125)).toBe(12.5);
  });

  it('reconvertit la saisie en taux serveur sans derive', () => {
    expect(percentToRate(40)).toBe(0.4);
    expect(percentToRate(22)).toBe(0.22);
    expect(percentToRate(5)).toBe(0.05);
    expect(percentToRate(12.5)).toBe(0.125);
  });

  it('ne fabrique pas de flottants illisibles apres un aller-retour', () => {
    expect(rateToPercent(percentToRate(33))).toBe(33);
    expect(percentToRate(rateToPercent(0.08))).toBe(0.08);
  });
});
