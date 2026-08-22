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
  gameId: string;
  controllerType: ControllerType;
  device: 'phone' | 'tablet' | 'pc' | 'other';
  levelCODM: number;
  rankMJ: string;
  rankBR: string;
  country: string;
  streamerPseudo?: string;
  streamerMode: boolean;
  walletBalance: number;
  trustScore: number;
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
  dateJoined: string;
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

const STORAGE_KEY_ZOYD_TOKEN = 'zoyd_session_token';
const STORAGE_KEY_ZOYD_EXPIRES = 'zoyd_session_expires';

function persistSession(token: string, expiresAt: string | null) {
  try {
    sessionStorage.setItem(STORAGE_KEY_ZOYD_TOKEN, token);
    if (expiresAt) sessionStorage.setItem(STORAGE_KEY_ZOYD_EXPIRES, expiresAt);
  } catch { /* storage full or blocked */ }
}

function readPersistedSession(): { token: string | null; expiresAt: string | null } {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY_ZOYD_TOKEN);
    const expiresAt = sessionStorage.getItem(STORAGE_KEY_ZOYD_EXPIRES);
    if (!token) return { token: null, expiresAt: null };
    
    // Validate token format — accept any non-empty alphanumeric string
    if (typeof token !== 'string' || token.length < 10 || token.length > 512) {
      clearPersistedSession();
      return { token: null, expiresAt: null };
    }
    
    if (expiresAt && new Date(expiresAt) < new Date()) {
      clearPersistedSession();
      return { token: null, expiresAt: null };
    }
    return { token, expiresAt };
  } catch {
    return { token: null, expiresAt: null };
  }
}

function clearPersistedSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_ZOYD_TOKEN);
    sessionStorage.removeItem(STORAGE_KEY_ZOYD_EXPIRES);
    localStorage.removeItem(STORAGE_KEY_ZOYD_TOKEN);
    localStorage.removeItem(STORAGE_KEY_ZOYD_EXPIRES);
  } catch { /* ok */ }
}

export interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  expiresAt: string | null;
  login: (user: User, sessionToken: string, expiresAt?: string) => void;
  hydrateSession: (user: User, sessionToken: string, expiresAt?: string) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateStats: (partial: Partial<UserStats>) => void;
  getPersistedToken: () => string | null;
}

const normalizeUser = (user: User | null | undefined): User | null => {
  if (!user) return null;
  return {
    ...user,
    role: user.role ?? 'player',
  };
};

// Hydrate from storage on module load
const initialSession = readPersistedSession();

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  sessionToken: initialSession.token,
  isAuthenticated: false,
  isLoading: !!initialSession.token,
  expiresAt: initialSession.expiresAt,
  login: (user, sessionToken, expiresAt) => {
    const normalized = normalizeUser(user);
    useTrustScoreStore.getState().hydrateFromUser(normalized ?? {});
    persistSession(sessionToken, expiresAt || null);
    set({ user: normalized, sessionToken, isAuthenticated: true, isLoading: false, expiresAt: expiresAt || null });
  },
  hydrateSession: (user, sessionToken, expiresAt) => {
    const normalized = normalizeUser(user);
    useTrustScoreStore.getState().hydrateFromUser(normalized ?? {});
    set({ user: normalized, sessionToken, isAuthenticated: true, isLoading: false, expiresAt: expiresAt || null });
  },
  setLoading: (loading) => set({ isLoading: loading }),
  logout: () => {
    clearPersistedSession();
    set({ user: null, sessionToken: null, isAuthenticated: false, isLoading: false, expiresAt: null });
  },
  updateUser: (updates) => {
    const allowedKeys = new Set([
      'pseudo', 'email', 'phone', 'walletBalance', 'trustScore',
      'isOnline', 'lastSeen', 'stats', 'progression', 'arbiterProgression', 'gameId',
      'country', 'controllerType', 'device', 'levelCODM', 'rankMJ',
      'rankBR', 'bio', 'streamerMode', 'streamerPseudo', 'notifications',
    ]);
    const safeUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.has(key)) safeUpdates[key] = value;
    }
    set((state) => ({
      user: state.user ? normalizeUser({ ...state.user, ...safeUpdates }) : null,
    }));
    if (typeof updates.trustScore === 'number') {
      useTrustScoreStore.getState().hydrateFromUser(updates);
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
  getPersistedToken: () => readPersistedSession().token,
}));
