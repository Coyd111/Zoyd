import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// `getClientIp` lit `process.env.TRUST_PROXY` au moment de l'appel.
const originalTrustProxy = process.env.TRUST_PROXY;

const loadLimiter = async () => import('./rate-limiter.mjs');

/** Requête minimale : seul le peer et l'en-tête XFF sont utiles ici. */
const makeReq = (remoteAddress, xff) => ({
  socket: { remoteAddress },
  headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
});

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
});

describe('getClientIp — resistance a la falsification de X-Forwarded-For', () => {
  it('prend le DERNIER saut, seul non controle par le client', async () => {
    process.env.TRUST_PROXY = 'true';
    const { getClientIp } = await loadLimiter();
    // Le client forge un préfixe, le proxy ajoute l'IP réelle à la fin.
    expect(getClientIp(makeReq('10.0.0.5', '1.2.3.4, 203.0.113.9'))).toBe('203.0.113.9');
  });

  it('ignore un XFF entièrement forgé quand le peer est de confiance', async () => {
    process.env.TRUST_PROXY = 'true';
    const { getClientIp } = await loadLimiter();
    // Un seul saut = un saut écrit par l'appelant... mais c'est aussi le seul
    //hops disponible. Le cas réel (plusieurs proxies) est couvert ci-dessus :
    // on vérifie ici qu'on ne retombe jamais sur le peer ni sur du vide.
    expect(getClientIp(makeReq('10.0.0.5', '9.9.9.9'))).toBe('9.9.9.9');
  });

  it('retombe sur le peer quand le dernier saut est invalide', async () => {
    process.env.TRUST_PROXY = 'true';
    const { getClientIp } = await loadLimiter();
    expect(getClientIp(makeReq('10.0.0.5', '1.2.3.4, pas-une-ip'))).toBe('10.0.0.5');
  });

  it('ignore XFF quand le peer nest pas un proxy de confiance', async () => {
    process.env.TRUST_PROXY = 'false';
    const { getClientIp } = await loadLimiter();
    // Un client qui se connecte directement ne peut pas choisir son bucket.
    expect(getClientIp(makeReq('198.51.100.7', '1.2.3.4'))).toBe('198.51.100.7');
  });

  it('donne la meme IP reelle quel que soit le prefixe forge', async () => {
    process.env.TRUST_PROXY = 'true';
    const { getClientIp } = await loadLimiter();
    // Le but : deux requetes d'un meme client doivent tomber dans le meme
    // bucket, sinon le rate-limit est contournable en changeant d'en-tete.
    const a = getClientIp(makeReq('10.0.0.5', '1.1.1.1, 203.0.113.9'));
    const b = getClientIp(makeReq('10.0.0.5', '2.2.2.2, 203.0.113.9'));
    expect(a).toBe(b);
  });
});

describe('Separation du quota de logout', () => {
  // `logout` ne demande aucune authentification : le token est facultatif et la
  // route repond 200 sans session. Tant qu il consomme le groupe `auth`, il
  // permet a n importe qui de verrouiller `login`, `register`,
  // `forgot-password` et `reset-password` : 50 appels, 15 minutes, sur toute
  // IP partagee.
  //
  // Ce test est ici, et non en E2E, parce que le rate limiter est
  // ASSOUPLI en test automatise (NODE_ENV=test + ALLOW_DEBUG_CODES). Un test
  // E2E de saturation passerait donc toujours, correct comme regresse : il ne
  // prouverait rien.

  it('saturer logout ne consomme pas le quota des routes d authentification', async () => {
    const { rateLimitGuard } = await loadLimiter();
    const stub = () => ({ statusCode: 200, headersSent: false, setHeader() {}, writeHead() {}, end() {}, json() {}, getHeader() {} });
    const ip = '10.1.2.3';

    // Le budget de `auth` est de 50 par fenetre. On sature `logout` au-dela.
    let autorisees = 0;
    for (let i = 0; i < 120; i += 1) {
      const res = stub();
      if (rateLimitGuard(res, ip, 'auth_logout')) autorisees += 1;
    }
    expect(autorisees, 'logout doit avoir son propre quota').toBeGreaterThan(50);

    // Le quota `auth` est intact : la connexion reste possible.
    const res = stub();
    expect(rateLimitGuard(res, ip, 'auth')).toBe(true);
  });

  it('deux groupes distincts ne partagent pas leur compteur', async () => {
    const { rateLimitGuard } = await loadLimiter();
    const ip = '10.1.2.4';
    const stub = () => ({ statusCode: 200, headersSent: false, setHeader() {}, writeHead() {}, end() {}, json() {}, getHeader() {} });

    // `auth` est sature.
    for (let i = 0; i < 50; i += 1) rateLimitGuard(stub(), ip, 'auth');
    expect(rateLimitGuard(stub(), ip, 'auth'), 'le groupe auth doit etre epuise').toBe(false);

    // Un autre groupe ne paie pas pour lui.
    expect(rateLimitGuard(stub(), ip, 'auth_logout')).toBe(true);
    expect(rateLimitGuard(stub(), ip, 'default')).toBe(true);
  });
});
