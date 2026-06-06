import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ControllerType = 'touch' | 'controller' | 'emulator' | 'pc' | 'other';
export type PlayerLevel = 'BEGINNER' | 'COMPETITOR' | 'CHALLENGER' | 'ELITE' | 'PRO';
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
  achievements: string[];
  bio?: string;
  dateJoined: string; // ISO date
  avatar?: string;
  isOnline: boolean;
  lastSeen?: string;
}

type PersistedUser = Omit<User, 'role'> & { role?: UserRole };

export interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  login: (user: User, sessionToken: string) => void;
  hydrateSession: (user: User, sessionToken: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateStats: (partial: Partial<UserStats>) => void;
  addXp: (amount: number) => void;
  adjustTrustScore: (delta: number) => void;
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
};

const normalizeUser = (user: PersistedUser | User | null | undefined): User | null => {
  if (!user) return null;

  return {
    ...user,
    role: user.role ?? 'player',
  };
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      sessionToken: null,
      isAuthenticated: false,
      login: (user, sessionToken) => set({ user: normalizeUser(user), sessionToken, isAuthenticated: true }),
      hydrateSession: (user, sessionToken) => set({ user: normalizeUser(user), sessionToken, isAuthenticated: true }),
      logout: () => set({ user: null, sessionToken: null, isAuthenticated: false }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? normalizeUser({ ...state.user, ...updates }) : null,
        })),
      updateStats: (partial) =>
        set((state) => {
          if (!state.user) return state;
          const newStats = { ...state.user.stats, ...partial };
          // Recalcul auto du winRate
          const total = newStats.wins + newStats.losses + newStats.draws;
          newStats.winRate = total > 0 ? Math.round((newStats.wins / total) * 1000) / 10 : 0;
          newStats.totalMatches = total;
          return { user: { ...state.user, stats: newStats } };
        }),
      addXp: (amount) =>
        set((state) => {
          if (!state.user) return state;
          let { xp, level, nextLevelXp } = state.user.progression;
          xp += amount;
          // Système de niveaux simple
          const levelThresholds: Record<PlayerLevel, number> = {
            BEGINNER: 1000,
            COMPETITOR: 3000,
            CHALLENGER: 7000,
            ELITE: 15000,
            PRO: Infinity,
          };
          const levels: PlayerLevel[] = ['BEGINNER', 'COMPETITOR', 'CHALLENGER', 'ELITE', 'PRO'];
          const currentIdx = levels.indexOf(level);
          if (currentIdx < levels.length - 1 && xp >= levelThresholds[level]) {
            level = levels[currentIdx + 1];
          }
          nextLevelXp = levelThresholds[level];
          return {
            user: {
              ...state.user,
              progression: { xp, level, nextLevelXp },
            },
          };
        }),
      adjustTrustScore: (delta) =>
        set((state) => {
          if (!state.user) return state;
          const newScore = Math.max(0, Math.min(100, state.user.trustScore + delta));
          return { user: { ...state.user, trustScore: newScore } };
        }),
    }),
    {
      name: 'zoyd-auth',
      merge: (persistedState, currentState) => {
        const typedState = persistedState as Partial<AuthState> & {
          user?: PersistedUser | null;
        };
        const sessionToken = typedState.sessionToken ?? null;
        const normalizedUser = sessionToken ? normalizeUser(typedState.user ?? currentState.user) : null;

        return {
          ...currentState,
          ...typedState,
          user: normalizedUser,
          sessionToken,
          isAuthenticated: Boolean(sessionToken && normalizedUser),
        };
      },
    }
  )
);
