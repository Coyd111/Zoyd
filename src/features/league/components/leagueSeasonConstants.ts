import type { LeagueDayKey } from '../../../app/stores/leagueStore';
import { Play, CheckCircle, Clock } from 'lucide-react';

export const DAY_KEYS: LeagueDayKey[] = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const DAY_LABELS: Record<LeagueDayKey, string> = {
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
};

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  registering: { label: 'Inscriptions ouvertes', color: 'text-green-400 border-green-400/30 bg-green-400/10' },
  qualifying: { label: 'Qualification en cours', color: 'text-zoyd-yellow border-zoyd-yellow/30 bg-zoyd-yellow/10' },
  final: { label: 'Finale', color: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  completed: { label: 'Terminé', color: 'text-white/70 border-white/10 bg-white/5' },
  // Sans cette entree, STATUS_BADGES[season.status] valait undefined sur une
  // saison annulee (inscriptions insuffisantes, saison perimee) : la page
  // lisait badge.color et tombait (M2).
  cancelled: { label: 'Annulée', color: 'text-red-400 border-red-400/30 bg-red-400/10' },
};

export const DAY_STATUS_ICONS: Record<string, typeof Play> = {
  pending: Clock,
  scheduled: Clock,
  live: Play,
  finished: CheckCircle,
};
