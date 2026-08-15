import { useAuthStore } from '../stores/authStore';

export const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

export const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

export const getAuthHeaders = () => {
  const token = useAuthStore.getState().sessionToken;
  const expiresAt = useAuthStore.getState().expiresAt;
  
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

const handleAuthError = (status: number) => {
  if (status === 401 || status === 403) {
    useAuthStore.getState().logout();
  }
};

export const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    handleAuthError(response.status);
    
    // Provide specific error messages for auth errors
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

export const authorizedGet = async <T>(path: string) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
      },
    })
  );

export const authorizedPost = async <T>(path: string, body?: unknown) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

export const authorizedPatch = async <T>(path: string, body?: unknown) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

export const authorizedDelete = async <T>(path: string) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders(),
      },
    })
  );
