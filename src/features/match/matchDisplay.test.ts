import { describe, expect, it } from 'vitest';
import {
  MISSING_VALUE,
  formatBestOf,
  formatScoreTarget,
  formatTeamScore,
} from './matchDisplay';

/**
 * Un match ancien peut ne pas porter `rules.bestOf`, `rules.scoreTarget`
 * ou `result.scores`. La production a rendu « BOundefined » et
 * « SCORE ALPHA undefined » sur M-MWHYO9FS : la valeur absente doit
 * s'afficher comme absente, jamais comme le mot « undefined ».
 */
describe('affichage des champs de match anciens', () => {
  it('un bestOf absent affiche un tiret, jamais BOundefined', () => {
    expect(formatBestOf(undefined)).toBe(MISSING_VALUE);
    expect(formatBestOf(null)).toBe(MISSING_VALUE);
    expect(formatBestOf(Number.NaN)).toBe(MISSING_VALUE);
    expect(formatBestOf(0)).toBe(MISSING_VALUE);
  });

  it('un bestOf present garde son libelle BO', () => {
    expect(formatBestOf(1)).toBe('BO1');
    expect(formatBestOf(3)).toBe('BO3');
    expect(formatBestOf(5)).toBe('BO5');
  });

  it('un score cible absent affiche un tiret', () => {
    expect(formatScoreTarget(undefined)).toBe(MISSING_VALUE);
    expect(formatScoreTarget(null)).toBe(MISSING_VALUE);
    expect(formatScoreTarget(Number.NaN)).toBe(MISSING_VALUE);
  });

  it('un score cible present reste un nombre, zero compris', () => {
    expect(formatScoreTarget(0)).toBe('0');
    expect(formatScoreTarget(7)).toBe('7');
    expect(formatScoreTarget(250)).toBe('250');
  });

  it('un score d equipe absent affiche un tiret, zero reste zero', () => {
    expect(formatTeamScore(undefined)).toBe(MISSING_VALUE);
    expect(formatTeamScore(null)).toBe(MISSING_VALUE);
    expect(formatTeamScore(Number.NaN)).toBe(MISSING_VALUE);
    expect(formatTeamScore(0)).toBe('0');
    expect(formatTeamScore(13)).toBe('13');
  });
});
