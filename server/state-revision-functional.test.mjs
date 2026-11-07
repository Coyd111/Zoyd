import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * State OCC fonctionnel : conflit détecté, pas écrasé.
 *
 * On rejoue le scénario multi-instance : l'instance B a chargé la
 * révision 3, l'instance A a déjà écrit (base à révision 4). L'écriture
 * conditionnelle de B ne touche 0 ligne -> `STATE_CONFLICT` + rollback
 * mémoire (pas de divergence « optimiste »).
 */

const h = vi.hoisted(() => {
  // Chaîne Supabase minimale : update -> eq* -> select -> {data, error}
  let updateRows = [];
  let upsertOk = true;
  const builder = () => {
    const q = {};
    q.select = vi.fn(() => Promise.resolve({ data: updateRows, error: null }));
    q.limit = vi.fn(() => Promise.resolve({ data: [], error: null }));
    q.eq = vi.fn(() => q);
    q.in = vi.fn(() => q);
    q.order = vi.fn(() => q);
    return q;
  };
  return {
    setUpdateRows: (rows) => { updateRows = rows; },
    setUpsertOk: (ok) => { upsertOk = ok; },
    getUpsertOk: () => upsertOk,
    supabaseMock: {
      from: vi.fn(() => {
        const q = builder();
        q.update = vi.fn(() => q);
        q.upsert = vi.fn(async () => ({ error: upsertOk ? null : new Error('down') }));
        q.delete = vi.fn(() => q);
        q.insert = vi.fn(async () => ({ error: null }));
        return q;
      }),
    },
  };
});

vi.mock('./supabase.mjs', () => ({ supabase: h.supabaseMock }));

// `fetchAllRows` utilise aussi `from(...).select().order().limit()` : le
// builder ci-dessus rend `{data: updateRows}` sur select — au boot sans
// `loadFromSupabase`, l'état reste vide : on alimente via `upsertStateEntity`
// (création) puis on teste la mise à jour conditionnelle.

import {
  upsertStateEntity,
  getStateEntity,
  setStateRevisionSupportedPourTest,
  setStateTrustedPourTest,
  getHealthInfo,
} from './persistence.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  h.setUpdateRows([{ entity_id: 'E1' }]);
  h.setUpsertOk(true);
  setStateRevisionSupportedPourTest(true);
  setStateTrustedPourTest(true);
});

describe('state revision — fonctionnel', () => {
  it('sante expose stateRevisionColumn', () => {
    expect(getHealthInfo()).toHaveProperty('stateRevisionColumn');
  });

  it('creation puis mise a jour conditionnelle reussie', async () => {
    // Création (revision 1 via upsert).
    await upsertStateEntity('matches', { id: 'E1', status: 'recruiting' });
    expect(getStateEntity('matches', 'E1')?.status).toBe('recruiting');
    // Mise à jour : la ligne existe, révision observée 1, base à 1.
    h.setUpdateRows([{ entity_id: 'E1' }]);
    await upsertStateEntity('matches', { id: 'E1', status: 'in_progress' });
    expect(getStateEntity('matches', 'E1')?.status).toBe('in_progress');
  });

  it('conflit (0 ligne touchee) = STATE_CONFLICT + rollback memoire', async () => {
    await upsertStateEntity('matches', { id: 'E1', status: 'recruiting' });
    // L'autre instance a écrit entre-temps : 0 ligne pour notre révision.
    h.setUpdateRows([]);
    const avant = getStateEntity('matches', 'E1');
    await expect(
      upsertStateEntity('matches', { id: 'E1', status: 'finished' }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    // Rollback : la mémoire garde la valeur d'avant.
    expect(getStateEntity('matches', 'E1')?.status).toBe(avant.status);
  });

  it('sans colonne : ecriture inconditionnelle (fallback)', async () => {
    setStateRevisionSupportedPourTest(false);
    await upsertStateEntity('matches', { id: 'E2', status: 'recruiting' });
    expect(getStateEntity('matches', 'E2')?.status).toBe('recruiting');
    // Update sans CAS : même avec 0 ligne « conditionnelle », on ne lève pas.
    await upsertStateEntity('matches', { id: 'E2', status: 'in_progress' });
    expect(getStateEntity('matches', 'E2')?.status).toBe('in_progress');
  });
});
