import { describe, it, expect, vi } from 'vitest';

/**
 * Un payout « peut-être parti » doit être résolu même hors de l'historique.
 *
 * Le trou
 * -------
 * L'historique du portefeuille est plafonné à 200 entrées
 * (`wallet-engine.mjs:90`). La réconciliation balayait exactement ce tableau.
 *
 * Un retrait marqué `pending_review` qui en sortait n'était donc PLUS JAMAIS
 * relu. Son payout restait « peut-être parti » indéfiniment : l'argent du joueur
 * restait retenu, sans remboursement, sans log, et `stillPending` ne le comptait
 * même plus puisque le balayage ne le voyait plus. Le pire état possible — de
 * l'argent immobilisé, invisible.
 *
 * Le correctif
 * -------------
 * `wallet.payoutsEnAttente` : liste dédiée, dans le payload en base, non bornée
 * par l'activité du joueur. Elle porte le `payoutId` et la clé d'idempotence —
 * assez pour résoudre SANS la transaction, qui a pu disparaître.
 *
 * Ces tests n'utilisent pas FedaPay : ils injectent les fonctions dont la
 * réconciliation a besoin. Le comportement testé est l'énumération et la
 * résolution, pas le réseau.
 */

const construireReconciliation = (etat) => {
  const wallets = etat.wallets;
  const tagues = [];
  const oubliees = [];
  const rembourses = [];

  return {
    tagues,
    oubliees,
    rembourses,
    execute: () => vi.importActual('./wallet-engine.mjs').then(({ reconcilePendingWithdrawals }) =>
      reconcilePendingWithdrawals(
        (s) => ['success', 'completed'].includes(String(s).toLowerCase()),
        (s) => ['failed', 'rejected'].includes(String(s).toLowerCase()),
        async (payoutId) => ({ payoutId, status: etat.statuts?.[payoutId] ?? 'pending_review' }),
        () => Object.keys(wallets),
        (userId) => wallets[userId],
        async (userId, txId, patch) => { tagues.push({ userId, txId, patch }); return true; },
        async (userId, amount, extra) => { rembourses.push({ userId, amount, extra }); },
        (userId, key) => { oubliees.push({ userId, key }); },
        () => {},
      )),
  };
};

describe('Reconciliation hors historique', () => {
  it('relit un payout dont la transaction a disparu de la fenetre', async () => {
    const r = construireReconciliation({
      // 200 transactions recentes : le retrait `pending_review` n'y est plus.
      wallets: {
        U1: {
          payoutsEnAttente: [{ payoutId: 777, txId: 'TX-OLD', idempotencyKey: 'K-1', since: 'hier' }],
          transactions: Array.from({ length: 200 }, (_, i) => ({
            type: 'deposit', amount: 10, status: 'completed', metadata: { seq: i },
          })),
        },
      },
      statuts: { 777: 'failed' },
    });

    const resultat = await r.execute();

    expect(resultat.refunded, 'le refus definitif doit etre traite').toBe(1);
    expect(r.oubliees, 'la cle d idempotence doit etre liberee').toContainEqual({ userId: 'U1', key: 'K-1' });
  });

  it('resout un payout encore present dans l historique', async () => {
    const r = construireReconciliation({
      wallets: {
        U1: {
          payoutsEnAttente: [{ payoutId: 888, txId: 'TX-1', idempotencyKey: 'K-2' }],
          transactions: [{
            type: 'withdraw', amount: -500, status: 'pending_review',
            id: 'TX-1', metadata: { payoutId: 888, payoutStatus: 'pending_review', idempotencyKey: 'K-2' },
          }],
        },
      },
      statuts: { 888: 'success' },
    });

    const resultat = await r.execute();

    expect(resultat.resolved).toBe(1);
    expect(r.oubliees).toContainEqual({ userId: 'U1', key: 'K-2' });
  });

  it('ne traite pas deux fois un payout liste ET dans l historique', async () => {
    const r = construireReconciliation({
      wallets: {
        U1: {
          payoutsEnAttente: [{ payoutId: 999, txId: 'TX-9', idempotencyKey: 'K-3' }],
          transactions: [{
            type: 'withdraw', amount: -100, status: 'pending_review',
            id: 'TX-9', metadata: { payoutId: 999, payoutStatus: 'pending_review', idempotencyKey: 'K-3' },
          }],
        },
      },
      statuts: { 999: 'success' },
    });

    const resultat = await r.execute();
    // La double comptabilisation ferait croire a deux retraits resolus, et sur un
    // echec de FedaPay pourrait declencher deux remboursements.
    expect(resultat.resolved).toBe(1);
  });

  it('l historique seul reste un filet pour les portefeuilles anciens', async () => {
    const r = construireReconciliation({
      wallets: {
        U1: {
          // Pas de `payoutsEnAttente` : portefeuille enregistre avant le
          // correctif, ou la liste n'a pas encore ete ecrite.
          transactions: [{
            type: 'withdraw', amount: -700, status: 'pending_review',
            id: 'TX-OLD', metadata: { payoutId: 555, payoutStatus: 'pending_review', idempotencyKey: 'K-4' },
          }],
        },
      },
      statuts: { 555: 'failed' },
    });

    const resultat = await r.execute();
    expect(resultat.refunded).toBe(1);
    expect(r.rembourses[0].amount, 'le montant vient de la transaction').toBe(700);
  });

  it('un payout encore en attente reste en attente', async () => {
    const r = construireReconciliation({
      wallets: {
        U1: {
          payoutsEnAttente: [{ payoutId: 111, txId: 'TX-X', idempotencyKey: 'K-5' }],
          transactions: [],
        },
      },
      statuts: { 111: 'pending_review' },
    });

    const resultat = await r.execute();
    expect(resultat.stillPending).toBe(1);
    expect(r.rembourses).toHaveLength(0);
  });
});