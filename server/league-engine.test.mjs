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

import * as leagueEngine from './league-engine.mjs';
import { getUserById, updateUserAccount } from './persistence.mjs';
import { lockEntryFee, refundLockedEntry } from './wallet-engine.mjs';

const mockAdmin = { id: 'admin-1', pseudo: 'Admin', role: 'admin', wallet: {} };
const mockPlayer = { id: 'player-1', pseudo: 'ShadowX', role: 'player', wallet: {} };
const mockPlayer2 = { id: 'player-2', pseudo: 'Ghost', role: 'player', wallet: {} };

const makeSeason = (overrides = {}) =>
  leagueEngine.normalizeLeagueSeason({
    id: 'LS-TEST',
    cycleNumber: 1,
    status: 'registering',
    entryFee: 50,
    maxPlayers: 500,
    registeredPlayers: [],
    qualificationGroups: {},
    standings: [],
    finalists: [],
    finalMatch: { matchId: null, results: [], status: 'pending' },
    podium: { first: null, second: null, third: null },
    payout: { gross: 0, first: 0, second: 0, third: 0 },
    schedule: {
      registrationOpens: new Date().toISOString(),
      registrationCloses: null,
      qualifyingStarts: null,
      qualifyingEnds: null,
      finalAt: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

describe('league-engine - normalizeLeagueSeason', () => {
  it('should fill defaults for empty season', () => {
    const season = leagueEngine.normalizeLeagueSeason({});
    expect(season.id).toMatch(/^LS-/);
    expect(season.status).toBe('registering');
    expect(season.entryFee).toBe(50);
    expect(season.maxPlayers).toBe(500);
    expect(season.registeredPlayers).toEqual([]);
    expect(season.standings).toEqual([]);
    expect(season.podium).toEqual({ first: null, second: null, third: null });
  });

  it('should preserve existing values', () => {
    const season = leagueEngine.normalizeLeagueSeason({
      id: 'LS-CUSTOM',
      cycleNumber: 3,
      status: 'qualifying',
      entryFee: 100,
      maxPlayers: 200,
    });
    expect(season.id).toBe('LS-CUSTOM');
    expect(season.cycleNumber).toBe(3);
    expect(season.status).toBe('qualifying');
    expect(season.entryFee).toBe(100);
    expect(season.maxPlayers).toBe(200);
  });

  it('should normalize qualification groups for all days', () => {
    const season = leagueEngine.normalizeLeagueSeason({ qualificationGroups: {} });
    const days = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of days) {
      expect(season.qualificationGroups[day]).toEqual({
        players: [],
        matchId: null,
        results: [],
        status: 'pending',
      });
    }
  });
});

describe('league-engine - normalizeLeagueCollection', () => {
  it('should sort by updatedAt descending', () => {
    const s1 = makeSeason({ id: 'LS-1', updatedAt: '2026-01-01T00:00:00Z' });
    const s2 = makeSeason({ id: 'LS-2', updatedAt: '2026-01-02T00:00:00Z' });
    const result = leagueEngine.normalizeLeagueCollection([s1, s2]);
    expect(result[0].id).toBe('LS-2');
    expect(result[1].id).toBe('LS-1');
  });

  it('should handle empty input', () => {
    expect(leagueEngine.normalizeLeagueCollection([])).toEqual([]);
    expect(leagueEngine.normalizeLeagueCollection(null)).toEqual([]);
  });
});

describe('league-engine - createLeagueSeasonOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should create season as admin', () => {
    const result = leagueEngine.createLeagueSeasonOnServer([], mockAdmin);
    expect(result.season).toBeDefined();
    expect(result.season.status).toBe('registering');
    expect(result.season.cycleNumber).toBe(1);
    expect(result.seasons).toHaveLength(1);
  });

  it('should increment cycle number', () => {
    const existing = [makeSeason({ cycleNumber: 5 })];
    const result = leagueEngine.createLeagueSeasonOnServer(existing, mockAdmin);
    expect(result.season.cycleNumber).toBe(6);
  });

  it('should reject non-admin', () => {
    getUserById.mockReturnValue(mockPlayer);
    expect(() => leagueEngine.createLeagueSeasonOnServer([], mockPlayer)).toThrow();
  });
});

