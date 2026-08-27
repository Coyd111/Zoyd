import { respondJson } from './http-utils.mjs';

/** @type {Map<string, { windowStart: number, attempts: number }>} */
const rateLimitBuckets = new Map();

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
 * Check whether the given IP has exceeded the rate limit for a group.
 * @param {string} ip
 * @param {string} [group='default']
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
const checkRateLimit = (ip, group = 'default') => {
  const config = RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default;
  const key = `${ip}:${group}`;
  const now = Date.now();
  const record = rateLimitBuckets.get(key);
  if (!record || now - record.windowStart > config.windowMs) {
    rateLimitBuckets.set(key, { windowStart: now, attempts: 1 });
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
    const group = key.split(':').pop();
    const config = RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default;
    if (now - record.windowStart > config.windowMs) rateLimitBuckets.delete(key);
  }
};

setInterval(cleanupRateLimits, 60 * 1000);

/**
 * Validate that a string looks like an IPv4/IPv6 address.
 * @param {string} ip
 * @returns {boolean}
 */
const isValidIp = (ip) => /^[\d.:a-fA-F]+$/.test(ip);

/**
 * Extract the real client IP from a request, respecting X-Forwarded-For
 * (set by Render proxy). Falls back to the socket remote address.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (isValidIp(firstIp)) return firstIp;
  }
  return req.socket.remoteAddress || '127.0.0.1';
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
