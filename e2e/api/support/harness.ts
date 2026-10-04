// ─────────────────────────────────────────────────────────────────────────────
// E2E harness — contrat RÉEL de l'API ZOYD (mode mémoire, ALLOW_DEBUG_CODES)
//
// Ce module n'est PAS un fichier de test : `playwright.config.ts` ne collecte
// que `**/*.@(spec|test).*` et `vitest.config.ts` n'inclut que `server/**` et
// `src/**`. Il n'est donc ni exécuté par `pnpm test:run` ni type-checké par
// `tsc -p tsconfig.app.json`.
//
// Pourquoi il existe :
//  1. `POST /api/wallet/deposit` est ADMIN + 2FA (requireAdmin2fa). Aucun
//     endpoint de test/award ne permet de créditer un joueur autrement, donc
//     le seul moyen de financer un joueur de test est d'enrôler le compte admin
//     seedé en TOTP et de calculer les codes.
//  2. Le secret TOTP admin n'est renvoyé qu'UNE seule fois par
//     `/api/admin/2fa/setup` : `/setup` répond ensuite 409 2FA_ALREADY_ENABLED
//     et il n'existe aucun endpoint de désactivation. Sans un cache partagé
//     entre wallet.spec.ts et match.spec.ts, le second fichier ne pourrait plus
//     jamais financer de joueur sur le même process serveur.
//  3. Chaque acteur a son PROPRE APIRequestContext (= son propre cookie jar) :
//     `readBearerToken()` privilégie le cookie `zoyd_auth` sur l'en-tête
//     Authorization, donc un contexte partagé ferait résoudre les requêtes
//     Bearer d'un joueur avec la session d'un autre.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { request as apiRequest, type APIRequestContext } from '@playwright/test';

export const API_BASE_URL = 'http://localhost:4001';
export const ADMIN_EMAIL = 'admin@zoyd.com';
export const ADMIN_PASSWORD = process.env.ZOYD_ADMIN_PASSWORD || 'ZoydE2E!Admin2026';
export const PLAYER_PASSWORD = 'ZoydE2E!Player2026';

export interface Actor {
  /** Contexte isolé (= cookie jar dédié à cet acteur). */
  readonly context: APIRequestContext;
  readonly token: string;
  readonly id: string;
  readonly pseudo: string;
  readonly email: string;
  readonly phone: string;
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

const contexts: APIRequestContext[] = [];

const newContext = async (): Promise<APIRequestContext> => {
  const context = await apiRequest.newContext({ baseURL: API_BASE_URL });
  contexts.push(context);
  return context;
};

/**
 * Ferme tous les contextes ouverts (évite les processus fantômes).
 */
export const disposeActors = async (): Promise<void> => {
  const open = contexts.splice(0, contexts.length);
  await Promise.all(open.map((context) => context.dispose().catch(() => undefined)));
};

const randomDigits = (length: number): string => {
  let out = '';
  while (out.length < length) out += String(crypto.randomInt(0, 10));
  return out;
};

// ─── Requêtes ───────────────────────────────────────────────────────────────

/**
 * Appel JSON typé sur la session d'un acteur (Authorization: Bearer).
 */
export const call = async <T = any>(
  actor: Actor,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  route: string,
  data?: unknown,
): Promise<ApiResult<T>> => {
  const response = await actor.context.fetch(route, {
    method,
    headers: { Authorization: `Bearer ${actor.token}` },
    data: data === undefined ? undefined : (data as Record<string, unknown>),
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status(), body: body as T };
};

/**
 * Appel JSON sans aucune session.
 *
 * Chaque appel utilise un contexte neuf puis le ferme : un contexte
 * partagé conserverait le cookie `zoyd_auth` renvoyé par un `POST
 * /api/auth/login` anonymous, et les tests « 401 sans token » passeraient au
 * travers de ce cookie.
 */
export const callAnonymous = async <T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  route: string,
  data?: unknown,
): Promise<ApiResult<T>> => {
  const context = await apiRequest.newContext({ baseURL: API_BASE_URL });
  try {
    const response = await context.fetch(route, {
      method,
      data: data === undefined ? undefined : (data as Record<string, unknown>),
    });
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status(), body: body as T };
  } finally {
    await context.dispose().catch(() => undefined);
  }
};

