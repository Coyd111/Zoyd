import { getAuthSession, getRealtimeSession } from './persistence.mjs';
import { incCounter, endTimer } from './metrics.mjs';
import { log } from './logger.mjs';

/**
 * @param {string} name
 * @param {string} value
 * @param {object} [options]
 * @returns {string}
 */
export const serializeCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join('; ');
};

/** @type {string[]} */
export const ALLOWED_ORIGINS = [
  ...(process.env.ZOYD_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  'https://zoyd.vercel.app',
  'https://zoyd.africa',
  'https://www.zoyd.africa',
];

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export const getCorsOrigin = (req) => {
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
};

/**
 * Send a JSON response with security headers and optional metrics recording.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {object} payload
 * @param {import('node:http').IncomingMessage} [req]
 */
export const respondJson = (res, statusCode, payload, req = null) => {
  const effectiveReq = req || res._req;
  const origin = effectiveReq ? getCorsOrigin(effectiveReq) : ALLOWED_ORIGINS[0];
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Vary': 'Origin',
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://cdn.fedapay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws: https: http:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; frame-ancestors 'none';",
  });
  res.end(JSON.stringify(payload));

  if (effectiveReq && effectiveReq._metricsStart) {
    const pathname = effectiveReq._metricsPathname || 'unknown';
    const method = effectiveReq.method || 'UNKNOWN';
    const labels = { method, status: String(statusCode) };
    incCounter('zoyd_http_requests_total', labels);
    endTimer('zoyd_http_request_duration_seconds', effectiveReq._metricsStart, { method, pathname });
    if (statusCode >= 500) incCounter('zoyd_http_errors_total', { method, status: String(statusCode) });
  }
};

/**
 * @param {string} url
 * @returns {{ limit: number, offset: number }}
 */
export const parseQueryParams = (url) => {
  const params = new URL(url, 'http://localhost').searchParams;
  return {
    limit: Math.min(Math.max(parseInt(params.get('limit') || '100', 10) || 100, 1), 500),
    offset: Math.max(parseInt(params.get('offset') || '0', 10) || 0, 0),
  };
};

/**
 * @param {Array} arr
 * @param {{ limit: number, offset: number }} opts
 * @returns {Array}
 */
export const paginate = (arr, { limit, offset }) => arr.slice(offset, offset + limit);

/** @type {number} Max request body size in bytes (1 MB). */
export const BODY_SIZE_LIMIT = 1 * 1024 * 1024;

/**
 * Parse a JSON request body with size limit enforcement.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<object>}
 */
