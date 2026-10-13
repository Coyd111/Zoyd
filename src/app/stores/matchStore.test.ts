import { describe, it, expect, beforeEach } from 'vitest';
import { useMatchStore } from './matchStore';

/**
 * Le socket ne diffuse QUE des deltas : un seul match modifie. `hydrateFromServer`
 * est donc la porte d'entree de l'etat affiche par le joueur, et le commentaire
 * de `useRealtimeHeartbeat` previent explicitement qu'appeler `replaceFromServer`
 * a la place effacerait tous les autres matchs de la liste.
 *
 * Ces tests verrouillent deux choses :
 *  - la fusion ne PERD jamais un match absent du delta ;
 *  - un delta plus ancien que l'etat local ne peut pas le perimer.
 *
 * Un store qui applique un delta arrive dans le mauvais sens fait disappear des
 * matchs de l'ecran sans aucune erreur visible.
 */

const match = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'M1',
    format: 'duel',
    status: 'open',
    players: [],
    disputes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as never;

const current = () => useMatchStore.getState().matches;
const ids = () => current().map((m) => m.id);

describe('matchStore — hydrateFromServer (delta)', () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: [], filters: { format: 'all', status: 'all' } });
  });

  it('conserve les matchs absents du delta (le piege du replace)', () => {
    useMatchStore.setState({
      matches: [
        match({ id: 'M1', updatedAt: '2026-01-01T10:00:00.000Z' }),
        match({ id: 'M2', updatedAt: '2026-01-01T09:00:00.000Z' }),
        match({ id: 'M3', updatedAt: '2026-01-01T08:00:00.000Z' }),
      ] as never,
    });

    // Delta : seul M2 a bouge sur le serveur.
    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M2', status: 'in_progress', updatedAt: '2026-01-01T11:00:00.000Z' }),
    ]);

    expect(ids().sort()).toEqual(['M1', 'M2', 'M3']);
  });

  it('applique le changement de statut du match inclus dans le delta', () => {
    useMatchStore.setState({
      matches: [match({ id: 'M1', status: 'open', updatedAt: '2026-01-01T10:00:00.000Z' })] as never,
    });

    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M1', status: 'in_progress', updatedAt: '2026-01-01T11:00:00.000Z' }),
    ]);

    expect(current()[0].status).toBe('in_progress');
  });

  it('ajoute un match inconnu du delta sans supprimer les autres', () => {
    useMatchStore.setState({ matches: [match({ id: 'M1' })] as never });

    useMatchStore.getState().hydrateFromServer([match({ id: 'NOUVEAU', updatedAt: '2026-01-02T00:00:00.000Z' })]);

    expect(ids().sort()).toEqual(['M1', 'NOUVEAU']);
  });

  it('un delta plus ancien ne peut pas perimer un etat local plus frais', () => {
    useMatchStore.setState({
      matches: [match({ id: 'M1', status: 'finished', updatedAt: '2026-01-05T12:00:00.000Z' })] as never,
    });

    // Relivraison d'un paquet reseau tardif, antérieur à l'etat courant.
    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M1', status: 'open', updatedAt: '2026-01-05T09:00:00.000Z' }),
    ]);

    expect(current()[0].status).toBe('finished');
  });

  it('a horodatage egal, le delta l emporte (tie-break favorable au serveur)', () => {
    useMatchStore.setState({
      matches: [match({ id: 'M1', status: 'open', updatedAt: '2026-01-05T12:00:00.000Z' })] as never,
    });

    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M1', status: 'cancelled', updatedAt: '2026-01-05T12:00:00.000Z' }),
    ]);

    expect(current()[0].status).toBe('cancelled');
  });

  it('retombe sur createdAt quand updatedAt est absent', () => {
    useMatchStore.setState({
      matches: [
        match({ id: 'M1', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: undefined }),
      ] as never,
    });

    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M1', status: 'finished', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: undefined }),
    ]);

    expect(current()[0].status).toBe('finished');
  });

  it('ne duplique pas un match present plusieurs fois dans le delta', () => {
    useMatchStore.setState({ matches: [match({ id: 'M1' })] as never });

    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M1', status: 'ready', updatedAt: '2026-01-03T00:00:00.000Z' }),
      match({ id: 'M1', status: 'in_progress', updatedAt: '2026-01-04T00:00:00.000Z' }),
    ]);

    expect(ids()).toEqual(['M1']);
    expect(current()[0].status).toBe('in_progress');
  });

  it('resultat trie du plus recent au plus ancien', () => {
    useMatchStore.getState().hydrateFromServer([
      match({ id: 'VIEUX', updatedAt: '2026-01-01T00:00:00.000Z' }),
      match({ id: 'RECENT', updatedAt: '2026-03-01T00:00:00.000Z' }),
      match({ id: 'MOYEN', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);

    expect(ids()).toEqual(['RECENT', 'MOYEN', 'VIEUX']);
  });

  it('un delta vide ne vide pas la liste', () => {
    useMatchStore.setState({ matches: [match({ id: 'M1' }), match({ id: 'M2' })] as never });

    useMatchStore.getState().hydrateFromServer([]);

    expect(ids().sort()).toEqual(['M1', 'M2']);
  });
});

describe('matchStore — replaceFromServer (liste complete)', () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: [], filters: { format: 'all', status: 'all' } });
  });

  it('remplace integralement : un match absent disparait', () => {
    useMatchStore.setState({ matches: [match({ id: 'PERDU' })] as never });

    useMatchStore.getState().replaceFromServer([match({ id: 'GARDE' })]);

    expect(ids()).toEqual(['GARDE']);
  });
});