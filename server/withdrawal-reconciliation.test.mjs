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

// Le harnais injecte les PREDICATS DE PRODUCTION (payment-engine), pas des
// copies locales : un detecteur calque sur la meme hypothese que le module
// teste ne peut pas detecter son propre defaut de vocabulaire (audit-3 P4 C1
// — FedaPay tranche le succes final sur `sent`, jamais liste ici).
vi.mock('fedapay', () => ({
  FedaPay: { setApiKey: vi.fn(), setEnvironment: vi.fn(), apiKey: null },
  Transaction: { retrieve: vi.fn() },
  Payout: { retrieve: vi.fn() },
}));

import { reconcilePendingWithdrawals, countPendingWithdrawals } from './wallet-engine.mjs';
import { payoutSucceeded, payoutFailed } from './payment-engine.mjs';

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
      payoutSucceeded, payoutFailed, retrieve,
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
    // `sent` est le statut final de SUCCES chez FedaPay : c'est le cas
    // nominal de la production, pas un vocabulaire de confort.
    const h = harnais('sent');
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
    // Fixture `sent` : meme un statut qui aurait tranche en succes ne vaut
    // rien si la lecture a echoue.
    const h = harnais('sent', true);
    const res = await h.run();

    expect(res.stillPending).toBe(1);
    expect(h.appels.remboursements, 'une panne de lecture ne vaut pas preuve d echec').toHaveLength(0);
    expect(h.appels.tags).toHaveLength(0);
  });

  it('rien a faire quand aucun retrait n est incertain', async () => {
    const res = await reconcilePendingWithdrawals(
      payoutSucceeded, payoutFailed, async () => { throw new Error('appele a tort'); },
      () => [], () => undefined, async () => true, async () => {}, () => {}, vi.fn(),
    );
    expect(res).toEqual({ resolved: 0, refunded: 0, stillPending: 0 });
  });
});

describe('Comptage des retraits en attente', () => {
  it('miroir exact de la reprise (P4 C3) : file dediee + historique, dedoublonnes par payoutId', () => {
    // La sante annonce la dette RECUPERABLE, pas l heritage : u1 porte 2
    // dossiers dans la file dediee ; l historique recite le 101 (deja vu
    // par la file, skip) et apporte le 103 (comptable, absent de la file).
    // Le 104 `sent` n est pas pending_review, le deposit est hors sujet,
    // et le portefeuille vide de u2 ne doit rien lever.
    const n = countPendingWithdrawals(
      () => ['u1', 'u2'],
      (userId) => (userId === 'u1'
        ? {
          payoutsEnAttente: [{ payoutId: 101 }, { payoutId: 102 }],
          transactions: [
            { type: 'withdraw', metadata: { payoutStatus: 'pending_review', payoutId: 101 } },
            { type: 'withdraw', metadata: { payoutStatus: 'pending_review', payoutId: 103 } },
            { type: 'withdraw', metadata: { payoutStatus: 'sent', payoutId: 104 } },
            { type: 'deposit', metadata: {} },
          ],
        }
        : undefined),
    );
    expect(n).toBe(3);
  });

  it('une tx pending_review sans payoutId n est pas recouvrable : non comptee (P4 C3)', () => {
    // Sans cle de reprise, la reconciliation ne peut pas relire cette dette
    // aupres du prestataire : la compter serait mentir sur la reprise.
    const n = countPendingWithdrawals(
      () => ['u1'],
      () => ({ transactions: [{ type: 'withdraw', metadata: { payoutStatus: 'pending_review' } }] }),
    );
    expect(n).toBe(0);
  });
});