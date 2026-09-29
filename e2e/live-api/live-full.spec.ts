/**
 * E2E LIVE — zoyd.onrender.com (production)
 *
 * Deux volets :
 *
 * 1. Surface PUBLIQUE (toujours exécuté, ne crée rien) : codes d'erreur,
 *    CSRF, CORS, listes, 404, health, rate-limits. C'est ce qui peut être
 *    vérifié sans compte, et cela recouvre l'essentiel des régressions
 *    récentes (codes d'erreur non mappés → 500, CSRF Origin, allowRequest
 *    WebSocket).
 *
 * 2. Volet AUTHENTIFIÉ (exécuté seulement si ZOYD_LIVE_EMAIL et
 *    ZOYD_LIVE_PASSWORD sont fournis) : il faut un compte PRÉPARÉ ET ACTIVÉ
 *    par un humain.
 *
 *    Pourquoi pas de création de compte ici : depuis le passage en
 *    cookie-only, `token` ET `activationCode` ne sont renvoyés que si
 *    `ALLOW_DEBUG_CODES=true`, jamais en production. Activer ce flag en prod
 *    pour que les tests passent serait une régression de sécurité. Et
 *    `POST /api/wallet/deposit` est désormais admin + 2FA (les dépôts
 *    passent par FedaPay), donc un test ne peut pas se créditer lui-même.
 *
 * Préparer le compte (une fois) :
 *   1. Ouvrir https://zoyd.vercel.app/auth/register depuis le navigateur
 *   2. Pseudo prefixé `ZOYDLIVE` (pour le repérer et le supprimer ensuite)
 *   3. Activer via le code reçu par email
 *   4. $env:ZOYD_LIVE_EMAIL = '...'; $env:ZOYD_LIVE_PASSWORD = '...'
 *      pnpm test:e2e:live
 *
 * Nettoyage : DELETE /api/auth/me (suppression réelle en base).
 */

import { test, expect } from '@playwright/test';

const BASE = 'https://zoyd.onrender.com/api';
const ORIGIN = 'https://zoyd.vercel.app';
const HEADERS = { Origin: ORIGIN } as const;
const UNIQ = Date.now().toString(36).slice(-6);

const LIVE_EMAIL = process.env.ZOYD_LIVE_EMAIL || '';
const LIVE_PASSWORD = process.env.ZOYD_LIVE_PASSWORD || '';
const hasLiveAccount = Boolean(LIVE_EMAIL && LIVE_PASSWORD);

/** Identifiant unique : un seul appel par route pour ne pas déclencher 429. */
const once = async (request: any, method: string, url: string, opts: any = {}) =>
  method === 'GET' ? request.get(url, opts) : request.post(url, opts);

