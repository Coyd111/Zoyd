import { describe, it, expect } from 'vitest';
import { splitBrPayout } from './brApi';
import type { BrLobby } from './brApi';

/**
 * M3 - taux de la battle royale = pourcentage du POT.
 *
 * Avant le correctif, `splitBrPayout` multipliait chaque taux par le
 * winnersPool (`pot - commission`) : l'ecran pre-mark ne correspondait donc
 * plus a la formule serveur (`computeBrPayouts` applique desormais les taux
 * au pot et fait absorber l'arrondi par la derniere place classee).
 * Verrou : les deux calculs partent des memes NOMBRES.
 */

const lobbyAvec = (pot: number): BrLobby =>
  ({
    id: 'BR-1',
    status: 'scheduled',
    pot,
    prizePool: pot,
    entryFee: 50,
    payout: {
      first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08,
      arbiterRate: 0.03,
    },
    players: [],
    teams: [],
  }) as unknown as BrLobby;

describe('splitBrPayout — taux appliques au pot (M3)', () => {
  it('chaque place vaut pot * taux, pas winnersPool * taux', () => {
    const split = splitBrPayout(lobbyAvec(1000));

    expect(split.places[0].amount).toBe(400); // 1000 * 0.40
    expect(split.places[1].amount).toBe(220); // 1000 * 0.22
    expect(split.places[2].amount).toBe(150); // 1000 * 0.15
    expect(split.places[3].amount).toBe(120); // 1000 * 0.12
    expect(split.places[4].amount).toBe(80);  // 1000 * 0.08
    expect(split.arbiterAmount).toBe(30);     // 1000 * 0.03
  });

  it('la somme des cinq parts et de la commission vaut le pot', () => {
    const split = splitBrPayout(lobbyAvec(333.33));

    const total =
      split.places.reduce((sum, place) => sum + place.amount, 0) +
      split.arbiterAmount;
    expect(total).toBeCloseTo(333.33, 2);
  });
});