// ─── Inscription ────────────────────────────────────────────────────────────

export interface RegisterOverrides {
  pseudo?: string;
  email?: string;
  phone?: string;
  gameId?: string;
  password?: string;
  acceptAdult?: boolean;
  acceptTerms?: boolean;
  acceptedAt?: string;
  device?: string;
  controllerType?: string;
  country?: string;
  levelCODM?: number;
}

export interface RegistrationResult {
  actor: Actor;
  status: number;
  body: any;
  setCookie: string;
}

/** Inscrit un joueur et renvoie un acteur prêt à l'emploi (token inclus). */
export const registerPlayerWithResponse = async (
  tag: string,
  overrides: RegisterOverrides = {},
): Promise<RegistrationResult> => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const context = await newContext();
  const payload = {
    pseudo: `${tag}_${suffix}`,
    email: `${tag.toLowerCase()}_${suffix}@e2e.zoyd.test`,
    phone: `+229${randomDigits(8)}`,
    gameId: `${tag}${suffix}`,
    password: PLAYER_PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
    acceptedAt: new Date().toISOString(),
    ...overrides,
  };
  const response = await context.post('/api/auth/register', { data: payload });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const setCookie = response.headers()['set-cookie'] || '';
  if (response.status() !== 201 || !body?.token) {
    throw new Error(`register(${payload.pseudo}) -> ${response.status()} ${JSON.stringify(body)}`);
  }
  return {
    actor: {
      context,
      token: body.token,
      id: body.user.id,
      pseudo: payload.pseudo,
      email: payload.email,
      phone: payload.phone,
    },
    status: response.status(),
    body,
    setCookie,
  };
};

export const registerPlayer = async (tag: string, overrides: RegisterOverrides = {}): Promise<Actor> =>
  (await registerPlayerWithResponse(tag, overrides)).actor;

// ─── TOTP (RFC 6238, HMAC-SHA1, 6 chiffres, période 30 s) ─────────────────────
// Aucune dépendance TOTP n'est présente dans package.json : on implémente
// l'algorithme en Node pur, aligné sur server/admin-totp.mjs (fenêtre ±1 pas).

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Decode = (encoded: string): Buffer => {
  let bits = '';
  for (const char of encoded.toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return Buffer.from(bytes);
};

export const generateTotp = (base32Secret: string, atMs: number = Date.now()): string => {
  const counter = Math.floor(atMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', base32Decode(base32Secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const otp =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(otp % 1_000_000).padStart(6, '0');
};

// ─── Cache du secret 2FA (un seul enrôlement par process serveur) ───────────

const findProjectRoot = (): string => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'playwright.config.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
};

const secretCacheFile = (): string =>
  path.join(findProjectRoot(), 'test-results', 'zoyd-e2e-admin-totp.json');

const readCachedSecret = (): string | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(secretCacheFile(), 'utf-8'));
    return typeof raw?.secret === 'string' ? raw.secret : null;
  } catch {
    return null;
  }
};

const writeCachedSecret = (secret: string): void => {
  const file = secretCacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ secret, adminEmail: ADMIN_EMAIL }), 'utf-8');
};

// ─── Acteur admin + 2FA ─────────────────────────────────────────────────────

/**
 * Session admin du compte seedé, SANS toucher à la 2FA : sert à prouver que
 * `POST /api/wallet/deposit` est refusé tant que `/api/admin/2fa/verify` n'a
 * pas été appelé sur CETTE session.
 */