test.describe('LIVE — surface publique (aucun compte cree)', () => {
  test('health expose stateTrusted', async ({ request }) => {
    const r = await once(request, 'GET', `${BASE}/health`, { headers: HEADERS });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('zoyd-api');
    // `stateTrusted` absent = ancien deploiement, ou etat partiel.
    expect(body.persistence).toHaveProperty('stateTrusted');
    expect(body.persistence.stateTrusted).toBe(true);
  });

  test('realtime health repond', async ({ request }) => {
    const r = await once(request, 'GET', `${BASE}/realtime/health`, { headers: HEADERS });
    expect(r.status()).toBe(200);
    expect((await r.json()).service).toBe('zoyd-realtime');
  });

  test('404 sur route inconnue', async ({ request }) => {
    const r = await once(request, 'GET', `${BASE}/route-inexistante-${UNIQ}`, { headers: HEADERS });
    expect(r.status()).toBe(404);
  });

  test('CSRF : Origin malveillant rejete (403)', async ({ request }) => {
    const r = await once(request, 'POST', `${BASE}/auth/login`, {
      headers: { Origin: 'https://evil.example.com' },
      data: { identifier: 'peu-importe', password: 'Peu importe1!' },
    });
    expect(r.status()).toBe(403);
  });

  test('login : erreur generique, pas d enumeration de compte', async ({ request }) => {
    const r = await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: `inconnu_${UNIQ}`, password: 'Peu importe1!' },
    });
    expect(r.status()).toBe(401);
    const body = await r.json();
    expect(body.code).toBe('INVALID_CREDENTIALS');
    // Le message ne doit jamais reveler si le compte existe.
    expect(body.error.toLowerCase()).not.toContain('introuvable');
  });

  test('register : 18+/CGU non confirmes -> 400 (et non 500)', async ({ request }) => {
    // Regression : LEGAL_NOT_ACCEPTED absent de mapPersistenceError -> 500.
    const r = await once(request, 'POST', `${BASE}/auth/register`, {
      headers: HEADERS,
      data: {
        pseudo: `NOCONSENT_${UNIQ}`,
        email: `noconsent_${UNIQ}@example.com`,
        phone: `+2299${UNIQ}0000`,
        gameId: `NOCONSENT_${UNIQ}`,
        password: 'MotDePasse1!',
        acceptAdult: false,
        acceptTerms: false,
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe('LEGAL_NOT_ACCEPTED');
  });

  test('register : mot de passe faible -> 400 WEAK_PASSWORD', async ({ request }) => {
    const r = await once(request, 'POST', `${BASE}/auth/register`, {
      headers: HEADERS,
      data: {
        pseudo: `WEAK_${UNIQ}`,
        email: `weak_${UNIQ}@example.com`,
        phone: `+2298${UNIQ}0000`,
        gameId: `WEAK_${UNIQ}`,
        password: 'court',
        acceptAdult: true,
        acceptTerms: true,
        acceptedAt: new Date().toISOString(),
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe('WEAK_PASSWORD');
  });

  test('listes publiques accessibles sans session', async ({ request }) => {
    expect((await once(request, 'GET', `${BASE}/matches`, { headers: HEADERS })).status()).toBe(200);
    expect((await once(request, 'GET', `${BASE}/tournaments`, { headers: HEADERS })).status()).toBe(200);
    expect((await once(request, 'GET', `${BASE}/leagues`, { headers: HEADERS })).status()).toBe(200);
  });

  test('liste des matchs ne fuite aucun mot de passe de salle', async ({ request }) => {
    const r = await once(request, 'GET', `${BASE}/matches`, { headers: HEADERS });
    const text = JSON.stringify(await r.json());
    expect(text).not.toContain('roomPassword');
  });

  test('acces sans session -> 401 sur le wallet', async ({ request }) => {
    expect((await once(request, 'GET', `${BASE}/wallet/me`, { headers: HEADERS })).status()).toBe(401);
  });

  test('token falsifie rejete (401)', async ({ request }) => {
    const r = await once(request, 'GET', `${BASE}/wallet/me`, {
      headers: { ...HEADERS, Authorization: 'Bearer jeton-invente' },
    });
    expect(r.status()).toBe(401);
  });

  test('format de match hors 1VS1-5VS5 rejete (400)', async ({ request }) => {
    // Regression : la limite 5v5 n'existait pas cote serveur avant 68499ad.
    const r = await once(request, 'POST', `${BASE}/matches`, {
      headers: HEADERS,
      data: { format: '12VS12', entryFee: 50, visibility: 'public' },
    });
    // Sans session : 401. Avec session : 400 INVALID_FORMAT. Les deux sont
    // acceptables ici, un 500 ne l'est pas (indique une garde manquante).
    expect([400, 401]).toContain(r.status());
    if (r.status() === 400) expect((await r.json()).code).toBe('INVALID_FORMAT');
  });
});

test.describe('LIVE — cookie-only (compte prepare requis)', () => {
  test.skip(!hasLiveAccount, 'Renseigne ZOYD_LIVE_EMAIL et ZOYD_LIVE_PASSWORD pour ce volet.');

  test('login pose un cookie HttpOnly et ne renvoie PAS de token', async ({ request }) => {
    const r = await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: LIVE_EMAIL, password: LIVE_PASSWORD },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    // Contrat cookie-only : aucun token en JSON.
    expect(body.token).toBeUndefined();
    const cookies = await request.storageState();
    const auth = cookies.cookies.find((c) => c.name === 'zoyd_auth');
    expect(auth, 'cookie zoyd_auth attendu').toBeTruthy();
    expect(auth.httpOnly, 'le cookie doit etre HttpOnly').toBe(true);
    expect(auth.sameSite).toBe('None'); // cross-site Vercel -> Render
    expect(auth.secure, 'le cookie doit etre Secure').toBe(true);
  });

  test('la session persiste sur /auth/me', async ({ request }) => {
    expect((await once(request, 'GET', `${BASE}/auth/me`, { headers: HEADERS })).status()).toBe(200);
    const r = await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: LIVE_EMAIL, password: LIVE_PASSWORD },
    });
    expect(r.status()).toBe(200);
    const me = await once(request, 'GET', `${BASE}/auth/me`, { headers: HEADERS });
    expect(me.status()).toBe(200);
    expect((await me.json()).user).toBeTruthy();
  });

  test('le depot direct est refuse au joueur (403 admin+2FA)', async ({ request }) => {
    await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: LIVE_EMAIL, password: LIVE_PASSWORD },
    });
    const r = await once(request, 'POST', `${BASE}/wallet/deposit`, {
      headers: HEADERS,
      data: { amount: 100, userId: 'nimporte-quoi' },
    });
    // Le credit ne passe QUE par FedaPay. Un joueur qui peut credited son
    // propre compte creerait de la monnaie : doit etre refuse.
    expect(r.status()).toBe(403);
  });

  test('creation de match sans solde -> 409 (et non 500)', async ({ request }) => {
    await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: LIVE_EMAIL, password: LIVE_PASSWORD },
    });
    const r = await once(request, 'POST', `${BASE}/matches`, {
      headers: HEADERS,
      data: { format: '1VS1', entryFee: 500, visibility: 'public' },
    });
    expect([200, 409]).toContain(r.status());
    if (r.status() === 200) {
      // Match cree : on l'annule pour ne pas polluer la prod.
      const id = (await r.json()).match.id;
      const del = await request.delete(`${BASE}/matches/${id}`, { headers: HEADERS });
      expect([200, 403, 405, 409]).toContain(del.status());
    }
  });

  test('format 4VS4 accepte (le format manquant)', async ({ request }) => {
    await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: LIVE_EMAIL, password: LIVE_PASSWORD },
    });
    const r = await once(request, 'POST', `${BASE}/matches`, {
      headers: HEADERS,
      data: { format: '4VS4', entryFee: 1, visibility: 'public' },
    });
    // 409 si le solde ne suffit pas, sinon 201 : jamais 400 INVALID_FORMAT.
    expect([201, 409]).toContain(r.status());
    if (r.status() === 201) {
      const id = (await r.json()).match.id;
      await request.delete(`${BASE}/matches/${id}`, { headers: HEADERS });
    }
  });

  test('deconnexion invalide la session', async ({ request }) => {
    await once(request, 'POST', `${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: LIVE_EMAIL, password: LIVE_PASSWORD },
    });
    expect((await once(request, 'POST', `${BASE}/auth/logout`, { headers: HEADERS })).status()).toBe(200);
    expect((await once(request, 'GET', `${BASE}/auth/me`, { headers: HEADERS })).status()).toBe(401);
  });
});
