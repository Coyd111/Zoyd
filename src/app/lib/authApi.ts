/**
 * authApi - appels REST d'authentification : inscription, login, activation,
 * reinitialisation, 2FA.
 *
 * Client dedie du domaine compte. C'est aussi la que se trouve la
 * verification du code TOTP admin (verifyAdmin2fa).
 *
 * INVARIANT : cookie-only. Le `token` que renvoie le serveur n'est pas a
 * stocker en JavaScript : le cookie httpOnly fait foi. Le champ token de la
 * reponse reste dans le type pour compatibilite, pas pour etre utilise.
 * PIEGE : la 2FA admin est une BARRIERE SERVEUR. verifyAdmin2fa n'est qu'un
 * garde d'UX cote front : la vraie verification est faite par
 * requireAdmin2fa sur /api/admin/*.
 * PIEGE : l'inscription peut renvoyer un code d'activation a saisir dans une
 * autre page : ne pas enchainer l'activation automatiquement.
 *
 * Voir aussi : docs/08-frontend.md - section 5 (Les gardes client)
 */
import type { User } from '../stores/authStore';
import { authorizedGet, authorizedPost, authorizedPatch, authorizedDelete, getApiUrl } from './apiClient';

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
  found?: boolean;
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
  acceptAdult?: boolean;
  acceptTerms?: boolean;
}

export const registerWithBackend = async (payload: RegisterPayload): Promise<AuthResponse> => {
  return authorizedPost<AuthResponse>('/api/auth/register', payload);
};

export const loginWithBackend = async (identifier: string, password: string): Promise<AuthResponse> => {
  return authorizedPost<AuthResponse>('/api/auth/login', { identifier, password });
};

export const fetchCurrentUser = async () => {
  return authorizedGet<AuthResponse>('/api/auth/me');
};

export const logoutFromBackend = async () => {
  return authorizedPost<{ ok: boolean }>('/api/auth/logout');
};

export const updateServerAccount = async (
  updates: Partial<User> & { currentPassword?: string }
): Promise<{ ok: boolean; user: User }> => {
  return authorizedPatch<{ ok: boolean; user: User }>('/api/auth/me', updates);
};

/**
 * Serment d'intégrité — version du texte scellé.
 *
 * Le même littéral vit côté serveur (`server/persistence.mjs` COVENANT_VERSION,
 * avec le commentaire croisé). Changer d'abord la version SERVEUR, ensuite
 * celle-ci, dans le même commit : un client qui posterait une version inconnue
 * du serveur ne serait scellé qu'à la version du serveur.
 *
 * INVARIANT : la requête ne transporte JAMAIS les réponses OUI/NON des
 * fenêtres — uniquement `{ version }` + le signalement optionnel. Côté base,
 * seule la date d'acceptation est consignée (`user.covenant.acceptedAt`) :
 * aucun aveu, aucune trace nominative d'aveu.
 */
export const COVENANT_VERSION = '2026-11-04';

export interface CovenantReport {
  pseudo: string;
  note?: string;
}

export interface CovenantResponse {
  ok: boolean;
  user: User;
  already: boolean;
  /** Le signalement F7 a été écrit côté serveur (anonyme). */
  signalRegistered: boolean;
}

/**
 * Scelle le serment d'intégrité (fin des fenêtres F1..F10, IntegrityCovenantModal).
 * Le serveur date l'acceptation, répond le user fraîchement écrit, et rejoue
 * `already: true` sur un rejeu — le client ne détermine RIEN de ce qui est
 * stocké.
 */
export const submitCovenant = async (
  version: string,
  report?: CovenantReport
): Promise<CovenantResponse> =>
  authorizedPost<CovenantResponse>('/api/auth/covenant', report ? { version, report } : { version });

export const deleteOwnAccount = async (currentPassword: string): Promise<{ ok: boolean; message: string }> => {
  return authorizedDelete<{ ok: boolean; message: string }>('/api/auth/me', { confirmForfeit: true, currentPassword });
};

export const activateAccount = async (email: string, code: string): Promise<ActivationResponse> => {
  return postUnauthenticated<ActivationResponse>('/api/auth/activate', { email, code }, 15000);
};

const postUnauthenticated = async <T>(
  path: string,
  body: Record<string, string>,
  timeoutMs = 30000
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getApiUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
};

const postAuthRecovery = async (path: string, body: Record<string, string>): Promise<RecoveryResponse> =>
  postUnauthenticated<RecoveryResponse>(path, body);

export const resendActivationCode = (email: string): Promise<RecoveryResponse> =>
  postAuthRecovery('/api/auth/resend-code', { email });

// A-3 (audit-5) : le serveur exige la preuve de possession (mot de passe actuel
// du compte) pour reorienter l'email d'un compte inactif. La reponse est
// generique (OK sans detail) que le compte existe ou non — P13 C14.
export const changeActivationEmail = (oldEmail: string, newEmail: string, password: string): Promise<RecoveryResponse> =>
  postAuthRecovery('/api/auth/activation-email', { oldEmail, newEmail, password });
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
  /** Horodatage serveur au moment de la reponse, en ms. */
  serverTime?: number;
  /** Duree de validite d'un code, en secondes. */
  period?: number;
}

interface Admin2faSetupResponse {
  ok: boolean;
  otpauthUrl: string;
}

export const fetchAdmin2faStatus = async (): Promise<Admin2faStatusResponse> => {
  return authorizedGet<Admin2faStatusResponse>('/api/admin/2fa/status');
};

export const setupAdmin2fa = async (currentPassword: string): Promise<Admin2faSetupResponse> => {
  // Le mot de passe admin est exige : l'endpoint ne doit pas pouvoir etre
  // appelle avec la seule session, sinon un attaquant ayant vole le cookie
  // s'en-role sa propre 2FA et recupere l'acces financier.
  return authorizedPost<Admin2faSetupResponse>('/api/admin/2fa/setup', { currentPassword });
};

export const enableAdmin2fa = async (code: string): Promise<{ ok: boolean }> => {
  return authorizedPost<{ ok: boolean }>('/api/admin/2fa/enable', { code });
};

export const verifyAdmin2fa = async (code: string): Promise<{ ok: boolean }> => {
  return authorizedPost<{ ok: boolean }>('/api/admin/2fa/verify', { code });
};
