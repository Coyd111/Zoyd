import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Un conflit d'ecriture OCC ne doit pas POISONNER une entite d'etat.
 *
 * Le constat (audit de concurrence) :
 *
 *   Instance A : la memoire voit le match M en revision 5.
 *   Instance B : elle ecrit M en revision 8 (la base passe a 8).
 *   Instance A : elle ecrit M -> compare-and-swap sur la revision 5 ->
 *                0 ligne -> CONFLIT.
 *
 * Le code d avant faisait deux choses fautives :
 *   1. il RESTAURAIT le payload perime en memoire (la base, elle, tient la
 *      version de B) : l instance A servait donc une donnee perimee, en
 *      silence ;
 *   2. il NE FAISAIT PAS AVANCER la revision locale. Chaque ecriture
 *      ulterieure rejouait donc le meme compare-and-swap sur la revision 5
 *      et echouait a nouveau : le match devenait DEFINITIVEMENT inecrivable
 *      depuis cette instance. Tout ce qui passe par lui — check-in, resultat,
 *      confirmation, litige — restait bloque en 409, sans qu'aucune reprise
 *      ne soit possible.
 *
 * Le correctif : sur conflit, on ADOPTE l etat frais relu en base (payload
 * ET revision). Le rejeu de l appelant repart alors de la base : le moteur
 * recalcule depuis la memoire, redevenue coherente, et l ecriture suivante
 * passe.
 *
 * La creation a ete corrigee au passage : elle passe par un INSERT qui
 * refuse le doublon (23505), et non par un upsert qui ecrasait une ligne
 * existante en remettant sa revision a 1 (donc en faisant RECULER la
 * revision en base, et en perdant la garantie du compare-and-swap).
 */

const h = vi.hoisted(() => ({
  // kind:entity_id -> { kind, entity_id, payload, revision }
  lignes: new Map(),
  // Nombre d'inserts refuses comme doublon (23505).
  doublons: 0,
}));

const cle = (kind, id) => `${kind}:${id}`;

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (table) => {
      const f = {};
      const api = {
        _patch: null,
        _select: null,
        _insert: null,
        select: (cols) => { api._select = cols; return api; },
        update: (patch) => { api._patch = patch; return api; },
        insert: (payload) => { api._insert = payload; return api; },
        upsert: (payload) => {
          if (table === 'app_users') return Promise.resolve({ error: null });
          const k = cle(payload.kind, payload.entity_id);
          const existant = h.lignes.get(k);
          h.lignes.set(k, { ...payload, revision: payload.revision ?? (existant?.revision ?? 0) + 1 });
          return Promise.resolve({ error: null });
        },
        delete: () => api,
        eq: (c, v) => { f[c] = v; return api; },
        limit: () => api,
        order: () => api,
        range: () => api,
        then: (resoudre) => {
          if (table !== 'state_snapshots') return Promise.resolve({ data: [], error: null }).then(resoudre);

          // INSERT : le doublon doit etre refuse (23505), comme en base.
          if (api._insert) {
            const k = cle(api._insert.kind, api._insert.entity_id);
            if (h.lignes.has(k)) {
              h.doublons += 1;
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } }).then(resoudre);
            }
            h.lignes.set(k, { ...api._insert });
            return Promise.resolve({ data: [], error: null }).then(resoudre);
          }

          // UPDATE conditionnel : la ligne n est touchee que si sa revision
          // est encore celle observee.
          if (api._patch) {
            const k = cle(f.kind, f.entity_id);
            const ligne = h.lignes.get(k);
            if (!ligne) return Promise.resolve({ data: [], error: null }).then(resoudre);
            if (f.revision !== undefined && ligne.revision !== f.revision) {
              return Promise.resolve({ data: [], error: null }).then(resoudre);
            }
            h.lignes.set(k, { ...ligne, ...api._patch });
            return Promise.resolve({ data: [{ entity_id: f.entity_id }], error: null }).then(resoudre);
          }

          // SELECT de relecture : revision + payload.
          if (api._select && String(api._select).includes('revision')) {
            const ligne = h.lignes.get(cle(f.kind, f.entity_id));
            return Promise.resolve({
              data: ligne ? [{ revision: ligne.revision, payload: ligne.payload }] : [],
              error: null,
            }).then(resoudre);
          }

          return Promise.resolve({ data: [], error: null }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

import {
  upsertStateEntity,
  getStateEntity,
  setStateRevisionSupportedPourTest,
  setStateTrustedPourTest,
} from './persistence.mjs';

const match = (version) => ({ id: 'M-OCC', status: 'recruiting', version });

beforeEach(() => {
  h.lignes.clear();
  h.doublons = 0;
  setStateRevisionSupportedPourTest(true);
  // L etat doit etre juge fiable, sinon toute ecriture est refusee en
  // SERVER_BUSY (le garde anti-perte de donnees) et le test ne testerait
  // que ce garde.
  setStateTrustedPourTest(true);
});

describe('OCC sur les collections d etat — un conflit ne doit pas empoisonner l entite', () => {
  it('apres un conflit, l ecriture suivante REUSSIT (la revision locale a avance)', async () => {
    // 1 — L instance cree le match : la base passe en revision 1.
    await upsertStateEntity('matches', match(1));
    expect(h.lignes.get(cle('matches', 'M-OCC')).revision).toBe(1);

    // 2 — Une AUTRE instance ecrit : la base passe en revision 3, avec un
    //     payload different. L instance A ne le voit pas encore.
    h.lignes.set(cle('matches', 'M-OCC'), {
      kind: 'matches', entity_id: 'M-OCC', payload: match(3), revision: 3,
    });

    // 3 — L instance A ecrit : son compare-and-swap porte la revision 1,
    //     la base en est a 3 -> CONFLIT.
    await expect(upsertStateEntity('matches', match(2)))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    // 4 — L etat frais est ADOPTE : la memoire ne sert plus le payload
    //     perime (celui de l instance A), mais celui de la base.
    expect(getStateEntity('matches', 'M-OCC').version, 'la memoire doit servir l etat frais, pas le perime')
      .toBe(3);

    // 5 — L ecriture suivante passe : la revision locale a avance, donc le
    //     compare-and-swap porte la revision 3 — celle de la base.
    await expect(upsertStateEntity('matches', match(4))).resolves.toBeUndefined();
    expect(h.lignes.get(cle('matches', 'M-OCC')).payload.version, 'l ecriture a bien ete appliquee')
      .toBe(4);
  });

  it('la CREATION d une entite deja presente refuse le doublon au lieu d ecraser', async () => {
    // Une ligne existe en base (l autre instance l a creee), mais cette
    // instance ne la connait pas encore : sa creation doit etre refusee
    // comme un conflit, PAS un upsert qui ecraserait la ligne ET remettrait
    // sa revision a 1 (donc ferait reculer la revision en base).
    h.lignes.set(cle('matches', 'M-NEUF'), {
      kind: 'matches', entity_id: 'M-NEUF', payload: match(9), revision: 4,
    });

    await expect(upsertStateEntity('matches', { id: 'M-NEUF', status: 'recruiting', version: 1 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    expect(h.doublons, 'le doublon doit etre refuse par la base').toBe(1);
    expect(h.lignes.get(cle('matches', 'M-NEUF')).payload.version, 'le payload de la base est intact')
      .toBe(9);
    expect(h.lignes.get(cle('matches', 'M-NEUF')).revision, 'la revision n a pas recule')
      .toBe(4);
  });
});
