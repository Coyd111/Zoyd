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

/**
 * M1 — la projection serveur survit a la normalisation.
 *
 * Avant la correction, `StoredMatch` ne declarait pas `projectedPayouts` :
 * `normalizeStoredMatch` ecartait le champ malgre l'emission serveur
 * (`sanitizeMatchForBroadcast` l'attache a TOUTES les sorties), et les helpers
 * de `src/lib/matchPayout.ts` retombaient toujours sur le recalcul local
 * `prizePool - zoydFee - arbiterFee` — le pot THEORIQUE et une commission
 * figee, jamais le versement reel (roster incomplet, match sans arbitre).
 */
describe('matchStore — projection projectedPayouts (M1)', () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: [], filters: { format: 'all', status: 'all' } });
  });

  it('replaceFromServer garde la projection serveur dans le match normalise', () => {
    const projection = {
      basis: 88.2,
      locked: true,
      arbiterFee: 1.8,
      winner: 86.4,
      perWinner: 43.2,
    };
    // Roster 2v2 incomplet : prizePool theorique 100 mais projection sur les
    // fonds reellement bloques (88.2).
    useMatchStore.getState().replaceFromServer([
      match({ id: 'M-PROJ', prizePool: 100, teamSize: 2, projectedPayouts: projection }),
    ]);

    const stored = current()[0].projectedPayouts;
    expect(stored).toEqual(projection);
  });

  it('hydrateFromServer garde aussi la projection (chemin delta socket)', () => {
    useMatchStore.setState({ matches: [match({ id: 'M-PROJ', updatedAt: '2026-01-01T00:00:00.000Z' })] as never });

    useMatchStore.getState().hydrateFromServer([
      match({
        id: 'M-PROJ',
        updatedAt: '2026-01-02T00:00:00.000Z',
        prizePool: 100,
        teamSize: 2,
        projectedPayouts: { basis: 88.2, locked: true, arbiterFee: 1.8, winner: 86.4, perWinner: 43.2 },
      }),
    ]);

    expect(current()[0].projectedPayouts?.perWinner).toBe(43.2);
    expect(current()[0].projectedPayouts?.basis).toBe(88.2);
  });

  it('sans projection, le champ reste undefined et le repli local reste le recours', () => {
    useMatchStore.getState().replaceFromServer([match({ id: 'M-ANCIEN', prizePool: 100, teamSize: 2 })]);

    expect(current()[0].projectedPayouts).toBeUndefined();
  });

  it('une projection malformee (basis non fini) est ecartee : pas de pot invente', () => {
    useMatchStore.getState().replaceFromServer([
      match({
        id: 'M-CASSE',
        prizePool: 100,
        projectedPayouts: { basis: Number.NaN, locked: true, arbiterFee: 1.8, winner: 86.4, perWinner: 43.2 },
      }),
    ]);

    expect(current()[0].projectedPayouts).toBeUndefined();
  });

  it('les helpers de matchPayout lisent enfin la valeur serveur du store (V8)', async () => {
    const { getWinnerPayout, getWinnerPayoutPerPlayer, getArbiterFee } = await import('../../lib/matchPayout');

    useMatchStore.getState().replaceFromServer([
      match({
        id: 'M-PROJ',
        prizePool: 100,
        zoydFee: 2,
        arbiterFee: 2,
        teamSize: 2,
        players: [{ isMe: true, team: 0, userId: 'p1', pseudo: 'P1', ready: true, checkedIn: true, readyAt: null, checkedInAt: null }] as never,
        projectedPayouts: { basis: 88.2, locked: true, arbiterFee: 1.764, winner: 86.436, perWinner: 43.218 },
      }),
    ]);

    const storedMatch = current()[0];
    // La projection l'emporte partout : le pot reellement bloque (88.2) et la
    // commission reelle (1.764 : 2% de la base verrouillee), pas la theorie.
    expect(getWinnerPayout(storedMatch)).toBe(86.44);
    expect(getWinnerPayoutPerPlayer(storedMatch)).toBe(43.22);
    // La commission projetee passe SANS re-normalisation : le front ne
    // recalcule rien (getArbiterFee ne round pas la branche projetee).
    expect(getArbiterFee(storedMatch)).toBe(1.764);
  });

  it('sans projection conservee, les helpers retombent sur le calcul local', async () => {
    const { getWinnerPayout, getArbiterFee } = await import('../../lib/matchPayout');

    useMatchStore.getState().replaceFromServer([
      match({ id: 'M-ANCIEN', prizePool: 100, zoydFee: 2, arbiterFee: 2, teamSize: 2 }),
    ]);

    const storedMatch = current()[0];
    expect(getWinnerPayout(storedMatch)).toBe(96);
    expect(getArbiterFee(storedMatch)).toBe(2);
  });
});

/**
 * P13 C2 (audit-3) : la salle CODM arrive PAR destinataire dans `match.room`.
 * Avant le correctif, le sanitizer la retirait de toutes les sorties :
 * `canLaunch` restait toujours false et tout match arbitre etait inerte
 * depuis l'UI. Ces tests verrouillent la survie du champ a la normalisation
 * du store — sans elle, l'ecran perdrait la salle a chaque hydratation.
 */
describe('matchStore — salle livree par destinataire (P13 C2)', () => {
  beforeEach(() => {
    useMatchStore.setState({ matches: [], filters: { format: 'all', status: 'all' } });
  });

  it('la salle du destinataire survit a la normalisation (chemin socket delta)', () => {
    useMatchStore.getState().hydrateFromServer([
      match({
        id: 'M-ROOM',
        updatedAt: '2026-01-02T00:00:00.000Z',
        room: { name: 'SALLE-1', password: 'secret' },
      }),
    ]);

    expect(current()[0].room).toEqual({ name: 'SALLE-1', password: 'secret' });
  });

  it('l\'absence de salle reste absente (lecteur non habilite)', () => {
    useMatchStore.getState().replaceFromServer([match({ id: 'M-PUBLIC' })]);

    expect(current()[0].room).toBeUndefined();
  });

  it('un delta plus frais remplace la salle (l\'arbitre re-partage une autre salle)', () => {
    useMatchStore.setState({
      matches: [
        match({ id: 'M-ROOM', updatedAt: '2026-01-01T10:00:00.000Z', room: { name: 'ANCIENNE', password: 'a' } }),
      ] as never,
    });

    useMatchStore.getState().hydrateFromServer([
      match({ id: 'M-ROOM', updatedAt: '2026-01-01T11:00:00.000Z', room: { name: 'NOUVELLE', password: 'b' } }),
    ]);

    expect(current()[0].room).toEqual({ name: 'NOUVELLE', password: 'b' });
  });
});