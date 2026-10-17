import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La reconciliation des retraits « peut-etre partis ».
 *
 * Le trou ferme : la route refuse de rembourser un payout dont l envoi est
 * incertain — a raison, sinon le joueur recevait son remboursement ET son
 * virement. Mais rien ne relisait ces retraits : le joueur restait debite a
 * jamais, et le seul signe etait une ligne de log.
 *
 * Ce balayage tranche sur la reponse REELLE du prestataire, et ne decide RIEN
 * quand la lecture echoue. C est le point critique : une lecture en erreur ne
 * doit surtout pas declencher un remboursement, puisque c'est precisement le
 * double versement qu on cherche a empecher.
 */

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

import { reconcilePendingWithdrawals, countPendingWithdrawals } from './wallet-engine.mjs';

const PAIEMENT_REUSSITE = (s) => ['success', 'successful', 'completed'].includes(String(s).toLowerCase());
const PAIEMENT_ECHEC = (s) => ['failed', 'rejected', 'cancelled'].includes(String(s).toLowerCase());

/** Fabrique le harnais minimal attendu par la fonction. */
const harnais = (statuts, lectureEchoue = false) => {
  const appels = { tags: [], remboursements: [], forgotten: [], lus: [] };
  const tx = {
    id: 'TX-1',
    type: 'withdraw',
    amount: 200,
    metadata: { idempotencyKey: 'cle-1', payoutId: 77, payoutStatus: 'pending_review' },
  };
  const retrieve = async (id) => {
    appels.lus.push(id);
    if (lectureEchoue) throw new Error('FedaPay injoignable');
    return { payoutId: id, status: statuts };
  };
  return {
    appels,
    run: () => reconcilePendingWithdrawals(
      PAIEMENT_REUSSITE, PAIEMENT_ECHEC, retrieve,
      () => ['u1'],
      () => ({ transactions: [tx] }),
      async (userId, txId, patch) => { appels.tags.push(patch); return true; },
      async (userId, amount, extra) => { appels.remboursements.push({ amount, ...extra }); return {}; },
      (userId, key) => { appels.forgotten.push(key); },
      vi.fn(),
    ),
  };
};

beforeEach(() => vi.clearAllMocks());

describe('Reconciliation des retraits incertains', () => {
  it('un payout reussi honore le retrait, sans remboursement', async () => {
    const h = harnais('success');
    const res = await h.run();

    expect(res.resolved).toBe(1);
    expect(h.appels.tags[0].payoutStatus).toBe('success');
    expect(h.appels.remboursements, 'aucun remboursement si l argent est parti').toHaveLength(0);
    expect(h.appels.forgotten).toEqual(['cle-1']);
  });

  it('un payout rejete rembourse enfin le joueur', async () => {
    const h = harnais('failed');
    const res = await h.run();

    expect(res.refunded).toBe(1);
    expect(h.appels.remboursements[0].amount).toBe(200);
    expect(h.appels.remboursements[0].idempotencyKey).toBe('cle-1');
    expect(h.appels.tags[0].payoutStatus).toBe('failed');
  });

  it('un payout encore en cours ne decide RIEN', async () => {
    const h = harnais('pending');
    const res = await h.run();

    expect(res.stillPending).toBe(1);
    expect(h.appels.remboursements, 'tant que FedaPay n a pas tranche, on ne rembourse pas').toHaveLength(0);
    expect(h.appels.tags).toHaveLength(0);
  });

  it('une lecture en echec ne rembourse SURTOUT PAS', async () => {
    // Le point le plus important. Rembourser parce qu on n a pas su lire le
    // statut, ce serait exactement le double versement que la route evite.
    const h = harnais('success', true);
    const res = await h.run();

    expect(res.stillPending).toBe(1);
    expect(h.appels.remboursements, 'une panne de lecture ne vaut pas preuve d echec').toHaveLength(0);
    expect(h.appels.tags).toHaveLength(0);
  });

  it('rien a faire quand aucun retrait n est incertain', async () => {
    const res = await reconcilePendingWithdrawals(
      PAIEMENT_REUSSITE, PAIEMENT_ECHEC, async () => { throw new Error('appele a tort'); },
      () => [], () => undefined, async () => true, async () => {}, () => {}, vi.fn(),
    );
    expect(res).toEqual({ resolved: 0, refunded: 0, stillPending: 0 });
  });
});

describe('Comptage des retraits en attente', () => {
  it('ne compte que les retraits marques pending_review', () => {
    const n = countPendingWithdrawals(
      () => ['u1', 'u2'],
      (userId) => (userId === 'u1'
        ? { transactions: [
          { type: 'withdraw', metadata: { payoutStatus: 'pending_review' } },
          { type: 'withdraw', metadata: { payoutStatus: 'success' } },
          { type: 'deposit', metadata: {} },
        ] }
        : { transactions: [{ type: 'withdraw', metadata: { payoutStatus: 'pending_review' } }] }),
    );
    expect(n).toBe(2);
  });
});