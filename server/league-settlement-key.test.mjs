import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * I17 — La clé de réservation du gain de ligue est `season.id`.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `applyLeagueSettlement` verse avec `releaseWalletWinnings(..., season.id, ...)`,
 * la même clé que `lockEntryFee(..., seasonId)` à l'inscription.
 * L'historique (commentaire league-engine.mjs) : une clé
 * `${season.id}-1ST` laissait `lockedEntries[matchId]` à `undefined`,
 * `releasedAmount = 0`, verrou jamais libéré (pass gelé à vie) ET mise
 * bonus convertie à 100 % en cash retirable (contournement anti-
 * blanchiment — wallet-engine.mjs `bonusRestore = min(stakeBonus, ...)`).
 * Aucun test n'exerçait cette clé : une faute de frappe la changeait
 * sans que rien ne tombe.
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. Les 3 versements podium utilisent `season.id`, jamais un suffixe.
 * 2. Les débits des non-podium utilisent aussi `season.id`.
 * 3. La reprise (`retryPendingLeaguePayouts`) garde la même clé.
 * 4. Garde source : le fichier ne contient aucun `-${season.id}-1ST`
 *    ni template `${season.id}-` passé au wallet (le commentaire, lui,
 *    est attendu).
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
  sanitizeText: vi.fn((value) => String(value || '').trim()),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: async (_id, fn) => fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(async () => ({})),
  settleMatchLossWallet: vi.fn(async () => ({})),
  isUnrecoverableRefundError: (error) => error?.code === 'USER_NOT_FOUND' || error?.code === 'USER_DELETED',
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as leagueEngine from './league-engine.mjs';
import { releaseWalletWinnings, settleMatchLossWallet } from './wallet-engine.mjs';

beforeEach(() => {
  vi.clearAllMocks();
});

const saisonTerminee = () => leagueEngine.normalizeLeagueSeason({
  id: 'LS-I17',
  cycleNumber: 1,
  status: 'completed',
  entryFee: 50,
  payout: { gross: 600, first: 360, second: 150, third: 90 },
  podium: { first: 'p-1', second: 'p-2', third: 'p-3' },
  registeredPlayers: [
    { userId: 'p-1', entryFee: 50 },
    { userId: 'p-2', entryFee: 50 },
    { userId: 'p-3', entryFee: 50 },
    { userId: 'p-4', entryFee: 50 },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('I17 - cle de reservation ligue = season.id', () => {
  it('les 3 versements podium utilisent season.id', async () => {
    await leagueEngine.applyLeagueSettlement(saisonTerminee());
    expect(releaseWalletWinnings).toHaveBeenCalledTimes(3);
    const ids = releaseWalletWinnings.mock.calls.map((c) => c[2]);
    expect(ids).toEqual(['LS-I17', 'LS-I17', 'LS-I17']);
    const types = releaseWalletWinnings.mock.calls.map((c) => c[3]);
    expect(types).toEqual(['prize_win', 'prize_win', 'prize_win']);
    for (const c of releaseWalletWinnings.mock.calls) {
      expect(String(c[2])).not.toMatch(/-1ST|-2ND|-3RD/);
    }
  });

  it('la reprise utilise aussi season.id (pas un suffixe)', async () => {
    const season = saisonTerminee();
    season.pendingPayouts = [{ kind: 'prize', userId: 'p-1', amount: 360, lastError: 'x', at: new Date().toISOString() }];
    await leagueEngine.retryPendingLeaguePayouts([season]);
    expect(releaseWalletWinnings).toHaveBeenCalledTimes(1);
    expect(releaseWalletWinnings.mock.calls[0][2]).toBe('LS-I17');
  });

  it('le debit des non-podium utilise season.id', async () => {
    await leagueEngine.applyLeagueSettlement(saisonTerminee());
    expect(settleMatchLossWallet).toHaveBeenCalledTimes(1);
    expect(settleMatchLossWallet.mock.calls[0][1]).toBe('LS-I17');
  });

  it('aucune cle suffixed n est passee au wallet (garde source)', () => {
    const source = readFileSync(resolve('server/league-engine.mjs'), 'utf8');
    // Interdits : appels wallet avec un template a suffixe.
    expect(source).not.toMatch(/releaseWalletWinnings\([^)]*\$\{season\.id\}-/);
    expect(source).not.toMatch(/settleMatchLossWallet\([^)]*\$\{season\.id\}-/);
    expect(source).not.toMatch(/lockEntryFee\([^)]*\$\{season\.id\}-/);
    // Autorise : le commentaire historique qui explique la faute.
    expect(source).toContain('PAS `${season.id}-1ST`');
  });
});
