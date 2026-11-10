import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * State OCC fonctionnel : conflit détecté, pas écrasé.
 *
 * On rejoue le scénario multi-instance : l'instance B a chargé la
 * révision 3, l'instance A a déjà écrit (base à révision 4). L'écriture
 * conditionnelle de B ne touche 0 ligne -> `STATE_CONFLICT`.
 *
 * Sur conflit, la mémoire ADOPTE l'état FRAIS relu en base (avant : elle
 * restaurait sa valeur périmée, et la révision locale n'avançait pas —
 * l'entité devenait définitivement inécrivable depuis cette instance).
 */

const h = vi.hoisted(() => {
  // Chaîne Supabase minimale : update -> eq* -> select -> {data, error}
  let updateRows = [];
  let relectureRows = [];
  let upsertOk = true;
  const builder = () => {
    const q = {};
    // `select` renvoie le BUILDER (et non une promesse) : la relecture
    // d'un conflit enchaîne `.select('revision, payload').eq().eq().limit()`.
    // Renvoyer une promesse ici rendait cette chaine impossible — et
    // l'ecriture conditionnelle elle-meme ne pouvait plus etre testee.
    q.select = vi.fn((cols) => { q._cols = cols; return q; });
    q.limit = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.in = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.update = vi.fn(() => q);
    q.upsert = vi.fn(async () => ({ error: upsertOk ? null : new Error('down') }));
    q.delete = vi.fn(() => q);
    q.insert = vi.fn(async () => ({ error: null }));
    q.then = (resoudre) => {
      // La RELLECTURE demande explicitement `revision` : elle doit renvoyer
      // l'etat frais de la base. L'ecriture conditionnelle, elle, renvoie
      // les lignes touchees (0 = conflit).
      if (String(q._cols || '').includes('revision')) {
        return Promise.resolve({ data: relectureRows, error: null }).then(resoudre);
      }
      return Promise.resolve({ data: updateRows, error: null }).then(resoudre);
    };
    return q;
  };
  return {
    setUpdateRows: (rows) => { updateRows = rows; },
    setRelectureRows: (rows) => { relectureRows = rows; },
    setUpsertOk: (ok) => { upsertOk = ok; },
    getUpsertOk: () => upsertOk,
    supabaseMock: {
      from: vi.fn(() => builder()),
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

  it('conflit (0 ligne touchee) = STATE_CONFLICT + adoption de l etat frais', async () => {
    await upsertStateEntity('matches', { id: 'E1', status: 'recruiting' });
    // L'autre instance a écrit entre-temps : 0 ligne pour notre révision.
    h.setUpdateRows([]);
    // ...et l'état frais en base est différent du nôtre.
    h.setRelectureRows([{ revision: 7, payload: { id: 'E1', status: 'in_progress' } }]);
    await expect(
      upsertStateEntity('matches', { id: 'E1', status: 'finished' }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    // La mémoire ADOPTE l'état FRAIS.
    //
    // Avant le correctif, elle RESTAURAIT sa valeur périmée ('recruiting')
    // alors que la base en tenait une autre ('in_progress') : l'instance
    // servait une donnée périmée, en silence. Et surtout la révision locale
    // n'avançait pas — chaque écriture rejouait le même compare-and-swap et
    // échouait : l'entité devenait DÉFINITIVEMENT inécrivable depuis cette
    // instance (check-in, résultat, litige : tout restait en 409).
    expect(getStateEntity('matches', 'E1')?.status).toBe('in_progress');
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
