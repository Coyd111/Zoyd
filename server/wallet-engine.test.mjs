/**
 * Tests ciblés argent : dépôt, retrait, refund, purge orpheline.
 * Mode mémoire (ZOYD_DISABLE_SUPABASE=true via vitest.config.mjs).
 * Aucun appel réseau : persistence lit les Maps en mémoire.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createUserAccount } from './persistence.mjs';
import {
  calcWithdrawNet,
  getWindowedWithdrawalTotal,
  depositToWallet,
  withdrawFromWallet,
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  refundRejectedWithdrawal,
  reconcilePendingWithdrawals,
  isUnrecoverableRefundError,
} from './wallet-engine.mjs';

let n = 0;
async function makeUser() {
  n += 1;
  const id = `10000000-0000-4000-8000-${String(100000000000 + n).padStart(12, '0')}`;
  const phone = `6${String(6000000 + n * 137).padStart(7, '0')}`;
  const user = await createUserAccount({
    id,
    pseudo: `TestArgent${n}`,
    email: `argent${n}@example.com`,
    phone,
    gameId: `6742${String(100000 + n).padStart(6, '0')}`,
    password: 'Abcdef1!ZoydArgent',
    levelCODM: 50,
    rankMJ: 'bronze',
    rankBR: 'bronze',
    country: 'Benin',
    controllerType: 'touch',
    device: 'phone',
    acceptAdult: true,
    acceptTerms: true,
  });
  return user.id;
}

beforeEach(() => { /* mémoire par test : chaque compte est unique */ });

describe('calcWithdrawNet — commission 2 % unique', () => {
  it('retire 2 % arrondis au centime', () => {
    expect(calcWithdrawNet(150)).toEqual({ feeAmount: 3, netAmount: 147 });
    expect(calcWithdrawNet(1000)).toEqual({ feeAmount: 20, netAmount: 980 });
  });
});

describe('getWindowedWithdrawalTotal — cumul 24 h glissant', () => {
  it('ignore les retraits hors fenêtre et les failed', () => {
    const now = Date.now();
    const wallet = {
      retraitCumul: [
        { txId: 'a', timestamp: new Date(now - 3600_000).toISOString(), amount: 200 },
        { txId: 'b', timestamp: new Date(now - 30 * 3600_000).toISOString(), amount: 500 },
      ],
      transactions: [],
    };
    expect(getWindowedWithdrawalTotal(wallet, now)).toBe(200);
  });
});

