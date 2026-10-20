import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le job de reprise des commissions d'arbitre est-il BRANCHE ?
 *
 * Pourquoi ce fichier est distinct de `arbiter-fee-recovery.test.mjs`
 * -----------------------------------------------------------------
 * Celui-la teste le MECANISME : la fonction de reprise du moteur verse-t-elle
 * bien la commission, solde-t-elle la creance, respecte-t-elle la cle
 * d'idempotence ?
 *
 * Celui-ci teste le CABLE : le job du cron appelle-t-il cette fonction, lit-il
 * l'etat, et persiste-t-il le resultat ?
 *
 * La distinction n'est pas pedante. V1, dans ce projet, etait un mecanisme
 * ecrit, teste, et JAMAIS APPELE : les delais de 2 h par phase n'etaient pas
 * appliques, et un match sans arbitre pouvait rester en sequestre 14 jours.
 * Le test du mecanisme etait VERT. C'est la preuve du cablage qui manquait.
 *
 * Meme famille pour V6 : une exception dans une boucle, et tous les matchs
 * situes apres elle n'etaient plus traites.
 *
 * Ce test appelle donc `sweepPendingArbiterFees()` — la fonction exportee par
 * `server/cron.mjs` — et non la fonction du moteur.
 */

const etat = { matches: [] };

vi.mock('./persistence.mjs', () => ({
  getStateCollection: vi.fn((nom) => (nom === 'matches' ? etat.matches : [])),
  replaceStateCollection: vi.fn((nom, valeur) => {
    if (nom === 'matches') etat.matches = valeur;
  }),
  getUserById: vi.fn((id) => ({ id, pseudo: id, role: 'player', wallet: {} })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
  applyUserSettlementOnce: vi.fn(async (u, _k, updater) => updater({ id: u, stats: {}, progression: {} })),
  cleanupMemoryChatReads: vi.fn(),
  cleanupMemoryNotifications: vi.fn(),
  cleanupMemoryFriendRequests: vi.fn(),
  verifyDataIntegrity: vi.fn(async () => ({ ok: true })),
  listUserIds: vi.fn(() => []),
  tagWalletTransaction: vi.fn(),
  forgetWithdrawalKey: vi.fn(),
}));

const versements = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(async (userId, amount, matchId, type) => {
    versements.push({ userId, amount, matchId, type });
  }),
  settleMatchLossWallet: vi.fn(),
  reconcilePendingWithdrawals: vi.fn(async () => ({ reconciled: 0 })),
  depositToWallet: vi.fn(),
}));

vi.mock('./payment-engine.mjs', () => ({
  retrieveFedaPayPayout: vi.fn(),
  payoutSucceeded: vi.fn(),
  payoutFailed: vi.fn(),
}));

import { sweepPendingArbiterFees } from './cron.mjs';

const matchAvecCreance = (surcharge = {}) => ({
  id: 'M-CABLE',
  status: 'finished',
  createdAt: '2026-01-01T00:00:00Z',
  players: [{ userId: 'p-1', team: 0 }, { userId: 'p-2', team: 1 }],
  arbiter: { userId: 'arb' },
  disputes: [],
  result: { payoutDistributed: true, winnerTeam: 0 },
  pendingArbiterFee: 20,
  ...surcharge,
});

beforeEach(() => {
  versements.length = 0;
  vi.clearAllMocks();
  etat.matches = [];
});

describe('Le job de reprise des commissions d arbitre est branche', () => {
  it('verse la commission du match en attente, en passant par le job', async () => {
    etat.matches = [matchAvecCreance()];

    await sweepPendingArbiterFees();

    // Le job a bien appele le mecanisme : l argent est parti.
    expect(versements).toHaveLength(1);
    expect(versements[0].userId).toBe('arb');
    expect(versements[0].amount).toBe(20);
    expect(versements[0].type).toBe('arbitration_fee');
  });

  it('persiste l etat : la creance disparait de la collection', async () => {
    etat.matches = [matchAvecCreance()];

    await sweepPendingArbiterFees();

    // Sans cette persistance, la creance reviendrait au cycle suivant et
    // serait rejouee pour toujours.
    expect(etat.matches[0].pendingArbiterFee).toBeUndefined();
  });

  it('ne fait rien quand il n y a aucune creance', async () => {
    etat.matches = [matchAvecCreance({ pendingArbiterFee: undefined })];

    await sweepPendingArbiterFees();

    expect(versements).toHaveLength(0);
  });

  it('conserve la creance si le versement echoue, et ne pretend pas avoir regle', async () => {
    const { releaseWalletWinnings } = await import('./wallet-engine.mjs');
    releaseWalletWinnings.mockImplementationOnce(async () => { throw new Error('BASE INDISPONIBLE'); });
    etat.matches = [matchAvecCreance()];

    await sweepPendingArbiterFees();

    expect(etat.matches[0].pendingArbiterFee).toBe(20);
  });
});
