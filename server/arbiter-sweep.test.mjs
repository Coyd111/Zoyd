import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id, pseudo: id, role: 'player', trustScore: 100, stats: {}, progression: {},
    wallet: { cashBalance: 0, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

const rembourses = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(async (userId, matchId, raison) => { rembourses.push({ userId, matchId, raison }); }),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import { sweepMatchesWithoutArbiter } from './match-engine.mjs';

const H = 60 * 60 * 1000;
const ilYA = (ms) => new Date(Date.now() - ms).toISOString();

const matchSquelette = (surcharge = {}) => ({
  id: 'M-1',
  status: 'check_in',
  createdAt: ilYA(5 * H),
  players: [{ userId: 'p-1' }, { userId: 'p-2' }],
  disputes: [],
  prizePool: 1000,
  ...surcharge,
});

beforeEach(() => { rembourses.length = 0; vi.clearAllMocks(); });

describe('Balayage des matchs sans arbitre', () => {
  it('rembourse un match sans arbitre au-dela du delai', async () => {
    const match = matchSquelette();
    const res = await sweepMatchesWithoutArbiter([match]);

    expect(res.refunded).toEqual([{ matchId: 'M-1', reason: 'NO_ARBITER' }]);
    expect(rembourses.map((r) => r.userId).sort()).toEqual(['p-1', 'p-2']);
    // Le balayage mute un CLONE : c est sur la valeur retour qu on observe.
    expect(res.matches[0].status).toBe('cancelled');
    expect(res.matches[0].cancellationReason).toBe('NO_ARBITER');
  });

  it('respecte le delai : un match recent n est pas touche', async () => {
    const match = matchSquelette({ createdAt: ilYA(30 * 60 * 1000) });
    const res = await sweepMatchesWithoutArbiter([match]);

    expect(res.refunded).toEqual([]);
    expect(rembourses).toHaveLength(0);
    expect(res.matches[0].status).toBe('check_in');
  });

  it('un arbitre en poste qui ne lance pas est rembourse au-dela de 2 h', async () => {
    // Phase A : la place est prise, le match ne demarre jamais.
    const match = matchSquelette({ arbiter: { userId: 'p-arb', assignedAt: ilYA(3 * H) } });
    const res = await sweepMatchesWithoutArbiter([match]);

    expect(res.refunded).toEqual([{ matchId: 'M-1', reason: 'ARBITER_TIMEOUT' }]);
    expect(res.matches[0].cancellationReason).toBe('ARBITER_TIMEOUT');
  });

  it('un arbitre qui ne tranche pas est rembourse apres lancement', async () => {
    // Phase B : le match a demarre, aucun resultat. L argent ne doit pas rester
    // en sequestre au seul motif que l arbitre s est tu.
    const match = matchSquelette({
      status: 'in_progress',
      arbiter: { userId: 'p-arb', assignedAt: ilYA(5 * H) },
      startedAt: ilYA(3 * H),
    });
    const res = await sweepMatchesWithoutArbiter([match]);

    expect(res.refunded).toHaveLength(1);
    expect(rembourses).toHaveLength(2);
  });

  it('ne touche ni un litige ouvert, ni un match deja solde', async () => {
    const litige = matchSquelette({ disputes: [{ status: 'open' }] });
    const solde = matchSquelette({ id: 'M-2', result: { payoutDistributed: true } });
    const res = await sweepMatchesWithoutArbiter([litige, solde]);

    expect(res.refunded).toEqual([]);
    expect(rembourses).toHaveLength(0);
    expect(res.matches[0].status).toBe('check_in');
    expect(res.matches[1].status).toBe('check_in');
  });

  it('NE CLOT PAS si un remboursement echoue', async () => {
    // Le cas le plus dangereux : cloturer un match dont un joueur n a pas ete
    // rembourse laisserait du sequestre sans trace, et le joueur verrait le
    // match « annule » sans jamais avoir vu son argent.
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockImplementationOnce(async () => { throw new Error('SEQUESTRE INDISPONIBLE'); });

    const match = matchSquelette();
    const res = await sweepMatchesWithoutArbiter([match]);

    expect(res.refunded).toEqual([]);
    expect(res.matches[0].status, 'le match doit rester ouvert pour etre repris').toBe('check_in');
    expect(res.matches[0].cancellationReason).toBeUndefined();
  });
});