describe('dépôt', () => {
  it('crédite cash et journalise en positif', async () => {
    const userId = await makeUser();
    const w = await depositToWallet(userId, 250, 'Mobile Money');
    expect(w.cashBalance).toBe(250);
    expect(w.transactions[0].type).toBe('deposit');
    expect(w.transactions[0].amount).toBe(250);
  });

  it('refuse un dépôt négatif ou nul', async () => {
    const userId = await makeUser();
    await expect(depositToWallet(userId, 0)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

describe('retrait', () => {
  it('débit cash, historique négatif, net affiché après 2 %', async () => {
    const userId = await makeUser();
    await depositToWallet(userId, 500);
    const w = await withdrawFromWallet(userId, 200, 'Mobile Money', '+22961000000');
    expect(w.cashBalance).toBe(300);
    const tx = w.transactions[0];
    expect(tx.type).toBe('withdraw');
    expect(tx.amount).toBe(-200);
    expect(tx.metadata.feeAmount).toBe(4);
    expect(tx.metadata.netAmount).toBe(196);
  });

  it('refuse sous le minimum (150 ZC) et sans solde', async () => {
    const userId = await makeUser();
    await expect(withdrawFromWallet(userId, 100)).rejects.toMatchObject({ code: 'WITHDRAWAL_MIN' });
    await expect(withdrawFromWallet(userId, 200)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});

describe('verrouillage du pass (lock) et remboursement', () => {
  it('bloque cash+bonus puis rembourse à l’identique', async () => {
    const userId = await makeUser();
    await depositToWallet(userId, 300);
    const locked = await lockEntryFee(userId, 100, 'M-TEST1');
    expect(locked.lockedBalance).toBe(100);
    expect(locked.lockedEntries['M-TEST1'].amount).toBe(100);
    const refunded = await refundLockedEntry(userId, 'M-TEST1', 'Annulation');
    expect(refunded.cashBalance).toBe(300);
    expect(refunded.lockedBalance).toBe(0);
    expect(refunded.lockedEntries['M-TEST1']).toBeUndefined();
    // Idempotent : second remboursement ne recrédite pas
    const again = await refundLockedEntry(userId, 'M-TEST1', 'Annulation');
    expect(again.cashBalance).toBe(300);
  });

  it('refuse le double verrouillage sur le même match', async () => {
    const userId = await makeUser();
    await depositToWallet(userId, 300);
    await lockEntryFee(userId, 100, 'M-TEST2');
    await expect(lockEntryFee(userId, 100, 'M-TEST2')).rejects.toMatchObject({ code: 'ALREADY_LOCKED' });
  });
});

describe('versement des gains — idempotent', () => {
  it('ne verse qu’une fois pour la même paire (type, match)', async () => {
    const userId = await makeUser();
    await depositToWallet(userId, 100);
    await lockEntryFee(userId, 100, 'M-GAIN');
    const first = await releaseWalletWinnings(userId, 198, 'M-GAIN', 'prize_win', 'Gain test');
    expect(first.cashBalance).toBe(198);
    expect(first.lockedBalance).toBe(0);
    const second = await releaseWalletWinnings(userId, 198, 'M-GAIN', 'prize_win', 'Gain test');
    expect(second.cashBalance).toBe(198);
  });
});

describe('remboursement de retrait rejeté — idempotent', () => {
  it('crédite une seule fois pour la même refundKey', async () => {
    const userId = await makeUser();
    await depositToWallet(userId, 300);
    const first = await refundRejectedWithdrawal(userId, 150, 'refund:1');
    expect(first.cashBalance).toBe(450);
    const second = await refundRejectedWithdrawal(userId, 150, 'refund:1');
    expect(second.cashBalance).toBe(450);
  });

  it('refuse sans clé d’idempotence', async () => {
    const userId = await makeUser();
    await expect(refundRejectedWithdrawal(userId, 150, '')).rejects.toMatchObject({ code: 'REFUND_KEY_REQUIRED' });
  });
});

describe('purge orpheline / réconciliation des retraits', () => {
  it('isUnrecoverableRefundError : USER_DELETED est définitif', () => {
    expect(isUnrecoverableRefundError({ code: 'USER_DELETED' })).toBe(true);
    expect(isUnrecoverableRefundError({ code: 'USER_NOT_FOUND' })).toBe(true);
    expect(isUnrecoverableRefundError({ code: 'SUPABASE_DOWN' })).toBe(false);
  });

  it('reconcilePendingWithdrawals sans dette → {0,0,0}', async () => {
    const res = await reconcilePendingWithdrawals(
      () => true, () => false, async () => null,
      () => [], () => null, async () => false, async () => ({}), () => {}, () => {},
    );
    expect(res).toEqual({ resolved: 0, refunded: 0, stillPending: 0 });
  });

  it('reconcile rembourse un payout refusé une seule fois puis tague', async () => {
    const userId = await makeUser();
    await depositToWallet(userId, 400);
    await withdrawFromWallet(userId, 200, 'Mobile Money', '+22961000000');
    // Simule l’état pending_review côté FedaPay (02-argent: trace payoutsEnAttente)
    const walletWithDebt = {
      cashBalance: 200,
      bonusBalance: 0,
      lockedBalance: 0,
      pendingWinnings: 0,
      transactions: [{ id: 'TX-1', type: 'withdraw', amount: -200, timestamp: new Date().toISOString(), metadata: { payoutId: 9999, payoutStatus: 'pending_review', idempotencyKey: 'k1' } }],
      payoutsEnAttente: [{ payoutId: 9999, idempotencyKey: 'k1', txId: 'TX-1' }],
      winningsKeys: [],
      withdrawalKeys: [],
      retraitCumul: [],
      lockedEntries: {},
    };
    const calls = [];
    const res = await reconcilePendingWithdrawals(
      () => false, () => true,
      async () => ({ status: 'failed' }),
      () => [userId],
      (id) => (id === userId ? walletWithDebt : null),
      async (uid, txId, patch) => { calls.push({ txId, patch }); return true; },
      async (uid, amount) => { calls.push({ refund: amount }); return walletWithDebt; },
      () => {},
      () => {},
    );
    // payout refusé → refund appelé avec |montant négatif| corrigé
    expect(calls.some((c) => c.refund === 200)).toBe(true);
    expect(res.refunded).toBe(1);
  });
});
