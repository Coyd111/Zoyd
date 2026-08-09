import { create } from 'zustand';
import { useTrustScoreStore } from './trustScoreStore';

export type ControllerType = 'touch' | 'controller' | 'emulator' | 'pc' | 'other';
export type PlayerLevel = 'DEBUTANT' | 'COMPETITEUR' | 'CONFIRME' | 'VETERAN' | 'ELITE_ZOYD';
export type ArbiterLevel = 'NOVICE' | 'PREMIER_MATCH' | 'ACTIF' | 'REGULIER' | 'VETERAN' | 'ELITE';
export type UserRole = 'player' | 'arbiter' | 'organizer' | 'admin';

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  totalEarnings: number;
  winRate: number;
  tournamentsWon: number;
  tournamentsPlayed: number;
  elo: number;
  arbitratedMatches: number;
}

export interface User {
  id: string;
  role: UserRole;
  pseudo: string;
  email: string;
  phone: string;
  gameId: string; // Identifiant CODM unique (ex: 674292618xxxx)
  controllerType: ControllerType;
  device: 'phone' | 'tablet' | 'pc' | 'other';
  levelCODM: number;
  rankMJ: string;
  rankBR: string;
  country: string;
  streamerPseudo?: string;
  streamerMode: boolean;
  walletBalance: number;
  trustScore: number; // 0-100
  stats: UserStats;
  progression: {
    level: PlayerLevel;
    xp: number;
    nextLevelXp: number;
  };
  arbiterProgression: {
    level: ArbiterLevel;
    xp: number;
    nextLevelXp: number;
  };
  achievements: string[];
  bio?: string;
  dateJoined: string; // ISO date
  avatar?: string;
  isOnline: boolean;
  lastSeen?: string;
  notifications?: {
    matchStart: boolean;
    results: boolean;
    messages: boolean;
    tournaments: boolean;
    referrals: boolean;
  };
}


export interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  expiresAt: string | null;
  login: (user: User, sessionToken: string, expiresAt?: string) => void;
  hydrateSession: (user: User, sessionToken: string, expiresAt?: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateStats: (partial: Partial<UserStats>) => void;
}

const defaultStats: UserStats = {
  wins: 0,
  losses: 0,
  draws: 0,
  totalMatches: 0,
  totalEarnings: 0,
  winRate: 0,
  tournamentsWon: 0,
  tournamentsPlayed: 0,
  elo: 1200,
  arbitratedMatches: 0,
};

const normalizeUser = (user: User | null | undefined): User | null => {
  if (!user) return null;

  return {
    ...user,
    role: user.role ?? 'player',
  };
};

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  sessionToken: null,
  isAuthenticated: false,
  expiresAt: null,
  login: (user, sessionToken, expiresAt) => {
    const normalized = normalizeUser(user);
    useTrustScoreStore.getState().hydrateFromUser(normalized?.trustScore ?? 0);
    set({ user: normalized, sessionToken, isAuthenticated: true, expiresAt: expiresAt || null });
  },
  hydrateSession: (user, sessionToken, expiresAt) => {
    const normalized = normalizeUser(user);
    useTrustScoreStore.getState().hydrateFromUser(normalized?.trustScore ?? 0);
    set({ user: normalized, sessionToken, isAuthenticated: true, expiresAt: expiresAt || null });
  },
  logout: () => set({ user: null, sessionToken: null, isAuthenticated: false, expiresAt: null }),
  updateUser: (updates) => {
    set((state) => ({
      user: state.user ? normalizeUser({ ...state.user, ...updates }) : null,
    }));
    if (typeof updates.trustScore === 'number') {
      useTrustScoreStore.getState().hydrateFromUser(updates.trustScore);
    }
  },
  updateStats: (partial) =>
    set((state) => {
      if (!state.user) return state;
      const newStats = { ...state.user.stats, ...partial };
      const total = newStats.wins + newStats.losses + newStats.draws;
      newStats.winRate = total > 0 ? Math.round((newStats.wins / total) * 1000) / 10 : 0;
      newStats.totalMatches = total;
      return { user: { ...state.user, stats: newStats } };
    }),
}));
