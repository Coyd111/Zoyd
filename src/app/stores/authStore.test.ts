/**
 * authStore.test.ts
 *
 * Tests for the auth Zustand store after the "backend-as-source-of-truth"
 * refactor. XP management, arbiter progression, and trust score adjustments
 * are no longer performed locally — they are computed by persistence.mjs and
 * pushed to the client via socket events / REST responses.
 *
 * What this store still owns:
 *   - login / hydrateSession / logout   : session lifecycle
 *   - updateUser                        : partial user field updates
 *   - updateStats                       : stat merging with win-rate recalc
 *
 * Progression data (xp, level, trustScore) is reflected via updateUser() once
 * the server sends the updated user object.
 *
 * TODO: Once socket events are wired up in socketStore, add integration tests
 * that verify updateUser() is called when the server emits xp_update events.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

// ---------------------------------------------------------------------------
// Shared mock user
// ---------------------------------------------------------------------------
const makeUser = (overrides = {}) => ({
  id: 'user1',
  role: 'player' as const,
  pseudo: 'TestUser',
  email: 'test@example.com',
  phone: '+22960000000',
  gameId: '674292618',
  controllerType: 'touch' as const,
  device: 'phone' as const,
  levelCODM: 150,
  rankMJ: 'Master',
  rankBR: 'Legendary',
  country: 'Benin',
  streamerMode: false,
  walletBalance: 100,
  trustScore: 85,
  stats: {
    wins: 10,
    losses: 5,
    draws: 2,
    totalMatches: 17,
    totalEarnings: 500,
    winRate: 58.8,
    tournamentsWon: 2,
    tournamentsPlayed: 5,
    elo: 1500,
    arbitratedMatches: 0,
  },
  progression: {
    level: 'CHALLENGER' as const,
    xp: 5000,
    nextLevelXp: 7000,
  },
  arbiterProgression: {
    level: 'NOVICE' as const,
    xp: 0,
    nextLevelXp: 1,
  },
  achievements: [],
  dateJoined: '2024-01-01',
  isOnline: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Authentication lifecycle
// ---------------------------------------------------------------------------
describe('authStore - Authentication', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, sessionToken: null, isAuthenticated: false });
  });

  it('should login user successfully', () => {
    const mockUser = makeUser();
    useAuthStore.getState().login(mockUser, 'session-token-123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.sessionToken).toBe('session-token-123');
    expect(state.isAuthenticated).toBe(true);
  });

  it('should hydrate session successfully', () => {
    const mockUser = makeUser();
    useAuthStore.getState().hydrateSession(mockUser, 'session-token-123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.sessionToken).toBe('session-token-123');
    expect(state.isAuthenticated).toBe(true);
  });

  it('should logout user successfully', () => {
    useAuthStore.getState().login(makeUser(), 'token');
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.sessionToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('should normalize user with missing role to "player"', () => {
    const userWithoutRole = makeUser({ role: undefined as any });
    useAuthStore.getState().login(userWithoutRole, 'token');

    expect(useAuthStore.getState().user?.role).toBe('player');
  });
});

// ---------------------------------------------------------------------------
// User field updates
// ---------------------------------------------------------------------------
describe('authStore - User Updates', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: makeUser(),
      sessionToken: 'token',
      isAuthenticated: true,
    });
  });

  it('should update individual user fields', () => {
    useAuthStore.getState().updateUser({ pseudo: 'UpdatedUser', trustScore: 90 });

    const state = useAuthStore.getState();
    expect(state.user?.pseudo).toBe('UpdatedUser');
    expect(state.user?.trustScore).toBe(90);
  });

  it('should not update when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().updateUser({ pseudo: 'UpdatedUser' });

    expect(useAuthStore.getState().user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stats updates
// ---------------------------------------------------------------------------
describe('authStore - Stats Updates', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: makeUser({
        stats: {
          wins: 10,
          losses: 5,
          draws: 2,
          totalMatches: 17,
          totalEarnings: 500,
          winRate: 58.8,
          tournamentsWon: 2,
          tournamentsPlayed: 5,
          elo: 1500,
          arbitratedMatches: 0,
        },
      }),
      sessionToken: 'token',
      isAuthenticated: true,
    });
  });

  it('should merge stats and recalculate win rate and totalMatches', () => {
    useAuthStore.getState().updateStats({ wins: 15, losses: 5 });

    const state = useAuthStore.getState();
    expect(state.user?.stats.wins).toBe(15);
    expect(state.user?.stats.losses).toBe(5);
    // totalMatches = wins + losses + draws = 15 + 5 + 2 = 22
    expect(state.user?.stats.totalMatches).toBe(22);
    // winRate = round(15/22 * 1000) / 10 = 68.2
    expect(state.user?.stats.winRate).toBe(68.2);
  });

  it('should not update stats when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().updateStats({ wins: 99 });

    expect(useAuthStore.getState().user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Progression reflection via updateUser()
// The server computes XP and levels; the frontend reflects the result via
// updateUser() when it receives the updated user object from the backend.
// ---------------------------------------------------------------------------
describe('authStore - Server-Driven Progression Reflection', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: makeUser({
        progression: { level: 'DEBUTANT' as const, xp: 5, nextLevelXp: 8 },
        arbiterProgression: { level: 'NOVICE' as const, xp: 0, nextLevelXp: 1 },
        trustScore: 85,
      }),
      sessionToken: 'token',
      isAuthenticated: true,
    });
  });

  it('should reflect player level-up when server sends updated progression', () => {
    // Simulate the server responding with a new progression object after a match
    useAuthStore.getState().updateUser({
      progression: { level: 'COMPETITEUR', xp: 8, nextLevelXp: 30 },
    });

    const state = useAuthStore.getState();
    expect(state.user?.progression.level).toBe('COMPETITEUR');
    expect(state.user?.progression.xp).toBe(8);
  });

  it('should reflect arbiter level-up when server sends updated arbiterProgression', () => {
    useAuthStore.getState().updateUser({
      arbiterProgression: { level: 'ACTIF', xp: 6, nextLevelXp: 20 },
    });

    const state = useAuthStore.getState();
    expect(state.user?.arbiterProgression.level).toBe('ACTIF');
    expect(state.user?.arbiterProgression.xp).toBe(6);
  });

  it('should reflect trust score change when server sends updated score', () => {
    // Server increases trust score after a clean arbitation
    useAuthStore.getState().updateUser({ trustScore: 95 });
    expect(useAuthStore.getState().user?.trustScore).toBe(95);

    // Server decreases trust score after a dispute
    useAuthStore.getState().updateUser({ trustScore: 75 });
    expect(useAuthStore.getState().user?.trustScore).toBe(75);
  });

  it('should reflect arbiter penalty (25% score loss) from server', () => {
    // Before penalty: xp = 60 (VETERAN level)
    useAuthStore.getState().updateUser({
      arbiterProgression: { level: 'VETERAN', xp: 60, nextLevelXp: 100 },
    });

    // Server calculates 60 * 0.75 = 45 (REGULIER level) and sends the result
    useAuthStore.getState().updateUser({
      arbiterProgression: { level: 'REGULIER', xp: 45, nextLevelXp: 60 },
    });

    const state = useAuthStore.getState();
    expect(state.user?.arbiterProgression.xp).toBe(45);
    expect(state.user?.arbiterProgression.level).toBe('REGULIER');
  });

  it('should not update when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().updateUser({ trustScore: 100 });

    expect(useAuthStore.getState().user).toBeNull();
  });
});
