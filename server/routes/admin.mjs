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
  readSessionToken,
  respondMappedError,
} from '../http-utils.mjs';
import {
  forceReloadFromSupabase,
  getHealthInfo,
  getCommissionStats,
  saveAdminTotpSecret,
  markAdmin2faVerified,
  getMfaLockState,
  recordMfaFailure,
  clearMfaFailures,
  getStateCollection,
  listUserReports,
  listUserIds,
} from '../persistence.mjs';
import { collectFinanceDebts, FINANCE_STALE_MS, FINANCE_CRITICAL_MS } from '../finance-observability.mjs';
import { supabase } from '../supabase.mjs';
// Compteurs vifs du bail de cron (ils repartent a zero au redemarrage de
// l instance ; l historique durable, lui, survit).
import { getCronLeaseCounters, isCronLeaseTableAvailable } from '../cron-lease.mjs';
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
 * Injection de formule (OWASP CSV) : une cellule qui COMMENCE par `=`, `+`,
 * `@` ou `-` (hors nombre pur) est un operateur pour Excel / Sheets /
 * LibreOffice, evalue a l'ouverture du fichier avec les droits du lecteur.
 * Un pseudo depose a l'avance suffit : l'admin qui ouvre son export financier
 * execute une commande DDE. Mitigation : prefixe apostrophe, le tableur lit
 * la cellule comme du texte, la valeur recoit un caractere visible mais la
 * lecture brute du CSV reste fidele. Les montants (nombres purs) ne sont
 * JAMAIS alters.
 *
 * Le BOM UTF-8 est prefixe : sans lui, Excel casse les accents, et un fichier
 * d'historique ouvert par un non-technique parait corrupt.
 */
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  const nombrePur = /^[+-]?\d+(?:[.,]\d+)?$/.test(s);
  const neutre = !nombrePur && /^[=+@-]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(neutre) ? `"${neutre.replace(/"/g, '""')}"` : neutre;
};

const buildMatchesCsv = (matches) => {
  const columns = [
    'id', 'format', 'status', 'createdAt', 'finishedAt', 'scheduledAt',
    'entryFee', 'prizePool', 'zoydFee', 'arbiterFee', 'arbiterFeeReel',
    'pendingArbiterFee', 'creatorPseudo',
    'players', 'winner', 'payouts',
  ];

  const rows = matches.map((match) => {
    // A9 (audit-2) : `match.payouts` est ecrit au fil du reglement par
    // `recordActualPayout` (match-engine). Avant ce correctif, la colonne
    // `payouts` sortait toujours vide — rien n'etait jamais ecrit — et la
    // colonne `arbiterFee` ressortait le montant FIGE a la creation (pot
    // theorique `maxPlayers * entryFee`), alors que le versement prend 2%
    // du pot REELLEMENT verrouille. L'export servait de sauvegarde de
    // l'historique financier : il ne doit pas raconter des montants
    // imaginaires.
    const verses = Array.isArray(match.payouts) ? match.payouts : [];
    const arbiterFeeReel = Number(
      verses
        .filter((paye) => paye?.type === 'arbitration_fee')
        .reduce((sum, paye) => sum + Number(paye?.amount || 0), 0).toFixed(2)
    );
    const payouts = verses
      .map((paye) => `${paye.userId || ''}:${paye.pseudo || ''}:${paye.amount ?? ''}`)
      .join(' | ');
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
      arbiterFeeReel,
      match.pendingArbiterFee ?? '',
      match.creatorPseudo || '',
      Array.isArray(match.players) ? match.players.map((p) => p?.pseudo || p?.userId || '').join(' | ') : '',
      match.winner ?? '',
      payouts,
    ].map(csvCell).join(',');
  });

  return `\uFEFF${columns.join(',')}\n${rows.join('\n')}\n`;
};

export { buildMatchesCsv };

