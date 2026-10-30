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
 * 2. Volet AUTHENTIFIÉ : il CRÉE lui-même un compte jetable et le SUPPRIME
 *    à la fin (`DELETE /api/auth/me`, suppression réelle en base).
 *
 *    Pourquoi aucun code d'activation n'est nécessaire : l'inscription
 *    renvoie directement une session + cookie (`isActive: true`, décision
 *    du 2026-09-18 — pas d'email/SMS pour l'instant). C'est exactement le
 *    contrat à valider en prod.
 *
 *    Le compte est identifiable : pseudo préfixé `ZOYDLIVE`, email `@e2e-live`.
 *    Si le run est interrompu, `scripts/cleanup-live-e2e.sql` les supprime.
 *
 *    PAS de dépôt ni de retrait dans ce volet : le crédit passe par FedaPay
 *    (widget sandbox) et le retrait par un vrai payout. Ces deux chemins se
 *    testent à la main, pas ici.
 */

import { test, expect } from '@playwright/test';

// ─── Garde-fou PRODUCTION ────────────────────────────────────────────────────
// Ce fichier vise zoyd.onrender.com et INSCRIT un compte jetable.
//
// C'est arrivé pendant la session de travail : `playwright test` lancé sans
// `--project` a exécuté ce fichier, simplement parce qu'il était dans la liste.
// Les tests live touchaient la production sans que ce soit demandé.
//
// On refuse tant que l'intention n'est pas explicite. Le message est
// volontairement bruyant : mieux vaut un échec sans conséquence qu'une base de
// production qui contient un compte de plus.
test.beforeAll(async () => {
  if (process.env.ZOYD_ALLOW_LIVE_TESTS !== '1') {
    throw new Error(
      'Refus de lancer un test LIVE sur la PRODUCTION.\n'
      + 'Relancer avec : ZOYD_ALLOW_LIVE_TESTS=1 pnpm test:e2e:live\n'
      + 'Ce fichier inscrit un compte sur zoyd.onrender.com.',
    );
  }
});

const BASE = 'https://zoyd.onrender.com/api';
const ORIGIN = 'https://zoyd.vercel.app';
const HEADERS = { Origin: ORIGIN } as const;
const UNIQ = Date.now().toString(36).slice(-6);
/**
 * Phone VALIDE au format beninois courant : indicatif +229, plan national
 * a 10 chiffres (migration ARCEP du 30/11/2024), 0 initial inclus.
 *
 * Les couches de validation de l'insertion sont ORDONNEES
 * (persistence.mjs insertUser) : format de phone PAYABLE, puis password,
 * puis CGU. Un phone invalide renverrait donc INVALID_PHONE a la
 * premiere couche et masquerait la couche que le test vise. Les tests
 * de CGU/password utilisent un phone de cette forme (jamais persiste :
 * la validation echoue AVANT l'unicite et l'ecriture).
 */
