// ─────────────────────────────────────────────────────────────────────────────
// Routes d'administration (/api/admin/*).
//
// EXTRAIT DE `realtime-server.mjs` SANS MODIFICATION DE LOGIQUE. Le bloc
// original (lignes 2751-2998) est reproduit tel quel ; seule la frontière de
// la fonction change. `handleAdminRoutes` renvoie `true` quand elle a traité
// la requête, ce qui remplace les `return;` de fin de bloc.
//
// L'ordre des routes est préservé : l'appelant les invoque exactement à la
// place qu'occupait le bloc, donc aucun test de route ne peut changer de
// réponse.
//
// Toute opération financière passe par `requireAdmin2fa` : c'est la garantie
// principale de ce fichier, et elle est vérifiée par les E2E admin.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

import { rateLimitGuard, getClientIp } from '../rate-limiter.mjs';
import { verifyTotp, toBase32, adminTotpSecrets, requireAdmin, requireAdmin2fa } from '../admin-totp.mjs';
import {
  respondJson,
  parseRequestBody,
  readBearerToken,
  respondMappedError,
} from '../http-utils.mjs';
import {
  forceReloadFromSupabase,
  getHealthInfo,
  getCommissionStats,
  saveAdminTotpSecret,
  markAdmin2faVerified,
  getStateCollection,
} from '../persistence.mjs';
import {
  submitMatchResultOnServer,
  settlePendingMatchResult,
  resolveDisputeOnServer,
  cancelMatchOnServer,
} from '../match-engine.mjs';
import { saveMatches, buildMatchActionPayload } from '../state-helpers.mjs';
import { withMatchMutex } from '../mutex.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('admin-routes');

/**
 * Traite les routes `/api/admin/*`.
 *
 * @param {object} ctx
 * @param {import('node:http').IncomingMessage} ctx.req
 * @param {import('node:http').ServerResponse} ctx.res
 * @param {string} ctx.pathname
 * @param {object} ctx.io - instance Socket.IO (pour rediffuser les matchs)
 * @returns {Promise<boolean>} `true` si la requête a été traitée
 */
