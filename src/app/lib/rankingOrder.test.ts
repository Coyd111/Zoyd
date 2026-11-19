import { describe, it, expect } from 'vitest';
import { rankWithUnrankedLast } from './rankingOrder';

/**
 * Verrou ZD-03 (audit production 2026-11-19).
 *
 * Le joueur courant sans activite voyait « Pas encore classé » dans l'en-tete
 * ET un rang numerote dans le tableau. Les deux affirmations se contredisaient
 * sur le meme ecran. Regle : il garde sa ligne (pour ne pas ressembler a un
 * bug) mais n'obtient AUCUN rang tant qu'il n'a pas d'activite.
 */
interface Player {
  pseudo: string;
  activityCount: number;
  isMe?: boolean;
}

const player = (pseudo: string, activityCount: number, isMe = false): Player => ({
  pseudo,
  activityCount,
  isMe,
});

describe('rankWithUnrankedLast', () => {
  it('classe les joueurs actifs de 1 a n', () => {
    const ranked = rankWithUnrankedLast(
      [player('Bravo', 2), player('Alpha', 5)],
      (p) => p.activityCount > 0,
      (p) => p.isMe === true,
      (left, right) => right.activityCount - left.activityCount
    );
    expect(ranked.map(({ item, rank }) => [item.pseudo, rank])).toEqual([
      ['Alpha', 1],
      ['Bravo', 2],
    ]);
  });

  it('place le joueur courant sans activite en dernier, sans rang', () => {
    const ranked = rankWithUnrankedLast(
      [player('Alpha', 5), player('Moi', 0, true), player('Bravo', 2)],
      (p) => p.activityCount > 0,
      (p) => p.isMe === true,
      (left, right) => right.activityCount - left.activityCount
    );
    expect(ranked.map(({ item, rank }) => [item.pseudo, rank])).toEqual([
      ['Alpha', 1],
      ['Bravo', 2],
      ['Moi', null],
    ]);
  });

  it('ne cree pas de doublon quand le joueur courant est actif', () => {
    const ranked = rankWithUnrankedLast(
      [player('Alpha', 5), player('Moi', 3, true)],
      (p) => p.activityCount > 0,
      (p) => p.isMe === true,
      (left, right) => right.activityCount - left.activityCount
    );
    expect(ranked.map(({ item, rank }) => [item.pseudo, rank])).toEqual([
      ['Alpha', 1],
      ['Moi', 2],
    ]);
  });

  it('exclut les joueurs inactifs qui ne sont pas le joueur courant', () => {
    const ranked = rankWithUnrankedLast(
      [player('Alpha', 5), player('Fantome', 0), player('Moi', 0, true)],
      (p) => p.activityCount > 0,
      (p) => p.isMe === true,
      (left, right) => right.activityCount - left.activityCount
    );
    expect(ranked.map(({ item }) => item.pseudo)).toEqual(['Alpha', 'Moi']);
  });
});
