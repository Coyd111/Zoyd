import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Le quota anti-bruteforce ne doit pas pouvoir etre contourne.
 *
 * Le defaut, mesure en PRODUCTION le 2026-11-12
 * ------------------------------------------------
 * 70 requetes SEQUENTIELLES sur une seule connexion, avec un
 * `X-Forwarded-For` constant -> ZERO refus. La meme salve SANS l
 * en-tete -> refus des la requete #45, avec le corps
 * `{ code: "RATE_LIMITED" }` (celui de l application).
 *
 * Autrement dit : ajouter un en-tete suffisait a sortir du quota.
 *
 * Pourquoi
 * --------
 * La cle de seau est `${ip}|${groupe}`, et `ip` vient de `getClientIp` -
 * donc de l en-tete que l appelant controle. Le test unitaire existant
 * (`rate-limiter.test.mjs`) verifie la regle « dernier saut » en
 * SIMULANT un proxy qui APPENDRE son IP. Cette simulation dit ce que le
 * code fait, pas ce que la plateforme fait : la regle n etait donc
 * verifiee que contre une hypothese, jamais contre la realite.
 *
 * Le correctif n est pas de deviner quelle convention s applique (on ne
 * peut pas : elle depend de la plateforme), mais d ajouter une dimension
 * que l appelant ne peut PAS controler : le PAIR TCP. Le seau du pair
 * est plafonne a `PEER_MULTIPLIER` fois le quota fin, ce qui BORNE la
 * multiplication au lieu de la laisser sans borne.
 */

const loadLimiter = async () => import('./rate-limiter.mjs');

/** Un `res` minimal, comme celui de `route-rate-limits.test.mjs`. */
const resFactice = () => ({
  statusCode: 200,
  headersSent: false,
  ended: false,
  corps: null,
  setHeader() {},
  getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end(chunk) {
    this.ended = true;
    if (chunk) {
      try { this.corps = JSON.parse(String(chunk)); } catch { this.corps = String(chunk); }
    }
  },
});

const reqFactice = (peer, xff) => ({
  socket: { remoteAddress: peer },
  headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
});

describe('Rate limit — le seau du PAIR borne la multiplication', () => {
  beforeEach(async () => {
    const { rateLimitBuckets } = await loadLimiter();
    rateLimitBuckets.clear();
  });

  it('falsifier l IP ne sort plus du quota', async () => {
    const { rateLimitGuard, RATE_LIMIT_CONFIG, PEER_MULTIPLIER } = await loadLimiter();
    const max = RATE_LIMIT_CONFIG.admin.max;
    const plafondPair = max * PEER_MULTIPLIER;

    // Un client qui forge une IP differente a chaque requete : chaque
    // requete tombe dans un seau FIN distinct, donc le quota fin ne peut
    // jamais le arreter. Le seau du PAIR, lui, ne bouge pas.
    let dernier = null;
    for (let i = 0; i < plafondPair + 1; i += 1) {
      const res = resFactice();
      rateLimitGuard(res, `198.51.100.${(i % 250) + 1}`, 'admin', '10.0.0.7');
      dernier = res;
    }

    expect(dernier.statusCode, 'la derniere requete doit etre refusee').toBe(429);
    expect(dernier.corps.code).toBe('RATE_LIMITED');
  });

  it('des pairs differents ne se bloquent pas entre eux', async () => {
    const { rateLimitGuard, RATE_LIMIT_CONFIG, PEER_MULTIPLIER } = await loadLimiter();
    const plafondPair = RATE_LIMIT_CONFIG.admin.max * PEER_MULTIPLIER;

    // Le meme volume, mais en changeant de pair : chaque pair a son seau.
    // C est ce qui rend le seau du pair utilisable : il ne bloque pas la
    // plateforme entiere, il borne seulement la multiplication.
    let dernier = null;
    for (let i = 0; i < plafondPair + 1; i += 1) {
      const res = resFactice();
      rateLimitGuard(res, `198.51.100.${(i % 250) + 1}`, 'admin', `10.0.${(i % 250) + 1}.7`);
      dernier = res;
    }
    expect(dernier.statusCode, 'chaque pair a son propre seau').toBe(200);
  });

  it('le quota FIN est inchange : une meme IP reste plafonnee', async () => {
    const { rateLimitGuard, RATE_LIMIT_CONFIG } = await loadLimiter();
    const max = RATE_LIMIT_CONFIG.admin.max;

    let dernier = null;
    for (let i = 0; i < max + 1; i += 1) {
      const res = resFactice();
      rateLimitGuard(res, '198.51.100.42', 'admin', '10.0.0.7');
      dernier = res;
    }
    expect(dernier.statusCode, `la requete ${max + 1} doit etre refusee`).toBe(429);
  });

  it('le seau du pair est par pair ET par groupe', async () => {
    const { checkRateLimitComplet, RATE_LIMIT_CONFIG, PEER_MULTIPLIER } = await loadLimiter();
    const plafond = RATE_LIMIT_CONFIG.admin.max * PEER_MULTIPLIER;

    // Un groupe ne doit pas consommer le quota d un autre.
    for (let i = 0; i < plafond; i += 1) {
      checkRateLimitComplet(`198.51.100.${(i % 250) + 1}`, 'admin', '10.0.0.7');
    }
    const autre = checkRateLimitComplet('198.51.100.99', 'social', '10.0.0.7');
    expect(autre.allowed, 'un autre groupe a son propre seau de pair').toBe(true);
  });

  it('sans pair, le comportement est inchange (compatibilite)', async () => {
    const { checkRateLimitComplet } = await loadLimiter();
    const r = checkRateLimitComplet('198.51.100.42', 'default', null);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeGreaterThan(0);
  });
});

