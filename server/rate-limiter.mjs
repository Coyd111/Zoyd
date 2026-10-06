import { respondJson } from './http-utils.mjs';

/** @type {Map<string, { windowStart: number, attempts: number, group: string }>} */
const rateLimitBuckets = new Map();
const MAX_RATE_LIMIT_BUCKETS = 50000;

/** @type {{ auth: { max: number, windowMs: number }, social: { max: number, windowMs: number }, wallet: { max: number, windowMs: number }, chat: { max: number, windowMs: number }, admin: { max: number, windowMs: number }, default: { max: number, windowMs: number } }} */
const RATE_LIMIT_CONFIG = {
  auth:    { max: 50,  windowMs: 15 * 60 * 1000 },
  social:  { max: 30,  windowMs: 60 * 1000 },
  wallet:  { max: 20,  windowMs: 10 * 60 * 1000 },
  chat:    { max: 60,  windowMs: 60 * 1000 },
  admin:   { max: 20,  windowMs: 5 * 60 * 1000 },
  default: { max: 60,  windowMs: 60 * 1000 },
};

/**
 * Assouplissement EXCLUSIVEMENT pour les tests automatises.
 *
 * L'E2E rejoue des dizaines de scenarios depuis une seule IP (127.0.0.1) :
 * le bucket `default` (60/min) le bloquait, et les echecs 429 faisaient
 * echouer des tests au hasard — au point qu'un test qui passait devait etre
 * relance pour « fonctionner ». On ne teste pas la logique metier ici.
 *
 * Double condition :
 *   - `NODE_ENV=test` : la production tourne en `NODE_ENV=production` (Render),
 *     donc la branche est inatteignable chez nous meme si quelqu'un pose
 *     `ALLOW_DEBUG_CODES` par erreur.
 *   - `ALLOW_DEBUG_CODES=true`, qui n'est pose que par le harness E2E.
 *
 * Sans ces deux variables, la configuration ci-dessus s'applique telle quelle.
 */
const TEST_ONLY_RELAXATION = process.env.NODE_ENV === 'test'
  && process.env.ALLOW_DEBUG_CODES === 'true';

if (TEST_ONLY_RELAXATION) {
  for (const group of Object.keys(RATE_LIMIT_CONFIG)) {
    RATE_LIMIT_CONFIG[group].max = Number(process.env.ZOYD_RATE_LIMIT_MAX || 100000);
    RATE_LIMIT_CONFIG[group].windowMs = 1;
  }
}

/**
 * Check whether the given IP has exceeded the rate limit for a group.
 * @param {string} ip
 * @param {string} [group='default']
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
const checkRateLimit = (ip, group = 'default') => {
  const config = RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default;
  const key = `${ip}|${group}`;
  const now = Date.now();
  const record = rateLimitBuckets.get(key);
  if (!record || now - record.windowStart > config.windowMs) {
    // Evict oldest if at capacity
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      const oldest = rateLimitBuckets.keys().next().value;
      rateLimitBuckets.delete(oldest);
    }
    rateLimitBuckets.set(key, { windowStart: now, attempts: 1, group });
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 };
  }
  record.attempts += 1;
  const allowed = record.attempts <= config.max;
  const retryAfter = allowed ? 0 : Math.ceil((record.windowStart + config.windowMs - now) / 1000);
  return { allowed, remaining: Math.max(0, config.max - record.attempts), retryAfter };
};

/** Remove expired entries from the rate-limit buckets. */
const cleanupRateLimits = () => {
  const now = Date.now();
  for (const [key, record] of rateLimitBuckets) {
    const config = RATE_LIMIT_CONFIG[record.group] || RATE_LIMIT_CONFIG.default;
    if (now - record.windowStart > config.windowMs) rateLimitBuckets.delete(key);
  }
};

setInterval(cleanupRateLimits, 60 * 1000);

/**
 * Validate that a string is a plausible IPv4/IPv6 address.
 *
 * Le motif precedent acceptait `...`, `deadbeef`, `:::::` : n'importe quelle
 * chaîne made-up passait et devenait une CLE DE BUCKET. Ce n'etait pas une
 * faille (un attaquant veut de toute facon des buckets distincts), mais cela
 * consommait des slots du plafond `MAX_RATE_LIMIT_BUCKETS` avec des clefs
 * inutiles. On exige maintenant une vraie adresse.
 * @param {string} ip
 * @returns {boolean}
 */