export const handleAdminRoutes = async ({ req, res, pathname, io }) => {
  // Admin: force reload all data from Supabase
  if (req.method === 'POST' && pathname === '/api/admin/reload') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    log.info('Admin force reload from Supabase', { adminId: session.user.id });
    try {
      const ok = await forceReloadFromSupabase();
      const health = getHealthInfo();
      respondJson(res, 200, { ok, persistence: health });
    } catch (err) {
      log.error('Admin reload failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors du rechargement des donnees.', code: 'RELOAD_ERROR' });
    }
    return true;
  }

  // Admin: commissions ZOYD encaissees (frais de retrait + arbitrages).
  // Donnee financiere sensible -> 2FA obligatoire, comme les autres operations
  // financieres. `/api/stats` reste public et ne l'expose PAS.
  if (req.method === 'GET' && pathname === '/api/admin/commissions') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    try {
      respondJson(res, 200, { ok: true, commissions: getCommissionStats() }, req);
    } catch (err) {
      log.error('Admin commissions failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors du calcul des commissions.', code: 'COMMISSIONS_ERROR' }, req);
    }
    return true;
  }

  // SEC-R4: Admin 2FA status — whether TOTP is enabled for this admin
  if (req.method === 'GET' && pathname === '/api/admin/2fa/status') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin(req, res);
    if (!session) return true;
    const entry = adminTotpSecrets.get(session.user.id);
    respondJson(res, 200, { ok: true, enabled: !!entry?.enabled });
    return true;
  }

  // SEC-R4: Admin 2FA setup — generate TOTP secret for admin
  if (req.method === 'POST' && pathname === '/api/admin/2fa/setup') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin(req, res);
    if (!session) return true;
    // Anti-takeover : ré-enrôler une 2FA déjà ACTIVE imposerait de connaitre
    // le secret courant. Sans ce garde, un attaquant ayant le seul mot de passe
    // admin remplaçait le secret, s'auto-validait un code et obtenait l'accès
    // financier complet.
    const existing = adminTotpSecrets.get(session.user.id);
    if (existing?.enabled) {
      respondJson(res, 409, {
        ok: false,
        error: '2FA deja activee. Verifie un code TOTP pour la re-enroller.',
        code: '2FA_ALREADY_ENABLED',
      });
      return true;
    }
    const secret = toBase32(crypto.randomBytes(20));
    adminTotpSecrets.set(session.user.id, { secret, enabled: false, verifiedAt: null });
    try {
      await saveAdminTotpSecret(session.user.id, secret, false);
    } catch (dbErr) {
      log.error('2FA setup: failed to persist secret', { adminId: session.user.id, error: dbErr.message });
    }
    const otpauthUrl = `otpauth://totp/ZOYD:${encodeURIComponent(session.user.email || session.user.pseudo)}?secret=${secret}&issuer=ZOYD`;
    log.info('Admin 2FA setup initiated', { adminId: session.user.id });
    respondJson(res, 200, { ok: true, otpauthUrl });
    return true;
  }

  // SEC-R4: Admin 2FA enable — verify code and activate 2FA
  if (req.method === 'POST' && pathname === '/api/admin/2fa/enable') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await parseRequestBody(req).catch(() => ({}));
    const { code } = body || {};
    if (!code || typeof code !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Code 2FA requis.', code: 'MFA_REQUIRED' });
      return true;
    }
    const totpEntry = adminTotpSecrets.get(session.user.id);
    if (!totpEntry || !totpEntry.secret) {
      respondJson(res, 400, { ok: false, error: 'Aucune configuration 2FA en cours. Effectuez /api/admin/2fa/setup d\'abord.' });
      return true;
    }
    if (totpEntry.enabled) {
      respondJson(res, 400, { ok: false, error: '2FA deja activee.', code: 'MFA_ALREADY_ACTIVE' });
      return true;
    }
    if (!verifyTotp(totpEntry.secret, code)) {
      log.warn('Admin 2FA enable failed — invalid code', { adminId: session.user.id });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.', code: 'MFA_INVALID' });
      return true;
    }
    totpEntry.enabled = true;
    totpEntry.verifiedAt = new Date().toISOString();
    adminTotpSecrets.set(session.user.id, totpEntry);
    try {
      await saveAdminTotpSecret(session.user.id, totpEntry.secret, true);
    } catch (dbErr) {
      log.error('2FA enable: failed to persist secret', { adminId: session.user.id, error: dbErr.message });
    }
    // Persiste sur la session STOCKÉE (getAuthSession renvoie une copie — muter `session` ne suffit pas)
    markAdmin2faVerified(readBearerToken(req));
    log.info('Admin 2FA enabled', { adminId: session.user.id });
    respondJson(res, 200, { ok: true });
    return true;
  }

  // SEC-R4: Admin 2FA verify — verify TOTP code for financial operations
  if (req.method === 'POST' && pathname === '/api/admin/2fa/verify') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await parseRequestBody(req).catch(() => ({}));
    const { code } = body || {};
    if (!code || typeof code !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Code 2FA requis.', code: 'MFA_REQUIRED' });
      return true;
    }
    const totpEntry = adminTotpSecrets.get(session.user.id);
    if (!totpEntry?.enabled) {
      respondJson(res, 400, { ok: false, error: '2FA non active pour ce compte admin.', code: 'MFA_NOT_ACTIVE' });
      return true;
    }
    if (!verifyTotp(totpEntry.secret, code)) {
      log.warn('Admin 2FA verify failed — invalid code', { adminId: session.user.id });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.', code: 'MFA_INVALID' });
      return true;
    }
    // Persiste sur la session STOCKÉE (getAuthSession renvoie une copie — muter `session` ne suffit pas)
    markAdmin2faVerified(readBearerToken(req));
    log.info('Admin 2FA verified', { adminId: session.user.id });
    respondJson(res, 200, { ok: true });
    return true;
  }

  const adminMatchAward = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/award$/);
  if (req.method === 'POST' && adminMatchAward) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      if (body.winnerTeam !== 0 && body.winnerTeam !== 1) {
        respondJson(res, 400, { ok: false, error: 'winnerTeam doit être 0 ou 1.', code: 'INVALID_WINNER' });
        return;
      }
      const currentMatches = getStateCollection('matches');
      const targetMatch = currentMatches.find((entry) => entry.id === adminMatchAward[1]);
      const defaultScores = body.winnerTeam === 0 ? { team0: 1, team1: 0 } : { team0: 0, team1: 1 };
      // Décision de modération = décision finale : pas de fenêtre de
      // confirmation (l'admin arbitre, les joueurs n'ont plus à confirmer).
      //
      // MAIS en DEUX PHASES, comme le chemin joueur. `deferSettlement: true`
      // persiste d'abord `payoutDistributed: 'pending'`, et le versement a
      // lieu ensuite. Avec `false`, les portefeuilles étaient crédités AVANT
      // `saveMatches` : un crash ou un 503 d'écriture Supabase entre les deux
      // laissait l'argent parti sans trace, et l'admin pouvait attribuer une
      // seconde fois. Le job de reprise du cron doit pouvoir voir le match.
      const outcome = await submitMatchResultOnServer(currentMatches, session.user, adminMatchAward[1], {
        winnerTeam: body.winnerTeam,
        scores: targetMatch?.result?.scores || defaultScores,
        screenshots: targetMatch?.result?.screenshots || [],
        proofs: targetMatch?.result?.proofs,
        arbiterNotes: body.arbiterNotes || 'Resolution admin depuis le command center.',
        submittedBy: 'admin-dashboard',
      }, { deferSettlement: true });

      // Phase 1 : le résultat est persisté avec `payoutDistributed:'pending'`.
      await saveMatches(io, outcome.matches, outcome.match);

      // Phase 2 : le versement, maintenant que l'état est en base.
      const settled = await settlePendingMatchResult(outcome.matches, adminMatchAward[1]);
      await saveMatches(io, settled.matches, settled.match);

      if (settled.match?.result?.payoutDistributed !== true) {
        log.error('Admin award settlement incomplete', { matchId: adminMatchAward[1] });
      }
      log.info('Admin action: award match', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchAward[1], winnerTeam: body.winnerTeam });
      // `settled` n'existait pas ici (oublie lors du refactor du reglement) :
      // le payload renvoye a l'admin etait donc vide apres une attribution
      // reussie, et l'UI ne rafraichissait pas le match.
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return true;
  }

  const adminMatchResolve = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/resolve-dispute$/);
  if (req.method === 'POST' && adminMatchResolve) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      // `action` explicite : le règlement d'un litige BOUGGE de l'argent
      // (paiement du résultat ou remboursement des passes). Sans cela, un
      // litige clos laissait la cagnotte gelée pour toujours.
      const outcome = await resolveDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchResolve[1],
        body.resolution || 'Litige clos par moderation.',
        { action: body.action }
      );
      await saveMatches(io, outcome.matches, outcome.match);
      log.info('Admin action: resolve dispute', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchResolve[1], resolution: body.resolution });
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return true;
  }

  const adminMatchCancel = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && adminMatchCancel) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await cancelMatchOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchCancel[1],
        body.reason || 'Match annule par moderation.'
      );
      await saveMatches(io, outcome.matches, outcome.match);
      log.info('Admin action: cancel match', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchCancel[1], reason: body.reason });
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return true;
  }

  return false;
};