export const loginAdminWithout2fa = async (): Promise<Actor> => {
  const context = await newContext();
  const login = await context.post('/api/auth/login', {
    data: { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  let body: any = null;
  try {
    body = await login.json();
  } catch {
    body = null;
  }
  if (login.status() !== 200 || !body?.token) {
    throw new Error(`admin login -> ${login.status()} ${JSON.stringify(body)}`);
  }
  return {
    context,
    token: body.token,
    id: body.user.id,
    pseudo: body.user.pseudo,
    email: body.user.email,
    phone: body.user.phone,
  };
};

/**
 * Ouvre une session admin seedée (`admin@zoyd.com`, id `admin-zoyd-control`)
 * et garantit un état 2FA vérifié pour les 5 minutes de fenêtre serveur.
 *
 * - 2FA non activée  → setup + enable (le secret est mis en cache disque).
 * - 2FA déjà activée → /verify avec le secret en cache (le setup est
 *   volontairement refusé en 409 : ré-enrôler exigerait le secret courant).
 */
export const openAdminSession = async (): Promise<Actor> => {
  const actor = await loginAdminWithout2fa();

  const status = await call<{ enabled: boolean }>(actor, 'GET', '/api/admin/2fa/status');
  if (status.status !== 200) {
    throw new Error(`2FA status -> ${status.status} ${JSON.stringify(status.body)}`);
  }

  if (!status.body.enabled) {
    const setup = await call<{ otpauthUrl: string }>(actor, 'POST', '/api/admin/2fa/setup');
    if (setup.status !== 200 || !setup.body?.otpauthUrl) {
      throw new Error(`2FA setup -> ${setup.status} ${JSON.stringify(setup.body)}`);
    }
    const secret = new URL(setup.body.otpauthUrl).searchParams.get('secret');
    if (!secret) throw new Error(`2FA setup: secret absent de ${setup.body.otpauthUrl}`);
    writeCachedSecret(secret);
    // `enable` valide le code ET marque la session comme 2FA vérifiée.
    const enable = await call(actor, 'POST', '/api/admin/2fa/enable', { code: generateTotp(secret) });
    if (enable.status !== 200) {
      throw new Error(`2FA enable -> ${enable.status} ${JSON.stringify(enable.body)}`);
    }
    return actor;
  }

  const secret = readCachedSecret();
  if (!secret) {
    throw new Error(
      '2FA admin déjà activée sur ce process serveur et aucun secret TOTP en cache ' +
        '(test-results/zoyd-e2e-admin-totp.json). Relancer la suite avec un serveur neuf, ' +
        'car /api/admin/2fa/setup refuse le ré-enrôlement (409 2FA_ALREADY_ENABLED).',
    );
  }
  const verify = await call(actor, 'POST', '/api/admin/2fa/verify', { code: generateTotp(secret) });
  if (verify.status !== 200) {
    throw new Error(`2FA verify -> ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return actor;
};

const revalidateAdmin2fa = async (admin: Actor): Promise<void> => {
  const secret = readCachedSecret();
  if (!secret) return;
  await call(admin, 'POST', '/api/admin/2fa/verify', { code: generateTotp(secret) });
};

/**
 * Crédite un wallet via le canal SEUL de l'API : `POST /api/wallet/deposit`
 * (admin + 2FA). Les dépôts joueur passent par FedaPay
 * (`POST /api/wallet/verify-fedapay`), qui exige une transaction approuvée
 * côté FedaPay — inutilisable hors-ligne.
 */
export const creditWallet = async (admin: Actor, userId: string, amount: number): Promise<ApiResult> => {
  const payload = { amount, userId, method: 'admin-credit' };
  let result = await call(admin, 'POST', '/api/wallet/deposit', payload);
  if (result.status === 403 && (result.body as any)?.code === '2FA_REQUIRED') {
    // Fenêtre 2FA de 5 min expirée : on ré-authentifie la session puis on réessaie.
    await revalidateAdmin2fa(admin);
    result = await call(admin, 'POST', '/api/wallet/deposit', payload);
  }
  if (result.status !== 200) {
    throw new Error(`admin deposit(${amount} -> ${userId}) -> ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result;
};