describe('league-engine - joinLeagueSeasonOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should join registering season', async () => {
    const season = makeSeason();
    const result = await leagueEngine.joinLeagueSeasonOnServer([season], mockPlayer, 'LS-TEST');
    expect(result.season.registeredPlayers).toHaveLength(1);
    expect(result.season.registeredPlayers[0].userId).toBe('player-1');
    expect(lockEntryFee).toHaveBeenCalledWith('player-1', 50, 'LS-TEST');
  });

  it('should reject if already joined', async () => {
    const season = makeSeason({
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
    });
    await expect(leagueEngine.joinLeagueSeasonOnServer([season], mockPlayer, 'LS-TEST')).rejects.toThrow();
  });

  it('should reject if season is full', async () => {
    const players = Array.from({ length: 500 }, (_, i) => ({
      userId: `p-${i}`,
      pseudo: `P${i}`,
      joinedAt: new Date().toISOString(),
    }));
    const season = makeSeason({ registeredPlayers: players });
    await expect(leagueEngine.joinLeagueSeasonOnServer([season], mockPlayer, 'LS-TEST')).rejects.toThrow();
  });

  it('should reject if not registering', async () => {
    const season = makeSeason({ status: 'qualifying' });
    await expect(leagueEngine.joinLeagueSeasonOnServer([season], mockPlayer, 'LS-TEST')).rejects.toThrow();
  });

  it('should reject if season not found', async () => {
    await expect(leagueEngine.joinLeagueSeasonOnServer([], mockPlayer, 'LS-NOPE')).rejects.toThrow();
  });
});

describe('league-engine - leaveLeagueSeasonOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should remove player from season', async () => {
    const season = makeSeason({
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
    });
    const result = await leagueEngine.leaveLeagueSeasonOnServer([season], mockPlayer, 'LS-TEST');
    expect(result.season.registeredPlayers).toHaveLength(0);
    expect(refundLockedEntry).toHaveBeenCalledWith('player-1', 'LS-TEST', expect.any(String));
  });

  it('should reject if not joined', async () => {
    const season = makeSeason();
    await expect(leagueEngine.leaveLeagueSeasonOnServer([season], mockPlayer, 'LS-TEST')).rejects.toThrow();
  });
});

describe('league-engine - getLeagueLeaderboard', () => {
  it('should return standings for season', () => {
    const standings = [
      { userId: 'p1', pseudo: 'A', totalPoints: 100, bestPlacement: 1, matchesPlayed: 5, placements: [1, 2, 3] },
    ];
    const season = makeSeason({ standings });
    const result = leagueEngine.getLeagueLeaderboard([season], 'LS-TEST');
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('p1');
  });

  it('should throw if season not found', () => {
    expect(() => leagueEngine.getLeagueLeaderboard([], 'LS-NOPE')).toThrow();
  });
});

describe('league-engine - updateLeagueSettingsOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should update maxPlayers as admin', () => {
    const season = makeSeason();
    const result = leagueEngine.updateLeagueSettingsOnServer([season], mockAdmin, 'LS-TEST', { maxPlayers: 100 });
    expect(result.season.maxPlayers).toBe(100);
  });

  it('should update entryFee as admin', () => {
    const season = makeSeason();
    const result = leagueEngine.updateLeagueSettingsOnServer([season], mockAdmin, 'LS-TEST', { entryFee: 75 });
    expect(result.season.entryFee).toBe(75);
  });

  it('should reject maxPlayers < 10', () => {
    const season = makeSeason();
    expect(() =>
      leagueEngine.updateLeagueSettingsOnServer([season], mockAdmin, 'LS-TEST', { maxPlayers: 5 })
    ).toThrow();
  });

  it('should reject entryFee > 500', () => {
    const season = makeSeason();
    expect(() =>
      leagueEngine.updateLeagueSettingsOnServer([season], mockAdmin, 'LS-TEST', { entryFee: 600 })
    ).toThrow();
  });

  it('should reject if not admin', () => {
    getUserById.mockReturnValue(mockPlayer);
    const season = makeSeason();
    expect(() =>
      leagueEngine.updateLeagueSettingsOnServer([season], mockPlayer, 'LS-TEST', { maxPlayers: 100 })
    ).toThrow();
  });

  it('should reject if not registering', () => {
    const season = makeSeason({ status: 'qualifying' });
    expect(() =>
      leagueEngine.updateLeagueSettingsOnServer([season], mockAdmin, 'LS-TEST', { maxPlayers: 100 })
    ).toThrow();
  });
});

