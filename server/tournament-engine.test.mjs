import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn(),
  updateUserAccount: vi.fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import * as tournamentEngine from './tournament-engine.mjs';
import { getUserById, updateUserAccount } from './persistence.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
} from './wallet-engine.mjs';

const mockAdmin = { id: 'admin-1', pseudo: 'Admin', role: 'admin', wallet: {} };
const mockPlayer = { id: 'player-1', pseudo: 'ShadowX', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
const mockPlayer2 = { id: 'player-2', pseudo: 'Ghost', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
const mockPlayer3 = { id: 'player-3', pseudo: 'Blaze', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
const mockPlayer4 = { id: 'player-4', pseudo: 'Storm', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };

const makeEntry = (userId, pseudo, seed = 1) => ({
  id: `ENTRY-${seed}`,
  seed,
  squadName: pseudo,
  captainId: userId,
  captainPseudo: pseudo,
  teamSize: 1,
  members: [{ userId, pseudo, isCaptain: true }],
  checkedIn: false,
  joinedAt: new Date().toISOString(),
  wins: 0,
  losses: 0,
});

describe('tournament-engine - normalizeTournamentCollection', () => {
  it('should sort by updatedAt descending', () => {
    const t1 = { id: 'T-1', updatedAt: '2026-01-01T00:00:00Z' };
    const t2 = { id: 'T-2', updatedAt: '2026-01-02T00:00:00Z' };
    const result = tournamentEngine.normalizeTournamentCollection([t1, t2]);
    expect(result[0].id).toBe('T-2');
    expect(result[1].id).toBe('T-1');
  });

  it('should handle empty input', () => {
    expect(tournamentEngine.normalizeTournamentCollection([])).toEqual([]);
    expect(tournamentEngine.normalizeTournamentCollection(null)).toEqual([]);
  });

  it('should normalize entries and matches', () => {
    const result = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-1',
      entries: [{ id: 'E1', seed: 1 }],
      matches: [{ id: 'M1' }],
    }]);
    expect(result[0].entries).toHaveLength(1);
    expect(result[0].matches).toHaveLength(1);
  });
});

describe('tournament-engine - createTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should create tournament', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      format: '1VS1',
      maxEntries: 8,
      entryFee: 100,
    });
    expect(result.tournament).toBeDefined();
    expect(result.tournament.name).toBe('Test Cup');
    expect(result.tournament.status).toBe('recruiting');
    expect(result.tournaments).toHaveLength(1);
  });

  it('should set default rules', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
    });
    expect(result.tournament.rules.scoreTarget).toBe(7);
    expect(result.tournament.rules.bestOf).toBe(1);
    expect(result.tournament.rules.mode).toBe('S&D');
    expect(result.tournament.rules.mapPool).toEqual(['Raid', 'Standoff', 'Crash']);
  });

  it('should reserve creator as arbiter by default', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      maxEntries: 12,
    });
    const hasArbiter = result.tournament.arbiters.some(
      (s) => s.userId === 'admin-1'
    );
    expect(hasArbiter).toBe(true);
  });

  it('should not reserve creator when explicitly disabled', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      maxEntries: 12,
      reserveCreatorAsArbiter: false,
    });
    const hasArbiter = result.tournament.arbiters.some(
      (s) => s.userId === 'admin-1'
    );
    expect(hasArbiter).toBe(false);
  });

  it('should reject if user not found', () => {
    getUserById.mockReturnValue(null);
    expect(() =>
      tournamentEngine.createTournamentOnServer([], { id: 'ghost' }, { name: 'Test' })
    ).toThrow();
  });
});

describe('tournament-engine - registerForTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should register player for tournament', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format: '1VS1',
      entries: [],
      arbiters: [],
    }])[0];

    const result = tournamentEngine.registerForTournamentOnServer(
      [tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' }
    );
    expect(result.tournament.entries).toHaveLength(1);
    expect(result.tournament.entries[0].captainId).toBe('player-1');
    expect(lockEntryFee).toHaveBeenCalled();
  });

  it('should reject if tournament not found', () => {
    expect(() =>
      tournamentEngine.registerForTournamentOnServer([], mockPlayer, 'T-NOPE', { pseudo: 'X' })
    ).toThrow();
  });

  it('should reject if tournament is full', () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeEntry(`p-${i}`, `P${i}`, i + 1));
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [],
    }])[0];

    expect(() =>
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' })
    ).toThrow();
  });

  it('should reject if already registered', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [],
    }])[0];

    expect(() =>
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' })
    ).toThrow();
  });

  it('should reject if not recruiting', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      status: 'live',
      entries: [],
      arbiters: [],
    }])[0];

    expect(() =>
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'X' })
    ).toThrow();
  });

  it('should reject if player is arbiter', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      format: '1VS1',
      entries: [],
      arbiters: [{ userId: 'player-1', pseudo: 'ShadowX', slot: 1 }],
    }])[0];

    expect(() =>
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' })
    ).toThrow();
  });
});

