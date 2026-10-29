/**
 * server/admin-totp.mjs - Double authentification TOTP (RFC 6238) des
 * administrateurs, et gardes d'autorisation associees.
 *
 * Trois exports servent de garde aux routes : `requireAdmin` (role admin),
 * `requireAdmin2fa` (role admin + 2FA verifiee) et `require2faIfAdmin`
 * (session quelconque ; l'admin seul doit avoir une 2FA fraiche) - plus le
 * stockage des secrets.
 *
 * INVARIANT : `requireAdmin` et `requireAdmin2fa` repondent EUX-MEMES sur un
 *   refus (401/403 + code) : l'appelant doit faire `return true` immediatement
 *   et ne JAMAIS repondre une seconde fois. `require2faIfAdmin` suit la meme
 *   discipline (401 sans session, 403 + code 2FA_REQUIRED pour un admin).
 * INVARIANT : toute operation financiere ou de moderation passe par
 *   `requireAdmin2fa` ; `requireAdmin` seul ne couvre que les routes de
 *   configuration de la 2FA (status / setup / enable / verify). Les routes
 *   mixtes (arbitre OU admin en override) brassent l'argent sur un chemin
 *   non admin : elles passent par `require2faIfAdmin` - sinon un mot de
 *   passe admin compromis suffit a ecrire un resultat payant sans TOTP
 *   (contours S1/S2/S3 de l'audit-2).
 * INVARIANT : `TOTP_WINDOW_STEPS = 0` - un code n'est accepte que pendant
 *   SON pas de 30 s : il n'est donc pas rejouable.
 * INVARIANT : le secret n'est lu que dans `adminTotpSecrets`, repeuple au
 *   demarrage par `loadAdminTotpSecrets` depuis la base.
 * INVARIANT : la verification est en temps CONSTANT (`timingSafeEqual`) sur
 *   deux tampons de meme taille : jamais une comparaison de chaines.
 * PIEGE : `verifyTotp` exige une CHAINUE de exactement 6 chiffres : un
 *   nombre est refuse meme s'il s'affiche correctement.
 * PIEGE : `adminTotpSecrets` vit en memoire : une Map vide au demarrage
 *   signifie "aucun secret charge", pas "2FA desactivee" - d'ou le mot
 *   de passe obligatoire sur `/api/admin/2fa/setup`.
 * PIEGE : `requireAdmin2fa` verifie `admin2faVerified` ET `admin2faExpires` :
 *   un seul des deux ne suffit pas.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

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
 * Fenêtre de tolérance, en pas de temps.
 *
 * `0` = le code n'est accepté que pendant SON pas de 30 s. C'est le choix
 * fait : sa durée de vie est de 30 s au lieu de 90 s (±1 pas avant).
 *
 * P8 C1 (audit-3) — le rejeu précisé : sans cache de codes utilisés, un
 * code reste VALIDE tout au long de son pas de 30 s et peut etre soumis
 * plusieurs fois ; ce que la fenêtre 0 bloque, c'est le rejeu D'UN PAS A
 * L'AUTRE. L'exposition reelle reste etroite : il faut le code ET une
 * session admin valide (le flag `admin2faVerified` est posé SUR la
 * session).
 *
 * Le compromis assumé : si l'horloge du téléphone de l'administrateur dérive
 * de plus d'une quinzaine de secondes, le code sera refusé alors qu'il est
 * parfaitement affiché. D'où le décompte affiché dans l'interface — il indique
 * le temps restant côté SERVEUR, pour attendre simplement le code suivant
 * plutôt que de resubmitter un code périmé.
 *
 * Passer à 1 rétablit la tolérance ±1 pas (90 s) si un jour un appareil
 * dérive trop : une seule constante à modifier.
 */
export const TOTP_WINDOW_STEPS = 0;

/**
 * Verify a TOTP code against a secret using a bounded time-step window.
 * @param {string} secret - Base32-encoded TOTP secret
 * @param {string} code - User-provided TOTP code
 * @returns {boolean} True if the code is valid
 */
