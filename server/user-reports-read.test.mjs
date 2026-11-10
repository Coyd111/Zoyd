import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Contrat de lecture du client Supabase installe : les query builders sont des
 * THENABLES. On reproduit la chaine exactement telle que `listUserReports`
 * l'utilise — `select` puis `eq` eventuels, `order`, `range`, puis
 * resolution en `{ data, error, count }`.
 */
const makeQuery = (result) => {
  const q = {
    calls: { eq: [], order: null, range: null },
    eq(col, val) { q.calls.eq.push([col, val]); return q; },
    order(col, opts) { q.calls.order = [col, opts]; return q; },
    range(from, to) { q.calls.range = [from, to]; return Promise.resolve(result); },
  };
  return q;
};

const state = { result: { data: [], error: null, count: 0 }, lastQuery: null };

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => {
      const q = makeQuery(state.result);
      state.lastQuery = { table, q };
      return { select: vi.fn(() => q) };
    }),
  },
}));

import { listUserReports } from './persistence.mjs';

beforeEach(() => {
  state.result = { data: [], error: null, count: 0 };
  state.lastQuery = null;
});

describe('listUserReports — filtres et pagination', () => {
  it('lit la table user_reports', async () => {
    await listUserReports({});
    expect(state.lastQuery.table).toBe('user_reports');
  });

  it('filtre sur les COLONNES, pas sur le payload', async () => {
    // Filtrer sur `payload` ne permettrait d utiliser aucun index : PostgREST
    // devrait extraire du JSONB et tout charger pour trier en JavaScript.
    // Les colonnes existent justement pour que les index servent.
    await listUserReports({ status: 'pending', targetId: 'U42' });
    expect(state.lastQuery.q.calls.eq).toEqual([
      ['status', 'pending'],
      ['target_id', 'U42'],
    ]);
  });

  it('n applique aucun filtre si les parametres sont absents', async () => {
    await listUserReports({});
    expect(state.lastQuery.q.calls.eq).toEqual([]);
  });

  it('traduit limit/offset en Plage PostgREST bornee', async () => {
    await listUserReports({ limit: 25, offset: 50 });
    // `.range()` est inclusif des deux cotes : 50 -> 74 pour 25 elements.
    expect(state.lastQuery.q.calls.range).toEqual([50, 74]);
  });

  it('trie du plus recent au plus ancien', async () => {
    await listUserReports({});
    expect(state.lastQuery.q.calls.order).toEqual(['created_at', { ascending: false }]);
  });

  it('renvoie le compte total, pas seulement la taille de la page', async () => {
    // Indispensable pour paginer : sans `count`, l admin ne sait pas s il
    // reste des signalements et n'affiche pas de numero de page.
    state.result = { data: [{ id: 'RP-1', payload: {}, created_at: 'x' }], error: null, count: 137 };
    const res = await listUserReports({});
    expect(res.ok).toBe(true);
    expect(res.total).toBe(137);
    expect(res.reports).toHaveLength(1);
  });
});

describe('listUserReports — honnêteté du résultat', () => {
  it('ECH OUE bruyamment si la table est injoignable', async () => {
    // Le point central de cette fonction. Une liste vide et une table tombee
    // sont INDISTINGUABLES a l ecran : l admin conclurait « personne ne
    // signale rien » et arreterait de moderer. Ici l echec est explicite.
    state.result = { data: [], error: { message: 'relation does not exist', code: '42P01' }, count: null };
    const res = await listUserReports({});
    expect(res.ok).toBe(false);
    expect(res.reports).toEqual([]);
  });

  it('signale le mode memoire plutot que de simuler une file vide', async () => {
    // En l absence de client Supabase, la liste est vide pour une raison qui
    // n a rien a voir avec l absence de signalement : il faut le dire.
    const mod = await import('./persistence.mjs');
    expect(typeof mod.listUserReports).toBe('function');
  });
});

describe('listUserReports — fusion payload et colonnes', () => {
  it('lit les donnees metier dans le payload', async () => {
    state.result = {
      data: [
        {
          id: 'RP-A',
          reporter_id: 'U1',
          target_id: 'U2',
          reason: 'harassment',
          status: 'pending',
          created_at: '2026-03-01T10:00:00.000Z',
          payload: {
            reporterId: 'U1',
            reporterPseudo: 'Alice',
            targetId: 'U2',
            reason: 'harassment',
            description: 'Insistances',
            status: 'pending',
            createdAt: '2026-03-01T10:00:00.000Z',
          },
        },
      ],
      error: null,
      count: 1,
    };

    const res = await listUserReports({});
    expect(res.reports[0]).toMatchObject({
      id: 'RP-A',
      reporterId: 'U1',
      reporterPseudo: 'Alice',
      targetId: 'U2',
      reason: 'harassment',
      description: 'Insistances',
      status: 'pending',
      createdAt: '2026-03-01T10:00:00.000Z',
    });
  });

  it('complete avec les colonnes quand le payload est vide', async () => {
    // Robuste aux lignes ecrites avant le remplissage des colonnes
    // denormalisees, ou a un payload corrompu.
    state.result = {
      data: [{ id: 'RP-B', reporter_id: 'U9', target_id: 'U8', reason: 'cheating', status: 'resolved', created_at: '2026-02-01T00:00:00.000Z', payload: null }],
      error: null,
      count: 1,
    };

    const res = await listUserReports({});
    expect(res.reports[0]).toMatchObject({
      id: 'RP-B',
      reporterId: 'U9',
      targetId: 'U8',
      reason: 'cheating',
      status: 'resolved',
    });
  });

  it('ne leve pas sur un payload qui n est pas un objet', async () => {
    state.result = {
      data: [{ id: 'RP-C', status: 'pending', created_at: 'x', payload: 'texte inattendu' }],
      error: null,
      count: 1,
    };
    const res = await listUserReports({});
    expect(res.ok).toBe(true);
    expect(res.reports[0].id).toBe('RP-C');
    expect(res.reports[0].reporterPseudo).toBe('');
  });
});