const PHONE_VALID = `+22901${(Date.now() % 100000000).toString().padStart(8, '0')}`;
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
    // Phone valide : la couche testee est le CONSENTEMENT (l ordre de
    // validation du serveur met le phone payant en premier, voir
    // PHONE_VALID et persistence.mjs insertUser).
    const r = await once(request, 'POST', `${BASE}/auth/register`, {
      headers: HEADERS,
      data: {
        pseudo: `NOCONSENT_${UNIQ}`,
        email: `noconsent_${UNIQ}@example.com`,
        phone: PHONE_VALID,
        gameId: `NOCONSENT_${UNIQ}`,
        password: 'MotDePasse1!',
        acceptAdult: false,
        acceptTerms: false,
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe('LEGAL_NOT_ACCEPTED');
  });

  // Couche 1 de la frontiere de confiance : le serveur refuse un format
  // qu'aucun retrait FedaPay ne pourra jamais payer (11 chiffres apres
  // l indicatif : ni 10 chiffres ARCEP, ni 8 legacy). Historique : de tels
  // numeros etaient stockes puis le joueur echouait au retrait.
  test('register : phone non payant -> 400 INVALID_PHONE', async ({ request }) => {
    const r = await once(request, 'POST', `${BASE}/auth/register`, {
      headers: HEADERS,
      data: {
        pseudo: `BADPHONE_${UNIQ}`,
        email: `badphone_${UNIQ}@example.com`,
        phone: `+2299${UNIQ}0000`,
        gameId: `BADPHONE_${UNIQ}`,
        password: 'MotDePasse1!',
        acceptAdult: true,
        acceptTerms: true,
        acceptedAt: new Date().toISOString(),
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe('INVALID_PHONE');
  });

  test('register : mot de passe faible -> 400 WEAK_PASSWORD', async ({ request }) => {
    // Phone valide : la couche testee est le MOT DE PASSE (couche 2, avant
    // la CGU, apres le phone, voir persistence.mjs insertUser).
    const r = await once(request, 'POST', `${BASE}/auth/register`, {
      headers: HEADERS,
      data: {
        pseudo: `WEAK_${UNIQ}`,
        email: `weak_${UNIQ}@example.com`,
        phone: PHONE_VALID,
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

  test('listes publiques sans session (leagues : 401 voulu)', async ({ request }) => {
    expect((await once(request, 'GET', `${BASE}/matches`, { headers: HEADERS })).status()).toBe(200);
    expect((await once(request, 'GET', `${BASE}/tournaments`, { headers: HEADERS })).status()).toBe(200);
    // La liste des ligues exige une session VOLONTAIREMENT (server/routes/
    // league.mjs) : la reponse anonyme embarquait le userId de chaque
    // inscrit — une carte sociale pseudo -> compte. Aligne sur le spec
    // local e2e/api/public-read.spec.ts, qui documente la meme decision.
    expect((await once(request, 'GET', `${BASE}/leagues`, { headers: HEADERS })).status()).toBe(401);
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

test.describe('LIVE — compte jetable (inscription, session, suppression)', () => {
  // UN SEUL compte pour tout le bloc, créé en beforeAll.
  // Un compte par test déclenchait le rate-limit de production (50 / 15 min
  // sur le bucket `auth`) : au-delà, 429 partout. Les tests sont en série.
  test.describe.configure({ mode: 'serial' });
  const PASSWORD = 'ZoydLive!2026';
  let pseudo = '';
  let email = '';
  let registered: { body: any; setCookie: string } = { body: null, setCookie: '' };

  const registerLiveAccount = async (request: any) => {
    // Pseudo, email, téléphone ET gameId uniques : le serveur rejette les
    // doublons (409 DUPLICATE_*). `digits` est purement numérique — un
    // suffixe base36 rendrait le numéro invalide.
    const digits = String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    pseudo = `ZOYDLIVE_${digits}`;
    email = `zoydlive_${digits}@e2e-live.example.com`;
    const res = await request.post(`${BASE}/auth/register`, {
      headers: HEADERS,
      data: {
        pseudo,
        email,
        phone: `+2296${digits}`,
        gameId: 'ZOYDLIVE' + digits,
        password: PASSWORD,
        controllerType: 'touch',
        device: 'phone',
        levelCODM: 50,
        rankMJ: 'Gold',
        rankBR: 'Gold',
        country: 'Benin',
        acceptAdult: true,
        acceptTerms: true,
        acceptedAt: new Date().toISOString(),
      },
    });
    expect(res.status(), 'inscription en direct').toBe(201);
    const body = await res.json();
    // Contrat V1 : compte actif immédiatement, PAS de code d'activation
    // (pas d'email/SMS pour l'instant) et session délivrée d'office.
    expect(body.activationCode).toBeUndefined();
    expect(body.ok).toBe(true);
    // On lit l'en-tête brut : c'est la source de vérité des attributs du
    // cookie. (storageState() ne le remonte pas de façon fiable ici.)
    return { body, setCookie: res.headers()['set-cookie'] || '' };
  };

  test.beforeAll(async ({ request }) => {
    registered = await registerLiveAccount(request);
  });

  // Filet de sécurité : si un test échoue avant la suppression, le compte
  // reste en base (le dernier test, qui le supprime, n'est pas exécuté).
  // On tente donc la suppression en fin de série quoi qu'il arrive.
  test.afterAll(async ({ request }) => {
    if (!pseudo) return;
    await request.post(`${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: pseudo, password: PASSWORD },
    });
    await request.delete(`${BASE}/auth/me`, {
      headers: HEADERS,
      data: { confirmForfeit: true },
    });
  });

  /**
   * Playwright crée un contexte `request` NEUF pour chaque test : le cookie
   * posé par l'inscription (during `beforeAll`) n'est pas conservé. Il faut
   * donc se reconnecter au début de chaque test. C'est aussi un test en soi :
   * la reconnexion par cookie doit fonctionner.
   */
  const loginLiveAccount = async (request: any) => {
    const res = await request.post(`${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: pseudo, password: PASSWORD },
    });
    expect(res.status(), 'reconnexion').toBe(200);
    return res;
  };

  test("inscription : cookie HttpOnly/Secure/SameSite=None, aucun token", async () => {
    // La lib de sérialisation normalise l'attribut en minuscules (`SameSite=none`).
    const setCookie = registered.setCookie;
    const attrs = setCookie.toLowerCase();
    expect(setCookie, 'en-tête Set-Cookie présent').toContain('zoyd_auth=');
    expect(attrs, 'HttpOnly').toContain('httponly');
    expect(attrs, 'Secure').toContain('secure');
    // Cross-site Vercel -> Render : sans SameSite=None le cookie n'est pas envoyé.
    expect(attrs, 'SameSite=None').toContain('samesite=none');
    // Le cookie est le SEUL credential : aucun token dans le JSON.
    expect(registered.body.token).toBeUndefined();
  });

  test('la session tient sur /auth/me et PATCH', async ({ request }) => {
    await loginLiveAccount(request);
    const me = await request.get(`${BASE}/auth/me`, { headers: HEADERS });
    expect(me.status()).toBe(200);
    expect((await me.json()).user.pseudo).toBe(pseudo);

    const patched = await request.patch(`${BASE}/auth/me`, {
      headers: HEADERS,
      data: { bio: 'compte jetable E2E live' },
    });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).user.bio).toBe('compte jetable E2E live');
  });

  test('reconnexion par le pseudo, sans token en réponse', async ({ request }) => {
    const res = await loginLiveAccount(request);
    expect((await res.json()).token).toBeUndefined();
    expect((await request.get(`${BASE}/auth/me`, { headers: HEADERS })).status()).toBe(200);
  });

  test('mot de passe erroné refusé', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: pseudo, password: 'MauvaisMotDePasse1!' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe('INVALID_CREDENTIALS');
  });

  test('le dépôt direct reste interdit au joueur', async ({ request }) => {
    await loginLiveAccount(request);
    // Créditer son propre compte créerait de la monnaie : refusé par design.
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: HEADERS,
      data: { amount: 100, userId: 'nimporte-quoi' },
    });
    expect(res.status()).toBe(403);
  });

  test('créer un match sans solde échoue proprement (409, pas 500)', async ({ request }) => {
    await loginLiveAccount(request);
    const res = await request.post(`${BASE}/matches`, {
      headers: HEADERS,
      data: { format: '1VS1', entryFee: 500, visibility: 'public' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('INSUFFICIENT_FUNDS');
  });

  test('format 4VS4 accepté (le format qui manquait)', async ({ request }) => {
    await loginLiveAccount(request);
    // 409 (pas de solde) et NON 400 : le format est bien valide côté serveur.
    const res = await request.post(`${BASE}/matches`, {
      headers: HEADERS,
      data: { format: '4VS4', entryFee: 100, visibility: 'public' },
    });
    expect(res.status()).toBe(409);
  });

  test('le compte jetable est supprimé (DELETE /auth/me)', async ({ request }) => {
    await loginLiveAccount(request);
    // Sans confirmForfeit : refus attendu, compte intact.
    const refused = await request.delete(`${BASE}/auth/me`, { headers: HEADERS, data: {} });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe('CONFIRM_REQUIRED');

    const deleted = await request.delete(`${BASE}/auth/me`, {
      headers: HEADERS,
      data: { confirmForfeit: true },
    });
    expect(deleted.status()).toBe(200);

    // La session est morte et le compte n'existe plus.
    expect((await request.get(`${BASE}/auth/me`, { headers: HEADERS })).status()).toBe(401);
    const relogin = await request.post(`${BASE}/auth/login`, {
      headers: HEADERS,
      data: { identifier: pseudo, password: PASSWORD },
    });
    expect(relogin.status()).toBe(401);
  });
});
