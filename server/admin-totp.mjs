import crypto from 'node:crypto';
import { getAuthenticatedAppSession, respondJson } from './http-utils.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('admin-totp');

// ─── TOTP 2FA (RFC 6238) ──────────────────────────────────────────────────

/** Number of digits in the TOTP code */
export const TOTP_DIGITS = 6;

/** Time step in seconds for TOTP generation */
export const TOTP_PERIOD = 30;

/** HMAC algorithm used for TOTP */
export const TOTP_ALGORITHM = 'sha1';

// ─── Admin 2FA secrets storage ─────────────────────────────────────────────

/**
 * Map of admin TOTP secrets keyed by admin user ID.
 * Each entry: { secret: string, enabled: boolean, verifiedAt: number }
 */
export const adminTotpSecrets = new Map();

// ─── Helper functions ──────────────────────────────────────────────────────

/**
 * Generate a random TOTP secret encoded as base64.
 * @returns {string} Random TOTP secret
 */
export const generateTotpSecret = () => {
  return crypto.randomBytes(20).toString('base64');
};

/**
 * Decode a Base32-encoded string into a Buffer.
 * @param {string} encoded - Base32-encoded string
 * @returns {Buffer} Decoded buffer
 */
export const base32Decode = (encoded) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of encoded.toUpperCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return Buffer.from(bytes);
};

/**
 * Verify a TOTP code against a secret using a ±1 time-step window.
 * @param {string} secret - Base32-encoded TOTP secret
 * @param {string} code - User-provided TOTP code
 * @returns {boolean} True if the code is valid
 */
export const verifyTotp = (secret, code) => {
  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  for (const offset of [-1, 0, 1]) {
    const counter = now + offset;
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuffer.writeUInt32BE(counter & 0xFFFFFFFF, 4);
    const hmac = crypto.createHmac(TOTP_ALGORITHM, key).update(counterBuffer).digest();
    const offset2 = hmac[hmac.length - 1] & 0x0f;
    const otp = ((hmac[offset2] & 0x7f) << 24) | (hmac[offset2 + 1] << 16) | (hmac[offset2 + 2] << 8) | hmac[offset2 + 3];
    const expected = String(otp % Math.pow(10, TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
    if (expected === code) return true;
  }
  return false;
};

/**
 * Encode a Buffer as a Base32 string.
 * @param {Buffer} buffer - Buffer to encode
 * @returns {string} Base32-encoded string
 */
export const toBase32 = (buffer) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
};

// ─── Auth middleware ────────────────────────────────────────────────────────

/**
 * Require an authenticated admin session.
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 * @returns {object|null} Authenticated session or null if rejected
 */
export const requireAdmin = (req, res) => {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
    return null;
  }
  if (session.user.role !== 'admin') {
    log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id });
    respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.' }, req);
    return null;
  }
  return session;
};

/**
 * Require an authenticated admin session with verified 2FA (if enabled).
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 * @returns {object|null} Authenticated session or null if rejected
 */
export const requireAdmin2fa = (req, res) => {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
    return null;
  }
  if (session.user.role !== 'admin') {
    log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id });
    respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.' }, req);
    return null;
  }
  const totpEntry = adminTotpSecrets.get(session.user.id);
  if (totpEntry?.enabled && (!session.admin2faVerified || session.admin2faExpires <= Date.now())) {
    respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', requires2fa: true });
    return null;
  }
  return session;
};
