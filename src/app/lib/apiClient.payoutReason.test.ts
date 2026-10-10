import { describe, it, expect } from 'vitest';
import { resumerMessagePayout } from './apiClient';

// Le message serveur porte la partie rassurante puis la raison du prestataire.
// On ne doit surtout pas la masquer : c'est elle qui explique l'échec.
describe('affichage du refus de retrait', () => {
  it('conserve la raison quand elle est courte', () => {
    const message = "FedaPay refuse le transfert (403) à la création du transfert : compte non autorisé.";
    expect(resumerMessagePayout(message)).toBe(message);
  });

  it('tronque proprement un message démesuré', () => {
    const long = `Échec du transfert Mobile Money : ${'x'.repeat(500)}`;
    const resume = resumerMessagePayout(long);
    expect(resume.length).toBe(300);
    expect(resume.endsWith('…')).toBe(true);
  });

  it('ne garde que la première ligne', () => {
    expect(resumerMessagePayout('Raison utile\nStack trace interne')).toBe('Raison utile');
  });

  it('renvoie une chaîne vide sur message vide', () => {
    expect(resumerMessagePayout('')).toBe('');
  });
});