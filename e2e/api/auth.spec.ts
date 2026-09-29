import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  disposeActors,
  registerPlayer,
  registerPlayerWithResponse,
  PLAYER_PASSWORD,
  type Actor,
  type RegisterOverrides,
} from './support/harness';

// Contrat réel relevé dans server/realtime-server.mjs + server/persistence.mjs :
//   POST   /api/auth/register        201, cookie httpOnly `zoyd_auth` (+ `token`
//                                    seulement si ALLOW_DEBUG_CODES=true)
//   POST   /api/auth/login           200 (pseudo | email | phone), 401 sinon
//   GET    /api/auth/me              200 / 401 AUTH_REQUIRED
//   PATCH  /api/auth/me              200, whitelist stricte anti mass-assignment
//   POST   /api/auth/change-password 200 puis RÉVOQUE TOUTES les sessions
//   POST   /api/auth/logout          200 puis invalide la session
//   DELETE /api/auth/me              400 CONFIRM_REQUIRED sans confirmForfeit
const BASE = '/api';
const ROTATED_PASSWORD = 'ZoydE2E!Rotated2026';

test.describe('Auth API', () => {
  // Les tests partagent token + userId : l'ordre compte.
  test.describe.configure({ mode: 'serial' });

  let player: Actor;
  let rotating: Actor;
  let deletable: Actor;

  test.beforeAll(async () => {
    player = await registerPlayer('E2EAUTH');
    rotating = await registerPlayer('E2EROT');
    deletable = await registerPlayer('E2EDEL');
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('POST /api/auth/register — 201, session cookie httpOnly + token de debug', async () => {
    const { actor, status, body, setCookie } = await registerPlayerWithResponse('E2ECOOKIE');

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    // ALLOW_DEBUG_CODES=true est positionné par le webServer de la CI E2E.
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.user.pseudo).toBe(actor.pseudo);
    expect(body.user.role).toBe('player');
    expect(body.user.isActive).toBe(true);
    expect(body.user.wallet.cashBalance).toBe(0);

    // Le credential navigateur est un cookie httpOnly (jamais en localStorage).
    expect(setCookie).toContain('zoyd_auth=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');

    // Aucun hash de mot de passe ne doit fuiter.
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  test('POST /api/auth/register — 409 sur un pseudo déjà pris', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/register`, {
      pseudo: player.pseudo,
      email: `dup_${Date.now().toString(36)}@e2e.zoyd.test`,
      phone: '+22961000001',
      gameId: `DUP${Date.now().toString(36)}`,
      password: PLAYER_PASSWORD,
      acceptAdult: true,
      acceptTerms: true,
      acceptedAt: new Date().toISOString(),
    });

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('DUPLICATE_PSEUDO');
    expect(String(res.body.error).toLowerCase()).toContain('pseudo');
  });

  test('POST /api/auth/register — 400 sur un mot de passe faible', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/register`, {
      pseudo: `SHORT_${Date.now().toString(36)}`,
      email: `weak_${Date.now().toString(36)}@e2e.zoyd.test`,
      phone: '+22961000002',
      gameId: `WEAK${Date.now().toString(36)}`,
      password: '1234567',
      acceptAdult: true,
      acceptTerms: true,
      acceptedAt: new Date().toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  test('POST /api/auth/register — 400 sur un email malformé', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/register`, {
      pseudo: `BADMAIL_${Date.now().toString(36)}`,
      email: 'pas-un-email',
      phone: '+22961000003',
      gameId: `BADMAIL${Date.now().toString(36)}`,
      password: PLAYER_PASSWORD,
      acceptAdult: true,
      acceptTerms: true,
      acceptedAt: new Date().toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EMAIL');
  });

  test("POST /api/auth/register — refuse un compte sans consentement 18+/CGU", async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/register`, {
      pseudo: `NOLEGAL_${Date.now().toString(36)}`,
      email: `nolegal_${Date.now().toString(36)}@e2e.zoyd.test`,
      phone: '+22961000004',
      gameId: `NOLEGAL${Date.now().toString(36)}`,
      password: PLAYER_PASSWORD,
    });

    // Le compte n'est PAS créé. C'est une erreur de SAISIE, pas une panne
    // serveur : 400. (Ce test documentait un 500 parce que LEGAL_NOT_ACCEPTED
    // manquait dans mapPersistenceError — corrigé, le test a suivi.)
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('LEGAL_NOT_ACCEPTED');
  });

  test('POST /api/auth/register — la whitelist ignore rôle et wallet', async () => {
    // Champs hors REGISTER_FIELDS : doivent être ignorés, pas appliqués.
    const hostile = {
      role: 'admin',
      walletBalance: 5_000_000,
      wallet: { cashBalance: 5_000_000 },
    } as unknown as RegisterOverrides;
    const res = await registerPlayerWithResponse('E2EMASS', hostile);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('player');
    expect(res.body.user.wallet.cashBalance).toBe(0);
    expect(res.body.user.walletBalance).toBe(0);
    expect(res.body.user.wallet.lockedBalance).toBe(0);
  });

  test('POST /api/auth/login — 200 avec le pseudo', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: player.pseudo,
      password: PLAYER_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.pseudo).toBe(player.pseudo);
    expect(res.body.user.id).toBe(player.id);
    expect(typeof res.body.token).toBe('string');
  });

  test('POST /api/auth/login — 200 avec l’email (identifiant normalisé)', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: player.email.toUpperCase(),
      password: PLAYER_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(player.id);
    expect(typeof res.body.token).toBe('string');
  });

  test('POST /api/auth/login — 401 avec un mot de passe erroné (message générique)', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: player.pseudo,
      password: 'WrongPassword123!',
    });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    // Aucune fuite : le message ne distingue pas pseudo inconnu / mot de passe faux.
    expect(res.body.error).toBe('Identifiants invalides.');
    expect(res.body.token).toBeUndefined();
  });

  test('POST /api/auth/login — 401 pour un identifiant inconnu', async () => {
    const res = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: `ghost_${Date.now().toString(36)}`,
      password: PLAYER_PASSWORD,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error).toBe('Identifiants invalides.');
  });

  test('GET /api/auth/me — renvoie le profil de la session', async () => {
    const res = await call(player, 'GET', `${BASE}/auth/me`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.id).toBe(player.id);
    expect(res.body.user.pseudo).toBe(player.pseudo);
    expect(res.body.user.email).toBe(player.email);
    expect(res.body.user.role).toBe('player');
  });

  test('GET /api/auth/me — 401 sans token', async () => {
    const res = await callAnonymous('GET', `${BASE}/auth/me`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('GET /api/auth/me — 401 avec un token forgé', async () => {
    const tampered = await call({ ...player, token: `${player.token}-forged` }, 'GET', `${BASE}/auth/me`);

    expect(tampered.status).toBe(401);
    expect(tampered.body.code).toBe('AUTH_REQUIRED');
  });

  test('PATCH /api/auth/me — met à jour les champs de la whitelist', async () => {
    const res = await call(player, 'PATCH', `${BASE}/auth/me`, {
      bio: 'E2E test player',
      levelCODM: 75,
      country: 'Benin',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.bio).toBe('E2E test player');
    expect(res.body.user.levelCODM).toBe(75);
  });

  test('PATCH /api/auth/me — 400 sur un levelCODM hors bornes', async () => {
    const res = await call(player, 'PATCH', `${BASE}/auth/me`, { levelCODM: 999 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
  });

  test('PATCH /api/auth/me — 409 si le nouveau pseudo est déjà pris', async () => {
    const res = await call(player, 'PATCH', `${BASE}/auth/me`, { pseudo: rotating.pseudo });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_PSEUDO');
  });

  test('PATCH /api/auth/me — la whitelist bloque l’escalade de rôle et le wallet', async () => {
    const res = await call(player, 'PATCH', `${BASE}/auth/me`, {
      role: 'admin',
      trustScore: 100,
      walletBalance: 5_000_000,
      wallet: { cashBalance: 5_000_000 },
    });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('player');
    expect(res.body.user.wallet.cashBalance).toBe(0);
    expect(res.body.user.walletBalance).toBe(0);
  });

  test('POST /api/auth/change-password — 403 avec un mot de passe actuel erroné', async () => {
    const res = await call(player, 'POST', `${BASE}/auth/change-password`, {
      currentPassword: 'WrongOldPass!',
      newPassword: ROTATED_PASSWORD,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WRONG_PASSWORD');

    // Le mot de passe n'a pas bougé : la session courante reste valide.
    const me = await call(player, 'GET', `${BASE}/auth/me`);
    expect(me.status).toBe(200);
  });

  test('POST /api/auth/change-password — 400 sur un nouveau mot de passe faible', async () => {
    const res = await call(player, 'POST', `${BASE}/auth/change-password`, {
      currentPassword: PLAYER_PASSWORD,
      newPassword: 'short',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  test('POST /api/auth/change-password — 200 puis révoque toutes les sessions', async () => {
    const res = await call(rotating, 'POST', `${BASE}/auth/change-password`, {
      currentPassword: PLAYER_PASSWORD,
      newPassword: ROTATED_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // B9 : la session qui a changé le mot de passe est morte elle aussi.
    const me = await call(rotating, 'GET', `${BASE}/auth/me`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('AUTH_REQUIRED');

    const oldPassword = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: rotating.pseudo,
      password: PLAYER_PASSWORD,
    });
    expect(oldPassword.status).toBe(401);

    const newPassword = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: rotating.pseudo,
      password: ROTATED_PASSWORD,
    });
    expect(newPassword.status).toBe(200);
    expect(newPassword.body.user.id).toBe(rotating.id);
  });

  test('POST /api/auth/logout — invalide la session', async () => {
    const res = await call(player, 'POST', `${BASE}/auth/logout`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const me = await call(player, 'GET', `${BASE}/auth/me`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('AUTH_REQUIRED');
  });

  test('DELETE /api/auth/me — 400 sans confirmForfeit explicite', async () => {
    const res = await call(deletable, 'DELETE', `${BASE}/auth/me`, {});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONFIRM_REQUIRED');

    // Le compte survit : la suppression n'a pas eu lieu.
    const me = await call(deletable, 'GET', `${BASE}/auth/me`);
    expect(me.status).toBe(200);
  });

  test('DELETE /api/auth/me — échoue sans backend de persistance (mode mémoire)', async () => {
    const res = await call(deletable, 'DELETE', `${BASE}/auth/me`, { confirmForfeit: true });

    // Contrat observé : `deleteUserAccount` exige un DELETE strict en base
    // (sbDeleteStrict) ; sans Supabase il refuse d'effacer la mémoire seule,
    // donc 503. Le compte doit être INTACT (aucune suppression partielle).
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DELETE_FAILED');

    const login = await callAnonymous('POST', `${BASE}/auth/login`, {
      identifier: deletable.pseudo,
      password: PLAYER_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(deletable.id);
  });
});
