/**
 * authStore - etat d'authentification : user, isAuthenticated, isLoading.
 *
 * Detient le profil du joueur connecte et le miroir expiresAt. Le token
 * lui-meme n'est JAMAIS en JavaScript : il vit dans le cookie httpOnly
 * `zoyd_auth`, envoye automatiquement par le navigateur.
 *
 * INVARIANT : cookie-only. Aucun token dans le store, le localStorage ou une
 * variable module : le client ne peut pas lire un cookie httpOnly.
 * INVARIANT : expiresAt n'est qu'un MIROIR. Ne jamais comparer expiresAt
 * cote client pour deconnecter : le serveur est l'autorite et tranche au
 * premier 401.
 * PIEGE : updateUser filtre les cles autorisees (allowedKeys). Ajouter un
 * champ sans l'y inscrire le fait silencieusement ignorer.
 * PIEGE : login et hydrateSession vident aussi le score de confiance
 * (trustScoreStore) : ne pas oublier cette propagation.
 * INVARIANT : un CHANGEMENT DE COMPTE purge les stores de session (solde,
 * matchs, chat, amis, notifications) AVANT d'ecrire le nouvel utilisateur.
 * Sans cette purge, la navbar affiche le solde du compte precedent et /wallet
 * son historique : la session du compte A a expire cote serveur, le front
 * n'a fait aucun appel API (donc aucun 401, donc aucune purge), et le joueur
 * se connecte avec B sur /auth/login.
 * PIEGE : authStore NE DOIT PAS importer sessionReset.ts : le cycle
 * apiClient -> sessionReset -> socketStore -> socketConnectionStore ->
 * realtimeClient -> apiClient se referme (documente dans apiClient.ts). La
 * purge passe par le REGISTRE sessionPurge.ts, qui n'importe rien.
 */
import { create } from 'zustand';
import { useTrustScoreStore } from './trustScoreStore';
import { purgeSessionStores } from '../lib/sessionPurge';

export type ControllerType = 'touch' | 'controller' | 'emulator' | 'pc' | 'other';
export type PlayerLevel = 'DÉBUTANT' | 'COMPETITEUR' | 'CONFIRME' | 'VETERAN' | 'ELITE_ZOYD';
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
  /**
   * Serment d'intégrité anti-triche (scellé une fois par compte, date par le
   * serveur). Absent = serment NON scellé : le gate d'intégrité s'affichera
   * à la première session authentifiée. `covenant.acceptedAt` est aussi le
   * sceau affiché sur le profil (promesse de la fenêtre F10).
   */
  covenant?: {
    acceptedAt: string;
    version: string;
  };
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
  isAuthenticated: boolean;
  isLoading: boolean;
  expiresAt: string | null;
  login: (user: User, expiresAt?: string) => void;
  hydrateSession: (user: User, expiresAt?: string) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateStats: (partial: Partial<UserStats>) => void;
}

const normalizeUser = (user: User | null | undefined): User | null => {
  if (!user) return null;
  return {
    ...user,
    role: user.role ?? 'player',
  };
};

/**
 * Purge l'etat de session du compte PRECEDENT, si le compte change.
 *
 * Le registre `sessionPurge.ts` porte la vraie purge (sessionReset), branche
 * au chargement de `useAuthSessionBootstrap` : `authStore` ne peut pas
 * l'appeler directement (cycle d'imports, cf. sessionReset.ts).
 *
 * INVARIANT : meme compte -> AUCUNE purge. Reconnecter le meme joueur ne
 * doit pas vider son portefeuille : ses donnees lui appartiennent, et le
 * bootstrap wallet les rafraichit de toute facon.
 */
const purgePreviousSession = (previousUserId: string | undefined, nextUserId: string | undefined) => {
  if (!previousUserId || !nextUserId) return;
  if (previousUserId === nextUserId) return;
  purgeSessionStores();
};

// Auth cookie-only : le token vit dans le cookie httpOnly `zoyd_auth`,
// jamais en JS (ni localStorage, ni mémoire). La session est revalidée
// au chargement via GET /api/auth/me (cookie envoyé automatiquement).
export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  expiresAt: null,
  login: (user, expiresAt) => {
    const normalized = normalizeUser(user);
    // Changement de compte : purge l'etat du compte PRECEDENT avant
    // d'ecrire le nouveau. Sans cette purge, le solde, l'historique, le
    // chat et les amis de A restent visibles chez B (appareil partage,
    // session de A expiree cote serveur sans appel API de la part du front).
    purgePreviousSession(get().user?.id, normalized?.id);
    useTrustScoreStore.getState().hydrateFromUser(normalized ?? {});
    set({ user: normalized, isAuthenticated: true, isLoading: false, expiresAt: expiresAt || null });
  },
  hydrateSession: (user, expiresAt) => {
    const normalized = normalizeUser(user);
    // Meme règle que `login` : l'hydratation remplace la session, donc un
    // changement d'identité purge l'etat du compte précédent.
    purgePreviousSession(get().user?.id, normalized?.id);
    useTrustScoreStore.getState().hydrateFromUser(normalized ?? {});
    set({ user: normalized, isAuthenticated: true, isLoading: false, expiresAt: expiresAt || null });
  },
  setLoading: (loading) => set({ isLoading: loading }),
  logout: () => {
    set({ user: null, isAuthenticated: false, isLoading: false, expiresAt: null });
  },
  updateUser: (updates) => {
    const allowedKeys = new Set([
      'pseudo', 'email', 'phone', 'walletBalance', 'trustScore',
      'isOnline', 'lastSeen', 'stats', 'progression', 'arbiterProgression', 'gameId',
      'country', 'controllerType', 'device', 'levelCODM', 'rankMJ',
      'rankBR', 'bio', 'streamerMode', 'streamerPseudo', 'notifications',
      // Serment d'intégrité : la réponse de POST /api/auth/covenant porte le
      // code serveur, sans lui le gate ne verrait jamais l'acceptation et
      // réapparaîtrait après chaque navigation (refresh du store).
      'covenant',
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
}));
