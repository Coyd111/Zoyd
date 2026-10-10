import { describe, it, expect } from 'vitest';
import { extraireRaisonPayout } from './apiClient';

// Le message server : `Échec du transfert Mobile Money: <raison FedaPay>`.
describe('raison du refus FedaPay remontee au joueur', () => {
  it('extrait la raison après le préfixe connu', () => {
    expect(extraireRaisonPayout('Échec du transfert Mobile Money: Numéro invalide'))
      .toBe('Numéro invalide');
  });

  it('tolère l absence du préfixe', () => {
    expect(extraireRaisonPayout('Insufficient balance')).toBe('Insufficient balance');
  });

  it('ne garde que la première ligne', () => {
    // FedaPay peut renvoyer une trace multiligne : l'écran n'a pas besoin du
    // detail technique complet.
    expect(extraireRaisonPayout('Échec du transfert Mobile Money: pas assez\nStack: ...'))
      .toBe('pas assez');
  });

  it('tronque une raison démesurée', () => {
    const long = 'x'.repeat(400);
    const raison = extraireRaisonPayout(`Echec: ${long}`);
    expect(raison.length).toBeLessThanOrEqual(140);
    expect(raison.endsWith('…')).toBe(true);
  });

  it('renvoie une chaîne vide sur message vide', () => {
    expect(extraireRaisonPayout('')).toBe('');
  });
});