import type { User } from '../stores/authStore';
import { authorizedGet, authorizedPost, authorizedPatch, getApiUrl } from './apiClient';

export interface AuthResponse {
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

interface RecoveryResponse {
  ok: boolean;
  message: string;
  activationCode?: string;
  resetCode?: string;
  delivery?: 'sent' | 'pending-provider';
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
    const { useAuthStore } = await import('../stores/authStore');
    const prev = useAuthStore.getState().sessionToken;
    useAuthStore.setState({ sessionToken: token });
    try {
      return await authorizedGet<AuthResponse>('/api/auth/me');
    } finally {
      useAuthStore.setState({ sessionToken: prev });
    }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(getApiUrl('/api/auth/activate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const postAuthRecovery = async (path: string, body: Record<string, string>): Promise<RecoveryResponse> => {
  const response = await fetch(getApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
};

export const resendActivationCode = (email: string): Promise<RecoveryResponse> =>
  postAuthRecovery('/api/auth/resend-code', { email });

export const changeActivationEmail = (oldEmail: string, newEmail: string): Promise<RecoveryResponse> =>
  postAuthRecovery('/api/auth/activation-email', { oldEmail, newEmail });
export const requestPasswordReset = (identifier: string): Promise<RecoveryResponse> =>
  postAuthRecovery('/api/auth/forgot-password', { identifier });

export const resetPasswordWithCode = (
  identifier: string,
  code: string,
  newPassword: string
): Promise<RecoveryResponse> =>
  postAuthRecovery('/api/auth/reset-password', { identifier, code, newPassword });

// ─── Admin TOTP 2FA ─────────────────────────────────────────────────────────

interface Admin2faStatusResponse {
  ok: boolean;
  enabled: boolean;
}

interface Admin2faSetupResponse {
  ok: boolean;
  otpauthUrl: string;
}

export const fetchAdmin2faStatus = async (): Promise<Admin2faStatusResponse> => {
  return authorizedGet<Admin2faStatusResponse>('/api/admin/2fa/status');
};

export const setupAdmin2fa = async (): Promise<Admin2faSetupResponse> => {
  return authorizedPost<Admin2faSetupResponse>('/api/admin/2fa/setup', {});
};

export const enableAdmin2fa = async (code: string): Promise<{ ok: boolean }> => {
  return authorizedPost<{ ok: boolean }>('/api/admin/2fa/enable', { code });
};

export const verifyAdmin2fa = async (code: string): Promise<{ ok: boolean }> => {
  return authorizedPost<{ ok: boolean }>('/api/admin/2fa/verify', { code });
};
