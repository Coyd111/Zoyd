/**
 * Metriques d'en-tete de la liste des tournois.
 *
 * INVARIANT (audit production 2026-11-19, ZD-04) : « A gagner » et
 * « Places ouvertes » ne comptent QUE l'argent et les places encore
 * disponibles. Les archives (termines, annules) ont deja verse leur
 * cagnotte et ferme leurs places : les additionner affichait une cagnotte
 * fantome au-dessus de la liste.
 * PIEGE : un tournoi `live` garde sa cagnotte en jeu mais n'ouvre plus de
 * places — il compte dans `playerPool`, jamais dans `openSlots`.
 */
import type { Tournament } from '../../../app/stores/tournamentStore';

type MetricTournament = {
  status: Tournament['status'];
  payout: Pick<Tournament['payout'], 'playerPool'>;
  maxEntries: number;
  entries: ReadonlyArray<unknown>;
};

export interface TournamentMetrics {
  visible: number;
  playerPool: number;
  openSlots: number;
}

export const computeTournamentMetrics = (
  tournaments: ReadonlyArray<MetricTournament>
): TournamentMetrics => {
  let playerPool = 0;
  let openSlots = 0;
  for (const tournament of tournaments) {
    if (tournament.status === 'recruiting' || tournament.status === 'live') {
      playerPool += tournament.payout.playerPool;
    }
    if (tournament.status === 'recruiting') {
      openSlots += Math.max(0, tournament.maxEntries - tournament.entries.length);
    }
  }
  return { visible: tournaments.length, playerPool, openSlots };
};