// ─────────────────────────────────────────────────────────────────────────────
// Etat PERSISTE de la 2FA admin — la source de verite anti-takeover.
//
// Pourquoi une lecture directe de la base
// ----------------------------------------
// Le garde anti-takeover de `/api/admin/2fa/setup` lisait `adminTotpSecrets`,
// une Map EN MEMOIRE. Or `loadAdminTotpSecrets` (persistence.mjs) avale
// toutes ses erreurs et SAUTE les lignes indechiffrables : table
// `admin_2fa_secrets` absente, requete en echec, ou `ZOYD_2FA_ENC_KEY`
// absente/erronee suffisent a laisser la Map VIDE.
//
// Une Map vide ne distingue pas « aucun admin n'a de 2FA » de « les secrets
// ont ete perdus ». Le garde ne se declenchait donc pas (`existing` valait
// `undefined`, pas `enabled`), le serveur generait un secret NEUF et le
// renvoyait EN CLAIR dans `otpauthUrl`. Concretement : un attaquant ayant le
// mot de passe admin — mais pas le TOTP — s'auto-enrolait, puis pilotait
// `/api/admin/commissions`, `/api/wallet/deposit`,
// `/api/admin/matches/:id/award` et `/api/leagues/:id/final-results` :
// l'argent des joueurs.
//
// La LIGNE PERSISTEE, elle, dit si ce compte a une 2FA active, meme quand la
// Map memoire ne sait plus la lire. C'est elle qui fait foi.
//
// PIEGE : cette lecture est un acces BASE dans une route — inhabituel, mais
//   deliberé : c'est la seule source qui ne peut pas mentir. Le reste du
//   fichier lit la memoire, qui est un cache, et un cache peut etre vide pour
//   une raison qui n'a rien a voir avec l'etat reel des comptes.
// PIEGE : `enabled` est un BOOLEEN. Une ligne `enabled = false` veut dire
//   « enrolement en cours », pas « 2FA active » : la reponse n'est pas
//   interchangeable avec l'absence de ligne.
// ─────────────────────────────────────────────────────────────────────────────

/** Colonnes lues : ni le secret, ni sa version chiffree. */
const COLONNES_2FA = 'user_id, enabled';

/**
 * Etat persiste de la 2FA d'UN compte admin.
 *
 * @param {string} adminId
 * @returns {Promise<{status: 'memory-only'|'present'|'absent'|'unavailable', enabled: boolean, error: string|null}>}
 *   - `memory-only`  : aucune base configuree — la Map memoire est la seule
 *                      source (mode memoire / developpement).
 *   - `present`      : une ligne existe pour ce compte.
 *   - `absent`       : la table a ete lue, aucune ligne pour ce compte.
 *   - `unavailable`  : la table n'a pas PU etre lue. On ne peut alors rien
 *                      prouver : c'est le cas qui interdit l'enrolement.
 */
export const readPersistedAdmin2fa = async (adminId) => {
  if (!supabase) return { status: 'memory-only', enabled: false, error: null };
  try {
    const { data, error } = await supabase
      .from('admin_2fa_secrets')
      .select(COLONNES_2FA)
      .eq('user_id', adminId)
      .limit(1);
    if (error) return { status: 'unavailable', enabled: false, error: error.message || 'lecture impossible' };
    const ligne = Array.isArray(data) ? data[0] : null;
    if (!ligne) return { status: 'absent', enabled: false, error: null };
    return { status: 'present', enabled: ligne.enabled === true, error: null };
  } catch (err) {
    return { status: 'unavailable', enabled: false, error: err?.message || 'lecture impossible' };
  }
};

/**
 * Toutes les lignes `admin_2fa_secrets` (user_id + enabled uniquement).
 *
 * @returns {Promise<{status: 'memory-only'|'present'|'unavailable', rows: Array<{user_id: string, enabled: boolean}>, error: string|null}>}
 */
export const readPersistedAdmin2faRows = async () => {
  if (!supabase) return { status: 'memory-only', rows: [], error: null };
  try {
    const { data, error } = await supabase.from('admin_2fa_secrets').select(COLONNES_2FA);
    if (error) return { status: 'unavailable', rows: [], error: error.message || 'lecture impossible' };
    return { status: 'present', rows: Array.isArray(data) ? data : [], error: null };
  } catch (err) {
    return { status: 'unavailable', rows: [], error: err?.message || 'lecture impossible' };
  }
};

/**
 * Audit du magasin des secrets 2FA — le signal de demarrage.
 *
 * `loadedCount` = nombre de secrets effectivement dechiffres au chargement.
 * On le compare aux lignes PERSISTEES : l'ecart, c'est exactement la
 * population de comptes dont la 2FA existe en base mais n'est plus lisible
 * (cle de chiffrement absente/erronee, ligne alteree). Ces comptes sont, pour
 * un attaquant qui n'a que le mot de passe, a une echelle du controle
 * financier complet.
 *
 * `fatal` = le serveur ne doit PAS demarrer dans cet etat : des secrets
 * existent et AUCUN n'a pu etre lu. On prefere un serveur qui ne demarre pas
 * a un serveur qui pretend proteger l'argent.
 *
 * @param {{ loadedCount: number }} params
 * @returns {Promise<{fatal: boolean, warning: boolean, reason: string, adminsInMemory: number, loadedCount: number, persistedRows: number|null, adminTotpPersisted: boolean|null, adminTotpError: string|null, storeStatus: string, storeError: string|null}>}
 */
