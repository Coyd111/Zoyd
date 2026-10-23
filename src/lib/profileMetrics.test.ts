import { describe, it, expect } from 'vitest';
import { buildCompetitiveSummary } from './profileMetrics';
import type { Match } from '../app/stores/matchStore';

/**
 * Le gain affiche sur un profil PUBLIC doit etre le gain REELLEMENT verse.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * V8 : le front additionnait le TOTAL DE L'EQUIPE gagnante aux gains d'un
 * joueur. En 2VS2, chaque vainqueur voyait le double de sa part ; en 5VS5,
 * le quintuple. Et comme c'est un chiffre public — la reputation du joueur —
 * l'erreur etait visible par tous les autres.
 *
 * Le serveur, lui, etait correct : il credite la part individuelle
 * (`totalEarnings += amount`, ou `amount` est la part versee). Le front
 * derivait ses propres stats et les REMPLACAIT. Deux composants corrects
 * individuellement, qui ne s'accordent pas.
 *
 * Ce test verrouille l'accord : ce que le front calcule doit etre exactement
 * ce que le serveur a credite.
 *
 * Il compare aussi le profil vu par un tiers a celui vu par le joueur
 * lui-meme : les deux passent par des chemins differents (`isMe` contre
 * `pseudo`), et c'est le profil public qui compte le plus.
 */

const matchGagne2v2 = (): Match => ({
  id: 'M-1',
  status: 'finished',
  format: '2VS2' as const,
  teamSize: 2,
  maxPlayers: 4,
  entryFee: 500,
  prizePool: 2000,
  zoydFee: 0,
  arbiterFee: 40,
  finishedAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  players: [
    { userId: 'a', pseudo: 'ALPHA', team: 0, isMe: true, isCheckedIn: true, isReady: true, alive: false, kills: 0, placement: 1 },
    { userId: 'b', pseudo: 'BRAVO', team: 0, isMe: false, isCheckedIn: true, isReady: true, alive: false, kills: 3, placement: 1 },
    { userId: 'c', pseudo: 'CHARLIE', team: 1, isMe: false, isCheckedIn: true, isReady: true, alive: false, kills: 1, placement: 2 },
    { userId: 'd', pseudo: 'DELTA', team: 1, isMe: false, isCheckedIn: true, isReady: true, alive: false, kills: 0, placement: 3 },
  ],
  arbiter: { pseudo: 'ARB', isMe: false },
  disputes: [],
  result: {
    winnerTeam: 0,
    scores: { team0: 10, team1: 3 },
    confirmedByTeams: ['a', 'b', 'c', 'd'],
    payoutDistributed: true,
  },
  // Ce que le serveur calcule : 1960 pour l equipe gagnante, 980 par
  // joueur. C est le chiffre que le front doit reprendre tel quel.
  projectedPayouts: {
    basis: 2000,
    locked: true,
    arbiterFee: 40,
    winner: 1960,
    perWinner: 980,
  },
} as unknown as Match);

const cible = (pseudo: string, isOwnProfile: boolean) => ({ isOwnProfile, pseudo });

describe('Gains du profil — la part du joueur, pas celle de son equipe', () => {
  it('le gain calcule est la PART du joueur, pas le total de son equipe', () => {
    const resume = buildCompetitiveSummary({
      target: cible('ALPHA', true),
      overallTrustScore: 50,
      matches: [matchGagne2v2()],
      tournaments: [],
    });

    // Le total de l equipe gagnante est 1960 ; chaque joueur a touche 980.
    // Le profil affichait 1960 : le DOUBLE de la reality.
    expect(resume.stats.totalEarnings).toBe(980);
  });

  it('le profil vu par un tiers annonce le meme montant', () => {
    const resume = buildCompetitiveSummary({
      target: cible('BRAVO', false),
      overallTrustScore: 50,
      matches: [matchGagne2v2()],
      tournaments: [],
    });

    // Le chemin est different (`pseudo` au lieu de `isMe`), et c est le
    // profil PUBLIC qui compte le plus.
    expect(resume.stats.totalEarnings).toBe(980);
  });

  it('le perdant ne touche rien', () => {
    const resume = buildCompetitiveSummary({
      target: cible('CHARLIE', false),
      overallTrustScore: 50,
      matches: [matchGagne2v2()],
      tournaments: [],
    });

    expect(resume.stats.totalEarnings).toBe(0);
  });

  it('sans projection, le repli divise par la taille d equipe', () => {
    // Match ancien, sans projection serveur : le front doit tout de meme
    // diviser par la taille d'equipe, sinon il affiche le total.
    const match = { ...matchGagne2v2() };
    delete (match as { projectedPayouts?: unknown }).projectedPayouts;

    const resume = buildCompetitiveSummary({
      target: cible('ALPHA', true),
      overallTrustScore: 50,
      matches: [match],
      tournaments: [],
    });

    // 1960 (pot moins commission, recalcule depuis prizePool) / 2 joueurs.
    expect(resume.stats.totalEarnings).toBe(980);
  });

  /*
   * M4 - les commissions d'arbitre du profil public.
   *
   * `match.arbiterFee` est un champ FIGE a la creation (2 % du pot
   * THEORIQUE) : le serveur ne le reecrit jamais au reglement, ou il calcule
   * 2 % de la cagnotte REELLEMENT verrouillee dans une variable locale, et
   * ZERO commission quand l'arbitre est parti. La carte "commissions"
   * additionnait donc un montant que le serveur n'a pas verse des que le
   * roster etait incomplet ou l'arbitre absent.
   */

  it('les commissions affichees prennent la projection serveur, pas le champ fige', () => {
    // La commission reelle (2 % de la base verrouillee 8820) est 176.4 cote
    // serveur, pas l'ancienne valeur figee 40.
    const matchArbiter = {
      ...matchGagne2v2(),
      arbiterFee: 40,
      projectedPayouts: {
        basis: 8820,
        locked: true,
        arbiterFee: 176.4,
        winner: 8643.6,
        perWinner: 4321.8,
      },
    } as unknown as Match;
    const resume = buildCompetitiveSummary({
      target: cible('ARB', false),
      overallTrustScore: 50,
      matches: [matchArbiter],
      tournaments: [],
    });

    expect(resume.arbiterStats.arbitratedMatches).toBe(1);
    expect(resume.arbiterStats.totalCommissions).toBe(176.4);
  });

  it('sans projection, le repli reste le champ fige pour les matchs anciens', () => {
    const matchArbiter = { ...matchGagne2v2() };
    delete (matchArbiter as { projectedPayouts?: unknown }).projectedPayouts;
    const resume = buildCompetitiveSummary({
      target: cible('ARB', false),
      overallTrustScore: 50,
      matches: [matchArbiter],
      tournaments: [],
    });

    expect(resume.arbiterStats.arbitratedMatches).toBe(1);
    expect(resume.arbiterStats.totalCommissions).toBe(40);
  });
});