const isValidIp = (ip) => {
  const value = String(ip || '').trim();
  if (!value || value.length > 45) return false;
  // IPv4 : 4 groupes 0-255.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255);
  }
  // IPv6 : uniquement des hexets, deux-points, un eventuel IPv4 integre et une
  // zone (`%eth0`). `::1` et `::` doivent passer (loopback), `:::::` non.
  if (!value.includes(':')) return false;
  const [address] = value.split('%');
  if (!/^[0-9a-f:.]+$/i.test(address)) return false;
  if ((address.match(/::/g) || []).length > 1) return false; // compresse unique
  if (address.includes(':::')) return false;
  const groups = address.split(':').filter((g) => g !== '');
  if (groups.length === 0) return true;                       // `::` seul
  // Chaque groupe : 1-4 hexets, ou un IPv4 integre sur le dernier.
  return groups.every((group, index) => {
    if (group.includes('.')) {
      return index === groups.length - 1
        && /^\d{1,3}(\.\d{1,3}){3}$/.test(group)
        && group.split('.').every((o) => Number(o) <= 255);
    }
    return /^[0-9a-f]{1,4}$/i.test(group);
  });
};

/**
 * True if the direct TCP peer is a proxy/private hop (Render proxy, Docker,
 * localhost). X-Forwarded-For is only trusted in that case — sinon un client
 * pourrait forger l'en-tête et contourner le rate limit.
 *
 * TRUST_PROXY=true force la confiance (déployé derrière un LB dont le peer
 * n'est pas dans une plage privée). Le danger symétrique de cette option : si
 * le service est exposé directement, n'importe qui forge son XFF.
 */
const isTrustedProxyPeer = (remoteAddress) => {
  if (String(process.env.TRUST_PROXY || '').toLowerCase() === 'true') return true;
  if (!remoteAddress) return false;
  const ip = String(remoteAddress).replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const m172 = /^172\.(\d+)\./.exec(ip);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^(fc|fd)/i.test(ip)) return true;
  return false;
};

/**
 * Extract the real client IP from a request. X-Forwarded-For is honored
 * only when the direct peer is a trusted proxy (Render).
 *
 * ⚠️ On prend la DERNIÈRE valeur de X-Forwarded-For, pas la première.
 * Un proxy n'efface pas l'en-tête : il APPENDA son IP. Un client peut donc
 * envoyer `X-Forwarded-For: 1.2.3.4` et le proxy produit
 * `1.2.3.4, <IP reelle du client>`. Lire `[0]` rendait cette valeur
 * entièrement contrôlable par l'appelant : il suffisait de changer
 * d'en-tête à chaque requête pour obtenir un bucket neuf et contourner
 * complètement le rate-limit (donc le anti-bruteforce des 50 essais / 15 min).
 * La dernière valeur est celle qu'a posée le proxy de confiance, donc la
 * seule que l'appelant ne contrôle pas.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
const getClientIp = (req) => {
  const peer = req.socket?.remoteAddress || '';
  if (isTrustedProxyPeer(peer)) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const hops = forwarded
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
      // Le dernier saut est le plus proche du client et donc non falsifiable.
      const lastHop = hops[hops.length - 1];
      if (lastHop && isValidIp(lastHop)) return lastHop;
    }
  }
  return peer || '127.0.0.1';
};

/**
 * Guard an HTTP response against rate limiting.
 * Sends a 429 response and returns false if the limit is exceeded.
 * @param {import('http').ServerResponse} res
 * @param {string} ip
 * @param {string} group
 * @returns {boolean} true if the request is allowed, false if rate-limited
 */
const rateLimitGuard = (res, ip, group) => {
  const { allowed, retryAfter } = checkRateLimit(ip, group);
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter));
    respondJson(res, 429, { ok: false, error: 'Trop de requetes. Reessayez plus tard.', code: 'RATE_LIMITED' });
    return false;
  }
  return true;
};

export {
  rateLimitBuckets,
  RATE_LIMIT_CONFIG,
  checkRateLimit,
  cleanupRateLimits,
  isValidIp,
  getClientIp,
  rateLimitGuard,
};
