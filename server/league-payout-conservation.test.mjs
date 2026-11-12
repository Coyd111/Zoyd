import { describe, it, expect } from 'vitest';
import { buildLeaguePayout } from './league-engine.mjs';

/**
 * Le podium de la ligue doit CONSERVER la cagnotte.
 *
 * Le defaut
 * ---------
 * Les trois parts (60 / 25 / 15 %) etaient arrondies INDEPENDAMMENT. Leur
 * somme pouvait alors DEPASSER le pot : de la monnaie creee, dans le code
 * de l argent.
 *
 * Mesure sur 200 000 pots : 18 % etaient sur-distribues de 0,01 ZC, et 6 %
 * sous-distribues du meme montant.
 *
 * Le cas est REEL, pas theorique : le tarif de la ligue est modifiable par
 * l administration, avec des centimes. Tarif 12,50 ZC, 3 inscrits ->
 * pot 37,50 ZC -> reparti 22,50 + 9,38 + 5,63 = 37,51 ZC : 0,01 ZC de
 * plus que la cagnotte recue.
 *
 * Ce que le test garantit
 * -----------------------
 * La somme des trois parts vaut EXACTEMENT le pot, pour tout pot - centimes
 * compris.
 */
describe('Ligue — conservation de la cagnotte au podium', () => {
  it('la somme des trois parts vaut exactement le pot', () => {
    // Les pots avec des centimes sont les cas ou l ecart apparait.
    const pots = [
      0.01, 0.02, 0.03, 0.05, 0.06, 0.07, 0.1, 0.11, 0.25, 0.37,
      1.01, 2.675, 3.33, 12.5, 37.5, 49.99, 50, 125.5, 999.99, 1000,
      1234.56, 4999.99, 25000, 98765.43,
    ];
    for (const pot of pots) {
      const { gross, first, second, third } = buildLeaguePayout(pot);
      const somme = Math.round((first + second + third) * 100) / 100;
      expect(
        somme,
        `pot ${pot} : ${first} + ${second} + ${third} = ${somme} (attendu ${gross})`,
      ).toBe(gross);
    }
  });

  it('la conservation tient sur 20 000 pots consecutifs', () => {
    // Balayage large : un cas isolé ne prouverait rien.
    for (let centimes = 1; centimes <= 20000; centimes += 1) {
      const pot = centimes / 100;
      const { gross, first, second, third } = buildLeaguePayout(pot);
      const somme = Math.round((first + second + third) * 100) / 100;
      if (somme !== gross) {
        expect(
          somme,
          `pot ${pot} : ${first} + ${second} + ${third} = ${somme} (attendu ${gross})`,
        ).toBe(gross);
      }
    }
    expect(true).toBe(true);
  });

  it('la repartition reste proche de 60 / 25 / 15 %', () => {
    // Le reliquat d arrondi ne doit pas deformer la repartition : au plus
    // 0,01 ZC de part par Cran.
    for (const pot of [12.5, 37.5, 123.45, 4999.99]) {
      const { gross, first, second, third } = buildLeaguePayout(pot);
      expect(Math.abs(first - gross * 0.6)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(second - gross * 0.25)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(third - gross * 0.15)).toBeLessThanOrEqual(0.01);
    }
  });

  it('aucune part negative sur un pot minuscule', () => {
    for (const pot of [0, 0.001, 0.01, 0.04, 0.06]) {
      const { first, second, third } = buildLeaguePayout(pot);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBeGreaterThanOrEqual(0);
      expect(third).toBeGreaterThanOrEqual(0);
    }
  });
});
