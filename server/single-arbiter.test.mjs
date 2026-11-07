import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R2 — Un seul arbitre par match (docs/05-invariants.md).
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `match.arbiter` est un objet unique, premier arrivé premier servi :
 * `assignArbiterOnServer` refuse un second `assign` avec `ARBITER_TAKEN`.
 * Aucun test ne couvrait le double `assign` : une régression qui
 * écraserait l'arbitre en poste (commission détournée, hasSubmittedResult
 * perdu, litige « qui a tranché ? » insoluble) resterait verte.
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. Le premier `assign` réussit et mute `arbiter` + snapshot.
 * 2. Le second `assign` (autre compte) lève `ARBITER_TAKEN`.
 * 3. Le second `assign` ne mute PAS l'arbitre en place (ni pseudo, ni
 *    assignedAt, ni hasSubmittedResult).
 * 4. L'arbitre en place ne peut se réassigner lui-même (même code).
 * 5. Un `arbiter` sans `userId` reste truthy en JS mais doit être lu via
 *    le garde réel (`if (match.arbiter)`) — ce test documente le piège :
 *    la place est occupée dès que l'objet existe, même incomplet.
 */

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id,
    pseudo: id,
    role: 'player',
    trustScore: 100,
    stats: {},
    progression: {},
    wallet: { cashBalance: 1000, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import * as matchEngine from './match-engine.mjs';

beforeEach(() => vi.clearAllMocks());

const matchDeBase = (surcharge = {}) => ({
  id: 'M-1',
  status: 'recruiting',
  players: [
    { userId: 'p-1', team: 0, isCheckedIn: false, isReady: false },
  ],
  disputes: [],
  prizePool: 100,
  entryFee: 50,
  teamSize: 1,
  maxPlayers: 2,
  ...surcharge,
});

describe('R2 - un seul arbitre par match', () => {
  it('le premier assign reussit et mute arbiter + snapshot', () => {
    const { match, matches } = matchEngine.assignArbiterOnServer([matchDeBase()], { id: 'arb-1' }, 'M-1');
    expect(match.arbiter.userId).toBe('arb-1');
    expect(matches).toHaveLength(1);
    expect(matches[0].arbiter.userId).toBe('arb-1');
  });

  it('le second assign sur un autre compte leve ARBITER_TAKEN', () => {
    const { matches } = matchEngine.assignArbiterOnServer([matchDeBase()], { id: 'arb-1' }, 'M-1');
    expect(() =>
      matchEngine.assignArbiterOnServer(matches, { id: 'arb-2' }, 'M-1'),
    ).toThrowError(expect.objectContaining({ code: 'ARBITER_TAKEN' }));
  });

  it('le second assign ne mute PAS l arbitre en place', () => {
    const first = matchEngine.assignArbiterOnServer([matchDeBase()], { id: 'arb-1' }, 'M-1');
    const avant = { ...first.match.arbiter };
    try {
      matchEngine.assignArbiterOnServer(first.matches, { id: 'arb-2' }, 'M-1');
    } catch {
      // attendu
    }
    const apres = first.matches[0].arbiter;
    expect(apres?.userId).toBe(avant.userId);
    expect(apres?.pseudo).toBe(avant.pseudo);
    expect(apres?.assignedAt).toBe(avant.assignedAt);
    expect(apres?.hasSubmittedResult).toBe(avant.hasSubmittedResult);
  });

  it('l arbitre en place ne peut se reassigner', () => {
    const { matches } = matchEngine.assignArbiterOnServer([matchDeBase()], { id: 'arb-1' }, 'M-1');
    expect(() =>
      matchEngine.assignArbiterOnServer(matches, { id: 'arb-1' }, 'M-1'),
    ).toThrowError(expect.objectContaining({ code: 'ARBITER_TAKEN' }));
  });

  it('documente le piège : un objet arbiter incomplet occupe la place', () => {
    // `if (match.arbiter)` est un test de truthiness, pas de userId.
    // Un objet sans userId reste donc une place prise — jamais libérée.
    const m = matchDeBase({ arbiter: { pseudo: 'Fantome' } });
    expect(m.arbiter).toBeTruthy();
    expect(() =>
      matchEngine.assignArbiterOnServer([m], { id: 'arb-1' }, 'M-1'),
    ).toThrowError(expect.objectContaining({ code: 'ARBITER_TAKEN' }));
  });
});
