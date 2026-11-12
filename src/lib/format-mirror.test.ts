import { describe, it, expect } from 'vitest';
import { formatZC, roundAmount, ZC_TO_FCFA } from './utils';
// Le MIROIR serveur : les deux implémentations vivent dans deux langages,
// sans quoi l'invariant « les deux formats doivent rester identiques »
// n'était vérifié par rien.
import {
  formatZcForNotification,
  roundAmount as roundAmountServeur,
  ZC_TO_FCFA as ZC_TO_FCFA_SERVEUR,
} from '../../server/utils.mjs';

/**
 * Le formatage des montants doit etre IDENTIQUE des deux cotes.
 *
 * Pourquoi un test entre le serveur et le front
 * --------------------------------------------
 * `formatZC` (front) et `formatZcForNotification` (serveur) sont deux
 * ecritures de la MEME regle, dans deux langages, dans deux depots sans
 * dependance. Le serveur renvoyait '0 ZC' pour un montant non fini ; le
 * front renvoyait 'NaN ZC' - donc un joueur dont le solde n'etait pas un
 * nombre voyait « NaN ZC » dans l'interface, pendant que la notification
 * serveur disait « 0 ZC ».
 *
 * Aucun test ne les comparait : l'invariant etait ecrit dans les deux
 * en-tetes, et verifie nulle part.
 *
 * Ce test est le verrou : il echoue des que les deux cotes divergent.
 */
const MONTANTS = [
  0,
  1,
  -1,
  0.04,
  0.05,
  0.049,
  1.005,
  12.34,
  -12.34,
  123.456,
  1000,
  123456.789,
  0.1 + 0.2,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

describe('Formatage des montants — le front est le MIROIR du serveur', () => {
  it('formatZC et formatZcForNotification donnent la meme chaine', () => {
    for (const montant of MONTANTS) {
      expect(
        formatZC(montant),
        `formatZC(${String(montant)}) doit egaler le serveur`,
      ).toBe(formatZcForNotification(montant));
    }
  });

  it('un montant non fini ne s affiche jamais en NaN', () => {
    // Le defaut : le front renvoyait 'NaN ZC', le serveur '0 ZC'.
    expect(formatZC(Number.NaN)).toBe('0 ZC');
    expect(formatZC(Number.POSITIVE_INFINITY)).toBe('0 ZC');
    expect(formatZC(Number.NEGATIVE_INFINITY)).toBe('0 ZC');
  });

  it('roundAmount est le miroir du serveur', () => {
    for (const valeur of [...MONTANTS, 1.005, 2.675]) {
      expect(
        roundAmount(valeur),
        `roundAmount(${String(valeur)}) doit egaler le serveur`,
      ).toBe(roundAmountServeur(valeur));
    }
  });

  it('roundAmount ne renvoie jamais NaN', () => {
    // Sans ce garde, `roundAmount(undefined)` renvoyait NaN, qui se
    // propageait dans tous les totaux calcules apres.
    expect(roundAmount(Number.NaN)).toBe(0);
    expect(roundAmount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(Number.isNaN(roundAmount(undefined as unknown as number))).toBe(false);
  });

  it('le taux ZC -> FCFA est le MEME des deux cotes', () => {
    // Le taux etait reencode a la main de chaque cote : le changer d un
    // seul rendait la conversion FAUSSE ET SILENCIEUSE — le joueur verrait
    // un bon montant en FCFA, le prestataire en recevrait un autre.
    // Il est desormais importe d une source unique cote serveur, et ce
    // test verrouille l egalite.
    expect(ZC_TO_FCFA_SERVEUR).toBe(ZC_TO_FCFA);
    expect(ZC_TO_FCFA).toBeGreaterThan(0);
  });
});