export const auditAdmin2faStore = async ({ loadedCount }) => {
  const health = getHealthInfo();
  const store = await readPersistedAdmin2faRows();
  const base = {
    adminsInMemory: health.adminsInMemory || 0,
    loadedCount,
    persistedRows: store.status === 'present' ? store.rows.length : null,
    adminTotpPersisted: health.adminTotpPersisted,
    adminTotpError: health.adminTotpError || null,
    storeStatus: store.status,
    storeError: store.error || null,
  };
  if (store.status === 'memory-only') {
    // Aucune base : le secret ne vit que dans le processus. Rien n'a pu etre
    // perdu, donc rien n'a a etre signale.
    return { ...base, fatal: false, warning: false, reason: 'memory-only' };
  }
  if (store.status === 'unavailable') {
    // Table illisible : on ne peut pas prouver que les comptes admin n'ont
    // pas de 2FA. L'enrolement est refuse par la route (fail-closed) ; le
    // serveur demarre quand meme — les joueurs continue de jouer — mais
    // l'etat est signale.
    return { ...base, fatal: false, warning: true, reason: 'store-unreadable' };
  }
  const rows = store.rows.length;
  if (rows === 0) {
    // Aucun secret persiste : rien n'a pu etre perdu.
    return { ...base, fatal: false, warning: false, reason: 'no-persisted-secret' };
  }
  if (loadedCount === 0) {
    // Des secrets EXISTENT en base et AUCUN n'a pu etre lu : la cle de
    // chiffrement est absente ou erronee. Tous les comptes admin concernes
    // sont a un mot de passe vole d'un acces financier complet.
    return { ...base, fatal: true, warning: true, reason: 'persisted-secrets-unreadable' };
  }
  if (loadedCount < rows) {
    // Chargement PARTIEL : certains comptes ont une 2FA persistee illisible.
    // La route refuse leur re-enrolement ; on le signale sans couper le
    // service.
    return { ...base, fatal: false, warning: true, reason: 'partial-load' };
  }
  return { ...base, fatal: false, warning: false, reason: 'ok' };
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

  // Historique durable des bails de cron.
  //
  // La table `cron_leases` ne garde que le bail COURANT : la ligne est
  // supprimee a la fin de chaque job. Entre deux jobs, elle est VIDE — le
  // comportement correct, mais cela veut dire qu'il n existe AUCUN endroit
  // ou constater qu un job a tourne SANS protection multi-instance.
  //
  // C est ce qui s est produit en production apres le deploiement du bail :
  // chaque INSERT echouait sur un BIGINT, donc le bail n etait JAMAIS pris,
  // et rien ne le montrait. Cette route donne l historique : les tentatives
  // refusees (`acquired: false`) prouvent qu une AUTRE instance detenait le
  // job, et les tentatives sans bail marquent un job execute sans
  // protection.
  //
  // 2FA obligatoire : la route expose l identite des instances (topologie
  // du deploiement).
  //
  // La route est un GET STRICT. Toute autre methode est refusee ICI, et
  // non laissee tomber au routeur : sans cette garde, la route renvoie
  // `true` sans repondre, et l appelant recoit un 200 au corps vide —
  // l appelant croit avoir reussi. (En production, le routeur finit par
  // repondre 404, mais l ecart entre les deux comportement est exactement
  // le genre de piege qu un test de bout en bout revele.)
  if (pathname === '/api/admin/cron-leases') {
    if (req.method !== 'GET') {
      respondJson(res, 405, {
        ok: false,
        error: 'Methode non autorisee : cet historique est en lecture seule.',
        code: 'METHOD_NOT_ALLOWED',
      }, req);
      return true;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    try {
      const { limit, offset } = parseQueryParams(req.url);
      const cap = Math.min(Math.max(limit || 100, 1), 500);
      const maintenant = Date.now();
      const depuis = Math.min(
        Math.max(parseInt(new URL(req.url, `http://${req.headers.host}`).searchParams.get('sinceHours') || '24', 10) || 24, 1),
        24 * 30,
      ) * 60 * 60 * 1000;

      // Les evenements sont lus par fenetre temporelle : la table est
      //Retentionnee 30 jours, mais l operateur veut d abord « les 24 dernieres
      // heures ».
      const { data, error } = await supabase
        .from('cron_lease_audit')
        .select('job_name, holder, acquired, reason, acquired_at, duration_ms')
        .gte('acquired_at', maintenant - depuis)
        .order('acquired_at', { ascending: false })
        .range(offset, offset + cap - 1);
      if (error) throw new Error(error.message);

      const evenements = data || [];
      const refuses = evenements.filter((e) => e.acquired === false).length;
      const degrades = evenements.filter(
        (e) => e.acquired === true && e.reason !== 'acquis' && e.reason !== 'repris',
      ).length;

      respondJson(res, 200, {
        ok: true,
        sinceHours: Math.round(depuis / (60 * 60 * 1000)),
        total: evenements.length,
        // `refuses` = une autre instance detenait le job (deux instances
        // actives). `degrades` = job execute SANS protection (table absente
        // ou panne de base). Ce dernier doit rester a ZERO.
        refuses,
        degrades,
        evenements,
        // Les compteurs VIFS de l instance (ils repartent a zero au
        // redemarrage, l historique non).
        compteurs: getCronLeaseCounters(),
        bailTableAvailable: isCronLeaseTableAvailable(),
      }, req);
    } catch (err) {
      log.error('Admin cron leases failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la lecture de l historique des bails.', code: 'CRON_LEASES_ERROR' }, req);
    }
    return true;
  }

  // P0 observabilite argent : dettes ACTIONNABLES (ids + montants + age).
  // Donnee financiere sensible -> 2FA obligatoire. Trie par anciennete
  // decroissante : la plus vieille dette premier. `type` filtre en query.
  if (req.method === 'GET' && pathname === '/api/admin/finance/debts') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const typeFilter = (url.searchParams.get('type') || '').trim();
      const { limit, offset } = parseQueryParams(req.url);
      const cap = Math.min(Math.max(limit || 200, 1), 500);
      const { summary, debts } = collectFinanceDebts({
        matches: getStateCollection('matches'),
        tournaments: getStateCollection('tournaments'),
        leagues: getStateCollection('leagues'),
        brLobbies: getStateCollection('brLobbies'),
        listUserIds,
        getWallet: (userId) => getUserById(userId)?.wallet,
        nowMs: Date.now(),
      });
      const filtered = typeFilter
        ? debts.filter((d) => d.type === typeFilter)
        : debts;
      const items = filtered.slice(offset, offset + cap);
      respondJson(res, 200, {
        ok: true,
        summary,
        debts: items,
        total: filtered.length,
        limit: cap,
        offset,
        thresholds: { staleMs: FINANCE_STALE_MS, criticalMs: FINANCE_CRITICAL_MS },
        generatedAt: getNow(),
      }, req);
    } catch (err) {
      log.error('Admin finance debts failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors du calcul des dettes.', code: 'FINANCE_DEBTS_ERROR' }, req);
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

      // Anti-takeover, version PERSISTEE — le garde qui ne peut pas mentir.
      //
      // La Map memoire (`existing`) n'a pas valeur de preuve : elle est vide
      // quand le chargement a echoue (table absente, requete en echec,
      // `ZOYD_2FA_ENC_KEY` absente/erronee — voir `readPersistedAdmin2fa`).
      // Dans ce cas `existing` vaut `undefined`, le garde ci-dessus ne se
      // declenche pas, et le serveur renvoyait un secret NEUF EN CLAIR : un
      // attaquant ayant le seul mot de passe admin s'auto-enrolait et
      // prenait le controle financier complet.
      //
      // La LIGNE PERSISTEE dit la verite : si ce compte a une 2FA active en
      // base, on refuse le re-enrolement, que la Map memoire le sache ou non.
      const persisted = await readPersistedAdmin2fa(session.user.id);
      if (persisted.status === 'unavailable') {
        // Etat 2FA ILLISIBLE : on ne peut pas prouver que ce compte n'a pas
        // deja une 2FA active. Re-enroller serait laisser un mot de passe
        // vole remplacer un secret existant. On refuse — fail-closed.
        log.error('2FA setup refuse : etat 2FA admin illisible', {
          adminId: session.user.id,
          error: persisted.error,
        });
        respondJson(res, 503, {
          ok: false,
          error: 'Configuration 2FA indisponible : reessaie dans un instant.',
          code: '2FA_STORE_UNAVAILABLE',
        }, req);
        return true;
      }
      if (persisted.status === 'present' && persisted.enabled) {
        respondJson(res, 409, {
          ok: false,
          error: '2FA deja activee. Verifie un code TOTP pour la re-enroller.',
          code: '2FA_ALREADY_ENABLED',
        }, req);
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
    //
    // `readSessionToken` et non `readBearerToken` : c'est le token que le
    // GARDE a authentifie (en-tete `Authorization` d'abord). `readBearerToken`
    // privilegierait le COOKIE : quand la requete porte les deux, le
    // marquage 2FA partirait sur une session DIFFERENTE de celle
    // authentifiee — et une session volee se verrait attribuer
    // `admin2faVerified = true` pendant cinq minutes, avec le droit de
    // deplacer l'argent.
    markAdmin2faVerified(readSessionToken(req));
    log.info('Admin 2FA enabled', { adminId: session.user.id });
    respondJson(res, 200, { ok: true });
    return true;
  }

  // SEC-R4: Admin 2FA verify — verify TOTP code for financial operations
  if (req.method === 'POST' && pathname === '/api/admin/2fa/verify') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin(req, res);
    if (!session) return true;
    // Verrouillage PAR COMPTE ADMIN (audit sécurité) : le rate-limit par IP
    // ne suffit pas — un attaquant distribuerait ses essais sur des IPs.
    // 5 échecs → 5 min, persisté dans login_attempts (clé 2fa:<id>).
    const lockKey = session.user.id;
    const lock = await getMfaLockState(lockKey);
    if (lock.lockedUntil && Date.now() < lock.lockedUntil) {
      respondJson(res, 429, { ok: false, error: 'Trop d\'essais 2FA. Reessayez dans 5 minutes.', code: 'ACCOUNT_LOCKED' });
      return true;
    }
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
      const next = await recordMfaFailure(lockKey);
      log.warn('Admin 2FA verify failed — invalid code', { adminId: session.user.id, failures: next.count, locked: Boolean(next.lockedUntil) });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.', code: 'MFA_INVALID' });
      return true;
    }
    clearMfaFailures(lockKey);
    // Persiste sur la session STOCKÉE (getAuthSession renvoie une copie — muter `session` ne suffit pas)
    //
    // Meme token que celui du garde (`readSessionToken`, en-tete
    // `Authorization` d'abord) : marquer une AUTRE session que celle
    // authentifiee laisserait une session volee avec la fenetre 2FA ouverte.
    markAdmin2faVerified(readSessionToken(req));
    log.info('Admin 2FA verified', { adminId: session.user.id });
    respondJson(res, 200, { ok: true });
    return true;
  }

  const adminMatchAward = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/award$/);
  if (req.method === 'POST' && adminMatchAward) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return true;
    const session = requireAdmin2fa(req, res);
    if (!session) return true;

    // Parsing hors lock : le mutex global ne doit couvrir que la mutation.
    let body;
    try {
      body = await parseRequestBody(req);
    } catch (error) {
      respondMappedError(res, error);
      return true;
    }
    try { await withMatchMutex(async () => {
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

    // Parsing hors lock : le mutex global ne doit couvrir que la mutation.
    let body;
    try {
      body = await parseRequestBody(req);
    } catch (error) {
      respondMappedError(res, error);
      return true;
    }
    try { await withMatchMutex(async () => {
      // `action` explicite : le règlement d'un litige BOUGGE de l'argent
      // (paiement du résultat ou remboursement des passes). Sans cela, un
      // litige clos laissait la cagnotte gelée pour toujours.
      const outcome = await resolveDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchResolve[1],
        // La note vit dans l'etat du match et revient au joueur :
        // le texte lit comme le reste de la base (sanitizeText).
        sanitizeText(body.resolution || '') || 'Litige clos par moderation.',
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

    // Parsing hors lock : le mutex global ne doit couvrir que la mutation.
    let body;
    try {
      body = await parseRequestBody(req);
    } catch (error) {
      respondMappedError(res, error);
      return true;
    }
    try { await withMatchMutex(async () => {
      const outcome = await cancelMatchOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchCancel[1],
        // Meme classe que la resolution de litige : la raison est stockee
        // et re-exposee au joueur, elle passe par sanitizeText.
        sanitizeText(body.reason || '') || 'Match annule par moderation.'
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