export const verifyTotp = (secret, code) => {
  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  // Type STRICT a la porte de la boucle (P8 C1 audit-3) : le garde vivait
  // DANS la boucle HMAC — fenêtre 0 = une iteration, donc invisible ; passer
  // `TOTP_WINDOW_STEPS` a ±1 le re-evaluerait une fois par pas au lieu d'une
  // fois par appel. Coercer un nombre en chaine ferait passer
  // `verifyTotp(secret, 287082)` alors que le type ne correspond pas : une
  // fonction tolérante sur les types est un piege, meme si la route filtre
  // deja le corps de la requete.
  if (typeof code !== 'string' || code.length !== TOTP_DIGITS) return false;
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset++) {
    const counter = now + offset;
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuffer.writeUInt32BE(counter & 0xFFFFFFFF, 4);
    const hmac = crypto.createHmac(TOTP_ALGORITHM, key).update(counterBuffer).digest();
    const offset2 = hmac[hmac.length - 1] & 0x0f;
    const otp = ((hmac[offset2] & 0x7f) << 24) | (hmac[offset2 + 1] << 16) | (hmac[offset2 + 2] << 8) | hmac[offset2 + 3];
    const expected = String(otp % Math.pow(10, TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
    // Comparaison en temps constant : deux entrees de tailles differentes ne
    // peuvent pas etre comparees, et `timingSafeEqual` leve sur des tampons
    // de tailles inegales.
    try {
      const expectedBuf = Buffer.from(expected, 'utf-8');
      const codeBuf = Buffer.from(code, 'utf-8');
      if (crypto.timingSafeEqual(expectedBuf, codeBuf)) return true;
    } catch { /* format de code invalide */ }
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
 * Require an authenticated admin session, plus verified 2FA (OBLIGATOIRE
 * sur les routes financières/modération). Sans 2FA activée → 403 avec
 * code 2FA_REQUIRED (l'admin l'active dans Paramètres > Sécurité,
 * endpoints /api/admin/2fa/* qui restent accessibles au mot de passe).
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
    // `code` obligatoire : sans lui, apiClient ne peut pas distinguer un 403
    // d'autorisation d'une session expiree, et deconnectait le joueur.
    respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.', code: 'ADMIN_REQUIRED' }, req);
    return null;
  }
  const totpEntry = adminTotpSecrets.get(session.user.id);
  if (!totpEntry?.enabled) {
    respondJson(res, 403, { ok: false, error: 'Active la 2FA dans Paramètres > Sécurité pour cette action.', code: '2FA_REQUIRED', requires2fa: true });
    return null;
  }
  if (!session.admin2faVerified || session.admin2faExpires <= Date.now()) {
    respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', code: '2FA_REQUIRED', requires2fa: true });
    return null;
  }
  return session;
};

/**
 * Require a valid session; an ADMIN session is additionally bound to a fresh
 * 2FA verification (same rules as `requireAdmin2fa`), while any other role
 * passes through unchanged.
 *
 * Pour les routes mixtes ou un joueur arbitre peut agir sans etre admin
 * (`POST /api/matches/:id/result|arbiter`, `POST /api/tournaments/:id/
 * matches/:mid/result`) : l'override admin doit couter le meme code TOTP
 * que la route /api/admin/* equilibree - sinon le mot de passe admin
 * compromis suffit a ecrire un resultat payant (audit-2 S1/S3).
 *
 * Meme discipline que `requireAdmin2fa` : la garde repond EUX-MEME au refus
 * (401/403 + code), l'appelant fait `return true` immediatement.
 *
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('http').ServerResponse} res - HTTP response
 * @returns {object|null} Session (non admin) ou admin 2FA-fraiche, sinon null
 */
export const require2faIfAdmin = (req, res) => {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
    return null;
  }
  if (session.user.role !== 'admin') {
    return session;
  }
  const totpEntry = adminTotpSecrets.get(session.user.id);
  if (!totpEntry?.enabled) {
    respondJson(res, 403, { ok: false, error: 'Active la 2FA dans Paramètres > Sécurité pour cette action.', code: '2FA_REQUIRED', requires2fa: true });
    return null;
  }
  if (!session.admin2faVerified || session.admin2faExpires <= Date.now()) {
    respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', code: '2FA_REQUIRED', requires2fa: true });
    return null;
  }
  return session;
};
