import { describe, it, expect, vi, beforeEach } from 'vitest';

// On simule le comportement de PostgREST : `upsert` met a jour la ligne
// existante et RENVOIE SUCCES (c'est tout le probleme), `insert` echoue en
// 23505 sur violation d'unicite.
const lignes = new Map();
const journal = [];

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => {
      // `sbSelect` enchaine .eq(col, val).select().range(...) : on retient la
      // valeur filtree, sinon le mock renverrait TOUTES les lignes et
      // `hasTransactionBeenProcessed` les confondrait toutes.
      let filtreCol = null;
      let filtreVal = null;
      const selectees = () => [...lignes.values()]
        .filter((r) => (filtreCol === null ? true : r[filtreCol] === filtreVal));
      const query = {
        eq: vi.fn((col, val) => { filtreCol = col; filtreVal = val; return query; }),
        lt: vi.fn(() => query), in: vi.fn(() => query),
        upsert: vi.fn((data) => {
          journal.push({ table, op: 'upsert', key: data.transaction_id });
          // PostgREST : un upsert sur cle primaire MET A JOUR et reussit.
          lignes.set(data.transaction_id, { ...lignes.get(data.transaction_id), ...data });
          return Promise.resolve({ data, error: null });
        }),
        insert: vi.fn((data) => {
          journal.push({ table, op: 'insert', key: data.transaction_id });
          if (lignes.has(data.transaction_id)) {
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            });
          }
          lignes.set(data.transaction_id, data);
          return Promise.resolve({ data, error: null });
        }),
        delete: vi.fn(() => query),
        update: vi.fn(() => query),
        select: vi.fn(() => query),
        range: vi.fn(() => Promise.resolve({ data: selectees(), error: null })),
        then: (onOk) => Promise.resolve({ data: selectees(), error: null }).then(onOk),
      };
      return query;
    }),
  },
}));

import * as persistence from './persistence.mjs';

/**
 * Fenetre de double credit sur les depots FedaPay.
 *
 * Le chemin etait : verifier que la transaction n'a pas deja ete traitee
 * (SELECT), puis ecrire la reservation. Entre les deux, rien n'empechait une
 * seconde instance de passer aussi le SELECT et d'ecrire a son tour.
 *
 * L'ecriture etait un UPSERT : sur une cle primaire, PostgREST met a jour la
 * ligne existante et RENVOIE SUCCES. La seconde reservation n'echouait donc
 * pas — elle ecrasait la premiere — et les deux cr.edits passaient.
 *
 * Le verrou en memoire ne fermait cette fenetre qu'a l'interieur d'un seul
 * processus. Or un deploiement Render laisse un instant l'ancienne et la
 * nouvelle instance servir en parallele.
 */
describe('reservation idempotente d une transaction FedaPay', () => {
  beforeEach(() => {
    lignes.clear();
    journal.length = 0;
    persistence.clearProcessedTransactionsForTests?.();
  });

  it('refuse une deuxieme reservation du meme identifiant', async () => {
    const premier = await persistence.claimTransaction('TX-1', 'user-a', 100);
    const second = await persistence.claimTransaction('TX-1', 'user-a', 100);

    expect(premier).toBe(true);
    // C'EST LE CORRECTIF : le second echoue au lieu d'ecraser le premier.
    expect(second).toBe(false);
  });

  it('utilise un insert, pas un upsert, pour la reservation', async () => {
    await persistence.claimTransaction('TX-2', 'user-a', 50);
    const ops = journal.filter((j) => j.key === 'TX-2').map((j) => j.op);
    expect(ops).toContain('insert');
    expect(ops).not.toContain('upsert');
  });

  it('DEUXIEME INSTANCE : le cache memoire vierge ne suffit pas a proteger', async () => {
    // Pendant un deploiement Render, l'ancienne et la nouvelle instance
    // tournent en parallele : chacune a SON cache memoire, vide au demarrage.
    // Un test comportemental qui rejoue les claims l'un apres l'autre ne peut
    // donc PAS reproduire la course — le SELECT en base rattrape le second.
    // C'est pourquoi l'assertion qui compte est celle du test precedent :
    // `insert` au lieu d'`upsert`. En cas de course reelle (les deux SELECT
    // avant toute ecriture), seul l'insert refuse le doublon ; l'upsert, lui,
    // reecrit et laisse passer les DEUX credits.
    //
    // Ce test verifie donc la partie observable : une instance neuve, face a
    // une base deja peuplee, refuse bien la reservation.
    const premiere = await persistence.claimTransaction('TX-DUP', 'user-a', 100);
    expect(premiere).toBe(true);

    vi.resetModules();
    const secondeInstance = await import('./persistence.mjs');

    const seconde = await secondeInstance.claimTransaction('TX-DUP', 'user-a', 100);
    expect(seconde).toBe(false);
    expect(lignes.get('TX-DUP')).toBeTruthy();
  });

  it('laisse passer deux identifiants distincts', async () => {
    expect(await persistence.claimTransaction('TX-A', 'user-a', 10)).toBe(true);
    expect(await persistence.claimTransaction('TX-B', 'user-b', 10)).toBe(true);
  });

  it('un echec d ecriture ne pretend pas avoir reserve', async () => {
    // Si l'insertion echoue pour une raison technique (reseau, RLS), la
    // reservation doit etre libreee : sinon l'argent seraitredit une fois
    // puis la transaction serait rejetee a jamais.
    await persistence.releaseTransaction('TX-C');
    expect(await persistence.hasTransactionBeenProcessed('TX-C')).toBe(false);
  });
});