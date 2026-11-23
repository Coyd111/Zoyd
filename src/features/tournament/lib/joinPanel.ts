import type { TournamentStatus } from '../../../app/stores/tournamentStore';

/**
 * Le panneau d'inscription du bracket.
 *
 * INVARIANT : « Rejoindre le tournoi » n'est affiche que si l'action est
 * possible, ou si le lecteur a deja un engagement (inscription, poste
 * arbitre) a consulter. Sur un tournoi termine, une invitation a
 * rejoindre est une promesse que le serveur refusera.
 */
export const shouldShowJoinPanel = (
  status: TournamentStatus,
  hasEntry: boolean,
  hasArbiterSlot: boolean,
): boolean => status === 'recruiting' || hasEntry || hasArbiterSlot;

export const joinPanelTitle = (status: TournamentStatus): string => {
  switch (status) {
    case 'live':
      return 'Tournoi en cours';
    case 'completed':
      return 'Tournoi terminé';
    case 'cancelled':
      return 'Tournoi annulé';
    default:
      return 'Rejoindre le tournoi';
  }
};