describe('Rate limit — l adresse du pair', () => {
  it('normalise la forme IPv6-mappee', async () => {
    const { getPeerAddress } = await loadLimiter();
    expect(getPeerAddress(reqFactice('::ffff:10.0.0.7'))).toBe('10.0.0.7');
  });

  it('ne leve jamais sur une requete sans socket', async () => {
    const { getPeerAddress } = await loadLimiter();
    expect(getPeerAddress({})).toBe('inconnu');
    expect(getPeerAddress(undefined)).toBe('inconnu');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Chaque point d appel doit transmettre le pair.
//
// PIEGE : un point d appel oublie est un TROU. Le seau du pair existe mais
// ne protege rien si la route ne le lui fournit pas — et le test
// comportemental ci-dessus ne le verrait pas. Ce test de source ferme la
// porte : il compte les points d appel et exige le pair partout.
// ─────────────────────────────────────────────────────────────────────────────
describe('Rate limit — chaque point d appel transmet le pair', () => {
  const lister = (dir) => {
    const sortie = [];
    for (const nom of readdirSync(dir)) {
      const chemin = join(dir, nom);
      if (statSync(chemin).isDirectory()) {
        sortie.push(...lister(chemin));
        continue;
      }
      if (!/\.mjs$/.test(nom)) continue;
      if (/\.test\.mjs$/.test(nom)) continue;
      sortie.push(chemin);
    }
    return sortie;
  };

  it('tous les rateLimitGuard de production passent un pair', () => {
    const fichiers = [
      ...lister(resolve('server/routes')),
      resolve('server/realtime-server.mjs'),
    ];
    // Compteur d arguments QUI COMPTE LES PARENTHESES : `getClientIp(req)`
    // contient une virgule dans ses parenthesees, un simple `split(',')`
    // compterait faux.
    const compterArguments = (appel) => {
      let profondeur = 0;
      let nb = 1;
      for (const c of appel) {
        if (c === '(') profondeur += 1;
        else if (c === ')') {
          profondeur -= 1;
          if (profondeur === 0) break;
        } else if (c === ',' && profondeur === 1) nb += 1;
      }
      return nb;
    };

    const sansPair = [];
    let total = 0;
    for (const f of fichiers) {
      const source = readFileSync(f, 'utf8');
      for (const ligne of source.split(/\r?\n/)) {
        if (!ligne.includes('rateLimitGuard(')) continue;
        total += 1;
        const debut = ligne.indexOf('rateLimitGuard(');
        const appel = ligne.slice(debut);
        if (compterArguments(appel) < 4) sansPair.push(`${f}: ${ligne.trim()}`);
      }
    }
    expect(total, 'des points d appel de rate limit doivent exister').toBeGreaterThan(50);
    expect(sansPair, `points d appel sans pair :\n${sansPair.join('\n')}`).toEqual([]);
  });

  it('tous les checkRateLimit des handlers socket passent un pair', () => {
    const source = readFileSync(resolve('server/realtime-server.mjs'), 'utf8');
    const sansPair = source
      .split(/\r?\n/)
      .filter((l) => l.includes('checkRateLimit(ip,') && !l.includes('checkRateLimitComplet'))
      .map((l) => l.trim());
    expect(sansPair, `handlers socket sans pair :\n${sansPair.join('\n')}`).toEqual([]);
  });
});
