import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
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

// Import after mocking
import * as matchEngine from './match-engine.mjs';

describe('match-engine - XP Progression', () => {
  it('should add XP and stay at same level when below threshold', () => {
    const progression = { level: 'BEGINNER', xp: 500, nextLevelXp: 1000 };
    const result = matchEngine.addXpToProgression(progression, 300);
    
    expect(result.xp).toBe(800);
    expect(result.level).toBe('BEGINNER');
    expect(result.nextLevelXp).toBe(1000);
  });

  it('should level up when XP reaches threshold', () => {
    const progression = { level: 'BEGINNER', xp: 900, nextLevelXp: 1000 };
    const result = matchEngine.addXpToProgression(progression, 100);
    
    expect(result.xp).toBe(1000);
    expect(result.level).toBe('COMPETITOR');
    expect(result.nextLevelXp).toBe(3000);
  });

  it('should level up multiple levels if XP jumps thresholds', () => {
    const progression = { level: 'BEGINNER', xp: 500, nextLevelXp: 1000 };
    const result = matchEngine.addXpToProgression(progression, 3000);
    
    expect(result.xp).toBe(3500);
    expect(result.level).toBe('CHALLENGER');
    expect(result.nextLevelXp).toBe(7000);
  });

  it('should handle progression from COMPETITOR to CHALLENGER', () => {
    const progression = { level: 'COMPETITOR', xp: 2500, nextLevelXp: 3000 };
    const result = matchEngine.addXpToProgression(progression, 600);
    
    expect(result.xp).toBe(3100);
    expect(result.level).toBe('CHALLENGER');
    expect(result.nextLevelXp).toBe(7000);
  });

  it('should handle progression from CHALLENGER to ELITE', () => {
    const progression = { level: 'CHALLENGER', xp: 6500, nextLevelXp: 7000 };
    const result = matchEngine.addXpToProgression(progression, 600);
    
    expect(result.xp).toBe(7100);
    expect(result.level).toBe('ELITE');
    expect(result.nextLevelXp).toBe(15000);
  });

  it('should handle progression from ELITE to PRO', () => {
    const progression = { level: 'ELITE', xp: 14000, nextLevelXp: 15000 };
    const result = matchEngine.addXpToProgression(progression, 1000);
    
    expect(result.xp).toBe(15000);
    expect(result.level).toBe('PRO');
    expect(result.nextLevelXp).toBe(Infinity);
  });

  it('should handle undefined progression', () => {
    const result = matchEngine.addXpToProgression(undefined, 500);
    
    expect(result.xp).toBe(500);
    expect(result.level).toBe('BEGINNER');
    expect(result.nextLevelXp).toBe(1000);
  });
});

describe('match-engine - Elo Ranking', () => {
  it('should return Bronze for Elo < 1200', () => {
    expect(matchEngine.getRankFromElo(1100)).toBe('Bronze');
    expect(matchEngine.getRankFromElo(1199)).toBe('Bronze');
  });

  it('should return Silver for Elo 1200-1399', () => {
    expect(matchEngine.getRankFromElo(1200)).toBe('Silver');
    expect(matchEngine.getRankFromElo(1300)).toBe('Silver');
    expect(matchEngine.getRankFromElo(1399)).toBe('Silver');
  });

  it('should return Gold for Elo 1400-1599', () => {
    expect(matchEngine.getRankFromElo(1400)).toBe('Gold');
    expect(matchEngine.getRankFromElo(1500)).toBe('Gold');
    expect(matchEngine.getRankFromElo(1599)).toBe('Gold');
  });

  it('should return Platinum for Elo 1600-1799', () => {
    expect(matchEngine.getRankFromElo(1600)).toBe('Platinum');
    expect(matchEngine.getRankFromElo(1700)).toBe('Platinum');
    expect(matchEngine.getRankFromElo(1799)).toBe('Platinum');
  });

  it('should return Diamond for Elo 1800-1999', () => {
    expect(matchEngine.getRankFromElo(1800)).toBe('Diamond');
    expect(matchEngine.getRankFromElo(1900)).toBe('Diamond');
    expect(matchEngine.getRankFromElo(1999)).toBe('Diamond');
  });

  it('should return Master for Elo >= 2000', () => {
    expect(matchEngine.getRankFromElo(2000)).toBe('Master');
    expect(matchEngine.getRankFromElo(2500)).toBe('Master');
    expect(matchEngine.getRankFromElo(3000)).toBe('Master');
  });
});

