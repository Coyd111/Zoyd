import { useAuthStore } from '../stores/authStore';

let logoutQueued = false;

// M-01: Named VITE_REALTIME_URL because backend serves both REST API and Socket.io (realtime).
// This is the single backend URL for all communication.
export const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

export const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

export const getAuthHeaders = () => {
  // First try to get token from HttpOnly cookie
  const cookieToken = getCookie('zoyd_auth');
  
  // Fallback to store token (for backward compatibility)
  const storeToken = useAuthStore.getState().sessionToken;
  const expiresAt = useAuthStore.getState().expiresAt;
  
  const token = cookieToken || storeToken;
  
  if (!token) return {};

  // Check token expiration on client side — defer logout to avoid race conditions with parallel requests
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    if (!logoutQueued) {
      logoutQueued = true;
      queueMicrotask(() => {
        useAuthStore.getState().logout();
        logoutQueued = false;
      });
    }
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

// Helper to read cookie on client
const getCookie = (name: string): string | null => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
};

const handleAuthError = (status: number) => {
  if (status === 401 || status === 403) {
    if (!logoutQueued) {
      logoutQueued = true;
      queueMicrotask(() => { logoutQueued = false; useAuthStore.getState().logout(); });
    }
  }
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Solde insuffisant. Recharge ton portefeuille.',
  MATCH_CLOSED: 'Ce match est deja ferme.',
  ALREADY_JOINED: 'Tu es deja inscrit a ce match.',
  MATCH_NOT_FOUND: 'Match introuvable.',
  TOURNAMENT_NOT_FOUND: 'Tournoi introuvable.',
  LEAGUE_NOT_FOUND: 'Ligue introuvable.',
  PLAYER_NOT_FOUND: 'Joueur introuvable.',
  NOT_ENOUGH_PLAYERS: 'Pas assez de joueurs pour commencer.',
  REGISTRATION_CLOSED: 'Les inscriptions sont fermees.',
  NOT_JOINED: 'Tu n\'es pas inscrit.',
  MATCH_ALREADY_LIVE: 'Ce match est deja en cours.',
  INVALID_DAY: 'Journee invalide.',
  INVALID_RESULTS: 'Resultats invalides.',
  DUPLICATE_PSEUDO: 'Ce pseudo est deja utilise.',
  DUPLICATE_EMAIL: 'Cet email est deja utilise.',
  DUPLICATE_PHONE: 'Ce numero est deja utilise.',
  ARBITER_TAKEN: 'Un arbitre est deja assigne.',
  ROLE_CONFLICT: 'Conflit de role.',
  NO_SLOT_AVAILABLE: 'Aucune place disponible.',
  TRUST_REQUIRED: 'Score de confiance insuffisant.',
  DISPUTE_ALREADY_OPEN: 'Un dispute est deja ouvert.',
  RESULT_NOT_FOUND: 'Resultat introuvable.',
  RESULT_ALREADY_EXISTS: 'Un resultat a deja ete soumis.',
};

export const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    handleAuthError(response.status);
    
    if (response.status === 401) {
      throw new ApiError('Session expiree. Veuillez te reconnecter.', 'SESSION_EXPIRED', 401);
    }
    if (response.status === 403) {
      throw new ApiError('Acces refuse. Tu n\'as pas les permissions necessaires.', 'FORBIDDEN', 403);
    }
    
    const code = payload.code || 'UNKNOWN_ERROR';
    const message = payload.error || 'Une erreur reseau est survenue.';
    const friendlyMessage = ERROR_MESSAGES[code] || message;
    
    throw new ApiError(friendlyMessage, code, response.status);
  }

  return payload as T;
};

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const FETCH_TIMEOUT_MS = 30_000;

const authorizedRequest = async <T>(method: HttpMethod, path: string, body?: unknown) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await readJson<T>(
      await fetch(getApiUrl(path), {
        method,
        headers: {
          ...getAuthHeaders(),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

export const authorizedGet = <T>(path: string) => authorizedRequest<T>('GET', path);
export const authorizedPost = <T>(path: string, body?: unknown) => authorizedRequest<T>('POST', path, body);
export const authorizedPatch = <T>(path: string, body?: unknown) => authorizedRequest<T>('PATCH', path, body);
export const authorizedDelete = <T>(path: string) => authorizedRequest<T>('DELETE', path);
