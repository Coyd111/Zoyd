import type { User } from '../stores/authStore';
import { authorizedGet, authorizedPost, authorizedPatch, getApiUrl } from './apiClient';

interface AuthResponse {
  ok: boolean;
  token?: string;
  user: User;
  expiresAt?: string;
  activationCode?: string;
  message?: string;
  requiresActivation?: boolean;
  email?: string;
}

interface ActivationResponse {
  ok: boolean;
  user: User;
  message: string;
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

export const registerWithBackend = async (payload: RegisterPayload): Promise<AuthResponse> => {
  return authorizedPost<AuthResponse>('/api/auth/register', payload);
};

export const loginWithBackend = async (identifier: string, password: string): Promise<AuthResponse> => {
  return authorizedPost<AuthResponse>('/api/auth/login', { identifier, password });
};

export const fetchCurrentUser = async (token?: string) => {
  if (token) {
    // Use the provided token directly for bootstrap
    const response = await fetch(getApiUrl('/api/auth/me'), {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await response.json();
    return data;
  }
  return authorizedGet<AuthResponse>('/api/auth/me');
};

export const logoutFromBackend = async () => {
  return authorizedPost<{ ok: boolean }>('/api/auth/logout');
};

export const updateServerAccount = async (updates: Partial<User>): Promise<{ ok: boolean; user: User }> => {
  return authorizedPatch<{ ok: boolean; user: User }>('/api/auth/me', updates);
};

export const activateAccount = async (email: string, code: string): Promise<ActivationResponse> => {
  const response = await fetch(getApiUrl('/api/auth/activate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await response.json();
  return data;
};
