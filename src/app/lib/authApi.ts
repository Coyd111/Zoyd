import type { User } from '../stores/authStore';

interface AuthResponse {
  ok: boolean;
  token: string;
  user: User;
  expiresAt: string;
}

export interface RegisterPayload {
  pseudo: string;
  email: string;
  phone: string;
  password: string;
  gameId: string;
  controllerType: User['controllerType'];
  device: User['device'];
  levelCODM: number;
  rankMJ: string;
  rankBR: string;
  country: string;
  streamerMode: boolean;
  streamerPseudo?: string;
}

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Une erreur reseau est survenue.');
  }

  return payload as T;
};

export const registerWithBackend = async (payload: RegisterPayload) =>
  readJson<AuthResponse>(
    await fetch(getApiUrl('/api/auth/register'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  );

export const loginWithBackend = async (identifier: string, password: string) =>
  readJson<AuthResponse>(
    await fetch(getApiUrl('/api/auth/login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier,
        password,
      }),
    })
  );

export const fetchCurrentUser = async (token: string) =>
  readJson<{ ok: boolean; user: User; expiresAt: string }>(
    await fetch(getApiUrl('/api/auth/me'), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  );

export const logoutFromBackend = async (token: string) =>
  readJson<{ ok: boolean }>(
    await fetch(getApiUrl('/api/auth/logout'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  );
