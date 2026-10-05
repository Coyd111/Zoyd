import crypto from 'node:crypto';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import webpush from 'web-push';
import { vapidKeys } from './vapid-keys.mjs';
import { createLogger } from './logger.mjs';
import { metricsToPrometheus, incCounter, startTimer, endTimer, setGauge } from './metrics.mjs';
import { serializeAuthCookie, ALLOWED_ORIGINS, ALLOW_DEBUG_CODES, getCorsOrigin, respondJson, parseQueryParams, paginate, parseRequestBody, readBearerToken, getAuthenticatedAppSession, getAuthenticatedRealtimeSession, getPathname, normalizePathForMetrics, mapPersistenceError, respondMappedError } from './http-utils.mjs';
import { checkRateLimit, getClientIp, rateLimitGuard } from './rate-limiter.mjs';
import { sendPushToUser, deliverNotification, broadcastStateSnapshot, notifyAllAdmins } from './push-notifications.mjs';
import { channels, channelsBySocket, seenByChannel, typingByChannel, cleanupChannelMaps, getChannelMemberMap, getSeenMap, getTypingMap, publicMember, emitChannelSnapshots, trackSocketChannel, untrackSocketChannel, upsertChannelMember, removeSocketFromChannel } from './channel-presence.mjs';
import { buildMatchChatChannel, syncMatchChatChannels, canAccessChatChannel, buildChatBootstrapPayload, broadcastChatChannel, broadcastChatMessage, broadcastChatRead } from './chat-helpers.mjs';
import { saveMatches, getStoredTournaments, saveTournaments, buildMatchActionPayload, sanitizeMatchForBroadcast, sanitizeTournamentForBroadcast, buildTournamentActionPayload, getStoredLeagues, saveLeagues, buildLeagueActionPayload, getStoredBrLobbies, saveBrLobbies } from './state-helpers.mjs';
import { deliverAuthCode } from './code-delivery.mjs';
import { generateTotpSecret, verifyTotp, toBase32, adminTotpSecrets, requireAdmin, requireAdmin2fa } from './admin-totp.mjs';

import {
  activateUserAccount,
  authenticateUserAccount,
  appendChatMessage,
  countPushSubscriptions,
  createAuthSession,
  createRealtimeSession,
  createUserAccount,
  deleteAuthSession,
  deleteRealtimeSessionsForUser,
  deleteUserAccount,
  revokeAuthSessionsForUser,
  ensureGlobalChatChannel,
  getAuthSession,
  getLeaderboard,
  getUserById,
  getOrCreateRealtimeSessionForUser,
  verifyUserPassword,
  verifyActivationCode,
  generateActivationCode,
  resendActivationCode,
  changeActivationEmail,
  requestPasswordReset,
  resetPasswordWithCode,
  findUsersByPseudo,
  getChatChannelById,
  getChatMessagesForChannel,
  getRealtimeSession,
  getUnreadCountForUser,
  getStateCollection,
  loadFromSupabase,
  loadFromSupabaseWithRetry,
  forceReloadFromSupabase,
  isReloadInProgress,
  isStateTrusted,
  getStateLoadError,
  getHealthInfo,
  verifyDataIntegrity,
  loadAdminTotpSecrets,
  markChatChannelRead,
  removePushSubscription,
  saveAdminTotpSecret,
  upsertChatChannel,
  upsertPushSubscription,
  updateUserAccount,
  sanitizeUserPayload,
  sanitizeText,
  getFriendsForUser,
  getFriendRequestsForUser,
  getBlockedUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  getUnreadNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  hashPassword,
  updatePasswordHash,
  sbUpsert,
  sbFire,
  getPublicUserById,
  checkProfileUniqueness,
  withRegistrationMutex,
  assertStrongPassword,
  tagWalletTransaction,
  getPublicStats,
  getCommissionStats,
  markAdmin2faVerified,
} from './persistence.mjs';
import { depositToWallet, getServerWallet, withdrawFromWallet, calcWithdrawNet, MIN_WITHDRAWAL_ZC, WITHDRAWAL_FEE_RATE } from './wallet-engine.mjs';
import { withMatchMutex, withTournamentMutex, withLeagueMutex, withWalletMutex, withUserMutex } from './mutex.mjs';
import { initCronJobs } from './cron.mjs';
import { getNow, roundAmount } from './utils.mjs';
import {
  MATCH_AUTOMATION_INTERVAL_MS,
  assignArbiterOnServer,
  cancelMatchOnServer,
  checkInMatchOnServer,
  confirmMatchResultOnServer,
  createMatchOnServer,
  getPublicMatchesForUser,
  joinMatchOnServer,
  launchMatchOnServer,
  openDisputeOnServer,
  processMatchAutomationOnServer,
  resolveDisputeOnServer,
  scheduleMatchOnServer,
  setRoomDetailsOnServer,
  submitMatchResultOnServer,
  settlePendingMatchResult,
  toggleReadyOnServer,
  addEvidenceToDisputeOnServer,
  escalateDisputeOnServer,
} from './match-engine.mjs';
import { verifyFedaPayTransactionAndCredit, initiateFedaPayPayout, parsePhoneForFedaPay, normalizePayoutCountry, PAYOUT_COUNTRY_CONFIG } from './payment-engine.mjs';
import {
  assignTournamentArbiterOnServer,
  createTournamentOnServer,
  leaveTournamentOnServer,
  registerForTournamentOnServer,
  setTournamentMatchLiveOnServer,
  setTournamentMatchRoomDetailsOnServer,
  startTournamentOnServer,
  submitTournamentMatchResultOnServer,
} from './tournament-engine.mjs';
import {
  createLeagueSeasonOnServer,
  joinLeagueSeasonOnServer,
  leaveLeagueSeasonOnServer,
  startLeagueQualificationOnServer,
  startLeagueDayOnServer,
  submitLeagueDayResultsOnServer,
  advanceToFinalOnServer,
  submitLeagueFinalResultsOnServer,
  getLeagueLeaderboard,
  updateLeagueSettingsOnServer,
  reassignPlayerOnServer,
  refundLeaguePlayerOnServer,
  getLeaguePayments,
} from './league-engine.mjs';
import {
  BR_MAPS,
  BR_MAP_IDS,
  BR_MODES,
  BR_MODE_IDS,
  BR_RANKING_MODES,
  BR_RANKING_MODE_IDS,
  BR_ARBITER_MAX_RATE,
  BR_PRIZED_PLACES,
  createBrLobbyOnServer,
  joinBrLobbyOnServer,
  leaveBrLobbyOnServer,
  checkInBrLobbyOnServer,
  startBrLobbyOnServer,
  eliminateBrPlayerOnServer,
  settleBrLobbyOnServer,
  computeBrRanking,
  computeBrPayouts,
} from './br-engine.mjs';

/**
 * Formatage d'un montant ZC pour les notifications serveur.
 * Miroir de `formatZC` (src/lib/utils.ts) : 1 decimale, virgule francaise,
 * suffixe « ZC ». Le serveur ne doit pas afficher « 123.4560000001 ZC ».
 */
