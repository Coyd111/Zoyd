/**
 * server/routes/admin.mjs - Domaine ADMINISTRATION : rechargement force de la
 * base, commissions ZOYD, file de moderation des signalements, sanctions,
 * export de l'historique des matchs, configuration de la 2FA, attribution de
 * match, cloture de litige, annulation de match.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : rate limit (`admin`) -> `requireAdmin2fa` (ou
 * `requireAdmin` sur les seules routes 2FA) -> lecture du corps -> moteur ->
 * `saveMatches` -> reponse. Le rate limit passe AVANT le garde 2FA : le
 * quota doit proteger le garde, pas l'inverse.
 *
 * INVARIANT : toute operation financiere ou de moderation exige la 2FA
 *   (`requireAdmin2fa`). Seul le trio status / setup / enable / verify de la
 *   2FA utilise `requireAdmin`.
 * INVARIANT : l'attribution d'un match se fait en DEUX PHASES :
 *   `deferSettlement: true` persiste le resultat avec `payoutDistributed`
 *   a `'pending'`, puis `settlePendingMatchResult` verse. Crediter avant
 *   l'ecriture laissait l'argent parti sans trace.
 * INVARIANT : la cloture d'un litige exige une action EXPLICITE (`settle` ou
 *   `refund`) : sans elle la cagnotte restait gelee pour toujours.
 * INVARIANT : l'export et la lecture des signalements repondent 503
 *   (`SERVER_BUSY`) quand la base est absente : une liste vide se lirait
 *   comme "aucun match" ou "aucune file de moderation".
 * INVARIANT : la resolution d'un signalement porte une TRACE (qui a tranche,
 *   quand, avec quoi) : un signalement traite sans trace ne vaut rien en cas
 *   de contestation.
 * PIEGE : le CSV est echappe (`csvCell`) et prefixe d'un BOM UTF-8 : sans
 *   BOM, Excel casse les accents et le fichier parait corrupt.
 * PIEGE : l'installation de la 2FA exige le mot de passe admin : le garde
 *   anti-takeover repose sur un secret en base, pas seulement en memoire.
 * PIEGE : re-enroller une 2FA ACTIVE est refuse (409 `2FA_ALREADY_ENABLED`).
 * PIEGE : `markAdmin2faVerified` agit sur la session STOCKEE : muter la
 *   copie renvoyee par `getAuthSession` n'a aucun effet.
 * PIEGE : la fenetre TOTP est de 30 s : l'interface doit afficher le temps
 *   restant.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

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
import { verifyTotp, toBase32, adminTotpSecrets, requireAdmin, requireAdmin2fa, TOTP_PERIOD } from '../admin-totp.mjs';
import {
  respondJson,
  parseRequestBody,
  parseQueryParams,
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
  listUserReports,
} from '../persistence.mjs';
import {
  submitMatchResultOnServer,
  settlePendingMatchResult,
  resolveDisputeOnServer,
  cancelMatchOnServer,
} from '../match-engine.mjs';
  import { sanitizeText, resolveReport, listActiveSanctions, revokeSanction, getUserById, exportMatchHistory, verifyUserPassword } from '../persistence.mjs';
  import { isSanctionKind } from '../moderation.mjs';
  import { getNow } from '../utils.mjs';
  import { saveMatches, buildMatchActionPayload } from '../state-helpers.mjs';
import { withMatchMutex } from '../mutex.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('admin-routes');

/**
 * Cellule CSV.
 *
 * Un pseudo ou une description peut contenir une virgule, un guillemet ou un
 * retour a la ligne. Sans echappement, la ligne se decale et tout l export
 * devient illisible a partir de la premiere virgule parasite — silencieusement.
 *
 * Le BOM UTF-8 est prefixe : sans lui, Excel casse les accents, et un fichier
 * d'historique ouvert par un non-technique parait corrupt.
 */
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const buildMatchesCsv = (matches) => {
  const columns = [
    'id', 'format', 'status', 'createdAt', 'finishedAt', 'scheduledAt',
    'entryFee', 'prizePool', 'zoydFee', 'arbiterFee', 'creatorPseudo',
    'players', 'winner', 'payouts',
  ];

  const rows = matches.map((match) => {
    const payouts = Array.isArray(match.payouts)
      ? match.payouts
          .map((p) => `${p.userId || ''}:${p.pseudo || ''}:${p.amount ?? ''}`)
          .join(' | ')
      : '';
    return [
      match.id,
      match.format,
      match.status,
      match.createdAt,
      match.finishedAt || '',
      match.scheduledAt || '',
      match.entryFee ?? '',
      match.prizePool ?? '',
      match.zoydFee ?? '',
      match.arbiterFee ?? '',
      match.creatorPseudo || '',
      Array.isArray(match.players) ? match.players.map((p) => p?.pseudo || p?.userId || '').join(' | ') : '',
      match.winner ?? '',
      payouts,
    ].map(csvCell).join(',');
  });

  return `\uFEFF${columns.join(',')}\n${rows.join('\n')}\n`;
};

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

  // Signalements de joueurs — LECTURE SEULE.
  //
  // Ces lignes etaient ecrites depuis le debut, mais rien ne les relisait :
  // le tableau de bord n'affichait que les signalements faits dans le
  // navigateur courant. Un admin qui ouvrait son tableau de bord ailleurs, ou
  // apres un rechargement, n'en voyait aucun. Cette route ferme la boucle.
  //
  // 2FA obligatoire, comme `/api/admin/commissions` : un signalement accuse
  // une personne, et le contenu releve des identites de joueurs.
  if (req.method === 'GET' && pathname === '/api/admin/reports') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const { limit, offset } = parseQueryParams(req.url);
      const status = (url.searchParams.get('status') || '').trim();
      const targetId = (url.searchParams.get('targetId') || '').trim();

      const result = await listUserReports({
        status: status || undefined,
        targetId: targetId || undefined,
        limit,
        offset,
      });

      // Erreur de base -> 503. Jamais `[]` : l admin doit pouvoir distinguer
      // « aucun signalement » de « table injoignable ».
      if (!result.ok) {
        respondJson(res, 503, {
          ok: false,
          error: 'Signalements indisponibles, reessaie dans un instant.',
          code: 'SERVER_BUSY',
        }, req);
        return true;
      }

      respondJson(res, 200, {
        ok: true,
        reports: result.reports,
        total: result.total,
        limit,
        offset,
        // Signale explicitement que la base est absente, plutot que de
        // laisser croire a une file de moderation vide.
        degraded: result.degraded === true,
      }, req);
    } catch (err) {
      log.error('Admin reports failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la lecture des signalements.', code: 'REPORTS_ERROR' }, req);
    }
    return true;
  }

  // Traitement d'un signalement — file d'attente de moderation.
  //
  // Chaque resolution porte une TRACE : qui a tranche (adminId), quand
  // (reviewed_at), avec quoi (resolution) et sur quelle base (report_id lie a
  // la sanction). Un signalement traite sans trace ne vaut rien en cas de
  // contestation : le joueur doit pouvoir demander le motif.
  //
  // La sanction appliquee depend de la GRAVITE, mais elle est CHOISIE par
  // l admin, pas declenchee automatiquement. Bannir sur un signalement unique
  // reviendrait a laisser n'importe quel joueur faire bannir un rival.
  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/reports\/([^/]+)\/resolve$/)) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    const reportId = decodeURIComponent(pathname.match(/^\/api\/admin\/reports\/([^/]+)\/resolve$/)[1]);
    try {
      const body = await parseRequestBody(req);
      const resolution = String(body?.resolution || '').trim();
      if (!isSanctionKind(resolution)) {
        respondJson(res, 400, {
          ok: false,
          error: 'Resolution inconnue.',
          code: 'INVALID_RESOLUTION',
        }, req);
        return true;
      }

      const result = await resolveReport({
        reportId,
        resolution,
        adminId: session.user.id,
        note: sanitizeText(body?.note || ''),
        durationDays: body?.durationDays,
      });

      if (!result.ok) {
        // Un signalement deja traite ne se rejoue pas : rejouer creerait une
        // seconde sanction pour le meme fait.
        const code = result.code === 'ALREADY_REVIEWED' ? 409 : result.code === 'REPORT_NOT_FOUND' ? 404 : 500;
        respondJson(res, code, {
          ok: false,
          error: code === 409
            ? 'Ce signalement a deja ete traite.'
            : code === 404
              ? 'Signalement introuvable.'
              : 'Le traitement a echoue.',
          code: result.code,
        }, req);
        return true;
      }

      respondJson(res, 200, {
        ok: true,
        reportId,
        resolution,
        status: 'resolved',
        sanction: result.sanction
          ? { id: result.sanction.id, kind: result.sanction.kind, expiresAt: result.sanction.expiresAt }
          : null,
        reviewedBy: session.user.id,
        reviewedAt: getNow(),
      }, req);
    } catch (err) {
      log.error('Admin resolve report failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors du traitement du signalement.', code: 'RESOLVE_ERROR' }, req);
    }
    return true;
  }

  // Sanctions en cours — tous joueurs confondus.
  //
  // Cette route est le CONTRE-POIDS de `POST .../resolve`. Bannir sans
  // pouvoir lever, c'est une sanction irreversible : une erreur de
  // moderation enfermerait un joueur sans recours, et l admin n'aurait qu'une
  // requete SQL manuelle pour y remedier.
  if (req.method === 'GET' && pathname === '/api/admin/sanctions') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = (url.searchParams.get('userId') || '').trim();
      const { limit } = parseQueryParams(req.url);
      const sanctions = listActiveSanctions({ userId: userId || undefined, limit });
      // Le pseudo est resolu cote serveur : la sanction stocke un identifiant,
      // et une liste de UUID sans nom serait illisible a l'ecran.
      respondJson(res, 200, {
        ok: true,
        sanctions: sanctions.map((s) => {
          const target = getUserById(s.userId);
          return {
            ...s,
            targetPseudo: target ? target.pseudo : '',
          };
        }),
        limit,
      }, req);
    } catch (err) {
      log.error('Admin sanctions list failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la lecture des sanctions.', code: 'SANCTIONS_ERROR' }, req);
    }
    return true;
  }

  // Levee d'une sanction.
  //
  // 2FA obligatoire, comme les autres operations de moderation. Une levee
  // redonne immediateMENT la main au joueur : sa prochaine requete
  // authentifiee repartira, sans attendre une reconnexion.
  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/sanctions\/([^/]+)\/revoke$/)) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    const sanctionId = decodeURIComponent(pathname.match(/^\/api\/admin\/sanctions\/([^/]+)\/revoke$/)[1]);
    try {
      const revoked = await revokeSanction(sanctionId, session.user.id);
      if (!revoked) {
        // 404 : sanction inconnue, ou deja levee. Dans les deux cas, ne pas
        // reecrire une trace de levee qui n existe pas.
        respondJson(res, 404, {
          ok: false,
          error: 'Sanction introuvable ou deja levee.',
          code: 'SANCTION_NOT_FOUND',
        }, req);
        return true;
      }
      log.warn('Admin sanction levee', { adminId: session.user.id, sanctionId });
      respondJson(res, 200, { ok: true, sanctionId, revokedBy: session.user.id, revokedAt: getNow() }, req);
    } catch (err) {
      log.error('Admin revoke sanction failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la levee de la sanction.', code: 'REVOKE_ERROR' }, req);
    }
    return true;
  }

  // Export de l'historique des matchs.
  //
  // Sert a la sauvegarde periodique : l'historique reste dans la base, mais
  // une base n'est pas une sauvegarde tant que personne n'a produit de copie
  // a conserver ailleurs.
  //
  // 2FA obligatoire : l'export contient des cagnottes, des frais et des
  // resultats de reglement.
  //
  // CSV par defaut (ouvrable dans un tableur), JSON si `format=json` — le
  // JSON preserve la structure complete, le CSV se lit sans outil.
  if (req.method === 'GET' && pathname === '/api/admin/matches/export') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const from = (url.searchParams.get('from') || '').trim() || undefined;
      const to = (url.searchParams.get('to') || '').trim() || undefined;
      const format = (url.searchParams.get('format') || 'csv').toLowerCase();

      const result = await exportMatchHistory({ from, to });

      if (!result.ok) {
        respondJson(res, 503, {
          ok: false,
          error: 'Export indisponible, reessaie dans un instant.',
          code: 'SERVER_BUSY',
        }, req);
        return true;
      }

      if (result.degraded) {
        // Base absente : le CSV serait vide et se lirait comme « aucun match ».
        respondJson(res, 503, {
          ok: false,
          error: 'Aucune base configuree : rien a exporter. Historique indisponible, pas vide.',
          code: 'SERVER_BUSY',
        }, req);
        return true;
      }

      const stamp = getNow().slice(0, 10);
      const filename = `zoyd-matchs-${from || 'debut'}_${to || stamp}.${format === 'json' ? 'json' : 'csv'}`;

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.end(JSON.stringify({
          ok: true,
          exportedAt: getNow(),
          from: from || null,
          to: to || null,
          total: result.total,
          matches: result.matches,
        }, null, 2));
        return true;
      }

      const csv = buildMatchesCsv(result.matches);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.end(csv);
      log.info('Admin export historique matchs', { adminId: session.user.id, total: result.total, format });
    } catch (err) {
      log.error('Admin export matches failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de l export.', code: 'EXPORT_ERROR' }, req);
    }
    return true;
  }

  // SEC-R4: Admin 2FA status — whether TOTP is enabled for this admin
  if (req.method === 'GET' && pathname === '/api/admin/2fa/status') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin(req, res);
    if (!session) return true;
    const entry = adminTotpSecrets.get(session.user.id);
    respondJson(res, 200, { ok: true, enabled: !!entry?.enabled, serverTime: Date.now(), period: TOTP_PERIOD });
    return true;
  }

  // SEC-R4: Admin 2FA setup — generate TOTP secret for admin