describe('match-engine - Helper Functions', () => {
  it('should calculate team size from format', () => {
    expect(matchEngine.getTeamSize('1VS1')).toBe(1);
    expect(matchEngine.getTeamSize('2VS2')).toBe(2);
    expect(matchEngine.getTeamSize('3VS3')).toBe(3);
    expect(matchEngine.getTeamSize('5VS5')).toBe(5);
  });

  it('should get squad label', () => {
    expect(matchEngine.getSquadLabel(0)).toBe('Squad Alpha');
    expect(matchEngine.getSquadLabel(1)).toBe('Squad Bravo');
  });

  it('should get preferred team when both teams have space', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 1 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, null)).toBe(0);
  });

  it('should get preferred team when team 0 is full', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 0 },
        { userId: '3', team: 1 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, null)).toBe(1);
  });

  it('should return null when both teams are full', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 0 },
        { userId: '3', team: 1 },
        { userId: '4', team: 1 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, null)).toBe(null);
  });

  it('should respect preferred team when available', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, 1)).toBe(1);
  });
});

describe('match-engine - Match Status', () => {
  it('should return disputed when open dispute exists', () => {
    const match = {
      status: 'ready',
      disputes: [{ status: 'open', reason: 'test' }],
      players: [],
      maxPlayers: 4,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('disputed');
  });

  it('should return disputed when under_review dispute exists', () => {
    const match = {
      status: 'ready',
      disputes: [{ status: 'under_review', reason: 'test' }],
      players: [],
      maxPlayers: 4,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('disputed');
  });

  it('should return finished when result exists', () => {
    const match = {
      status: 'ready',
      disputes: [],
      result: { winnerTeam: 0 },
      players: [],
      maxPlayers: 4,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('finished');
  });

  it('should return recruiting when not all players present', () => {
    const match = {
      status: 'recruiting',
      disputes: [],
      players: [{ userId: '1' }],
      maxPlayers: 4,
      arbiter: null,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('recruiting');
  });

  it('should return full when all players present but no arbiter', () => {
    const match = {
      status: 'recruiting',
      disputes: [],
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 0 },
        { userId: '3', team: 1 },
        { userId: '4', team: 1 },
      ],
      maxPlayers: 4,
      arbiter: null,
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('full');
  });

  it('should return check_in when not all players checked in', () => {
    const match = {
      status: 'full',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true },
        { userId: '2', team: 0, isCheckedIn: false },
        { userId: '3', team: 1, isCheckedIn: true },
        { userId: '4', team: 1, isCheckedIn: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('check_in');
  });

  it('should return check_in when not all players ready', () => {
    const match = {
      status: 'full',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true, isReady: true },
        { userId: '2', team: 0, isCheckedIn: true, isReady: false },
        { userId: '3', team: 1, isCheckedIn: true, isReady: true },
        { userId: '4', team: 1, isCheckedIn: true, isReady: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('check_in');
  });

  it('should return ready when all checked in and ready', () => {
    const match = {
      status: 'full',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true, isReady: true },
        { userId: '2', team: 0, isCheckedIn: true, isReady: true },
        { userId: '3', team: 1, isCheckedIn: true, isReady: true },
        { userId: '4', team: 1, isCheckedIn: true, isReady: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('ready');
  });

  it('should return in_progress when status is in_progress', () => {
    const match = {
      status: 'in_progress',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true, isReady: true },
        { userId: '2', team: 0, isCheckedIn: true, isReady: true },
        { userId: '3', team: 1, isCheckedIn: true, isReady: true },
        { userId: '4', team: 1, isCheckedIn: true, isReady: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('in_progress');
  });
});

describe('match-engine - Winner Payout', () => {
  it('should calculate winner payout correctly', () => {
    const match = {
      prizePool: 100,
      zoydFee: 5,
      arbiterFee: 2,
    };
    expect(matchEngine.getWinnerPayout(match)).toBe(93);
  });

  it('should handle zero fees', () => {
    const match = {
      prizePool: 100,
      zoydFee: 0,
      arbiterFee: 0,
    };
    expect(matchEngine.getWinnerPayout(match)).toBe(100);
  });

  it('should handle negative payout (floor at 0)', () => {
    const match = {
      prizePool: 10,
      zoydFee: 8,
      arbiterFee: 5,
    };
    expect(matchEngine.getWinnerPayout(match)).toBe(0);
  });
});