export const parseRequestBody = async (req) => {
  const chunks = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > BODY_SIZE_LIMIT) {
      throw Object.assign(new Error('Payload trop volumineux (max 1MB).'), { code: 'PAYLOAD_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    throw Object.assign(new Error('Corps de requête JSON invalide.'), { code: 'INVALID_JSON' });
  }
};

/**
 * Extract a bearer token from the request cookie or Authorization header.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string|null}
 */
export const readBearerToken = (req) => {
  const cookies = req.headers.cookie;
  if (cookies) {
    const cookieToken = cookies.split(';').find(c => c.trim().startsWith('zoyd_auth='));
    if (cookieToken) {
      const value = cookieToken.split('=').slice(1).join('=').trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
};

/**
 * Resolve the authenticated app session from the request token.
 * @param {import('node:http').IncomingMessage} req
 * @returns {object|null}
 */
export const getAuthenticatedAppSession = (req) => {
  const token = readBearerToken(req);
  return token ? getAuthSession(token) : null;
};

/**
 * Resolve the authenticated realtime session from the request token.
 * @param {import('node:http').IncomingMessage} req
 * @returns {object|null}
 */
export const getAuthenticatedRealtimeSession = (req) => {
  const token = readBearerToken(req);
  return token ? getRealtimeSession(token) : null;
};

/**
 * Extract the pathname from an incoming request.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export const getPathname = (req) => new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

/**
 * Normalize a pathname by replacing dynamic segments with wildcards for metrics.
 * @param {string} pathname
 * @returns {string}
 */
export const normalizePathForMetrics = (pathname) =>
  pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/*')
    .replace(/\/M-[A-Za-z0-9]+/g, '/M/*')
    .replace(/\/T-[A-Za-z0-9]+/g, '/T/*')
    .replace(/\/FR-[A-Za-z0-9-]+/g, '/FR/*');

/**
 * Map a persistence-layer error code to an HTTP status and message.
 * @param {Error & { code?: string }} error
 * @returns {{ status: number, message: string, code: string }}
 */
export const mapPersistenceError = (error) => {
  const code = error?.code || 'UNKNOWN_ERROR';
  const message = error?.message || 'Une erreur serveur est survenue.';
  switch (code) {
    case 'INVALID_REGISTRATION':
      return { status: 400, message, code };
    case 'INVALID_AMOUNT':
    case 'WITHDRAWAL_MIN':
    case 'MATCH_SEGMENT_MISMATCH':
    case 'ROOM_INCOMPLETE':
    case 'ROOM_TOO_EARLY':
    case 'PROOFS_REQUIRED':
    case 'DISPUTE_INCOMPLETE':
    case 'MATCH_NOT_READY':
    case 'CHECKIN_REQUIRED':
    case 'INVALID_MATCH':
    case 'NOT_ENOUGH_PLAYERS':
    case 'QUALIFICATION_INCOMPLETE':
    case 'REGISTRATION_CLOSED':
    case 'NOT_JOINED':
    case 'MATCH_ALREADY_LIVE':
    case 'NO_PLAYERS':
    case 'INVALID_DAY':
    case 'INVALID_RESULTS':
      return { status: 400, message, code };
    case 'INVALID_CREDENTIALS':
      return { status: 401, message, code };
    case 'FORBIDDEN':
      return { status: 403, message, code };
    case 'DUPLICATE_PSEUDO':
    case 'DUPLICATE_EMAIL':
    case 'DUPLICATE_PHONE':
    case 'DUPLICATE_GAME_ID':
    case 'INSUFFICIENT_FUNDS':
    case 'MATCH_CLOSED':
    case 'ALREADY_JOINED':
    case 'ROLE_CONFLICT':
    case 'TRUST_REQUIRED':
    case 'NO_SLOT_AVAILABLE':
    case 'ARBITER_TAKEN':
    case 'SELF_BLOCK':
      return { status: 409, message, code };
    case 'INVALID_JSON':
    case 'PAYLOAD_TOO_LARGE':
      return { status: 400, message, code };
    case 'RESULT_NOT_FOUND':
    case 'RESULT_ALREADY_EXISTS':
    case 'DISPUTE_ALREADY_OPEN':
    case 'DISPUTE_NOT_FOUND':
    case 'DISPUTE_ALREADY_ESCALATED':
    case 'ALREADY_FRIENDS':
    case 'REQUEST_PENDING':
    case 'ALREADY_CONFIRMED':
    case 'INVALID_REQUEST':
      return { status: 409, message, code };
    case 'NOT_FOUND':
    case 'MATCH_NOT_FOUND':
    case 'TOURNAMENT_NOT_FOUND':
    case 'LEAGUE_NOT_FOUND':
    case 'CHANNEL_NOT_FOUND':
    case 'PLAYER_NOT_FOUND':
    case 'USER_NOT_FOUND':
      return { status: 404, message, code };
    default:
      return { status: 500, message: 'Une erreur serveur est survenue.', code };
  }
};

/**
 * Send a JSON error response derived from a mapped persistence error.
 * @param {import('node:http').ServerResponse} res
 * @param {Error} error
 */
export const respondMappedError = (res, error) => {
  const mapped = mapPersistenceError(error);
  if (mapped.status === 500) {
    log.error('[HTTP] 500', { message: error?.message, code: mapped.code, stack: error?.stack?.split('\n').slice(0, 3).join(' | ') });
  }
  respondJson(res, mapped.status, { ok: false, error: mapped.message, code: mapped.code });
};
