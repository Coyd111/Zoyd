import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

describe('authStore - Authentication', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      sessionToken: null,
      isAuthenticated: false,
    });
  });

  it('should login user successfully', () => {
    const mockUser = {
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
      },
      progression: {
        level: 'CHALLENGER' as const,
        xp: 5000,
        nextLevelXp: 7000,
      },
      achievements: [],
      dateJoined: '2024-01-01',
      isOnline: true,
    };

    useAuthStore.getState().login(mockUser, 'session-token-123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.sessionToken).toBe('session-token-123');
    expect(state.isAuthenticated).toBe(true);
  });

  it('should hydrate session successfully', () => {
    const mockUser = {
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
      },
      progression: {
        level: 'CHALLENGER' as const,
        xp: 5000,
        nextLevelXp: 7000,
      },
      achievements: [],
      dateJoined: '2024-01-01',
      isOnline: true,
    };

    useAuthStore.getState().hydrateSession(mockUser, 'session-token-123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.sessionToken).toBe('session-token-123');
    expect(state.isAuthenticated).toBe(true);
  });

  it('should logout user successfully', () => {
    const mockUser = {
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
      },
      progression: {
        level: 'CHALLENGER' as const,
        xp: 5000,
        nextLevelXp: 7000,
      },
      achievements: [],
      dateJoined: '2024-01-01',
      isOnline: true,
    };

    useAuthStore.getState().login(mockUser, 'session-token-123');
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.sessionToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('should normalize user with missing role', () => {
    const mockUser = {
      id: 'user1',
      role: undefined as any,
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
      },
      progression: {
        level: 'CHALLENGER' as const,
        xp: 5000,
        nextLevelXp: 7000,
      },
      achievements: [],
      dateJoined: '2024-01-01',
      isOnline: true,
    };

    useAuthStore.getState().login(mockUser, 'session-token-123');

    const state = useAuthStore.getState();
    expect(state.user?.role).toBe('player');
  });
});

describe('authStore - User Updates', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
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
        },
        progression: {
          level: 'CHALLENGER' as const,
          xp: 5000,
          nextLevelXp: 7000,
        },
        achievements: [],
        dateJoined: '2024-01-01',
        isOnline: true,
      },
      sessionToken: 'session-token-123',
      isAuthenticated: true,
    });
  });

  it('should update user fields', () => {
    useAuthStore.getState().updateUser({ pseudo: 'UpdatedUser', trustScore: 90 });

    const state = useAuthStore.getState();
    expect(state.user?.pseudo).toBe('UpdatedUser');
    expect(state.user?.trustScore).toBe(90);
  });

  it('should not update when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().updateUser({ pseudo: 'UpdatedUser' });

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });
});

describe('authStore - Stats Updates', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
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
        },
        progression: {
          level: 'CHALLENGER' as const,
          xp: 5000,
          nextLevelXp: 7000,
        },
        achievements: [],
        dateJoined: '2024-01-01',
        isOnline: true,
      },
      sessionToken: 'session-token-123',
      isAuthenticated: true,
    });
  });

  it('should update stats and recalculate win rate', () => {
    useAuthStore.getState().updateStats({ wins: 15, losses: 5 });

    const state = useAuthStore.getState();
    expect(state.user?.stats.wins).toBe(15);
    expect(state.user?.stats.losses).toBe(5);
    expect(state.user?.stats.totalMatches).toBe(22);
    expect(state.user?.stats.winRate).toBe(68.2);
  });

  it('should not update when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().updateStats({ wins: 15 });

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });
});

describe('authStore - XP Progression', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
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
        },
        progression: {
          level: 'BEGINNER' as const,
          xp: 500,
          nextLevelXp: 1000,
        },
        achievements: [],
        dateJoined: '2024-01-01',
        isOnline: true,
      },
      sessionToken: 'session-token-123',
      isAuthenticated: true,
    });
  });

  it('should add XP without leveling up', () => {
    useAuthStore.getState().addXp(300);

    const state = useAuthStore.getState();
    expect(state.user?.progression.xp).toBe(800);
    expect(state.user?.progression.level).toBe('BEGINNER');
    expect(state.user?.progression.nextLevelXp).toBe(1000);
  });

  it('should level up when XP reaches threshold', () => {
    useAuthStore.getState().addXp(500);

    const state = useAuthStore.getState();
    expect(state.user?.progression.xp).toBe(1000);
    expect(state.user?.progression.level).toBe('COMPETITOR');
    expect(state.user?.progression.nextLevelXp).toBe(3000);
  });

  it('should level up multiple levels if XP jumps thresholds', () => {
    useAuthStore.getState().addXp(3000);

    const state = useAuthStore.getState();
    expect(state.user?.progression.xp).toBe(3500);
    expect(state.user?.progression.level).toBe('CHALLENGER');
    expect(state.user?.progression.nextLevelXp).toBe(7000);
  });

  it('should not update when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().addXp(100);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });
});

describe('authStore - Trust Score', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
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
        },
        progression: {
          level: 'CHALLENGER' as const,
          xp: 5000,
          nextLevelXp: 7000,
        },
        achievements: [],
        dateJoined: '2024-01-01',
        isOnline: true,
      },
      sessionToken: 'session-token-123',
      isAuthenticated: true,
    });
  });

  it('should increase trust score', () => {
    useAuthStore.getState().adjustTrustScore(10);

    const state = useAuthStore.getState();
    expect(state.user?.trustScore).toBe(95);
  });

  it('should decrease trust score', () => {
    useAuthStore.getState().adjustTrustScore(-10);

    const state = useAuthStore.getState();
    expect(state.user?.trustScore).toBe(75);
  });

  it('should cap trust score at 100', () => {
    useAuthStore.getState().adjustTrustScore(20);

    const state = useAuthStore.getState();
    expect(state.user?.trustScore).toBe(100);
  });

  it('should floor trust score at 0', () => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, trustScore: 5 } });
    useAuthStore.getState().adjustTrustScore(-10);

    const state = useAuthStore.getState();
    expect(state.user?.trustScore).toBe(0);
  });

  it('should not update when user is null', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().adjustTrustScore(10);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });
});
