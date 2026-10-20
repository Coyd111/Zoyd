import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La commission d'arbitre non versee doit etre REPRISE.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `applyResultSettlement` paie les joueurs, puis l'arbitre. Si le versement de
 * la commission echoue, les joueurs sont deja payes, le match est `finished`,
 * et la creance `pendingArbiterFee` est ecrite... puis jamais relue. Aucun
 * cron, aucune route, aucun moteur ne la reprenait.
 *
 * Consequence : l'arbitre avait fait son travail, et perdait 2 % du pot, sans
 * que rien ne le signale. Meme famille que V1 et V6 : une creance ecrite, et
 * jamais reprise.
 *
 * Le point le plus delicat n est pas la reprise, c'est l'IDEMPOTENCE. La
 * reprise ne paie pas deux fois, parce que la cle d'idempotence de
 * `releaseWalletWinnings` est derivee de `type:matchId` — et qu'elle doit etre
 * la MEME que celle du reglement initial. Une cle differente (`retry:...`)
 * paierait deux fois. C'est ce que ce fichier verrouille.
 */

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id, pseudo: id, role: 'player', trustScore: 100, stats: {}, progression: {},
    wallet: { cashBalance: 0, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

const versements = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(async (userId, amount, matchId, type, description) => {
    versements.push({ userId, amount, matchId, type, description });
  }),
  settleMatchLossWallet: vi.fn(),
}));

import { countPendingArbiterFees, retryPendingArbiterFees } from './match-engine.mjs';

const matchAvecCreance = (surcharge = {}) => ({
  id: 'M-1',
  status: 'finished',
  createdAt: '2026-01-01T00:00:00Z',
  players: [{ userId: 'p-1', team: 0 }, { userId: 'p-2', team: 1 }],
  arbiter: { userId: 'arb' },
  disputes: [],
  result: { payoutDistributed: true, winnerTeam: 0 },
  pendingArbiterFee: 20,
  ...surcharge,
});

beforeEach(() => { versements.length = 0; vi.clearAllMocks(); });

describe('Reprise des commissions d arbitre non versees', () => {
  it('compte les matchs qui ont une creance', () => {
    expect(countPendingArbiterFees([matchAvecCreance(), matchAvecCreance({ id: 'M-2', pendingArbiterFee: 0 })])).toBe(1);
  });

  it('verse la commission et solde la creance', async () => {
    const res = await retryPendingArbiterFees([matchAvecCreance()]);

    expect(res.retried).toBe(1);
    expect(res.remaining).toBe(0);
    expect(versements).toHaveLength(1);
    expect(versements[0].userId).toBe('arb');
    expect(versements[0].amount).toBe(20);
    // LA CLE D IDEMPOTENCE est derivee de `type:matchId`. Il faut que ce soit
    // exactement les memes arguments que le reglement initial, sinon la
    // reprise paie une seconde fois.
    expect(versements[0].matchId).toBe('M-1');
    expect(versements[0].type).toBe('arbitration_fee');
    // La creance sort de la file : sinon elle serait rejouee a chaque cycle.
    expect(res.matches[0].pendingArbiterFee).toBeUndefined();
  });

  it('rejoue avec EXACTEMENT la meme cle que le reglement initial', async () => {
    // Le reglement initial appelle :
    //   releaseWalletWinnings(arbiterId, arbiterFee, match.id, 'arbitration_fee', ...)
    // La cle est donc `arbitration_fee:<match.id>`. Si la reprise derivait une
    // autre cle — un suffixe `retry`, un id de tentative — la garde
    // d idempotence ne reconnaitrait pas le versement deja fait, et
    // l arbitre serait PAYE DEUX FOIS.
    const res = await retryPendingArbiterFees([matchAvecCreance()]);

    const { userId, amount, matchId, type } = versements[0];
    const cleIdempotence = `${type}:${matchId}`;
    expect(cleIdempotence).toBe('arbitration_fee:M-1');
    expect(userId).toBe('arb');
    expect(amount).toBe(20);
    expect(res.retried).toBe(1);
  });

  it('conserve la creance quand le versement echoue — elle ne doit pas disparaitre', async () => {
    const { releaseWalletWinnings } = await import('./wallet-engine.mjs');
    releaseWalletWinnings.mockImplementationOnce(async () => { throw new Error('BASE INDISPONIBLE'); });

    const res = await retryPendingArbiterFees([matchAvecCreance()]);

    expect(res.retried).toBe(0);
    expect(res.remaining).toBe(1);
    // La creance reste : c est elle qui permet le prochain essai.
    expect(res.matches[0].pendingArbiterFee).toBe(20);
  });

  it('ne touche pas un match sans creance', async () => {
    const res = await retryPendingArbiterFees([matchAvecCreance({ pendingArbiterFee: undefined })]);

    expect(versements).toHaveLength(0);
    expect(res.retried).toBe(0);
    expect(res.remaining).toBe(0);
  });

  it('garde la creance et la signale quand l arbitre est inconnu', async () => {
    // L arbitre n est plus identifiable : la creance ne peut pas etre versee.
    // On la garde VISIBLE plutot que de l effacer — une dette qu on ne voit
    // pas est une dette qu on ne rembourse pas.
    const res = await retryPendingArbiterFees([matchAvecCreance({ arbiter: undefined })]);

    expect(versements).toHaveLength(0);
    expect(res.remaining).toBe(1);
    expect(res.matches[0].pendingArbiterFee).toBe(20);
  });
});