if (req.method === 'POST' && pathname === '/api/admin/2fa/setup') {
      if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
      const session = requireAdmin(req, res);
      if (!session) return true;

      // Mot de passe OBLIGATOIRE.
      //
      // Avant, cette route n'exigeait qu'une session. Son garde anti-takeover
      // reposait sur `adminTotpSecrets`, un Map EN MEMOIRE : si la ligne
      // `admin_2fa_secrets` manquait — echec d'ecriture non bloquant, table
      // absente, le Map est vide au demarrage — le garde voyait `undefined`,
      // renvoyait un nouveau secret, et un attaquant disposant du seul mot de
      // passe admin s'auto-enrolait un code valide. Acces financier complet.
      //
      // L'exigence est la MEME que pour un changement d'email, qui demande
      // deja le mot de passe actuel : une asymétrie de protection sur deux
      // operations de la meme gravite n'a pas de sens.
      const setupBody = await parseRequestBody(req).catch(() => ({}));
      if (
        typeof setupBody.currentPassword !== 'string'
        || !setupBody.currentPassword
        || !(await verifyUserPassword(session.user.id, setupBody.currentPassword))
      ) {
        respondJson(res, 403, {
          ok: false,
          error: 'Mot de passe admin incorrect.',
          code: 'INVALID_PASSWORD',
        }, req);
        return true;
      }

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
