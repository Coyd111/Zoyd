import { describe, expect, it } from 'vitest';
import { joinPanelTitle, shouldShowJoinPanel } from './joinPanel';

/**
 * Le panneau d'inscription affiche « Rejoindre le tournoi » et un solde
 * meme quand le tournoi est termine. Sur T-MJ-MWJ5RZ3E (termine, 8/8),
 * la production montrait encore « REJOINDRE LE TOURNOI » et
 * « Cout inscription » : une action impossible presentee comme ouverte.
 */
describe('panneau d inscription du bracket', () => {
  it('reste visible pendant les inscriptions', () => {
    expect(shouldShowJoinPanel('recruiting', false, false)).toBe(true);
  });

  it('disparait sur un tournoi termine sans engagement du lecteur', () => {
    expect(shouldShowJoinPanel('completed', false, false)).toBe(false);
    expect(shouldShowJoinPanel('cancelled', false, false)).toBe(false);
    expect(shouldShowJoinPanel('live', false, false)).toBe(false);
  });

  it('reste visible si le lecteur a une inscription ou un poste arbitre', () => {
    expect(shouldShowJoinPanel('completed', true, false)).toBe(true);
    expect(shouldShowJoinPanel('completed', false, true)).toBe(true);
  });

  it('le titre ne promet plus de rejoindre un tournoi clos', () => {
    expect(joinPanelTitle('recruiting')).toBe('Rejoindre le tournoi');
    expect(joinPanelTitle('live')).toBe('Tournoi en cours');
    expect(joinPanelTitle('completed')).toBe('Tournoi terminé');
    expect(joinPanelTitle('cancelled')).toBe('Tournoi annulé');
  });
});