describe('league-engine - getLeaguePayments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return payments for registered players', () => {
    getUserById.mockReturnValue({
      ...mockPlayer,
      wallet: { lockedEntries: { 'LS-TEST': { amount: 50, cashAmount: 40, bonusAmount: 10 } } },
    });
    const season = makeSeason({
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
    });
    const result = leagueEngine.getLeaguePayments([season], 'LS-TEST');
    expect(result).toHaveLength(1);
    expect(result[0].paid).toBe(true);
    expect(result[0].amount).toBe(50);
  });

  it('should mark unpaid if no locked entry', () => {
    getUserById.mockReturnValue({ ...mockPlayer, wallet: {} });
    const season = makeSeason({
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
    });
    const result = leagueEngine.getLeaguePayments([season], 'LS-TEST');
    expect(result[0].paid).toBe(false);
  });

  it('should throw if season not found', () => {
    expect(() => leagueEngine.getLeaguePayments([], 'LS-NOPE')).toThrow();
  });
});

describe('league-engine - refundLeaguePlayerOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should refund and remove player', async () => {
    const season = makeSeason({
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 50, bestPlacement: 3, matchesPlayed: 2, placements: [3, 5] }],
    });
    const result = await leagueEngine.refundLeaguePlayerOnServer([season], mockAdmin, 'LS-TEST', 'player-1');
    expect(result.season.registeredPlayers).toHaveLength(0);
    expect(result.season.standings).toHaveLength(0);
    expect(refundLockedEntry).toHaveBeenCalled();
  });

  it('should reject if player not in season', async () => {
    const season = makeSeason();
    await expect(leagueEngine.refundLeaguePlayerOnServer([season], mockAdmin, 'LS-TEST', 'player-1')).rejects.toThrow();
  });
});

describe('league-engine - reassignPlayerOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should move player between days', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'pending' },
        wednesday: { players: [], matchId: null, results: [], status: 'pending' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
    });
    const result = leagueEngine.reassignPlayerOnServer(
      [season], mockAdmin, 'LS-TEST', 'player-1', 'tuesday', 'wednesday'
    );
    expect(result.season.qualificationGroups.tuesday.players).not.toContain('player-1');
    expect(result.season.qualificationGroups.wednesday.players).toContain('player-1');
  });

  it('should reject if not qualifying', () => {
    const season = makeSeason({ status: 'registering' });
    expect(() =>
      leagueEngine.reassignPlayerOnServer([season], mockAdmin, 'LS-TEST', 'player-1', 'tuesday', 'wednesday')
    ).toThrow();
  });
});

describe('league-engine - advanceToFinalOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should advance to final with top 40', () => {
    const standings = Array.from({ length: 50 }, (_, i) => ({
      userId: `p-${i}`,
      pseudo: `Player${i}`,
      totalPoints: 500 - i * 10,
      bestPlacement: i + 1,
      matchesPlayed: 5,
      placements: [i + 1],
    }));
    const season = makeSeason({
      status: 'qualifying',
      standings,
      qualificationGroups: {
        tuesday: { players: [], matchId: null, results: [], status: 'finished' },
        wednesday: { players: [], matchId: null, results: [], status: 'finished' },
        thursday: { players: [], matchId: null, results: [], status: 'finished' },
        friday: { players: [], matchId: null, results: [], status: 'finished' },
        saturday: { players: [], matchId: null, results: [], status: 'finished' },
      },
    });
    const result = leagueEngine.advanceToFinalOnServer([season], mockAdmin, 'LS-TEST');
    expect(result.season.status).toBe('final');
    expect(result.season.finalists).toHaveLength(40);
    expect(result.season.finalists[0].userId).toBe('p-0');
  });

  it('should reject if not all days finished', () => {
    const season = makeSeason({
      status: 'qualifying',
      qualificationGroups: {
        tuesday: { players: [], matchId: null, results: [], status: 'finished' },
        wednesday: { players: [], matchId: null, results: [], status: 'live' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
    });
    expect(() => leagueEngine.advanceToFinalOnServer([season], mockAdmin, 'LS-TEST')).toThrow();
  });
});