const formatZcForNotification = (amount) => {
  const rounded = Math.round(Number(amount) * 10) / 10;
  if (!Number.isFinite(rounded)) return '0 ZC';
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${display} ZC`;
};

/**
 * Montants de retrait derives de la source de verdad (wallet-engine), renvoyes
 * au client pour qu'il affiche exactement ce qui a ete debite et verse.
 */const buildWithdrawalAmounts = (grossAmount) => {
  const { feeAmount, netAmount } = calcWithdrawNet(grossAmount);
  return { feeRate: WITHDRAWAL_FEE_RATE, grossAmount: roundAmount(grossAmount), feeAmount, netAmount };
};

const log = createLogger('realtime');
const PORT = Number(process.env.PORT || process.env.ZOYD_REALTIME_PORT || 4001);
const API_KEY_ROTATION_DAYS = Number(process.env.ZOYD_API_KEY_ROTATION_DAYS || 90);
let matchAutomationIntervalId = null;
let matchAutomationRunning = false;

if (vapidKeys) {
  webpush.setVapidDetails('mailto:ops@zoyd.africa', vapidKeys.publicKey, vapidKeys.privateKey);
}

const handleRequest = async (req, res) => {
  if (!req.url) {
    respondJson(res, 404, { ok: false, error: 'Not found', code: 'NOT_FOUND' });
    return;
  }

  const pathname = getPathname(req);
  req._metricsStart = startTimer();
  req._metricsPathname = normalizePathForMetrics(pathname);
  res._req = req;

  // INFRA-R2: Structured request logging (skip health checks and OPTIONS)
  if (req.method !== 'OPTIONS' && pathname !== '/api/health' && !pathname.startsWith('/metrics')) {
    const clientIp = getClientIp(req);
    log.debug('request', { method: req.method, path: pathname, ip: clientIp });
  }

  if (req.method === 'OPTIONS') {
    respondJson(res, 204, {}, req);
    return;
  }

  // ─── CSRF ────────────────────────────────────────────────────────────────
  // Le cookie de session est SameSite=None (front Vercel → API Render) : sans
  // ce garde, une page tierce peut POSTer /api/wallet/withdraw avec
  // `mode:'no-cors'` et `Content-Type: text/plain` (requête simple, sans
  // preflight) en profitant du cookie envoyé automatiquement.
  // Défense à deux niveaux : Origin sur la liste blanche + Content-Type JSON obligatoire.
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      log.warn('CSRF origin rejected', { origin, path: pathname });
      respondJson(res, 403, { ok: false, error: 'Origine non autorisee.', code: 'CSRF_ORIGIN_REJECTED' }, req);
      return;
    }
    // text/plain échoue ici : c'est ce qui bloque le CSRF "simple request".
    // Un client sans Content-Type (curl, e2e) reste accepté.
    const contentType = String(req.headers['content-type'] || '');
    if (contentType && !contentType.includes('application/json')) {
      respondJson(res, 415, { ok: false, error: 'Content-Type application/json requis.', code: 'UNSUPPORTED_MEDIA_TYPE' }, req);
      return;
    }
  }


  if (req.method === 'GET' && pathname === '/api/health') {
    const health = getHealthInfo();
    // ok=false quand l'état mémoire n'est pas fiable : les écritures sont
    // refusées, un orchestrateur doit le savoir plutôt que de croire au vert.
    respondJson(res, health.stateTrusted ? 200 : 503, {
      ok: health.stateTrusted,
      service: 'zoyd-api',
      persistence: { ...health, reloadInProgress: isReloadInProgress() },
      timestamp: getNow(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/realtime/health') {
    respondJson(res, 200, {
      ok: true,
      service: 'zoyd-realtime',
      timestamp: getNow(),
    });
    return;
  }

  // ─── CODM STORE PROXY ────────────────────────────────────────────────────
  // Proxies requests to the Codashop GraphQL API to avoid CORS issues.
  // GET /api/codm/store?country=IN
  if (req.method === 'GET' && pathname === '/api/codm/store') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const storeUrl = new URL(req.url, 'http://localhost');
      const rawCountry = (storeUrl.searchParams.get('country') || '').toUpperCase();
      const country = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : 'BJ';
      // LIMITE CONNUE DE L'API CODASHOP (verifiee le 04/10/2026) :
      // `getDynamicSkuInfo` renvoie le CATALOGUE INTERNATIONAL en INR quel que
      // soit `shopLang` (fr_bj, en_ng, en_za... => 17 groupes, 99.0 INR) et quel
      // que soit `whitelabelId` (1 a 14 => identique). Le schema GraphQL
      // n'accepte aucun argument `countryCode`, et `api.codashop.com` ne repond
      // pas. Donc pas de catalogue XOF disponible de ce cote : on ne pretend pas
      // l'inverse, la page affiche la devise reelle (INR) et renvoie vers le
      // checkout Codashop, qui facture dans la devise du pays du joueur.
      // `country` est conserve : il sera utile des que Codashop l'exposera.
      const shopLang = 'fr_bj';
      const deviceId = crypto.randomUUID();

      const graphqlBody = {
        operationName: 'GetDynamicSkuInfo',
        variables: {
          deviceId,
          whitelabelId: 1,
          userId: '',
          serverId: '',
          characterId: '',
          worldId: '',
          lvtId: 11347,
          shopLang,
        },
        extensions: {
          clientLibrary: { name: '@apollo/client', version: '4.0.9' },
        },
        query: `query GetDynamicSkuInfo($shopLang: String!, $lvtId: Int!, $serverId: String, $userId: String, $worldId: String, $characterId: String, $deviceId: String, $whitelabelId: Int) {
  getDynamicSkuInfo(shopLang: $shopLang, serverId: $serverId, lvtId: $lvtId, userId: $userId, worldId: $worldId, characterId: $characterId, deviceId: $deviceId, whitelabelId: $whitelabelId) {
    denominationGroups {
      tags dynamicSkuToken denomCategoryId denomDetailsImageUrl denomDetailsTitle denomImageUrl bannerImageUrl isHighlighted displayId displayText skuTitle skuSubTitle hasStock isVariableDenom isPopular isLuckyDraw originalSku sortOrderId status strikethroughPrice voucherId webStoreExclusive isPackage
      pricePoints { bestdeal hasDiscount discountAmount id isEnabled price { amount currency } pricingEngineToken }
      pricingScheme endTime userLimit userLimitRemaining promoId statusSubtype
    }
    denominationCategories { title imageUrl description id name sortOrder }
  }
}`,
      };

      const upstream = await fetch('https://api-sa.codashop.com/spring/api/graphql', {
        method: 'POST',
        headers: {
          accept: '*/*,application/json',
          'content-type': 'application/json',
        },
        referrer: 'https://store.callofdutymobile.com/',
        body: JSON.stringify(graphqlBody),
      });

      if (!upstream.ok) {
        respondJson(res, 502, { ok: false, error: 'Upstream API error.', code: 'UPSTREAM_ERROR' }, req);
        return;
      }

      const data = await upstream.json();
      const groups = data?.data?.getDynamicSkuInfo?.denominationGroups || [];
      const categories = data?.data?.getDynamicSkuInfo?.denominationCategories || [];

      const bundles = groups.map((g) => {
        const firstPrice = g.pricePoints?.[0];
        const amount = firstPrice?.price?.amount ?? '0';
        const currency = firstPrice?.price?.currency ?? 'USD';
        return {
          id: String(g.voucherId || g.dynamicSkuToken || ''),
          title: String(g.skuTitle || g.denomDetailsTitle || ''),
          subtitle: String(g.skuSubTitle || ''),
          imageUrl: String(g.denomImageUrl || ''),
          bannerUrl: String(g.bannerImageUrl || ''),
          price: amount,
          currency,
          isFree: amount === '0.0' || amount === '0',
          isPopular: Boolean(g.isPopular),
          isLuckyDraw: Boolean(g.isLuckyDraw),
          tags: Array.isArray(g.tags) ? g.tags.map(String) : [],
          category: String(g.denomCategoryId || ''),
        };
      });

      // La devise du catalogue est celle reellement servie par Codashop
      // (toujours INR aujourd'hui, cf. limite documentee plus haut). On la
      // renvoie explicitement pour que le front affiche la bonne devise et
      // n'impose pas une devise locale que l'API ne fournit pas.
      const catalogCurrency = bundles.find((b) => !b.isFree)?.currency || 'INR';
      respondJson(res, 200, {
        ok: true,
        bundles,
        categories,
        catalogCurrency,
        priceIsLocal: false,
        requestedCountry: country,
      }, req);
    } catch (err) {
      log.error('codm store proxy error', { message: err.message });
      respondJson(res, 500, { ok: false, error: 'Failed to fetch store data.', code: 'STORE_PROXY_ERROR' }, req);
    }
    return;
  }

  // ─── CODM PLAYER PROXY ───────────────────────────────────────────────────
  // Proxies player lookup to the Codashop validation API.
  // GET /api/codm/player/:id?country=IN
  if (req.method === 'GET' && pathname.startsWith('/api/codm/player/')) {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const userId = pathname.split('/api/codm/player/')[1];
      if (!userId || !/^\d{1,20}$/.test(userId)) {
        respondJson(res, 400, { ok: false, error: 'ID joueur invalide.', code: 'INVALID_PLAYER_ID' }, req);
        return;
      }

      const storeUrl = new URL(req.url, 'http://localhost');
      const country = (storeUrl.searchParams.get('country') || 'IN').replace(/[^A-Z]/g, '').slice(0, 2);
      const deviceId = crypto.randomUUID();

      const upstream = await fetch('https://order-sg.codashop.com/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country,
          voucherTypeName: 'CALL_OF_DUTY_MOBILE_WL',
          whiteLabelId: '1',
          deviceId,
          userId,
        }),
      });

      if (!upstream.ok) {
        respondJson(res, 502, { ok: false, error: 'Upstream API error.', code: 'UPSTREAM_ERROR' }, req);
        return;
      }

      const data = await upstream.json();

      // Handle country redirect
      if (data.errorCode === -200 && data.homeBaseCountry2Name) {
        const redirectUpstream = await fetch('https://order-sg.codashop.com/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            country: data.homeBaseCountry2Name,
            voucherTypeName: 'CALL_OF_DUTY_MOBILE_WL',
            whiteLabelId: '1',
            deviceId,
            userId,
          }),
        });
        const redirectData = await redirectUpstream.json();
        if (!redirectData.success || !redirectData.result) {
          respondJson(res, 404, { ok: false, error: 'Joueur introuvable.', code: 'PLAYER_NOT_FOUND' }, req);
          return;
        }
        const r = redirectData.result;
        respondJson(res, 200, {
          ok: true,
          player: {
            nickname: sanitizeText(r.nickname),
            picUrl: sanitizeText(r.picUrl),
            level: r.level,
            levelImage: r.customLevelImageUrl,
            rankClass: r.rankClass,
            readableRank: r.customReadableMpRank,
            rankImage: r.customMpRankImageUrl,
            rating: r.rating,
            shortId: r.shortId,
            country: data.homeBaseCountry2Name,
            countryId: r.countryId,
          },
        }, req);
        return;
      }

      if (!data.success || !data.result) {
        respondJson(res, 404, { ok: false, error: 'Joueur introuvable.', code: 'PLAYER_NOT_FOUND' }, req);
        return;
      }

      const r = data.result;
      respondJson(res, 200, {
        ok: true,
        player: {
          nickname: sanitizeText(r.nickname),
          picUrl: sanitizeText(r.picUrl),
          level: r.level,
          levelImage: r.customLevelImageUrl,
          rankClass: r.rankClass,
          readableRank: r.customReadableMpRank,
          rankImage: r.customMpRankImageUrl,
          rating: r.rating,
          shortId: r.shortId,
          country,
          countryId: r.countryId,
        },
      }, req);
    } catch (err) {
      log.error('codm player proxy error', { message: err.message });
      respondJson(res, 500, { ok: false, error: 'Failed to fetch player data.', code: 'PLAYER_PROXY_ERROR' }, req);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/metrics') {
    const metricsToken = process.env.METRICS_TOKEN;
    if (!metricsToken) {
      respondJson(res, 403, { ok: false, error: 'Metrics désactivé (METRICS_TOKEN non configuré).', code: 'METRICS_DISABLED' });
      return;
    }
    const authHeader = req.headers.authorization || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== metricsToken) {
      respondJson(res, 401, { ok: false, error: 'Unauthorized.', code: 'UNAUTHORIZED' });
      return;
    }
    setGauge('zoyd_channels', channels.size);
    setGauge('zoyd_push_subscriptions', countPushSubscriptions());
    setGauge('zoyd_stored_matches', getStateCollection('matches').length);
    setGauge('zoyd_stored_tournaments', getStoredTournaments().length);
    setGauge('zoyd_stored_leagues', getStateCollection('leagues').length);
    setGauge('zoyd_stored_users', getStateCollection('users')?.length || 0);
    const body = metricsToPrometheus();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(body);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      if (!body.email || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        respondJson(res, 400, { ok: false, error: 'Adresse email invalide.', code: 'INVALID_EMAIL' });
        return;
      }
      // Whitelist STRICTE : sans elle, un POST {id, wallet, trustScore, stats}
      // écrasait un compte en RAM+base et créditait un solde arbitraire.
      const REGISTER_FIELDS = [
        'pseudo', 'email', 'phone', 'password', 'gameId',
        'controllerType', 'device', 'levelCODM', 'rankMJ', 'rankBR',
        'country', 'streamerMode', 'streamerPseudo',
        'acceptAdult', 'acceptTerms', 'acceptedAt',
      ];
      const safeBody = {};
      for (const field of REGISTER_FIELDS) {
        if (field in body) safeBody[field] = body[field];
      }
      for (const field of ['pseudo', 'bio', 'streamerPseudo']) {
        if (field in safeBody) safeBody[field] = sanitizeText(safeBody[field] || '');
      }
      const user = await createUserAccount(safeBody);
      // V1 simplifiée (décision 2026-09-18) : compte directement actif,
      // session immédiate. Pas de code d'activation (pas d'email/SMS pour l'instant).
      const session = await createAuthSession(user.id);
      res.setHeader('Set-Cookie', serializeAuthCookie(session.token, 6 * 60 * 60));

      respondJson(res, 201, {
        ok: true,
        user: session.user,
        expiresAt: session.expiresAt,
        // Dev/test uniquement : jamais de token en réponse en production.
        ...(ALLOW_DEBUG_CODES && { token: session.token }),
        message: 'Compte cree avec succes. Bienvenue sur ZOYD !',
      });
    } catch (error) {
      log.error('register error', { message: error.message, code: error.code });
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      const user = await authenticateUserAccount({
        identifier: body.identifier || '',
        password: body.password || '',
      });
      
      const session = await createAuthSession(user.id);

      // Cookie httpOnly = seul credential du navigateur (plus de token en JS).
      res.setHeader('Set-Cookie', serializeAuthCookie(session.token, 6 * 60 * 60));

      respondJson(res, 200, {
        ok: true,
        user: session.user,
        expiresAt: session.expiresAt,
        // Dev/test uniquement : jamais de token en réponse en production.
        ...(ALLOW_DEBUG_CODES && { token: session.token }),
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/activate') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      const { email, code } = body;
      
      if (!email || !code) {
        respondJson(res, 400, { ok: false, error: 'Email et code requis.', code: 'MISSING_FIELDS' });
        return;
      }
      
      const verification = verifyActivationCode(email, code);
      
      if (!verification.valid) {
        respondJson(res, 400, { ok: false, error: verification.error, code: 'ACTIVATION_FAILED' });
        return;
      }
      
      const activatedUser = await activateUserAccount(verification.userId);
      
      respondJson(res, 200, {
        ok: true,
        user: sanitizeUserPayload(activatedUser),
        message: 'Compte active avec succes. Vous pouvez maintenant vous connecter.',
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/resend-code') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      const { email } = body;
      if (!email || typeof email !== 'string') {
        respondJson(res, 400, { ok: false, error: 'Email requis.', code: 'MISSING_FIELDS' });
        return;
      }
      const { code } = resendActivationCode(email);
      const delivery = await deliverAuthCode({ to: email, code, purpose: 'activation-resend' });
      respondJson(res, 200, {
        ok: true,
        message: delivery.delivered
          ? 'Nouveau code envoye. Verifie ta boite de reception.'
          : "Nouveau code genere. L'envoi automatique n'est pas encore configure : contacte le support si tu ne le recois pas.",
        delivery: delivery.delivered ? 'sent' : 'pending-provider',
        ...(ALLOW_DEBUG_CODES && { activationCode: code }),
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/activation-email') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      const { oldEmail, newEmail } = body;
      if (!oldEmail || !newEmail) {
        respondJson(res, 400, { ok: false, error: 'Ancien et nouvel email requis.', code: 'MISSING_FIELDS' });
        return;
      }
      const { code } = await changeActivationEmail(oldEmail, newEmail);
      const delivery = await deliverAuthCode({ to: newEmail, code, purpose: 'activation-email' });
      respondJson(res, 200, {
        ok: true,
        message: delivery.delivered
          ? 'Email mis a jour. Nouveau code envoye.'
          : "Email mis a jour. L'envoi automatique n'est pas encore configure : contacte le support si tu ne recois pas le code.",
        delivery: delivery.delivered ? 'sent' : 'pending-provider',
        ...(ALLOW_DEBUG_CODES && { activationCode: code }),
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/forgot-password') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      const { identifier } = body;
      if (!identifier || typeof identifier !== 'string') {
        respondJson(res, 400, { ok: false, error: 'Identifiant requis.', code: 'MISSING_FIELDS' });
        return;
      }
      // UX v1 : le front a besoin de savoir si le compte existe pour rester
      // sur l'étape 1 avec un message clair (choix produit assumé : cela
      // rend l'existence des comptes devinable, acceptable pour la v1).
      const result = requestPasswordReset(identifier);
      let delivery = { delivered: false };
      if (result.found) {
        delivery = await deliverAuthCode({ to: identifier, code: result.code, purpose: 'password-reset' });
      }
      respondJson(res, 200, {
        ok: true,
        found: result.found,
        message: result.found
          ? (delivery.delivered
            ? 'Code envoyé. Vérifie ta boîte de réception (et tes spams).'
            : "Code généré mais l'envoi automatique a échoué : réessaie dans un instant ou contacte le support.")
          : 'Aucun compte associé à cet identifiant.',
        ...(result.found && { delivery: delivery.delivered ? 'sent' : 'pending-provider' }),
        ...(result.found && ALLOW_DEBUG_CODES && { resetCode: result.code }),
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      const { identifier, code, newPassword } = body;
      if (!identifier || !code || !newPassword) {
        respondJson(res, 400, { ok: false, error: 'Identifiant, code et nouveau mot de passe requis.', code: 'MISSING_FIELDS' });
        return;
      }
      await resetPasswordWithCode(identifier, code, newPassword);
      respondJson(res, 200, {
        ok: true,
        message: 'Mot de passe reinitialise. Connecte-toi avec ton nouveau mot de passe.',
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    respondJson(res, 200, {
      ok: true,
      user: session.user,
      expiresAt: session.expiresAt,
    });
    return;
  }

  if (req.method === 'PATCH' && pathname === '/api/auth/me') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'auth')) return;

    try {
      const body = await parseRequestBody(req);
      // Whitelist strict — empêche l'escalade de rôle (mass assignment)
      const ALLOWED_PROFILE_FIELDS = [
        'pseudo', 'avatar', 'bio', 'device', 'controllerType',
        'country', 'streamerMode', 'streamerPseudo', 'notifications',
        'phone', 'levelCODM', 'rankMJ', 'rankBR',
      ];
      const safeUpdate = {};
      const STRING_FIELDS = ['pseudo', 'bio', 'avatar', 'streamerPseudo', 'country', 'phone'];
      const ENUM_FIELDS = {
        controllerType: ['touch', 'controller', 'emulator', 'pc', 'other'],
        device: ['phone', 'tablet', 'pc', 'other'],
      };
      const RANK_VALUES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Legendary', 'Rookie'];
      for (const field of ALLOWED_PROFILE_FIELDS) {
        if (field in body) {
          let value = STRING_FIELDS.includes(field) ? sanitizeText(body[field]) : body[field];
          if (ENUM_FIELDS[field] && (typeof value !== 'string' || !ENUM_FIELDS[field].includes(value))) {
            respondJson(res, 400, { ok: false, error: `Valeur invalide pour ${field}. Valeurs acceptees: ${ENUM_FIELDS[field].join(', ')}`, code: 'INVALID_ENUM' });
            return;
          }
          if ((field === 'rankMJ' || field === 'rankBR') && !RANK_VALUES.includes(value)) {
            respondJson(res, 400, { ok: false, error: `Rang invalide pour ${field}. Valeurs acceptees: ${RANK_VALUES.join(', ')}`, code: 'INVALID_ENUM' });
            return;
          }
          if (field === 'levelCODM' && (typeof value !== 'number' || value < 1 || value > 150 || !Number.isFinite(value))) {
            respondJson(res, 400, { ok: false, error: 'Level CODM invalide (1-150).', code: 'INVALID_ENUM' });
            return;
          }
          if (field === 'bio' && typeof value === 'string' && value.length > 500) {
            value = value.slice(0, 500);
          }
          if (field === 'pseudo' && typeof value === 'string' && value.length > 30) {
            value = value.slice(0, 30);
          }
          safeUpdate[field] = value;
        }
      }
      const updatedUser = await withRegistrationMutex(() => updateUserAccount(session.user.id, (user) => {
        // Unicité pseudo/email/phone (sinon collisions auth) — throw DUPLICATE_* → 409.
        // Sous mutex global : deux PATCH concurrents ne peuvent plus prendre le même identifiant.
        checkProfileUniqueness(session.user.id, safeUpdate);
        return { ...user, ...safeUpdate };
      }));
      respondJson(res, 200, { ok: true, user: updatedUser }, req);
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/social/friends') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    try {
      const { limit, offset } = parseQueryParams(req.url);
      const all = getFriendsForUser(session.user.id);
      const { items: friends, hasMore } = paginate(all, { limit, offset });
      respondJson(res, 200, { ok: true, friends, hasMore });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des amis.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/social/pending') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    try {
      const { limit, offset } = parseQueryParams(req.url);
      const all = getFriendRequestsForUser(session.user.id).filter((fr) => fr.status === 'pending');
      const { items: requests, hasMore } = paginate(all, { limit, offset });
      respondJson(res, 200, { ok: true, requests, hasMore });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des demandes.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/request') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      const request = await withUserMutex(session.user.id, async () =>
        sendFriendRequest(session.user.id, body.targetId, body.message)
      );
      
      deliverNotification(io, body.targetId, {
        type: 'friend_request',
        title: "Demande d'ami",
        body: `${session.user.pseudo} t'a envoyé une demande d'ami.`,
        url: `/profil`,
        requireInteraction: false
      }).catch(err => log.error('Notification delivery failed', err));

      respondJson(res, 200, { ok: true, request });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/accept') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      const friend = await withUserMutex(session.user.id, async () =>
        acceptFriendRequest(body.requestId, session.user.id)
      );
      
      deliverNotification(io, friend.id, {
        type: 'friend_online',
        title: 'Demande acceptée',
        body: `${session.user.pseudo} a accepté ta demande d'ami.`,
        url: `/profil/${session.user.id}`,
        requireInteraction: false
      }).catch(err => log.error('Notification delivery failed', err));

      respondJson(res, 200, { ok: true, friend });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/decline') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      await withUserMutex(session.user.id, async () =>
        declineFriendRequest(body.requestId, session.user.id)
      );
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const socialFriendMatch = pathname.match(/^\/api\/social\/friends\/(.+)$/);
  if (req.method === 'DELETE' && socialFriendMatch) {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      await withUserMutex(session.user.id, async () => {
        removeFriend(session.user.id, socialFriendMatch[1]);
      });
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/block') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      await withUserMutex(session.user.id, async () => {
        blockUser(session.user.id, body.targetId);
      });
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/unblock') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      await withUserMutex(session.user.id, async () => {
        unblockUser(session.user.id, body.targetId);
      });
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/report') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      if (!body.targetId || !body.reason) {
        respondJson(res, 400, { ok: false, error: 'targetId et reason requis.', code: 'MISSING_FIELDS' });
        return;
      }
      const report = {
        id: `RP-${Date.now().toString(36).toUpperCase()}`,
        reporterId: session.user.id,
        reporterPseudo: session.user.pseudo,
        targetId: body.targetId,
        reason: sanitizeText(body.reason),
        description: sanitizeText(body.description || ''),
        status: 'pending',
        createdAt: getNow(),
      };
      sbFire('user_reports', () => sbUpsert('user_reports', { id: report.id, payload: report, created_at: getNow() }));
      respondJson(res, 201, { ok: true, report });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/notifications/read') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const body = await parseRequestBody(req);
      const success = markNotificationAsRead(session.user.id, body.notificationId);
      respondJson(res, 200, { ok: true, success });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const changes = markAllNotificationsAsRead(session.user.id);
      respondJson(res, 200, { ok: true, changes });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/notifications') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    try {
      const unread = getUnreadNotificationsForUser(session.user.id);
      respondJson(res, 200, { ok: true, notifications: unread, count: unread.length });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/wallet/history') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    try {
      const wallet = getServerWallet(session.user.id);
      const { limit, offset } = parseQueryParams(req.url);
      const all = wallet.transactions || [];
      const { items: transactions, hasMore } = paginate(all, { limit: Math.min(limit, 200), offset });
      respondJson(res, 200, { ok: true, transactions, hasMore });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const userProfileMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === 'GET' && userProfileMatch && pathname !== '/api/users/search') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    try {
      const identifier = userProfileMatch[1];
      let targetUser = getPublicUserById(identifier);
      if (!targetUser) {
        const byPseudo = findUsersByPseudo(identifier, 1);
        if (byPseudo.length) targetUser = getPublicUserById(byPseudo[0].id);
      }
      if (!targetUser) return respondJson(res, 404, { ok: false, error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });
      respondJson(res, 200, { ok: true, user: targetUser });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    if (!rateLimitGuard(res, getClientIp(req), 'auth')) return;
    const token = readBearerToken(req);
    // skipRotation: sans ça, getAuthSession déclenche une rotation
    // fire-and-forget qui INSÈRE le nouveau token en mémoire de façon
    // synchrone AVANT que la route ne supprime l'ancien => une session
    // serveur valide de 6h survivait au logout (poste partagé).
    const session = token ? getAuthSession(token, { skipRotation: true }) : null;
    if (token) {
      deleteAuthSession(token);
    }
    if (session?.user?.id) {
      deleteRealtimeSessionsForUser(session.user.id);
    }

    // Clear HttpOnly cookie
    res.setHeader('Set-Cookie', serializeAuthCookie('', 0));

    respondJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/change-password') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;
    const token = readBearerToken(req);
    const session = token ? getAuthSession(token, { skipRotation: true }) : null;
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const body = await parseRequestBody(req);
      const { currentPassword, newPassword } = body;
      if (!currentPassword || !newPassword) {
        respondJson(res, 400, { ok: false, error: 'Les deux mots de passe sont requis.', code: 'MISSING_FIELDS' });
        return;
      }
      try {
        assertStrongPassword(newPassword);
      } catch (e) {
        respondMappedError(res, e);
        return;
      }
      const user = getUserById(session.user.id);
      if (!user) {
        respondJson(res, 404, { ok: false, error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });
        return;
      }
      if (!(await verifyUserPassword(session.user.id, currentPassword))) {
        respondJson(res, 403, { ok: false, error: 'Mot de passe actuel incorrect.', code: 'WRONG_PASSWORD' });
        return;
      }
      const newHash = await hashPassword(newPassword);
      await updatePasswordHash(session.user.id, newHash);
      // B9 : révoque TOUTES les sessions (une session attaquant ne doit pas survivre).
      revokeAuthSessionsForUser(session.user.id);
      deleteRealtimeSessionsForUser(session.user.id);
      res.setHeader('Set-Cookie', serializeAuthCookie('', 0));
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/auth/me') {
    if (!rateLimitGuard(res, getClientIp(req), 'auth')) return;
    const token = readBearerToken(req);
    const session = token ? getAuthSession(token, { skipRotation: true }) : null;
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const body = await parseRequestBody(req);
      if (body?.confirmForfeit !== true) {
        respondJson(res, 400, { ok: false, error: 'Confirme la perte du solde restant pour supprimer ton compte.', code: 'CONFIRM_REQUIRED' });
        return;
      }
      const { forfeitedCash } = await deleteUserAccount(session.user.id);
      // Clear HttpOnly cookie (all sessions already revoked)
      res.setHeader('Set-Cookie', serializeAuthCookie('', 0));
      respondJson(res, 200, {
        ok: true,
        message: forfeitedCash > 0
          ? `Compte supprimé. Solde restant de ${forfeitedCash} ZC abandonné.`
          : 'Compte supprimé définitivement.',
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const leaderboard = getLeaderboard();
      const { limit, offset } = parseQueryParams(req.url);
      const { items: players, hasMore } = paginate(leaderboard, { limit, offset });
      respondJson(res, 200, { ok: true, players, total: leaderboard.length, hasMore });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du classement.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/wallet/me') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const user = getUserById(session.user.id);
      respondJson(res, 200, {
        ok: true,
        wallet: user?.wallet || getServerWallet(session.user.id),
        user,
        // Politique de retrait publiee par le serveur : le front ne doit plus
        // coder `0.02` en dur (il l'avait en dur a deux endroits, et la
        // notification « X net » etait recalculee localement).
        withdrawal: { feeRate: WITHDRAWAL_FEE_RATE, minAmount: MIN_WITHDRAWAL_ZC },
      });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du wallet.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/wallet/deposit') {
    // Deposit endpoint admin-only (deposits go through /api/wallet/verify-fedapay in production).
    // requireAdmin2fa repond LUI-MEME (401/403 + code) : ne pas re-repondre
    // derriere, sinon double ecriture d'en-tetes, avalee en ERR_HTTP_HEADERS_SENT.
    const adminSession = requireAdmin2fa(req, res);
    if (!adminSession) return;
    if (!rateLimitGuard(res, getClientIp(req), 'wallet')) return;
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      respondJson(res, 400, { ok: false, error: 'Corps de requete invalide.', code: 'INVALID_JSON' });
      return;
    }
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 5_000_000) {
      respondJson(res, 400, { ok: false, error: 'Montant invalide (max 5 000 000 ZC).', code: 'INVALID_AMOUNT' });
      return;
    }
    if (!body.userId) {
      respondJson(res, 400, { ok: false, error: 'userId requis.', code: 'INVALID_JSON' });
      return;
    }

    try { await withWalletMutex(body.userId, async () => {
      const wallet = await depositToWallet(body.userId, body.amount, body.method || 'admin-credit');
      const user = getUserById(body.userId);
      respondJson(res, 200, { ok: true, wallet, user });
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/wallet/withdraw') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'wallet')) return;
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      respondJson(res, 400, { ok: false, error: 'Corps de requete invalide.', code: 'INVALID_JSON' });
      return;
    }
    // Montants en ZC : 150 min, 100 000 ZC max (= 1 000 000 FCFA, plafond payout FedaPay)
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < MIN_WITHDRAWAL_ZC || body.amount > 100_000) {
      respondJson(res, 400, { ok: false, error: `Montant invalide (${MIN_WITHDRAWAL_ZC} a 100 000 ZC).`, code: 'INVALID_AMOUNT' });
      return;
    }
    // Pays payout : requête explicite, sinon profil, sinon Bénin (legacy).
    // Un pays explicite mais non supporté → INVALID_COUNTRY (pas de fallback silencieux).
    const rawCountry = typeof body.country === 'string' && body.country ? body.country : session.user.country;
    const countryIso = rawCountry ? normalizePayoutCountry(rawCountry) : 'bj';
    const countryCfg = PAYOUT_COUNTRY_CONFIG[countryIso];
    if (!countryCfg) {
      respondJson(res, 400, { ok: false, error: 'Retraits bientôt disponibles pour ton pays.', code: 'INVALID_COUNTRY' });
      return;
    }
    if (typeof body.method !== 'string' || !countryCfg.operators[body.method]) {
      respondJson(res, 400, { ok: false, error: `Opérateur invalide (${countryCfg.label}) : ${Object.keys(countryCfg.operators).join(', ')}.`, code: 'INVALID_OPERATOR' });
      return;
    }
    const phoneInfo = parsePhoneForFedaPay(typeof body.phone === 'string' ? body.phone : '', countryIso);
    if (!phoneInfo.number) {
      respondJson(res, 400, { ok: false, error: `Numéro de téléphone invalide (format ${countryCfg.label} : +${countryCfg.prefix}...).`, code: 'INVALID_PHONE' });
      return;
    }
    // Idempotence : OBLIGATOIRE. Sans clé, un double-clic ou un retry réseau
    // débitait deux fois et déclenchait deux payouts FedaPay.
    const rawKey = body.idempotencyKey || req.headers['x-idempotency-key'];
    const cleanKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : null;
    if (!cleanKey) {
      respondJson(res, 400, { ok: false, error: 'idempotencyKey requis pour un retrait.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
      return;
    }


    // 1. Débit sous mutex (court, aucun appel réseau) — fonds réservés atomiquement
    let debitedWallet = null;
    let withdrawTxId = null;
    let isDuplicate = false;
    try {
      await withWalletMutex(session.user.id, async () => {
        // Check idempotency INSIDE mutex to prevent TOCTOU race.
        // Les tentatives marquées payoutStatus:'failed' (payout raté + remboursé)
        // sont EXCLUES : un retry avec la même clé doit relancer un vrai payout.
        if (cleanKey) {
          const existingTx = (getUserById(session.user.id)?.wallet?.transactions || [])
            .find((tx) => tx.metadata?.idempotencyKey === cleanKey && tx.type === 'withdraw' && tx.metadata?.payoutStatus !== 'failed');
          if (existingTx) {
            debitedWallet = getServerWallet(session.user.id);
            isDuplicate = true;
            return;
          }
        }
        debitedWallet = await withdrawFromWallet(
          session.user.id, body.amount, body.method, body.phone,
          cleanKey ? { idempotencyKey: cleanKey } : {},
        );
        withdrawTxId = debitedWallet?.transactions?.[0]?.id || null;
      });
    } catch (error) {
      respondMappedError(res, error);
      return;
    }
    if (isDuplicate) {
      respondJson(res, 200, {
        ok: true,
        wallet: debitedWallet,
        user: getUserById(session.user.id),
        duplicate: true,
        // Meme montant que le premier appel : l'UI peut afficher le net sans
        // le recalculer, et un retry ne change pas le message.
        ...buildWithdrawalAmounts(body.amount),
      });
      return;
    }

    // 2. Payout FedaPay HORS mutex (appel réseau, ne bloque plus le wallet) — montant net après 2%
    const { netAmount } = calcWithdrawNet(body.amount);
    let payoutResult;
    try {
      const currentUser = getUserById(session.user.id);
      payoutResult = await initiateFedaPayPayout({
        amountZC: netAmount,
        method: body.method,
        country: countryIso,
        phone: body.phone,
        userPseudo: currentUser?.pseudo || 'Joueur',
        userEmail: currentUser?.email,
        merchantReference: cleanKey || `ZOYD-WITHDRAW-${Date.now()}`,
      });
    } catch (payoutError) {
      // 3. Échec payout — remboursement sous mutex + traçabilité sur la tx d'origine
      log.error('Payout failed, refunding wallet', { userId: session.user.id, error: payoutError.message });
      try {
        await withWalletMutex(session.user.id, async () => {
          await depositToWallet(session.user.id, body.amount, `Remboursement retrait echoue (${body.amount} ZC)`);
        });
        if (withdrawTxId) {
          await tagWalletTransaction(session.user.id, withdrawTxId, { payoutStatus: 'failed' }).catch(() => {});
        }
      } catch (refundError) {
        log.error('CRITICAL: Refund also failed', { userId: session.user.id, error: refundError.message });
      }
      respondMappedError(res, payoutError);
      return;
    }
    // 4. Tag payoutId persisté (memory + Supabase) — best effort, le débit reste valide même si le tag échoue
    if (withdrawTxId) {
      try {
        await tagWalletTransaction(session.user.id, withdrawTxId, { payoutId: payoutResult.payoutId, payoutStatus: payoutResult.status });
      } catch (tagError) {
        log.error('Failed to tag payout metadata', { userId: session.user.id, txId: withdrawTxId, error: tagError.message });
      }
    }
    respondJson(res, 200, {
      ok: true,
      wallet: getServerWallet(session.user.id),
      user: getUserById(session.user.id),
      payoutId: payoutResult.payoutId,
      // Montants autoritaires : le client ne doit plus refaire le calcul de la
      // commission, sinon le « net » affiche peut differer du verse.
      ...buildWithdrawalAmounts(body.amount),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stats') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      respondJson(res, 200, { ok: true, stats: getPublicStats() });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/matches') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const token = readBearerToken(req);
      const matchSession = token ? getAuthSession(token) : null;
      const matchCurrentUser = matchSession?.user ? getUserById(matchSession.user.id) : null;
      const allMatches = getStateCollection('matches');
      const visibleMatches = getPublicMatchesForUser(allMatches, matchCurrentUser);
      const { limit, offset } = parseQueryParams(req.url);
      // Arrow explicite : `Array.map` passe (element, index, array), donc
      // `map(sanitizeMatchForBroadcast)` aurait passe l'INDEX comme viewerId
      // et `isMe` aurait toujours ete false sans lever la moindre erreur.
      const { items: matches, hasMore } = paginate(
        visibleMatches.map((match) => sanitizeMatchForBroadcast(match, matchCurrentUser?.id || null)),
        { limit, offset }
      );
      respondJson(res, 200, { ok: true, matches, total: visibleMatches.length, hasMore });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des matchs.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tournaments') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const { limit, offset } = parseQueryParams(req.url);
      const all = getStoredTournaments();
      const { items: tournaments, hasMore } = paginate(
        // `session` n'existait pas ici : le `isMe` des membres/arbitres de
        // tournois n'etait donc jamais calcule. ReferenceError capture par le
        // `catch` => 500 des que la liste contient un tournoi.
        all.map((t) => sanitizeTournamentForBroadcast(t, getAuthenticatedAppSession(req)?.userId || null)),
        { limit, offset }
      );
      respondJson(res, 200, { ok: true, tournaments, total: all.length, hasMore });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des tournois.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/users/search') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = url.searchParams.get('q') || '';
      const { limit, offset } = parseQueryParams(req.url);
      const allMatches = findUsersByPseudo(q).filter((u) => u.id !== session.user.id);
      const { items: matches, hasMore } = paginate(allMatches, { limit: Math.min(limit, 50), offset });
      respondJson(res, 200, {
        ok: true,
        users: matches.map((u) => ({
          id: u.id, pseudo: u.pseudo, avatar: u.avatar, country: u.country,
          trustScore: u.trustScore, controllerType: u.controllerType, isOnline: u.isOnline,
        })),
        total: allMatches.length,
        hasMore,
      });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la recherche.', code: 'SEARCH_ERROR' });
    }
    return;
  }

  const tournamentDetail = pathname.match(/^\/api\/tournaments\/([^/]+)$/);
  if (req.method === 'GET' && tournamentDetail) {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const tournament = getStoredTournaments().find((entry) => entry.id === tournamentDetail[1]);
      if (!tournament) {
        respondJson(res, 404, { ok: false, error: 'Tournoi introuvable.', code: 'TOURNAMENT_NOT_FOUND' });
        return;
      }
      respondJson(res, 200, { ok: true, tournament: sanitizeTournamentForBroadcast(tournament) });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du tournoi.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tournaments') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const body = await parseRequestBody(req);
      if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 3) {
        respondJson(res, 400, { ok: false, error: 'Nom du tournoi requis (3-100 caractères).', code: 'INVALID_TOURNAMENT_NAME' });
        return;
      }
      if (!body.format || typeof body.format !== 'string') {
        respondJson(res, 400, { ok: false, error: 'Format requis.', code: 'INVALID_FORMAT' });
        return;
      }
      if (body.maxEntries && (typeof body.maxEntries !== 'number' || body.maxEntries < 2 || body.maxEntries > 256)) {
        respondJson(res, 400, { ok: false, error: 'maxEntries doit être entre 2 et 256.', code: 'INVALID_MAX_ENTRIES' });
        return;
      }
      if (body.entryFee !== undefined && (typeof body.entryFee !== 'number' || !Number.isFinite(body.entryFee) || body.entryFee < 0)) {
        respondJson(res, 400, { ok: false, error: 'entryFee doit être un nombre positif.', code: 'INVALID_ENTRY_FEE' });
        return;
      }
      const outcome = createTournamentOnServer(getStoredTournaments(), session.user, body);
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 201, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentRegister = pathname.match(/^\/api\/tournaments\/([^/]+)\/register$/);
  if (req.method === 'POST' && tournamentRegister) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await registerForTournamentOnServer(getStoredTournaments(), session.user, tournamentRegister[1], body);
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentLeave = pathname.match(/^\/api\/tournaments\/([^/]+)\/leave$/);
  if (req.method === 'POST' && tournamentLeave) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = await leaveTournamentOnServer(getStoredTournaments(), session.user, tournamentLeave[1]);
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentArbiter = pathname.match(/^\/api\/tournaments\/([^/]+)\/arbiter$/);
  if (req.method === 'POST' && tournamentArbiter) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = assignTournamentArbiterOnServer(getStoredTournaments(), session.user, tournamentArbiter[1]);
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentStart = pathname.match(/^\/api\/tournaments\/([^/]+)\/start$/);
  if (req.method === 'POST' && tournamentStart) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = startTournamentOnServer(getStoredTournaments(), session.user, tournamentStart[1]);
      await saveTournaments(io, outcome.tournaments, outcome.tournament);

      const tournament = outcome.tournament;
      const participantIds = [...new Set(
        (tournament.entries || []).flatMap(entry => (entry.members || []).map(m => m.userId))
      )];
      for (const uid of participantIds) {
        deliverNotification(io, uid, {
          type: 'tournament_started',
          title: 'Tournoi demarre',
          body: `Le tournoi "${tournament.name}" a commence !`,
          url: `/mj/tournois/${tournament.id}`,
          requireInteraction: false
        }).catch(err => log.error('Notification delivery failed', err));
      }

      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentRoom = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/room$/);
  if (req.method === 'POST' && tournamentRoom) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = setTournamentMatchRoomDetailsOnServer(
        getStoredTournaments(),
        session.user,
        tournamentRoom[1],
        tournamentRoom[2],
        body.roomName,
        body.roomPassword
      );
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentLive = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/live$/);
  if (req.method === 'POST' && tournamentLive) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = setTournamentMatchLiveOnServer(
        getStoredTournaments(),
        session.user,
        tournamentLive[1],
        tournamentLive[2]
      );
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const tournamentResult = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/result$/);
  if (req.method === 'POST' && tournamentResult) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await submitTournamentMatchResultOnServer(
        getStoredTournaments(),
        session.user,
        tournamentResult[1],
        tournamentResult[2],
        body
      );
      await saveTournaments(io, outcome.tournaments, outcome.tournament);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  // ─── League Endpoints ───────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/leagues') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const { limit, offset } = parseQueryParams(req.url);
      const all = getStoredLeagues();
      const { items, hasMore } = paginate(all, { limit, offset });
      const seasons = items.map((s) => {
        const { members, ...safe } = s;
        if (Array.isArray(members)) {
          safe.members = members.map(({ playerId, ...rest }) => rest);
        }
        return safe;
      });
      respondJson(res, 200, { ok: true, seasons, total: all.length, hasMore });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des ligues.', code: 'LOAD_ERROR' });
    }
    return;
  }

  const leagueGetOne = pathname.match(/^\/api\/leagues\/([^/]+)$/);
  if (req.method === 'GET' && leagueGetOne) {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const seasons = getStoredLeagues();
      const season = seasons.find((s) => s.id === leagueGetOne[1]);
      if (!season) {
        respondJson(res, 404, { ok: false, error: 'Ligue introuvable.', code: 'LEAGUE_NOT_FOUND' });
        return;
      }
      respondJson(res, 200, { ok: true, season });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement de la ligue.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/leagues') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      // `name` et `format` sont OPTIONNELS : la route les exigeait (>= 3
      // caractères) alors que le front appelle sans argument -> body {} ->
      // 400 a chaque clic, donc la BR League etait impossible a creer. Le
      // moteur genere un nom par defaut (`Cycle N`).
      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 3)) {
        respondJson(res, 400, { ok: false, error: 'Nom de la ligue invalide (3-100 caractères).', code: 'INVALID_LEAGUE_NAME' });
        return;
      }
      if (body.name !== undefined && body.name.length > 100) {
        respondJson(res, 400, { ok: false, error: 'Nom de la ligue trop long (max 100 caractères).', code: 'INVALID_LEAGUE_NAME' });
        return;
      }
      if (body.format !== undefined && typeof body.format !== 'string') {
        respondJson(res, 400, { ok: false, error: 'Format invalide.', code: 'INVALID_FORMAT' });
        return;
      }
      if (body.teamSize !== undefined && (typeof body.teamSize !== 'number' || body.teamSize < 1 || body.teamSize > 5)) {
        respondJson(res, 400, { ok: false, error: 'teamSize doit être entre 1 et 5.', code: 'INVALID_TEAM_SIZE' });
        return;
      }
      const outcome = createLeagueSeasonOnServer(getStoredLeagues(), session.user, body);
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 201, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueJoin = pathname.match(/^\/api\/leagues\/([^/]+)\/join$/);
  if (req.method === 'POST' && leagueJoin) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = await joinLeagueSeasonOnServer(getStoredLeagues(), session.user, leagueJoin[1]);
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueLeave = pathname.match(/^\/api\/leagues\/([^/]+)\/leave$/);
  if (req.method === 'POST' && leagueLeave) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = await leaveLeagueSeasonOnServer(getStoredLeagues(), session.user, leagueLeave[1]);
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueStartQualification = pathname.match(/^\/api\/leagues\/([^/]+)\/start-qualification$/);
  if (req.method === 'POST' && leagueStartQualification) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = startLeagueQualificationOnServer(getStoredLeagues(), session.user, leagueStartQualification[1]);
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueStartDay = pathname.match(/^\/api\/leagues\/([^/]+)\/days\/([^/]+)\/start$/);
  if (req.method === 'POST' && leagueStartDay) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = startLeagueDayOnServer(getStoredLeagues(), session.user, leagueStartDay[1], leagueStartDay[2]);
      await saveLeagues(io, outcome.seasons);

      const season = outcome.season;
      const participantIds = (season.registeredPlayers || []).map(p => p.userId);
      for (const uid of participantIds) {
        deliverNotification(io, uid, {
          type: 'league_day_started',
          title: 'Journee BR Lancee',
          body: `La journee ${leagueStartDay[2]} de la ligue "${season.name}" est en cours !`,
          url: `/br-league/${season.id}`,
          requireInteraction: false
        }).catch(err => log.error('Notification delivery failed', err));
      }

      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueDayResults = pathname.match(/^\/api\/leagues\/([^/]+)\/days\/([^/]+)\/results$/);
  if (req.method === 'POST' && leagueDayResults) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = submitLeagueDayResultsOnServer(
        getStoredLeagues(),
        session.user,
        leagueDayResults[1],
        leagueDayResults[2],
        body.results
      );
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueAdvanceToFinal = pathname.match(/^\/api\/leagues\/([^/]+)\/advance-to-final$/);
  if (req.method === 'POST' && leagueAdvanceToFinal) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = advanceToFinalOnServer(getStoredLeagues(), session.user, leagueAdvanceToFinal[1]);
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueFinalResults = pathname.match(/^\/api\/leagues\/([^/]+)\/final-results$/);
  if (req.method === 'POST' && leagueFinalResults) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = submitLeagueFinalResultsOnServer(
        getStoredLeagues(),
        session.user,
        leagueFinalResults[1],
        body.results
      );
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueLeaderboard = pathname.match(/^\/api\/leagues\/([^/]+)\/leaderboard$/);
  if (req.method === 'GET' && leagueLeaderboard) {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const standings = getLeagueLeaderboard(getStoredLeagues(), leagueLeaderboard[1]);
      respondJson(res, 200, { ok: true, standings });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueUpdateSettings = pathname.match(/^\/api\/leagues\/([^/]+)$/);
  if (req.method === 'PATCH' && leagueUpdateSettings) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = updateLeagueSettingsOnServer(getStoredLeagues(), session.user, leagueUpdateSettings[1], body);
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueReassign = pathname.match(/^\/api\/leagues\/([^/]+)\/reassign$/);
  if (req.method === 'POST' && leagueReassign) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = reassignPlayerOnServer(
        getStoredLeagues(),
        session.user,
        leagueReassign[1],
        body.userId,
        body.fromDay,
        body.toDay
      );
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leagueRefund = pathname.match(/^\/api\/leagues\/([^/]+)\/refund\/([^/]+)$/);
  if (req.method === 'POST' && leagueRefund) {
    // Cette route DEPLACE DE L'ARGENT (remboursement d'un pass de ligue).
    // Elle n'exigeait que le rôle admin, alors que la lecture de la liste des
    // paiements exigeait la 2FA : un compte admin compromis suffisait a
    // vider les portefeuilles. Aligne sur les autres operations financieres.
    const session = requireAdmin2fa(req, res);
    if (!session) return;
    try { await withLeagueMutex(async () => {
      const outcome = await refundLeaguePlayerOnServer(
        getStoredLeagues(),
        session.user,
        leagueRefund[1],
        leagueRefund[2]
      );
      await saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const leaguePayments = pathname.match(/^\/api\/leagues\/([^/]+)\/payments$/);
  if (req.method === 'GET' && leaguePayments) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin2fa(req, res);
    if (!session) return;
    try {
      const payments = getLeaguePayments(getStoredLeagues(), leaguePayments[1]);
      respondJson(res, 200, { ok: true, payments });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  // ─── Battle Royale (salon unique, un seul match) ─────────────────────────
  // Voir server/br-engine.mjs. Regle commerciale centrale : le pass est bloque
  // a l'inscription et n'est jamais rembourse une fois la partie lancee.

  // Referentiel : maps, modes et variantes de classement, pour que le front ne
  // code pas ses propres listes (source de verite unique).
  if (req.method === 'GET' && pathname === '/api/br/config') {
    respondJson(res, 200, {
      ok: true,
      maps: BR_MAPS,
      mapIds: BR_MAP_IDS,
      modes: BR_MODES,
      modeIds: BR_MODE_IDS,
      rankingModes: BR_RANKING_MODES,
      rankingModeIds: BR_RANKING_MODE_IDS,
      prizedPlaces: BR_PRIZED_PLACES,
      arbiterMaxRate: BR_ARBITER_MAX_RATE,
    }, req);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/br/lobbies') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    const lobbies = getStoredBrLobbies();
    // Les joueurs sont visibles (pseudo, presence) mais jamais les userId :
    // le BR affiche le roster, comme un lobby de jeu.
    const sanitized = lobbies.map((lobby) => ({
      ...lobby,
      players: lobby.players.map(({ userId, ...rest }) => rest),
      teams: lobby.teams.map(({ members, ...rest }) => rest),
    }));
    respondJson(res, 200, { ok: true, lobbies: sanitized }, req);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/br/lobbies') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'match')) return;
    try {
      const body = await parseRequestBody(req);
      const created = createBrLobbyOnServer(
        getStoredBrLobbies(),
        { user: getUserById(session.user.id) || session.user },
        body,
      );
      // Le createur paie et joue son propre salon : on l'inscrit comme les
      // autres, sinon il resterait dehors et sa presence ne compterait pas au
      // demarrage. L'echec de ce verrouillage annule la creation.
      let lobbies = created.lobbies;
      let lobby = created.lobby;
      try {
        const joined = await joinBrLobbyOnServer(
          created.lobbies,
          { user: getUserById(session.user.id) || session.user },
          created.lobby.id,
        );
        lobbies = joined.lobbies;
        lobby = joined.lobby;
      } catch (joinError) {
        // On ne laisse pas trace d'un salon dont le createur n'a pas pu
        // bloquer son pass : la cagnotte serait decalee d'un joueur.
        log.error('BR creator join failed, lobby discarded', {
          lobbyId: created.lobby.id, error: joinError.message,
        });
        respondMappedError(res, joinError);
        return;
      }
      await saveBrLobbies(io, lobbies);
      log.info('BR lobby created', { lobbyId: lobby.id, by: session.user.id });
      respondJson(res, 201, { ok: true, lobby }, req);
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const brLobbyAction = pathname.match(/^\/api\/br\/lobbies\/([^/]+)\/(join|leave|checkin|start|eliminate|finish|arbiter)$/);
  if (brLobbyAction && req.method === 'POST') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
      return;
    }
    const lobbyId = brLobbyAction[1];
    const action = brLobbyAction[2];
    const actor = { user: getUserById(session.user.id) || session.user };
    // `join`/`leave` touchent l'argent MAIS restent sur le quota general :
    // les mettre dans `wallet` (20 requetes / 10 min, partage avec les
    // depots/retraits) rendait le produit inutilisable — un joueur qui
    // s'inscrit puis se desinscrit de 3 salons epuisait le quota avant meme
    // de pouvoir retirer ses gains.
    const rateGroup = (action === 'start' || action === 'finish' || action === 'arbiter')
      ? 'admin'
      : 'default';
    if (!rateLimitGuard(res, getClientIp(req), rateGroup)) return;

    try {
      const lobbies = getStoredBrLobbies();
      let outcome;
      let status = 200;

      if (action === 'join') {
        outcome = await joinBrLobbyOnServer(lobbies, actor, lobbyId);
      } else if (action === 'leave') {
        outcome = await leaveBrLobbyOnServer(lobbies, actor, lobbyId);
      } else if (action === 'checkin') {
        outcome = checkInBrLobbyOnServer(lobbies, actor, lobbyId);
      } else if (action === 'start') {
        outcome = startBrLobbyOnServer(lobbies, actor, lobbyId);
      } else if (action === 'eliminate') {
        const body = await parseRequestBody(req);
        if (!body.userId || typeof body.userId !== 'string') {
          respondJson(res, 400, { ok: false, error: 'userId du joueur elimine requis.', code: 'INVALID_JSON' }, req);
          return;
        }
        outcome = eliminateBrPlayerOnServer(lobbies, actor, lobbyId, body.userId, {
          killerUserId: typeof body.killerUserId === 'string' ? body.killerUserId : null,
          assists: Number(body.assists) || 0,
        });
      } else if (action === 'arbiter') {
        // L'arbitre est un joueur inscrit (il paie son pass comme tout le
        // monde) mais il est hors classement et touche une commission.
        const adminSession = requireAdmin2fa(req, res);
        if (!adminSession) return;
        const next = lobbies.map((l) => (l.id === lobbyId ? { ...l, arbiterId: session.userId } : l));
        outcome = { lobby: next.find((l) => l.id === lobbyId), lobbies: next };
        if (!outcome.lobby) {
          respondJson(res, 404, { ok: false, error: 'Salon introuvable.', code: 'LOBBY_NOT_FOUND' }, req);
          return;
        }
      } else {
        // `finish` distribue la cagnotte : operation financiere sensible.
        const adminSession = requireAdmin2fa(req, res);
        if (!adminSession) return;
        outcome = await settleBrLobbyOnServer(lobbies, actor, lobbyId);
        // Notification aux gagants.
        for (const prize of outcome.payouts || []) {
          await deliverNotification(io, prize.userId, {
            title: `BR - ${prize.placement}e place`,
            body: `${formatZcForNotification(prize.amount)} gagnes sur ${outcome.lobby.name} (${prize.kills} kills).`,
            url: '/br',
            tag: `br-prize-${outcome.lobby.id}-${prize.userId}`,
            type: 'wallet_update',
            requireInteraction: false,
          }).catch(() => { /* l'argent est verse, la notification est secondary */ });
        }
      }

      await saveBrLobbies(io, outcome.lobbies);
      respondJson(res, status, {
        ok: true,
        lobby: outcome.lobby,
        payouts: outcome.payouts || null,
        arbiter: outcome.arbiter || null,
        refunded: outcome.refunded || 0,
      }, req);
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const brLobbyDetail = pathname.match(/^\/api\/br\/lobbies\/([^/]+)$/);
  if (brLobbyDetail && req.method === 'GET') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    const lobby = getStoredBrLobbies().find((l) => l.id === brLobbyDetail[1]);
    if (!lobby) {
      respondJson(res, 404, { ok: false, error: 'Salon introuvable.', code: 'LOBBY_NOT_FOUND' }, req);
      return;
    }
    const { payouts, arbiter } = computeBrPayouts(lobby);
    respondJson(res, 200, {
      ok: true,
      lobby: {
        ...lobby,
        players: lobby.players.map(({ userId, ...rest }) => rest),
        teams: lobby.teams.map(({ members, ...rest }) => rest),
      },
      ranking: computeBrRanking(lobby).slice(0, BR_PRIZED_PLACES).map(({ userId, ...rest }) => rest),
      projectedPayouts: { payouts, arbiter },
    }, req);
    return;
  }

  // ─── End League Endpoints ───────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/wallet/verify-fedapay') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'wallet')) return;

    try { await withWalletMutex(session.user.id, async () => {
      const body = await parseRequestBody(req);
      // FedaPay renvoie un id NUMÉRIQUE (ex: 23) : on accepte number et string.
      const transactionId = body.transactionId === undefined || body.transactionId === null
        ? ''
        : String(body.transactionId);
      if (!/^\d{1,20}$/.test(transactionId)) {
        respondJson(res, 400, { ok: false, error: 'transactionId invalide.', code: 'INVALID_TRANSACTION_ID' });
        return;
      }

      const outcome = await verifyFedaPayTransactionAndCredit(transactionId, session.user);
      const wallet = getServerWallet(session.user.id);

      // Le crédit FedaPay ne montrait qu'un toast éphémère : rien dans le
      // centre de notifications. Un joueur qui recharge puis ferme l'onglet
      // n'avait aucune trace du dépôt, et le reçu n'était consultable qu'en
      // fouillant l'historique du portefeuille.
      // `requireInteraction: false` : un dépôt réussi ne doit pas exiger une
      // action du joueur, tout en restant dans le centre de notifications.
      await deliverNotification(io, session.user.id, {
        title: 'Depot credite',
        body: `${formatZcForNotification(outcome.amountZC)} ajoutes a ton portefeuille via FedaPay.`,
        url: '/wallet',
        tag: `deposit-${transactionId}`,
        type: 'wallet_update',
        requireInteraction: false,
      }).catch((notifyError) => {
        // Une notification ratée ne doit jamais faire échouer le crédit :
        // l'argent est déjà dans le portefeuille à ce stade.
        log.error('Deposit notification failed', { userId: session.user.id, error: notifyError.message });
      });

      respondJson(res, 200, { 
        ok: true, 
        amount: outcome.amountZC, 
        wallet,
        user: outcome.user
      });
    }); } catch (error) {
      // Préserve les codes métier (ALREADY_PROCESSED → 409, IN_PROGRESS → 409, etc.)
      // au lieu de tout écraser en 400 générique
      log.error('Payment verification failed', { message: error.message, code: error.code });
      if (error && typeof error.code === 'string' && error.code !== 'UNKNOWN_ERROR') {
        respondMappedError(res, error);
      } else {
        respondJson(res, 400, { ok: false, error: 'Verification du paiement echouee.', code: 'PAYMENT_FAILED' });
      }
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/matches') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;

    // Parsing hors lock : le mutex global ne doit couvrir que la mutation.
    let body;
    try {
      body = await parseRequestBody(req);
    } catch (error) {
      respondMappedError(res, error);
      return;
    }
    try { await withMatchMutex(async () => {
      if (body.tournamentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tournamentId)) {
        respondJson(res, 400, { ok: false, error: 'tournamentId invalide.', code: 'INVALID_JSON' });
        return;
      }
      // Formats 1VS1 à 5VS5 uniquement (garde serveur, cf. MAX_TEAM_SIZE).
      const formatMatch = /^(\d+)VS(\d+)$/i.exec(String(body.format || ''));
      const formatTeamSize = formatMatch ? Number(formatMatch[1]) : NaN;
      if (!formatMatch || formatMatch[1] !== formatMatch[2] || formatTeamSize < 1 || formatTeamSize > 5) {
        respondJson(res, 400, { ok: false, error: 'format invalide (de 1VS1 a 5VS5).', code: 'INVALID_FORMAT' });
        return;
      }
      if (body.entryFee !== undefined && (typeof body.entryFee !== 'number' || !Number.isFinite(body.entryFee) || body.entryFee < 0)) {
        respondJson(res, 400, { ok: false, error: 'entryFee doit être un nombre positif.', code: 'INVALID_ENTRY_FEE' });
        return;
      }
      const outcome = await withWalletMutex(session.user.id, async () =>
        createMatchOnServer(getStateCollection('matches'), session.user, body)
      );
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 201, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchJoin = pathname.match(/^\/api\/matches\/([^/]+)\/join$/);
  if (req.method === 'POST' && matchJoin) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;

    let body;
    try {
      body = await parseRequestBody(req);
    } catch (error) {
      respondMappedError(res, error);
      return;
    }
    try { await withMatchMutex(async () => {
      const outcome = await withWalletMutex(session.user.id, async () =>
        joinMatchOnServer(getStateCollection('matches'), session.user, matchJoin[1], body.team)
      );
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchArbiter = pathname.match(/^\/api\/matches\/([^/]+)\/arbiter$/);
  if (req.method === 'POST' && matchArbiter) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;

    try { await withMatchMutex(async () => {
      const outcome = assignArbiterOnServer(getStateCollection('matches'), session.user, matchArbiter[1]);
      await saveMatches(io, outcome.matches, outcome.match);

      deliverNotification(io, session.user.id, {
        type: 'arbiter_assigned',
        title: 'Arbitre assigne',
        body: `Tu es arbitre du match "${outcome.match?.format || 'MJ'}" (${outcome.match?.id}).`,
        url: `/mj/match/${outcome.match?.id}`,
        requireInteraction: true
      }).catch(err => log.error('Notification delivery failed', err));

      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchCheckIn = pathname.match(/^\/api\/matches\/([^/]+)\/check-in$/);
  if (req.method === 'POST' && matchCheckIn) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;

    try { await withMatchMutex(async () => {
      const outcome = checkInMatchOnServer(getStateCollection('matches'), session.user, matchCheckIn[1]);
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchReady = pathname.match(/^\/api\/matches\/([^/]+)\/ready$/);
  if (req.method === 'POST' && matchReady) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;

    try { await withMatchMutex(async () => {
      const outcome = toggleReadyOnServer(getStateCollection('matches'), session.user, matchReady[1]);
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchSchedule = pathname.match(/^\/api\/matches\/([^/]+)\/schedule$/);
  if (req.method === 'POST' && matchSchedule) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = scheduleMatchOnServer(getStateCollection('matches'), session.user, matchSchedule[1], body.scheduledAt);
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchRoom = pathname.match(/^\/api\/matches\/([^/]+)\/room$/);
  if (req.method === 'POST' && matchRoom) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = setRoomDetailsOnServer(
        getStateCollection('matches'),
        session.user,
        matchRoom[1],
        body.roomName,
        body.roomPassword
      );
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchLaunch = pathname.match(/^\/api\/matches\/([^/]+)\/launch$/);
  if (req.method === 'POST' && matchLaunch) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = launchMatchOnServer(getStateCollection('matches'), session.user, matchLaunch[1]);
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchResult = pathname.match(/^\/api\/matches\/([^/]+)\/result$/);
  if (req.method === 'POST' && matchResult) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      // On PERSISTE le résultat mais on NE VERSE PAS : le match passe en
      // 'awaiting_confirmation'. Les deux équipes doivent confirmer (ou la
      // fenêtre de 30 min expire via cron) avant que la cagnotte parte.
      // C'est la seule fenêtre où le perdant peut encore ouvrir un litige.
      //
      // Whitelist stricte : le body est du JSON client, on ne persiste que
      // les champs attendus (anti mass-assignment sur match.result).
      const outcome = await submitMatchResultOnServer(
        getStateCollection('matches'), session.user, matchResult[1], {
          winnerTeam: body.winnerTeam,
          scores: body.scores,
          proofs: body.proofs,
          screenshots: body.screenshots,
          resolutionType: body.resolutionType,
          arbiterNotes: body.arbiterNotes,
        }, { deferSettlement: true }
      );
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, {
        ...buildMatchActionPayload(outcome.match, session.user.id),
        awaitingConfirmation: true,
        confirmationDeadline: outcome.match.confirmationDeadline,
      });
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchConfirm = pathname.match(/^\/api\/matches\/([^/]+)\/confirm$/);
  if (req.method === 'POST' && matchConfirm) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = await confirmMatchResultOnServer(getStateCollection('matches'), session.user, matchConfirm[1]);
      await saveMatches(io, outcome.matches, outcome.match);

      const match = outcome.match;
      // On prévient ceux qui n'ont pas encore confirmé (ils peuvent
      // contester tant que la fenêtre est ouverte).
      const pendingIds = outcome.waitingFor || [];
      for (const userId of pendingIds) {
        if (userId === session.user.id) continue;
        deliverNotification(io, userId, {
          type: 'match_result',
          title: 'Resultat a confirmer',
          body: `${session.user.pseudo} a confirme le resultat du match ${match.id}. Confirme-le ou ouvre un litige avant la fin du delai.`,
          url: `/mj/match/${match.id}`,
          requireInteraction: true
        }).catch(err => log.error('Notification delivery failed', err));
      }

      respondJson(res, 200, {
        ...buildMatchActionPayload(outcome.match, session.user.id),
        settled: outcome.settled,
        waitingFor: outcome.waitingFor,
      });
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchDisputes = pathname.match(/^\/api\/matches\/([^/]+)\/disputes$/);
  if (req.method === 'POST' && matchDisputes) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = openDisputeOnServer(getStateCollection('matches'), session.user, matchDisputes[1], body);
      await saveMatches(io, outcome.matches, outcome.match);

      const match = outcome.match;
      const otherPlayerId = match.players?.find(p => p.userId !== session.user.id)?.userId;
      if (otherPlayerId) {
        deliverNotification(io, otherPlayerId, {
          type: 'dispute_opened',
          title: 'Litige ouvert',
          body: `${session.user.pseudo} a ouvert un litige sur un match.`,
          url: `/mj/match/${match.id}`,
          requireInteraction: true
        }).catch(err => log.error('Notification delivery failed', err));
      }

      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchDisputeEvidence = pathname.match(/^\/api\/matches\/([^/]+)\/dispute\/evidence$/);
  if (req.method === 'POST' && matchDisputeEvidence) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = addEvidenceToDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        matchDisputeEvidence[1],
        body.evidence
      );
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const matchDisputeEscalate = pathname.match(/^\/api\/matches\/([^/]+)\/dispute\/escalate$/);
  if (req.method === 'POST' && matchDisputeEscalate) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    try { await withMatchMutex(async () => {
      const outcome = escalateDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        matchDisputeEscalate[1]
      );
      await saveMatches(io, outcome.matches, outcome.match);

      // Notify admins of escalation
      const match = outcome.match;
      notifyAllAdmins(io, {
        type: 'dispute_update',
        title: 'Litige escaladé',
        body: `Match ${match.id} — Litige escaladé au niveau admin par ${session.user.pseudo}.`,
        url: `/admin`,
        requireInteraction: true,
      }).catch(err => log.error('Notification delivery failed', err));

      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  // Admin: force reload all data from Supabase
  if (req.method === 'POST' && pathname === '/api/admin/reload') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin2fa(req, res);
    if (!session) return;
    log.info('Admin force reload from Supabase', { adminId: session.user.id });
    try {
      const ok = await forceReloadFromSupabase();
      const health = getHealthInfo();
      respondJson(res, 200, { ok, persistence: health });
    } catch (err) {
      log.error('Admin reload failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors du rechargement des donnees.', code: 'RELOAD_ERROR' });
    }
    return;
  }

  // Admin: commissions ZOYD encaissees (frais de retrait + arbitrages).
  // Donnee financiere sensible -> 2FA obligatoire, comme les autres operations
  //financieres. `/api/stats` reste public et ne l'expose PAS.
  if (req.method === 'GET' && pathname === '/api/admin/commissions') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin2fa(req, res);
    if (!session) return;
    try {
      respondJson(res, 200, { ok: true, commissions: getCommissionStats() }, req);
    } catch (err) {
      log.error('Admin commissions failed', { adminId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors du calcul des commissions.', code: 'COMMISSIONS_ERROR' }, req);
    }
    return;
  }

  // SEC-R4: Admin 2FA status — whether TOTP is enabled for this admin
  if (req.method === 'GET' && pathname === '/api/admin/2fa/status') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin(req, res);
    if (!session) return;
    const entry = adminTotpSecrets.get(session.user.id);
    respondJson(res, 200, { ok: true, enabled: !!entry?.enabled });
    return;
  }

  // SEC-R4: Admin 2FA setup — generate TOTP secret for admin
  if (req.method === 'POST' && pathname === '/api/admin/2fa/setup') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin(req, res);
    if (!session) return;
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
      return;
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
    return;
  }

  // SEC-R4: Admin 2FA enable — verify code and activate 2FA
  if (req.method === 'POST' && pathname === '/api/admin/2fa/enable') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin(req, res);
    if (!session) return;
    const body = await parseRequestBody(req).catch(() => ({}));
    const { code } = body || {};
    if (!code || typeof code !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Code 2FA requis.', code: 'MFA_REQUIRED' });
      return;
    }
    const totpEntry = adminTotpSecrets.get(session.user.id);
    if (!totpEntry || !totpEntry.secret) {
      respondJson(res, 400, { ok: false, error: 'Aucune configuration 2FA en cours. Effectuez /api/admin/2fa/setup d\'abord.' });
      return;
    }
    if (totpEntry.enabled) {
      respondJson(res, 400, { ok: false, error: '2FA deja activee.', code: 'MFA_ALREADY_ACTIVE' });
      return;
    }
    if (!verifyTotp(totpEntry.secret, code)) {
      log.warn('Admin 2FA enable failed — invalid code', { adminId: session.user.id });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.', code: 'MFA_INVALID' });
      return;
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
    return;
  }

  // SEC-R4: Admin 2FA verify — verify TOTP code for financial operations
  if (req.method === 'POST' && pathname === '/api/admin/2fa/verify') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin(req, res);
    if (!session) return;
    const body = await parseRequestBody(req).catch(() => ({}));
    const { code } = body || {};
    if (!code || typeof code !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Code 2FA requis.', code: 'MFA_REQUIRED' });
      return;
    }
    const totpEntry = adminTotpSecrets.get(session.user.id);
    if (!totpEntry?.enabled) {
      respondJson(res, 400, { ok: false, error: '2FA non active pour ce compte admin.', code: 'MFA_NOT_ACTIVE' });
      return;
    }
    if (!verifyTotp(totpEntry.secret, code)) {
      log.warn('Admin 2FA verify failed — invalid code', { adminId: session.user.id });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.', code: 'MFA_INVALID' });
      return;
    }
    // Persiste sur la session STOCKÉE (getAuthSession renvoie une copie — muter `session` ne suffit pas)
    markAdmin2faVerified(readBearerToken(req));
    log.info('Admin 2FA verified', { adminId: session.user.id });
    respondJson(res, 200, { ok: true });
    return;
  }

  const adminMatchAward = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/award$/);
  if (req.method === 'POST' && adminMatchAward) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin2fa(req, res);
    if (!session) return;

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      if (body.winnerTeam !== 0 && body.winnerTeam !== 1) {
        respondJson(res, 400, { ok: false, error: 'winnerTeam doit être 0 ou 1.', code: 'INVALID_WINNER' });
        return;
      }
      const currentMatches = getStateCollection('matches');
      const targetMatch = currentMatches.find((entry) => entry.id === adminMatchAward[1]);
      const defaultScores = body.winnerTeam === 0 ? { team0: 1, team1: 0 } : { team0: 0, team1: 1 };
      // Décision de modération = décision finale : on persistE puis on règle
      // immédiatement, SANS fenêtre de confirmation (l'admin arbitre, les
      // joueurs n'ont plus à confirmer). D'où deferSettlement: false.
      const outcome = await submitMatchResultOnServer(currentMatches, session.user, adminMatchAward[1], {
        winnerTeam: body.winnerTeam,
        scores: targetMatch?.result?.scores || defaultScores,
        screenshots: targetMatch?.result?.screenshots || [],
        proofs: targetMatch?.result?.proofs,
        arbiterNotes: body.arbiterNotes || 'Resolution admin depuis le command center.',
        submittedBy: 'admin-dashboard',
      }, { deferSettlement: false });
      await saveMatches(io, outcome.matches, outcome.match);
      if (outcome.match.result?.payoutDistributed !== true) {
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
    return;
  }

  const adminMatchResolve = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/resolve-dispute$/);
  if (req.method === 'POST' && adminMatchResolve) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin2fa(req, res);
    if (!session) return;

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
    return;
  }

  const adminMatchCancel = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && adminMatchCancel) {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin2fa(req, res);
    if (!session) return;

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
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/bootstrap') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;
    try {
      respondJson(res, 200, { ok: true, ...buildChatBootstrapPayload(session.user.id) });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du chat.', code: 'LOAD_ERROR' });
    }
    return;
  }

  const chatChannelDetail = pathname.match(/^\/api\/chat\/channels\/([^/]+)$/);
  if (req.method === 'GET' && chatChannelDetail) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    const channel = getChatChannelById(chatChannelDetail[1]);
    if (!channel || !canAccessChatChannel(channel, session.user)) {
      respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.', code: 'CHANNEL_NOT_FOUND' });
      return;
    }

    try {
      respondJson(res, 200, {
        ok: true,
        channel: {
          ...channel,
          unreadCount: getUnreadCountForUser(channel.id, session.user.id),
        },
        messages: getChatMessagesForChannel(channel.id, 150),
      });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du canal.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat/channels') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;

    try {
      const body = await parseRequestBody(req);
      const CHANNEL_TYPES = ['private', 'match', 'team', 'dm'];
      const channelType = body.type || 'private';
      if (!CHANNEL_TYPES.includes(channelType)) {
        respondJson(res, 400, { ok: false, error: `Type de canal invalide. Valeurs acceptees: ${CHANNEL_TYPES.join(', ')}`, code: 'INVALID_ENUM' });
        return;
      }
      // Validate participants — only existing user IDs allowed
      const rawParticipants = Array.isArray(body.participants) ? body.participants.filter(Boolean) : [];
      const validParticipants = rawParticipants.filter((id) => getUserById(id));
      const channel = upsertChatChannel({
        id: `CH-${body.type || 'private'}-${Date.now().toString(36).toUpperCase()}`,
        type: body.type || 'private',
        name: body.name || 'Nouvelle conversation',
        participants: [session.user.id, ...validParticipants],
        scope: 'participants',
        inbox: 'participants',
        createdAt: getNow(),
        updatedAt: getNow(),
      });

      broadcastChatChannel(io, channel);
      respondJson(res, 201, {
        ok: true,
        channel: {
          ...channel,
          unreadCount: 0,
        },
        messages: [],
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const chatChannelMessages = pathname.match(/^\/api\/chat\/channels\/([^/]+)\/messages$/);
  if (req.method === 'POST' && chatChannelMessages) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;

    try {
      const body = await parseRequestBody(req);
      const channel = getChatChannelById(chatChannelMessages[1]);
      if (!channel || !canAccessChatChannel(channel, session.user)) {
        respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.', code: 'CHANNEL_NOT_FOUND' });
        return;
      }

      const text = sanitizeText(body.text || '').slice(0, 2000);
      if (!text) {
        respondJson(res, 400, { ok: false, error: 'Le message est vide.', code: 'EMPTY_MESSAGE' });
        return;
      }

      const message = await appendChatMessage({
        id: `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        channelId: channel.id,
        channelType: channel.type,
        senderId: session.user.id,
        senderPseudo: session.user.pseudo,
        text,
        replyTo: body.replyTo,
        timestamp: getNow(),
      });
      const updatedChannel = getChatChannelById(channel.id);

      broadcastChatMessage(io, updatedChannel, message);
      respondJson(res, 201, {
        ok: true,
        channel: {
          ...updatedChannel,
          unreadCount: 0,
        },
        message,
      });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  const chatChannelRead = pathname.match(/^\/api\/chat\/channels\/([^/]+)\/read$/);
  if (req.method === 'POST' && chatChannelRead) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;

    const channel = getChatChannelById(chatChannelRead[1]);
    if (!channel || !canAccessChatChannel(channel, session.user)) {
      respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.', code: 'CHANNEL_NOT_FOUND' });
      return;
    }

    try {
      const receipt = await markChatChannelRead(channel.id, session.user.id, getNow());
      broadcastChatRead(io, receipt.channelId, receipt.userId, receipt.readAt);
      respondJson(res, 200, { ok: true, ...receipt });
    } catch (err) {
      log.error('chat/channel read failed', { channelId: channel.id, userId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la marque de lecture.', code: 'READ_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/auth/session') {
    if (!rateLimitGuard(res, getClientIp(req), 'auth')) return;
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const realtimeSession = await createRealtimeSession({
        userId: session.user.id,
        pseudo: session.user.pseudo,
        role: session.user.role,
      });
      respondJson(res, 200, { ok: true, session: realtimeSession });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la creation de la session temps reel.', code: 'SESSION_ERROR' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/realtime/push/public-key') {
    if (!vapidKeys) {
      respondJson(res, 503, { ok: false, error: 'Notifications push non configurees.', code: 'PUSH_NOT_CONFIGURED' });
    } else {
      respondJson(res, 200, { publicKey: vapidKeys.publicKey });
    }
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/realtime/state/bootstrap')) {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
const allMatches = getStateCollection('matches');
      const recentMatches = allMatches.slice(-100)
        .map((match) => sanitizeMatchForBroadcast(match, session.userId));
      const allTournaments = getStoredTournaments();
      const recentTournaments = allTournaments.slice(-50)
        .map((t) => sanitizeTournamentForBroadcast(t, session.userId));
      respondJson(res, 200, {
        ok: true,
        matches: recentMatches,
        tournaments: recentTournaments,
        friends: getFriendsForUser(session.userId),
        friendRequests: getFriendRequestsForUser(session.userId),
        blockedIds: getBlockedUsers(session.userId),
        notifications: getUnreadNotificationsForUser(session.userId),
        timestamp: getNow(),
      });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement de l\'etat realtime.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/state/sync') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      if (body?.kind === 'tournaments') {
        respondJson(res, 409, { ok: false, error: 'Tournoi gere par les routes API dediees.', code: 'DEPRECATED_ROUTE' });
        return;
      }

      respondJson(res, 400, { ok: false, error: 'Payload de synchronisation invalide.', code: 'INVALID_PAYLOAD' });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Impossible de valider la synchronisation.', code: 'SYNC_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/push/subscribe') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const { subscription } = body;

      if (!subscription?.endpoint) {
        respondJson(res, 400, { ok: false, error: 'Point de souscription manquant.', code: 'MISSING_FIELDS' });
        return;
      }

      upsertPushSubscription(session.userId, subscription);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Impossible de sauvegarder la souscription.', code: 'SUBSCRIPTION_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/push/unsubscribe') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const { endpoint } = body;

      if (!endpoint) {
        respondJson(res, 400, { ok: false, error: 'Endpoint manquant.', code: 'MISSING_FIELDS' });
        return;
      }

      removePushSubscription(endpoint);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Impossible de supprimer la souscription.', code: 'SUBSCRIPTION_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/push/test') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const { title, body: messageBody, url, tag } = body;

      const payload = {
        title: title || 'ZOYD',
        body: messageBody || 'Notification de test ZOYD',
        url: url || '/mj',
        tag: tag || `zoyd-test-${Date.now()}`,
        requireInteraction: false,
      };

      await deliverNotification(io, session.userId, payload);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: "Impossible d'envoyer la notification test.", code: 'PUSH_ERROR' });
    }
    return;
  }

  respondJson(res, 404, { ok: false, error: 'Route introuvable.', code: 'NOT_FOUND' });
};

// Filet de sécurité : sans ce catch, la moindre exception non gérée dans une
// route laisse la requête pendre indéfiniment (client en timeout au lieu d'une 500).
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    log.error('Unhandled route error', { message: err?.message, path: req?.url });
    try {
      respondJson(res, 500, { ok: false, error: 'Erreur serveur inattendue.', code: 'INTERNAL_ERROR' });
    } catch { /* socket déjà fermée */ }
  });
});

const io = new SocketIOServer(server, {
  // Détection rapide des connexions mortes (sleep Render, réseau mobile).
  pingInterval: 20_000,
  pingTimeout: 10_000,
  // Le cookie de session est en SameSite=None (cross-site Vercel→Render), il
  // part donc aussi sur le handshake WebSocket. Or `cors.origin` ne s'applique
  // qu'au transport polling : une page tierce pouvait ouvrir un socket
  // authentifié avec le cookie de la victime (usurpation de présence, écoute
  // des events). allowRequest filtre l'upgrade WebSocket aussi.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    log.warn('Socket WS refuse : origine non autorisee', { origin });
    callback(null, false);
  },
  cors: {
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('origin_not_allowed'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Socket.io connection rate limit per IP
const socketConnectionCounts = new Map();
const SOCKET_CONNECTION_LIMIT = 10;
const SOCKET_CONNECTION_WINDOW = 60 * 1000;
const MAX_SOCKET_CONNECTION_ENTRIES = 10000;

const cleanupSocketConnectionCounts = () => {
  const now = Date.now();
  for (const [ip, entry] of socketConnectionCounts) {
    if (now - entry.start > SOCKET_CONNECTION_WINDOW * 2) {
      socketConnectionCounts.delete(ip);
    }
  }
  // Cap total entries to prevent memory leak
  if (socketConnectionCounts.size > MAX_SOCKET_CONNECTION_ENTRIES) {
    let evicted = 0;
    const toEvict = socketConnectionCounts.size - MAX_SOCKET_CONNECTION_ENTRIES;
    for (const key of socketConnectionCounts.keys()) {
      if (evicted >= toEvict) break;
      socketConnectionCounts.delete(key);
      evicted++;
    }
  }
};
setInterval(cleanupSocketConnectionCounts, 5 * 60 * 1000);

io.use(async (socket, next) => {
  const ip = socket.handshake.address || '127.0.0.1';
  const now = Date.now();
  const entry = socketConnectionCounts.get(ip);
  if (!entry || now - entry.start > SOCKET_CONNECTION_WINDOW) {
    socketConnectionCounts.set(ip, { start: now, count: 1 });
  } else {
    entry.count++;
    if (entry.count > SOCKET_CONNECTION_LIMIT) {
      next(new Error('rate_limited'));
      return;
    }
  }

  let session = getRealtimeSession(socket.handshake.auth?.token);
  if (!session) {
    // Fallback cookie httpOnly : session auth -> session realtime (créée si besoin).
    const cookieHeader = socket.handshake.headers?.cookie || '';
    const cookieMatch = /zoyd_auth=([^;]+)/.exec(cookieHeader);
    if (cookieMatch) {
      try {
        const authSession = getAuthSession(decodeURIComponent(cookieMatch[1]), { skipRotation: true });
        if (authSession) session = await getOrCreateRealtimeSessionForUser(authSession.user.id);
      } catch { /* jeton invalide -> unauthorized ci-dessous */ }
    }
  }

  if (!session) {
    next(new Error('unauthorized'));
    return;
  }

  socket.data.session = session;
  next();
});

io.on('connection', (socket) => {
  const session = socket.data.session;
  socket.join(`user:${session.userId}`);
  incCounter('zoyd_socket_connections_total');
  setGauge('zoyd_socket_connections', io.engine.clientsCount);

  socket.emit('server:hello', {
    socketId: socket.id,
    serverTime: getNow(),
    userId: session.userId,
  });

  socket.on('presence:join', (payload = {}) => {
    const ip = socket.handshake.address || '127.0.0.1';
    const { allowed } = checkRateLimit(ip, 'chat');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const channelId = payload.channelId;
    if (!channelId) return;

    const channel = getChatChannelById(channelId);
    const user = getUserById(session.userId);
    if (!canAccessChatChannel(channel, user)) {
      socket.emit('server:error', { error: 'Access denied to this channel.' });
      return;
    }

    const safePayload = {
      ...payload,
      userId: session.userId,
      pseudo: session.pseudo,
    };
    const member = upsertChannelMember(socket, safePayload);
    if (!member) return;
    emitChannelSnapshots(io, safePayload.channelId);
  });

  socket.on('presence:update', (payload = {}) => {
    const ip = socket.handshake.address || '127.0.0.1';
    const { allowed } = checkRateLimit(ip, 'chat');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const channelId = payload.channelId;
    if (!channelId) return;

    const channel = getChatChannelById(channelId);
    const user = getUserById(session.userId);
    if (!canAccessChatChannel(channel, user)) {
      socket.emit('server:error', { error: 'Access denied to this channel.' });
      return;
    }

    const safePayload = {
      ...payload,
      userId: session.userId,
      pseudo: session.pseudo,
    };
    const { userId } = safePayload;

    const members = getChannelMemberMap(channelId);
    const existingMember = members.get(userId);
    if (!existingMember) {
      const createdMember = upsertChannelMember(socket, safePayload);
      if (!createdMember) return;
    } else {
      existingMember.role = ['player', 'arbiter', 'spectator'].includes(safePayload.role) ? safePayload.role : existingMember.role;
      existingMember.team = typeof safePayload.team === 'number' && safePayload.team <= 1 ? safePayload.team : existingMember.team;
      existingMember.isCheckedIn = Boolean(safePayload.isCheckedIn);
      existingMember.isReady = Boolean(safePayload.isReady);
      existingMember.lastActiveAt = getNow();
      existingMember.socketIds.add(socket.id);
      members.set(userId, existingMember);
      trackSocketChannel(socket.id, channelId);
      socket.join(channelId);
    }

    emitChannelSnapshots(io, channelId);
  });

  socket.on('presence:leave', (payload = {}) => {
    const ip = socket.handshake.address || '127.0.0.1';
    const { allowed } = checkRateLimit(ip, 'chat');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    if (!payload.channelId) return;
    removeSocketFromChannel(io, socket, payload.channelId);
  });

  socket.on('channel:seen', (payload = {}) => {
    const ip = socket.handshake.address || '127.0.0.1';
    const { allowed } = checkRateLimit(ip, 'chat');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const { channelId } = payload;
    if (!channelId) return;

    const channel = getChatChannelById(channelId);
    const user = getUserById(session.userId);
    if (!canAccessChatChannel(channel, user)) return;

    const seen = getSeenMap(channelId);
    seen.set(session.userId, getNow());
    emitChannelSnapshots(io, channelId);
  });

  socket.on('typing:update', (payload = {}) => {
    const ip = socket.handshake.address || '127.0.0.1';
    const { allowed } = checkRateLimit(ip, 'chat');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const { channelId, isTyping } = payload;
    if (!channelId) return;

    const channel = getChatChannelById(channelId);
    const user = getUserById(session.userId);
    if (!canAccessChatChannel(channel, user)) return;

    const typing = getTypingMap(channelId);
    if (isTyping) {
      typing.set(session.userId, {
        userId: session.userId,
        pseudo: session.pseudo,
        startedAt: getNow(),
        socketId: socket.id,
      });
    } else {
      typing.delete(session.userId);
    }

    emitChannelSnapshots(io, channelId);
  });

  socket.on('notification:push', async (payload = {}) => {
    const ip = socket.handshake.address || '127.0.0.1';
    const { allowed } = checkRateLimit(ip, 'default');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const { targetUserId, title, body: notifBody, url, tag, requireInteraction } = payload;
    if (!targetUserId || !title) return;

    // Security: users can only send push to themselves, admins can send to anyone
    if (session.userId !== targetUserId && session.role !== 'admin') {
      return;
    }

    try {
      await deliverNotification(io, targetUserId, {
        title,
        body: notifBody || 'Notification ZOYD',
        url: url || '/mj',
        tag: tag || `zoyd-${Date.now()}`,
        requireInteraction: Boolean(requireInteraction),
      });
    } catch (err) {
      log.warn('notification:push delivery failed', { targetUserId, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    for (const channelId of channelsBySocket.get(socket.id) || []) {
      removeSocketFromChannel(io, socket, channelId);
    }

    channelsBySocket.delete(socket.id);
    incCounter('zoyd_socket_disconnects_total');
    setGauge('zoyd_socket_connections', io.engine.clientsCount);
  });
});

const start = async () => {
  const loaded = await loadFromSupabaseWithRetry(3);
  if (!loaded) {
    // Le serveur démarre quand même (les lectures restent possibles), mais
    // TOUTE écriture d'état est refusée tant que l'état n'est pas complet
    // (isStateTrusted() === false). C'est volontaire : démarrer avec un état
    // partiel faisait purger la base au premier match créé.
    log.error('CRITICAL: Failed to load data from Supabase after 3 attempts — ecritures desactivees', {
      stateTrusted: isStateTrusted(),
      error: getStateLoadError(),
    });
  }

  // Load admin 2FA secrets from Supabase
  const loaded2fa = await loadAdminTotpSecrets();
  for (const [userId, entry] of loaded2fa) {
    adminTotpSecrets.set(userId, entry);
  }

  // Verify data integrity after full load
  const integrity = await verifyDataIntegrity();
  if (!integrity.ok) {
    log.error('DATA INTEGRITY CHECK FAILED at startup', integrity);
  }

  ensureGlobalChatChannel();
  syncMatchChatChannels(getStateCollection('matches'));
  initCronJobs();

  matchAutomationIntervalId = setInterval(async () => {
    if (matchAutomationRunning) {
      log.warn('Match automation skipped: previous tick still running.');
      return;
    }
    matchAutomationRunning = true;
    try { await withMatchMutex(async () => {
      const outcome = await processMatchAutomationOnServer(getStateCollection('matches'));
      if (outcome.changed) {
        await saveMatches(io, outcome.matches);
      }
    });
    } catch (error) {
      log.error('Match automation error', error);
    } finally {
      matchAutomationRunning = false;
    }
  }, MATCH_AUTOMATION_INTERVAL_MS);

  server.listen(PORT, () => {
    log.info(`Listening on http://localhost:${PORT}`);
  });
};

process.on('unhandledRejection', (err) => {
  log.fatal('Unhandled promise rejection', err);
});
process.on('uncaughtException', (err) => {
  log.fatal('Uncaught exception — exiting to prevent corrupted state', err);
  process.exit(1);
});

const gracefulShutdown = (signal) => {
  log.info(`${signal} received — shutting down gracefully`);
  clearInterval(matchAutomationIntervalId);
  server.close(() => {
    io.close(() => {
      log.info('All connections closed');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();

