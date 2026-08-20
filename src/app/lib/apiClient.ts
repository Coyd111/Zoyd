import { useAuthStore } from '../stores/authStore';

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

  // Check token expiration on client side
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    useAuthStore.getState().logout();
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
    useAuthStore.getState().logout();
  }
};

export const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    handleAuthError(response.status);
    
    if (response.status === 401) {
      throw new Error('Session expiree. Veuillez te reconnecter.');
    }
    if (response.status === 403) {
      throw new Error('Acces refuse. Tu n\'as pas les permissions necessaires.');
    }
    
    throw new Error(payload.error || 'Une erreur reseau est survenue.');
  }

  return payload as T;
};

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const authorizedRequest = async <T>(method: HttpMethod, path: string, body?: unknown) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method,
      headers: {
        ...getAuthHeaders(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

export const authorizedGet = <T>(path: string) => authorizedRequest<T>('GET', path);
export const authorizedPost = <T>(path: string, body?: unknown) => authorizedRequest<T>('POST', path, body);
export const authorizedPatch = <T>(path: string, body?: unknown) => authorizedRequest<T>('PATCH', path, body);
export const authorizedDelete = <T>(path: string) => authorizedRequest<T>('DELETE', path);
