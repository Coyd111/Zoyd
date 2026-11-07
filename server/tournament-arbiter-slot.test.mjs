import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R5 — Un arbitre de tournoi n'agit que sur les duels de son slot
 * (docs/05-invariants.md).
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `requireTournamentMatchAction` (tournoi live) vérifie
 * `assignedSlot.slot === match.arbiterSlot` pour tout non-admin.
 * `arbiterSlot` est posé par `scheduleMatches` en `(index % needed) + 1`.
 * Sans test, une régression retirant ce contrôle laisserait un arbitre
 * valider le match de l'autre poste — l'affectation « les arbitres se
 * partagent les salons pour qu'aucune équipe qui ne joue pas observe une
 * autre » (02-modele-metier.md §3.4) deviendrait lettre morte.
 *
 * Ce que les tests gardent
 * ------------------------
 * 1. Slot 1 sur duel slot 2 = FORBIDDEN (room, live, résultat).
 * 2. Slot 1 sur duel slot 1 = autorisé (room publiée).
 * 3. Un joueur non-arbitre = FORBIDDEN partout.
 * 4. Un admin passe hors slot (recours, cf. requireTournamentMatchAction).
 */

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => {
    const roles = { 'admin-1': 'admin' };
    return {
      id,
      pseudo: id,
      role: roles[id] || 'player',
      trustScore: 100,
      stats: {},
      progression: {},
      wallet: { cashBalance: 1000, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
    };
  }),
  getUserByExactPseudo: vi.fn(),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((value) => String(value || '').trim()),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: async (_id, fn) => fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
  isUnrecoverableRefundError: (error) => error?.code === 'USER_NOT_FOUND' || error?.code === 'USER_DELETED',
}));

import * as tournamentEngine from './tournament-engine.mjs';

beforeEach(() => vi.clearAllMocks());

// Tournoi live a 2 arbitres, 2 duels (slots 1 et 2), SANS necessiter le
// bracket complet : on pose les champs que `requireTournamentMatchAction`
// lit (status, arbiters.slot, matches.arbiterSlot/entryAId/entryBId/status).
const tournoiLive2Slots = () => ({
  id: 'T-1',
  status: 'live',
  name: 'Cup',
  format: '1VS1',
  teamSize: 1,
  entryFee: 100,
  maxEntries: 9,
  minEntries: 2,
  arbiters: [
    { slot: 1, userId: 'arb-1', pseudo: 'arb-1', trustScore: 100, assignedAt: new Date().toISOString() },
    { slot: 2, userId: 'arb-2', pseudo: 'arb-2', trustScore: 100, assignedAt: new Date().toISOString() },
  ],
  entries: [
    { id: 'E1', seed: 1, squadName: 'A', captainId: 'p-1', captainPseudo: 'A', teamSize: 1, members: [{ userId: 'p-1', pseudo: 'A', isCaptain: true }] },
    { id: 'E2', seed: 2, squadName: 'B', captainId: 'p-2', captainPseudo: 'B', teamSize: 1, members: [{ userId: 'p-2', pseudo: 'B', isCaptain: true }] },
  ],
  matches: [
    { id: 'TM-1', tournamentId: 'T-1', bracketType: 'main', round: 1, position: 1, status: 'ready', arbiterSlot: 1, entryAId: 'E1', entryBId: 'E2', updatedAt: new Date().toISOString() },
    { id: 'TM-2', tournamentId: 'T-1', bracketType: 'main', round: 1, position: 2, status: 'ready', arbiterSlot: 2, entryAId: 'E1', entryBId: 'E2', updatedAt: new Date().toISOString() },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('R5 - perimetre de slot d arbitre', () => {
  it('slot 1 refuse sur un duel slot 2 (room)', () => {
    expect(() =>
      tournamentEngine.setTournamentMatchRoomDetailsOnServer(
        [tournoiLive2Slots()], { id: 'arb-1' }, 'T-1', 'TM-2', 'Salle', 'mdp',
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('slot 1 refuse sur un duel slot 2 (live)', () => {
    // TM-2 publie sa salle pour pouvoir atteindre le garde live
    const t = tournoiLive2Slots();
    t.matches[1].roomName = 'Salle';
    t.matches[1].roomPassword = 'mdp';
    expect(() =>
      tournamentEngine.setTournamentMatchLiveOnServer([t], { id: 'arb-1' }, 'T-1', 'TM-2'),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('slot 1 autorise sur son propre duel (room)', () => {
    const { match } = tournamentEngine.setTournamentMatchRoomDetailsOnServer(
      [tournoiLive2Slots()], { id: 'arb-1' }, 'T-1', 'TM-1', 'Salle', 'mdp',
    );
    expect(match.roomName).toBe('Salle');
  });

  it('un joueur non-arbitre est refuse partout', () => {
    expect(() =>
      tournamentEngine.setTournamentMatchRoomDetailsOnServer(
        [tournoiLive2Slots()], { id: 'p-1' }, 'T-1', 'TM-1', 'Salle', 'mdp',
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('un admin passe hors slot', () => {
    const { match } = tournamentEngine.setTournamentMatchRoomDetailsOnServer(
      [tournoiLive2Slots()], { id: 'admin-1' }, 'T-1', 'TM-2', 'Salle', 'mdp',
    );
    expect(match.roomName).toBe('Salle');
  });

  it('le second arbitre est muet sur le duel du premier (resultat)', async () => {
    await expect(
      tournamentEngine.submitTournamentMatchResultOnServer(
        [tournoiLive2Slots()], { id: 'arb-2' }, 'T-1', 'TM-1',
        { winnerEntryId: 'E1', scoreA: 10, scoreB: 5 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
