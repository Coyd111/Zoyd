import { describe, it, expect } from 'vitest';
import { computeTournamentMetrics } from './tournamentMetrics';

/**
 * Verrou ZD-04 (audit production 2026-11-19).
 *
 * Les compteurs d'en-tete « A gagner » et « Places ouvertes » additionnaient
 * TOUS les tournois filtres, archives comprises. Un tournoi termine gonflait
 * donc une cagnotte deja versee et des places qui n'existent plus.
 *
 * Regles verrouillees :
 * - « A gagner » = cagnottes encore en jeu (inscriptions + en cours) ;
 * - « Places ouvertes » = places encore reservables (inscriptions seules) ;
 * - « Tournois visibles » = tout ce que la liste affiche, archives comprises.
 */
const tournament = (
  status: 'recruiting' | 'live' | 'completed' | 'cancelled',
  playerPool: number,
  maxEntries: number,
  entryCount: number
) => ({
  status,
  payout: { playerPool },
  maxEntries,
  entries: Array.from({ length: entryCount }, () => ({})),
});

describe('computeTournamentMetrics', () => {
  it('exclut les archives de la cagnotte a gagner', () => {
    const metrics = computeTournamentMetrics([
      tournament('recruiting', 1000, 16, 4),
      tournament('completed', 500, 8, 8),
      tournament('cancelled', 300, 8, 2),
    ]);
    expect(metrics.playerPool).toBe(1000);
  });

  it('compte la cagnotte d un tournoi en cours mais aucune place ouverte', () => {
    const metrics = computeTournamentMetrics([
      tournament('live', 2000, 16, 12),
    ]);
    expect(metrics.playerPool).toBe(2000);
    expect(metrics.openSlots).toBe(0);
  });

  it('compte les places restantes des seules inscriptions ouvertes', () => {
    const metrics = computeTournamentMetrics([
      tournament('recruiting', 1000, 16, 12),
      tournament('live', 2000, 16, 12),
      tournament('completed', 500, 8, 8),
    ]);
    expect(metrics.openSlots).toBe(4);
  });

  it('ne rend jamais de places negatives sur un tournoi surrempli', () => {
    const metrics = computeTournamentMetrics([
      tournament('recruiting', 1000, 8, 10),
    ]);
    expect(metrics.openSlots).toBe(0);
  });

  it('compte tous les tournois visibles, archives comprises', () => {
    const metrics = computeTournamentMetrics([
      tournament('recruiting', 0, 8, 0),
      tournament('live', 0, 8, 8),
      tournament('completed', 0, 8, 8),
    ]);
    expect(metrics.visible).toBe(3);
  });
});
