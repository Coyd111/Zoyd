/**
 * Compte a rebours d'un salon Battle Royale.
 *
 * INVARIANT (audit production 2026-11-19, ZD-02) : le STATUT prime sur la
 * date. Un salon annule, termine ou en reglement n'a pas de compte a
 * rebours : afficher « Imminent » au-dessus d'un badge ANNULÉ met deux
 * affirmations contradictoires sur le meme ecran. La date ne parle que
 * pour un salon `scheduled`.
 * PIEGE : ne pas deduire le statut de la date. Un salon annule peut avoir
 * une date future, et un salon ouvert peut avoir une date passee (retard
 * d'arbitre) : seul le serveur connait le statut.
 * PIEGE : `Date.parse` renvoie NaN sur une date invalide ; sans garde on
 * afficherait « Dans NaN h ».
 */
import type { BrLobbyStatus } from '../../../app/lib/brApi';

const STATUS_LABELS: Record<BrLobbyStatus, string | null> = {
  scheduled: null,
  live: 'En cours',
  settling: 'Règlement',
  finished: 'Terminé',
  cancelled: 'Annulé',
};

export const countDown = (target: string | null, status: BrLobbyStatus): string => {
  const statusLabel = STATUS_LABELS[status];
  if (statusLabel !== null) return statusLabel;
  if (!target) return '—';
  const ms = Date.parse(target) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'Imminent';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 1) return `Dans ${hours} h`;
  if (minutes >= 1) return `Dans ${minutes} min`;
  return 'Imminent';
};
