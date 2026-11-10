import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ligue : preuves de journée et de finale (P1 preuves durcies).
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `submitLeagueDayResultsOnServer` et `submitLeagueFinalResultsOnServer`
 * ne stockaient aucune preuve : le seul « juge » était l'admin, sans
 * trace exploitable en contestation. Les preuves passent désormais par
 * le même filtre anti-XSS que MJ (`proof-helpers.mjs`, dédup incluse)
 * et sont persistées normalisées.
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. Journée : preuves nettoyées + dédupliquées sur `daySlot.proofs`.
 * 2. Finale : preuves nettoyées sur `finalMatch.proofs`.
 * 3. Sans preuves : aucun champ inventé (data legacy inchangé).
 * 4. XSS filtré de la même façon qu'en MJ.
 */

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id,
    pseudo: id,
    role: id === 'admin-1' ? 'admin' : 'player',
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

import * as leagueEngine from './league-engine.mjs';

beforeEach(() => vi.clearAllMocks());

const saisonJourneeLive = () => leagueEngine.normalizeLeagueSeason({
  id: 'LS-P1',
  cycleNumber: 1,
  status: 'qualifying',
  entryFee: 50,
  qualificationGroups: {
    tuesday: { players: ['p-1', 'p-2'], matchId: null, results: [], status: 'live' },
  },
  standings: [
    { userId: 'p-1', pseudo: 'a', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] },
    { userId: 'p-2', pseudo: 'b', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('ligue - preuves de journee', () => {
  it('stocke des preuves nettoyees et dedupees', () => {
    const { season } = leagueEngine.submitLeagueDayResultsOnServer(
      [saisonJourneeLive()],
      { id: 'admin-1' },
      'LS-P1',
      'tuesday',
      [{ userId: 'p-1', placement: 1, kills: 3 }, { userId: 'p-2', placement: 2, kills: 1 }],
      {
        scoreboard: ['https://cdn.example.com/sb.png', 'javascript:alert(1)', 'https://cdn.example.com/sb.png'],
        finalResult: ['https://cdn.example.com/final.png'],
      },
    );
    expect(season.qualificationGroups.tuesday.proofs.scoreboard).toEqual(['https://cdn.example.com/sb.png']);
    expect(season.qualificationGroups.tuesday.proofs.finalResult).toEqual(['https://cdn.example.com/final.png']);
  });

  it('sans preuves : aucun champ invente', () => {
    const { season } = leagueEngine.submitLeagueDayResultsOnServer(
      [saisonJourneeLive()],
      { id: 'admin-1' },
      'LS-P1',
      'tuesday',
      [{ userId: 'p-1', placement: 1, kills: 0 }, { userId: 'p-2', placement: 2, kills: 0 }],
    );
    expect(season.qualificationGroups.tuesday.proofs).toBeUndefined();
  });
});

describe('ligue - preuves de finale', () => {
  const saisonFinale = () => {
    const s = leagueEngine.normalizeLeagueSeason({
      id: 'LS-P1',
      cycleNumber: 1,
      status: 'final',
      entryFee: 50,
      finalists: [{ userId: 'p-1' }, { userId: 'p-2' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // normalizeLeagueSeason ramene 40 finalistes par defaut si liste courte?
    // On borne explicitement pour que le test ne dépende pas de la taille.
    s.finalists = [{ userId: 'p-1' }, { userId: 'p-2' }];
    return s;
  };

  it('stocke des preuves nettoyees sur finalMatch', async () => {
    const { season } = await leagueEngine.submitLeagueFinalResultsOnServer(
      [saisonFinale()],
      { id: 'admin-1' },
      'LS-P1',
      [{ userId: 'p-1', placement: 1, kills: 0 }, { userId: 'p-2', placement: 2, kills: 0 }],
      { scoreboard: ['http://evil.example/a.png', 'legacy-ref'], finalResult: ['legacy-final'] },
    );
    // http refuse (https-only), legacy conserve.
    expect(season.finalMatch.proofs.scoreboard).toEqual(['legacy-ref']);
    expect(season.finalMatch.proofs.finalResult).toEqual(['legacy-final']);
  });
});