describe('tournament-engine - leaveTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should remove entry and refund', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [],
    }])[0];

    const result = tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST');
    expect(result.tournament.entries).toHaveLength(0);
    expect(refundLockedEntry).toHaveBeenCalledWith('player-1', 'T-TEST', expect.any(String));
  });

  it('should reject if not registered', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      status: 'recruiting',
      entries: [],
      arbiters: [],
    }])[0];

    expect(() =>
      tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });

  it('should reject if not captain', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '2VS2',
      entries: [{
        id: 'ENTRY-1',
        captainId: 'other-player',
        members: [
          { userId: 'other-player', pseudo: 'Boss', isCaptain: true },
          { userId: 'player-1', pseudo: 'ShadowX', isCaptain: false },
        ],
        seed: 1,
      }],
      arbiters: [],
    }])[0];

    expect(() =>
      tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });

  it('should reject if tournament already started', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      status: 'live',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [],
    }])[0];

    expect(() =>
      tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });
});

describe('tournament-engine - startTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should start tournament and build bracket', () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
    ];
    const arbiterUser = { id: 'arbiter-1', pseudo: 'Ref', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
    getUserById.mockReturnValue(arbiterUser);
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'arbiter-1', pseudo: 'Ref', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    const result = tournamentEngine.startTournamentOnServer([tournament], arbiterUser, 'T-TEST');
    expect(result.tournament.status).toBe('live');
    expect(result.tournament.matches.length).toBeGreaterThan(0);
  });

  it('should reject if not enough entries', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('p1', 'P1', 1)],
      arbiters: [{ userId: 'arbiter-1', pseudo: 'Ref', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    expect(() =>
      tournamentEngine.startTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });

  it('should reject if arbiters not assigned', () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
    ];
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: null, slot: 1 }],
    }])[0];

    expect(() =>
      tournamentEngine.startTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });
});

describe('tournament-engine - assignTournamentArbiterOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should assign arbiter to empty slot', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      arbiters: [{ userId: null, slot: 1 }],
    }])[0];

    const result = tournamentEngine.assignTournamentArbiterOnServer([tournament], mockPlayer, 'T-TEST');
    expect(result.tournament.arbiters[0].userId).toBe('player-1');
  });

  it('should reject if player is already registered as entry', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [{ userId: null, slot: 1 }],
    }])[0];

    expect(() =>
      tournamentEngine.assignTournamentArbiterOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });
});

describe('tournament-engine - submitTournamentMatchResultOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should record match result and advance winner', () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
    ];
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      status: 'live',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString(), matchesHandled: 0 }],
      matches: [
        {
          id: 'TM-1',
          bracketType: 'main',
          round: 0,
          position: 0,
          entryAId: 'ENTRY-P1-1',
          entryBId: 'ENTRY-P2-2',
          status: 'ready',
          roomName: 'room1',
          roomPassword: 'pass1',
          arbiterSlot: 1,
        },
      ],
    }])[0];

    const matchId = tournament.matches[0].id;
    const result = tournamentEngine.submitTournamentMatchResultOnServer(
      [tournament], mockAdmin, 'T-TEST', matchId,
      { winnerEntryId: 'ENTRY-P1-1', scoreA: 7, scoreB: 3 }
    );
    const match = result.tournament.matches.find((m) => m.id === matchId);
    expect(match.status).toBe('finished');
    expect(match.winnerEntryId).toBe('ENTRY-P1-1');
  });
});

describe('tournament-engine - pure helpers', () => {
  it('should build correct bracket for 4 entries (2 rounds)', () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
    ];
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      minEntries: 4,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    const result = tournamentEngine.startTournamentOnServer([tournament], mockAdmin, 'T-TEST');
    expect(result.tournament.mainRounds).toBe(2);
    expect(result.tournament.matches.filter((m) => m.bracketType === 'main')).toHaveLength(3);
  });

  it('should build correct bracket for 8 entries (3 rounds)', () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeEntry(`p${i}`, `P${i}`, i + 1));
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      minEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    const result = tournamentEngine.startTournamentOnServer([tournament], mockAdmin, 'T-TEST');
    expect(result.tournament.mainRounds).toBe(3);
    expect(result.tournament.matches.filter((m) => m.bracketType === 'main')).toHaveLength(7);
  });
});
