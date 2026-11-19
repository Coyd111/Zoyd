import { describe, it, expect, vi, afterEach } from 'vitest';
import { countDown } from './lobbyTiming';

/**
 * Verrou ZD-02 (audit production 2026-11-19).
 *
 * Un salon ANNULE affichait « Imminent ». Le compte a rebours ne regardait
 * que la date, jamais le statut. La carte portait pourtant le badge ANNULÉ
 * juste au-dessus : deux affirmations contradictoires sur le meme ecran.
 */
describe('countDown BR', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('affiche le statut, jamais un compte a rebours, pour un salon annule', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
    expect(countDown('2026-11-19T11:00:00Z', 'cancelled')).toBe('Annulé');
  });

  it('affiche le statut pour un salon termine ou en reglement', () => {
    expect(countDown('2026-11-19T11:00:00Z', 'finished')).toBe('Terminé');
    expect(countDown('2026-11-19T11:00:00Z', 'settling')).toBe('Règlement');
  });

  it('affiche « En cours » pour un salon lance', () => {
    expect(countDown('2026-11-19T11:00:00Z', 'live')).toBe('En cours');
  });

  it('compte les heures et les minutes pour un salon programme', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
    expect(countDown('2026-11-19T14:00:00Z', 'scheduled')).toBe('Dans 2 h');
    expect(countDown('2026-11-19T12:30:00Z', 'scheduled')).toBe('Dans 30 min');
    expect(countDown('2026-11-19T11:59:30Z', 'scheduled')).toBe('Imminent');
  });

  it('reste muet sur une date absente ou invalide', () => {
    expect(countDown(null, 'scheduled')).toBe('—');
    expect(countDown('pas-une-date', 'scheduled')).toBe('—');
  });
});
