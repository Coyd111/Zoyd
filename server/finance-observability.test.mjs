import { describe, it, expect } from 'vitest';
import {
  collectFinanceDebts,
  summarizeFinanceDebts,
  FINANCE_STALE_MS,
  FINANCE_CRITICAL_MS,
} from './finance-observability.mjs';

/**
 * server/finance-observability.test.mjs - P0 observabilite argent.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Les dettes (`pending`, `pending_review`, `pendingPayouts`) etaient
 * invisibles : totaux anonymes en sante, liste nulle part, jauges absentes.
 * Une dette gelee (V1/V6) ne se voyait qu'en reluquant les logs.
 *
 * Ces tests prouvent :
 *   1. chaque famille de dette est collectee avec montant + age ;
 *   2. le resume anonyme compte et somme sans fuiter d'identifiant ;
 *   3. un `false` (deliberement non verse) n'est JAMAIS une dette ;
 *   4. un retrait sortis de l'historique 200 est trouve via `payoutsEnAttente` ;
 *   5. les seuils stale/critical classent correctement.
 */

const NOW = Date.parse('2026-11-07T12:00:00Z');
const isoH = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

describe('collectFinanceDebts - matchs', () => {
  it('collecte un reglement pending avec base figee', () => {
    const { debts, summary } = collectFinanceDebts({
      matches: [{
        id: 'M1',
        status: 'awaiting_confirmation',
        prizePool: 400,
        settlementBasis: { lockedPot: 200 },
        result: { payoutDistributed: 'pending', submittedAt: isoH(2) },
        createdAt: isoH(30),
        updatedAt: isoH(2),
      }],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ type: 'match_pending', id: 'M1', amountZC: 200 });
    expect(debts[0].ageMs).toBe(2 * 60 * 60 * 1000);
    expect(summary.totalZC).toBe(200);
  });

  it('ignore un false (volontairement non verse)', () => {
    const { debts } = collectFinanceDebts({
      matches: [{ id: 'M2', status: 'cancelled', result: { payoutDistributed: false }, createdAt: isoH(1) }],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts).toHaveLength(0);
  });

  it('collecte la commission arbitre due', () => {
    const { debts } = collectFinanceDebts({
      matches: [{ id: 'M3', status: 'finished', pendingArbiterFee: 4, arbiter: { userId: 'arb-1' }, createdAt: isoH(10), updatedAt: isoH(10) }],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ type: 'arbiter_fee_pending', amountZC: 4 });
  });

  it('trie par anciennete decroissante', () => {
    const { debts } = collectFinanceDebts({
      matches: [
        { id: 'RECENT', result: { payoutDistributed: 'pending', submittedAt: isoH(1) }, createdAt: isoH(1) },
        { id: 'VIEUX', result: { payoutDistributed: 'pending', submittedAt: isoH(30) }, createdAt: isoH(30) },
      ],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts[0].id).toBe('VIEUX');
    expect(debts[1].id).toBe('RECENT');
  });
});

describe('collectFinanceDebts - tournois / ligues / BR', () => {
  it('expande pendingPayouts et compte les uncollectable', () => {
    const { debts, summary } = collectFinanceDebts({
      matches: [], brLobbies: [],
      tournaments: [{
        id: 'T1', name: 'Cup',
        pendingPayouts: [{ userId: 'u1', amount: 95, lastError: 'SUPABASE_DOWN', at: isoH(8) }],
        pendingRefunds: [], uncollectableRefunds: [],
        updatedAt: isoH(8),
      }],
      leagues: [{
        id: 'L1',
        pendingPayouts: [{ userId: 'u2', amount: 30, at: isoH(1) }],
        pendingRefunds: [{ userId: 'u3', amount: 50, at: isoH(1) }],
        uncollectableRefunds: [{ userId: 'u4', amount: 50, at: isoH(1) }],
        updatedAt: isoH(1),
      }],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(summary.totalDebts).toBe(4);
    expect(summary.uncollectableCount).toBe(1);
    expect(debts.find((d) => d.type === 'tournament_payout_pending')?.lastError).toBe('SUPABASE_DOWN');
  });

  it('collecte un salon BR en settling', () => {
    const { debts } = collectFinanceDebts({
      matches: [], tournaments: [], leagues: [],
      brLobbies: [{ id: 'BR1', status: 'settling', pot: 4000, updatedAt: isoH(3) }],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ type: 'br_settling', amountZC: 4000 });
  });
});

describe('collectFinanceDebts - retraits pending_review', () => {
  it('trouve un retrait hors historique via payoutsEnAttente', () => {
    const wallets = {
      u1: {
        transactions: [], // sorti de la fenetre 200
        payoutsEnAttente: [{ payoutId: 777, txId: 'TX-OLD', since: isoH(5), amount: 500 }],
      },
    };
    const { debts } = collectFinanceDebts({
      matches: [], tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => ['u1'], getWallet: (id) => wallets[id], nowMs: NOW,
    });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ type: 'withdrawal_pending_review', id: '777', amountZC: 500 });
  });

  it('dedoublonne file + historique par payoutId', () => {
    const wallets = {
      u1: {
        payoutsEnAttente: [{ payoutId: 888, txId: 'TX-1', since: isoH(2) }],
        transactions: [{ id: 'TX-1', type: 'withdraw', amount: -500, timestamp: isoH(2), metadata: { payoutId: 888, payoutStatus: 'pending_review' } }],
      },
    };
    const { debts } = collectFinanceDebts({
      matches: [], tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => ['u1'], getWallet: (id) => wallets[id], nowMs: NOW,
    });
    expect(debts).toHaveLength(1);
    expect(debts[0].amountZC).toBe(500);
  });
});

describe('summarizeFinanceDebts', () => {
  it('calcule totaux, anciennete et seuils', () => {
    const summary = summarizeFinanceDebts([
      { type: 'match_pending', amountZC: 100, ageMs: 1 * 60 * 60 * 1000 },
      { type: 'match_pending', amountZC: 200, ageMs: 30 * 60 * 60 * 1000 },
      { type: 'tournament_refund_uncollectable', amountZC: 50, ageMs: FINANCE_CRITICAL_MS + 1000 },
    ]);
    expect(summary.totalDebts).toBe(3);
    expect(summary.totalZC).toBe(350);
    expect(summary.oldestAgeMs).toBe(30 * 60 * 60 * 1000);
    expect(summary.staleCount).toBe(2);
    expect(summary.criticalCount).toBe(2);
    expect(summary.uncollectableCount).toBe(1);
    expect(summary.byType.match_pending).toBe(2);
  });

  it('renvoie ageMs null quand aucune date fiable (pas de 0 mensonger)', () => {
    const { debts, summary } = collectFinanceDebts({
      matches: [{ id: 'M-X', result: { payoutDistributed: 'pending' } }],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts[0].ageMs).toBeNull();
    expect(summary.oldestAgeMs).toBeNull();
    expect(summary.staleCount).toBe(0);
  });

  it('seuil stale = 6h', () => {
    expect(FINANCE_STALE_MS).toBe(6 * 60 * 60 * 1000);
    expect(FINANCE_CRITICAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('dettes refund portent amount (ecriture reelle des moteurs)', () => {
    // Formes émises par cancelStaleLeagueSeasonOnServer /
    // cancelTournoiOnServer après correctif : amount = pass verrouillé.
    const { summary, debts } = collectFinanceDebts({
      matches: [], brLobbies: [],
      tournaments: [{
        id: 'T-REF', name: 'Cup',
        pendingRefunds: [{ userId: 'u1', entryId: 'e1', amount: 100, lastError: 'X', at: isoH(2) }],
        uncollectableRefunds: [{ userId: 'u2', entryId: 'e2', amount: 100, reason: 'ACCOUNT_DELETED', at: isoH(2) }],
        updatedAt: isoH(2),
      }],
      leagues: [{
        id: 'L-REF',
        pendingRefunds: [{ userId: 'u3', pseudo: 'a', amount: 50, lastError: 'X', at: isoH(1) }],
        uncollectableRefunds: [{ userId: 'u4', pseudo: 'b', amount: 50, reason: 'ACCOUNT_DELETED', at: isoH(1) }],
        updatedAt: isoH(1),
      }],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts.filter((d) => String(d.type).includes('refund')).map((d) => d.amountZC)).toEqual(expect.arrayContaining([100, 50]));
    // 2 dettes tournoi (100+100) + 2 dettes ligue (50+50) = 300 ZC, plus 0.
    expect(summary.totalZC).toBe(300);
    expect(summary.uncollectableCount).toBe(2);
  });

  it('match pending + commission = pot, pas pot + commission (pas de double compte)', () => {
    const { summary, debts } = collectFinanceDebts({
      matches: [{
        id: 'M-DBL',
        status: 'finished',
        prizePool: 1000,
        settlementBasis: { lockedPot: 1000 },
        pendingArbiterFee: 20,
        result: { payoutDistributed: 'pending', submittedAt: isoH(2) },
        createdAt: isoH(30), updatedAt: isoH(2),
      }],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    // match_pending = pot - commission (980) + commission (20) = 1000.
    expect(summary.totalZC).toBe(1000);
    expect(summary.totalDebts).toBe(2);
    expect(debts.find((d) => d.type === 'match_pending')?.amountZC).toBe(980);
  });

  it('litige ouvert prime : un seul pot compte, pas pending + dispute', () => {
    const { summary, debts } = collectFinanceDebts({
      matches: [{
        id: 'M-DSP',
        status: 'finished',
        prizePool: 1000,
        settlementBasis: { lockedPot: 1000 },
        pendingArbiterFee: 20,
        result: { payoutDistributed: 'pending', submittedAt: isoH(2) },
        disputes: [{ status: 'open', openedAt: isoH(1) }],
        createdAt: isoH(30), updatedAt: isoH(2),
      }],
      tournaments: [], leagues: [], brLobbies: [],
      listUserIds: () => [], getWallet: () => undefined, nowMs: NOW,
    });
    expect(debts).toHaveLength(1);
    expect(debts[0].type).toBe('dispute_frozen');
    expect(summary.totalZC).toBe(1000);
  });
});