describe('league-engine - Score Z System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should calculate Score Z = survival + kills for 1st place with 5 kills', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        wednesday: { players: [], matchId: null, results: [], status: 'pending' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] }],
    });

    const result = leagueEngine.submitLeagueDayResultsOnServer(
      [season], mockAdmin, 'LS-TEST', 'tuesday',
      [{ userId: 'player-1', placement: 1, kills: 5 }]
    );

    const dayResult = result.season.qualificationGroups.tuesday.results[0];
    expect(dayResult.survivalPoints).toBe(25);
    expect(dayResult.killPoints).toBe(10);
    expect(dayResult.points).toBe(35);

    const standing = result.season.standings.find((s) => s.userId === 'player-1');
    expect(standing.totalPoints).toBe(35);
  });

  it('should calculate Score Z for 10th place with 2 kills', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        wednesday: { players: [], matchId: null, results: [], status: 'pending' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] }],
    });

    const result = leagueEngine.submitLeagueDayResultsOnServer(
      [season], mockAdmin, 'LS-TEST', 'tuesday',
      [{ userId: 'player-1', placement: 10, kills: 2 }]
    );

    const dayResult = result.season.qualificationGroups.tuesday.results[0];
    expect(dayResult.survivalPoints).toBe(10);
    expect(dayResult.killPoints).toBe(4);
    expect(dayResult.points).toBe(14);
  });

  it('should accumulate Score Z across multiple days (3 lobbies)', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        wednesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        thursday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] }],
    });

    // Day 1: 3rd place, 3 kills = 17 + 6 = 23
    let result = leagueEngine.submitLeagueDayResultsOnServer(
      [season], mockAdmin, 'LS-TEST', 'tuesday',
      [{ userId: 'player-1', placement: 3, kills: 3 }]
    );
    expect(result.season.standings[0].totalPoints).toBe(23);

    // Day 2: 1st place, 8 kills = 25 + 16 = 41
    result = leagueEngine.submitLeagueDayResultsOnServer(
      result.seasons, mockAdmin, 'LS-TEST', 'wednesday',
      [{ userId: 'player-1', placement: 1, kills: 8 }]
    );
    expect(result.season.standings[0].totalPoints).toBe(64);

    // Day 3: 15th place, 1 kill = 6 + 2 = 8
    result = leagueEngine.submitLeagueDayResultsOnServer(
      result.seasons, mockAdmin, 'LS-TEST', 'thursday',
      [{ userId: 'player-1', placement: 15, kills: 1 }]
    );
    expect(result.season.standings[0].totalPoints).toBe(72);
  });

  it('should handle 0 kills (survival only)', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        wednesday: { players: [], matchId: null, results: [], status: 'pending' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] }],
    });

    const result = leagueEngine.submitLeagueDayResultsOnServer(
      [season], mockAdmin, 'LS-TEST', 'tuesday',
      [{ userId: 'player-1', placement: 25, kills: 0 }]
    );

    const dayResult = result.season.qualificationGroups.tuesday.results[0];
    expect(dayResult.survivalPoints).toBe(3);
    expect(dayResult.killPoints).toBe(0);
    expect(dayResult.points).toBe(3);
  });

  it('should reject results for unregistered player in day', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        wednesday: { players: [], matchId: null, results: [], status: 'pending' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] }],
    });

    expect(() =>
      leagueEngine.submitLeagueDayResultsOnServer(
        [season], mockAdmin, 'LS-TEST', 'tuesday',
        [{ userId: 'player-99', placement: 1, kills: 5 }]
      )
    ).toThrow();
  });

  it('should reject placement outside range 1-100', () => {
    const season = makeSeason({
      status: 'qualifying',
      registeredPlayers: [{ userId: 'player-1', pseudo: 'ShadowX', joinedAt: new Date().toISOString() }],
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
        wednesday: { players: [], matchId: null, results: [], status: 'pending' },
        thursday: { players: [], matchId: null, results: [], status: 'pending' },
        friday: { players: [], matchId: null, results: [], status: 'pending' },
        saturday: { players: [], matchId: null, results: [], status: 'pending' },
      },
      standings: [{ userId: 'player-1', pseudo: 'ShadowX', totalPoints: 0, bestPlacement: 0, matchesPlayed: 0, placements: [] }],
    });

    expect(() =>
      leagueEngine.submitLeagueDayResultsOnServer(
        [season], mockAdmin, 'LS-TEST', 'tuesday',
        [{ userId: 'player-1', placement: 0, kills: 5 }]
      )
    ).toThrow();

    expect(() =>
      leagueEngine.submitLeagueDayResultsOnServer(
        [season], mockAdmin, 'LS-TEST', 'tuesday',
        [{ userId: 'player-1', placement: 101, kills: 5 }]
      )
    ).toThrow();
  });

  it('should reject empty results array', () => {
    const season = makeSeason({
      status: 'qualifying',
      qualificationGroups: {
        tuesday: { players: ['player-1'], matchId: null, results: [], status: 'live' },
      },
    });

    expect(() =>
      leagueEngine.submitLeagueDayResultsOnServer(
        [season], mockAdmin, 'LS-TEST', 'tuesday', []
      )
    ).toThrow();
  });
});

