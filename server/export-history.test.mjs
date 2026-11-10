import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le filtre temporel est le coeur de cet export : c'est lui qui decide ce qui
 * entre dans le fichier de sauvegarde. Une borne deplacee d un jour ne produit
 * aucune erreur visible — le fichier est simplement incomplet, ou contient un
 * match qui ne devrait pas y etre.
 */

const state = { result: { data: [], error: null } };

const makeThenable = (result) => {
  let offset = 0;
  const t = {
    eq() { return t; },
    select() { return t; },
    range(off) { offset = off; return t; },
    then(onOk) {
      if (result.error) return Promise.resolve(onOk(result));
      const data = result.data || [];
      // Simule le plafond PostgREST : 1000 lignes par requete maximum.
      const page = data.slice(offset, offset + 1000);
      return Promise.resolve(onOk({ data: page, error: null }));
    },
  };
  return t;
};

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn(() => makeThenable(state.result)) })),
  },
}));

import { exportMatchHistory } from './persistence.mjs';

const row = (payload) => ({ entity_id: payload.id, payload, updated_at: new Date().toISOString() });

beforeEach(() => {
  state.result = { data: [], error: null };
});

describe('exportMatchHistory', () => {
  it('la branche mode memoire est couverte par le test E2E de la route', async () => {
    // Ce fichier simule un client Supabase, donc `supabase` est toujours
    // present : la branche « aucune base configuree » y est inatteignable.
    // Elle est verifiee de bout en bout par la suite Playwright, qui demarre
    // en `ZOYD_DISABLE_SUPABASE=true`. On ne pretend pas la couvrir ici.
    expect(state.result).toBeDefined();
  });

  it('echoue bruyamment si la table est injoignable', async () => {
    state.result = { data: null, error: { message: 'relation does not exist', code: '42P01' } };
    const res = await exportMatchHistory();
    expect(res.ok).toBe(false);
    expect(res.degraded).toBeUndefined();
  });

  it('filtre sur finishedAt, pas sur updated_at du snapshot', async () => {
    // `state_snapshots` n a que `updated_at`, qui bouge a chaque ecriture. Un
    // match de l an dernier relu aujourd hui ne doit PAS apparaitre dans la
    // periode demandee.
    state.result = {
      data: [
        row({ id: 'JOUEE', finishedAt: '2026-03-10T00:00:00.000Z', createdAt: '2026-03-01T00:00:00.000Z' }),
        row({ id: 'ANCIENNE', finishedAt: '2025-01-10T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' }),
      ],
      error: null,
    };

    const res = await exportMatchHistory({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.ok).toBe(true);
    expect(res.matches.map((m) => m.id)).toEqual(['JOUEE']);
  });

  it('retombe sur createdAt pour un match jamais cloture', async () => {
    state.result = {
      data: [row({ id: 'SANS_FIN', createdAt: '2026-02-01T00:00:00.000Z' })],
      error: null,
    };

    const res = await exportMatchHistory({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.matches.map((m) => m.id)).toEqual(['SANS_FIN']);
  });

  it('inclut la journee entiere du `to`', async () => {
    // Une borne superieure a minuit exclurait silencieusement les matchs du
    // dernier jour de la periode : exactement le genre de trou qu on ne voit
    // qu au moment de verifier une archive.
    state.result = {
      data: [
        row({ id: 'MATIN', finishedAt: '2026-03-10T00:00:01.000Z' }),
        row({ id: 'SOIR', finishedAt: '2026-03-10T23:59:59.000Z' }),
      ],
      error: null,
    };

    const res = await exportMatchHistory({ from: '2026-03-10', to: '2026-03-10' });
    expect(res.total).toBe(2);
  });

  it('trie du plus recent au plus ancien', async () => {
    state.result = {
      data: [
        row({ id: 'ANCIEN', finishedAt: '2026-01-01T00:00:00.000Z' }),
        row({ id: 'RECENT', finishedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      error: null,
    };

    const res = await exportMatchHistory({});
    expect(res.matches.map((m) => m.id)).toEqual(['RECENT', 'ANCIEN']);
  });

  it('ecarte une date illisible plutot que de la garder', async () => {
    state.result = {
      data: [
        row({ id: 'CASSE', finishedAt: 'pas-une-date' }),
        row({ id: 'VALIDE', finishedAt: '2026-05-05T00:00:00.000Z' }),
      ],
      error: null,
    };

    const res = await exportMatchHistory({});
    expect(res.matches.map((m) => m.id)).toEqual(['VALIDE']);
  });

  it('tolere une ligne dont le payload est vide ouAbsent', async () => {
    state.result = {
      data: [
        { entity_id: 'X', payload: null, updated_at: 'x' },
        { entity_id: 'Y', payload: 'texte', updated_at: 'x' },
        row({ id: 'BON', finishedAt: '2026-04-04T00:00:00.000Z' }),
      ],
      error: null,
    };

    const res = await exportMatchHistory({});
    expect(res.matches.map((m) => m.id)).toEqual(['BON']);
  });

  it('sans periode, renvoie tout', async () => {
    state.result = {
      data: [
        row({ id: 'A', finishedAt: '2024-01-01T00:00:00.000Z' }),
        row({ id: 'B', finishedAt: '2026-01-01T00:00:00.000Z' }),
      ],
      error: null,
    };

    const res = await exportMatchHistory({});
    expect(res.total).toBe(2);
  });

  // P2 C2 (audit-3) : le select etait lu SANS pagination — PostgREST plafonne
  // a 1000 lignes SANS erreur : l'export omettait les plus anciens
  // silencieusement (le pire defaut possible pour une sauvegarde). Le mock
  // applique le plafond : 1001 lignes en base, deux requetes.
  it('pagine au-dela du plafond de 1000 lignes de PostgREST', async () => {
    state.result = {
      data: Array.from({ length: 1001 }, (_, i) =>
        row({ id: `M-${i}`, finishedAt: '2026-01-01T00:00:00.000Z' })),
      error: null,
    };

    const res = await exportMatchHistory({});
    expect(res.ok).toBe(true);
    expect(res.total).toBe(1001);
    expect(res.matches).toHaveLength(1001);
    expect(res.matches[0].id).toBe('M-0');
    expect(res.matches[1000].id).toBe('M-1000');
  });
});