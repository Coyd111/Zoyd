import { describe, it, expect } from 'vitest';
import { hasWalletTrendActivity, type WalletTrendPoint } from './communityInsights';

/**
 * ZD-18 : un compte sans gain affichait un cadre de graphique vide. Le
 * graphique ne doit etre monte que si la courbe porte un mouvement ; sinon
 * l ecran affiche un etat vide explicite avec une action.
 */
const point = (delta: number): WalletTrendPoint => ({
  day: '01',
  label: '01/01',
  amount: 0,
  delta,
});

describe('etat vide des gains', () => {
  it('un trend sans mouvement est vide', () => {
    expect(hasWalletTrendActivity([])).toBe(false);
    expect(hasWalletTrendActivity([point(0), point(0), point(0)])).toBe(false);
  });

  it('un seul mouvement suffit a afficher la courbe', () => {
    expect(hasWalletTrendActivity([point(0), point(25)])).toBe(true);
    expect(hasWalletTrendActivity([point(-10)])).toBe(true);
  });
});