describe('league-engine - assignPlayersToDays', () => {
  it('should distribute players across all 5 days', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const groups = leagueEngine.assignPlayersToDays(players);

    expect(Object.keys(groups)).toEqual(['tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
    const allAssigned = Object.values(groups).flat();
    expect(allAssigned.sort()).toEqual(players.sort());
  });

  it('should handle empty array', () => {
    const groups = leagueEngine.assignPlayersToDays([]);
    for (const day of Object.values(groups)) {
      expect(day).toEqual([]);
    }
  });

  it('should handle single player', () => {
    const groups = leagueEngine.assignPlayersToDays(['only-one']);
    const allAssigned = Object.values(groups).flat();
    expect(allAssigned).toEqual(['only-one']);
  });

  it('should not duplicate players across days', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
    const groups = leagueEngine.assignPlayersToDays(players);
    const allAssigned = Object.values(groups).flat();
    expect(new Set(allAssigned).size).toBe(players.length);
  });

  it('should distribute evenly when divisible by 5', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const groups = leagueEngine.assignPlayersToDays(players);
    for (const day of Object.values(groups)) {
      expect(day).toHaveLength(1);
    }
  });
});

describe('league-engine - submitLeagueFinalResultsOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should reject result for non-finalist', async () => {
    const season = makeSeason({
      status: 'final',
      finalists: [
        { userId: 'player-1', pseudo: 'ShadowX', totalPoints: 100, bestPlacement: 1 },
      ],
      finalMatch: { matchId: null, results: [], status: 'pending' },
    });

    await expect(
      leagueEngine.submitLeagueFinalResultsOnServer(
        [season], mockAdmin, 'LS-TEST',
        [{ userId: 'player-99', placement: 1, kills: 5 }]
      )
    ).rejects.toThrow();
  });

  it('should reject placement outside valid range', async () => {
    const season = makeSeason({
      status: 'final',
      finalists: [
        { userId: 'player-1', pseudo: 'ShadowX', totalPoints: 100, bestPlacement: 1 },
      ],
      finalMatch: { matchId: null, results: [], status: 'pending' },
    });

    await expect(
      leagueEngine.submitLeagueFinalResultsOnServer(
        [season], mockAdmin, 'LS-TEST',
        [{ userId: 'player-1', placement: 0, kills: 5 }]
      )
    ).rejects.toThrow();
  });

  it('should accept valid final results', async () => {
    const season = makeSeason({
      status: 'final',
      finalists: [
        { userId: 'player-1', pseudo: 'ShadowX', totalPoints: 100, bestPlacement: 1 },
        { userId: 'player-2', pseudo: 'Ghost', totalPoints: 80, bestPlacement: 2 },
      ],
      finalMatch: { matchId: null, results: [], status: 'pending' },
      payout: { gross: 200, first: 100, second: 60, third: 40 },
    });

    const result = await leagueEngine.submitLeagueFinalResultsOnServer(
      [season], mockAdmin, 'LS-TEST',
      [
        { userId: 'player-1', placement: 1, kills: 10 },
        { userId: 'player-2', placement: 2, kills: 5 },
      ]
    );

    expect(result.season.status).toBe('completed');
    expect(result.season.podium.first).toBe('player-1');
    expect(result.season.podium.second).toBe('player-2');
  });
});
