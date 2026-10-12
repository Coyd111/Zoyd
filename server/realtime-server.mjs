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
import { saveMatches, refreshLiveMatchIdentities, getStoredTournaments, saveTournaments, buildMatchActionPayload, sanitizeMatchForBroadcast, sanitizeTournamentForBroadcast, buildTournamentActionPayload, getStoredLeagues, saveLeagues, buildLeagueActionPayload, getStoredBrLobbies, saveBrLobbies, toPublicBrLobby, toPublicBrRanking } from './state-helpers.mjs';
import { deliverAuthCode } from './code-delivery.mjs';
import { handleAdminRoutes } from './routes/admin.mjs';
import { handleSocialRoutes } from './routes/social.mjs';
import { handleTournamentRoutes } from './routes/tournament.mjs';
import { handleLeagueRoutes } from './routes/league.mjs';
import { handleBrRoutes } from './routes/br.mjs';
import { handleMatchRoutes } from './routes/match.mjs';
import { handleChatRoutes } from './routes/chat.mjs';
import { handleRealtimeRoutes } from './routes/realtime.mjs';
import { verifyTotp, toBase32, adminTotpSecrets, requireAdmin, requireAdmin2fa } from './admin-totp.mjs';

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
  isEmailAvailable,
  normalizeEmailKey,
  withRegistrationMutex,
  assertStrongPassword,
  tagWalletTransaction,
  hasActiveWithdrawalKey,
  trackWithdrawalKey,
  forgetWithdrawalKey,
  hydrateWithdrawalKeys,
  getPublicStats,
  getCommissionStats,
  markAdmin2faVerified,
  onWalletUpdated,
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
  //
  // Session obligatoire : ces endpoints ne contiennent aucun secret, mais
  // sans garde le serveur devenait un proxy Codashop gratuit pour tout
  // Internet, sur le quota du forfait Render gratuit. L'usage metier est de
  // rattacher le compte CODM d'un JOUEUR a son profil : un compte suffit.
  if (req.method === 'GET' && pathname === '/api/codm/store') {
    if (!getAuthenticatedAppSession(req)) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
      return;
    }
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
    // Meme garde que le proxy store : la verification d'un UID CODM est un
    // acte de compte (rattacher son profil), pas une API publique.
    if (!getAuthenticatedAppSession(req)) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
      return;
    }
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
          // Un pseudo vide effacerait l'identité du joueur : il disparaît des
          // matchs en cours, des classements et de la file de l'arbitre.
          // `checkProfileUniqueness` ignoreait justement les valeurs vides, le
          // compte restait donc « valide »… sans nom.
          if (field === 'pseudo' && !String(value || '').trim()) {
            respondJson(res, 400, { ok: false, error: 'Le pseudo ne peut pas etre vide.', code: 'PSEUDO_REQUIRED' });
            return;
          }
          safeUpdate[field] = value;
        }
      }

      // Changement d'email de connexion : opération sensible, traitée à part.
      //
      // L'email est l'IDENTIFIANT du compte. Le changer sans prouver son mot
      // de passe permettrait à une session volée (XSS, poste partagé) de prendre
      // la main définitivement : l'ancien mot de passe ne servirait plus à rien
      // pour revenir. D'où la reauthentification obligatoire.
      if (typeof body.email === 'string' && body.email.trim()) {
        const nextEmail = body.email.trim().toLowerCase();
        const currentEmail = normalizeEmailKey(getUserById(session.user.id)?.email || '');
        if (nextEmail !== currentEmail) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nextEmail) || nextEmail.length > 120) {
            respondJson(res, 400, { ok: false, error: 'Email invalide.', code: 'INVALID_EMAIL' });
            return;
          }
          if (!isEmailAvailable(nextEmail, session.user.id)) {
            respondJson(res, 409, { ok: false, error: 'Cet email est deja rattache a un compte ZOYD.', code: 'DUPLICATE_EMAIL' });
            return;
          }
          // `verifyPassword` part dans scrypt : un `undefined` le ferait
          // exploser en 500 au lieu de repondre 403.
          if (
            typeof body.currentPassword !== 'string'
            || !body.currentPassword
            || !(await verifyUserPassword(session.user.id, body.currentPassword))
          ) {
            respondJson(res, 403, { ok: false, error: 'Mot de passe incorrect : confirmation requise pour changer d’email.', code: 'PASSWORD_CONFIRMATION_REQUIRED' });
            return;
          }
          safeUpdate.email = nextEmail;
        }
      }
      const updatedUser = await withRegistrationMutex(() => updateUserAccount(session.user.id, (user) => {
        // Unicité pseudo/email/phone (sinon collisions auth) — throw DUPLICATE_* → 409.
        // Sous mutex global : deux PATCH concurrents ne peuvent plus prendre le même identifiant.
        checkProfileUniqueness(session.user.id, safeUpdate);
        return { ...user, ...safeUpdate };
      }));
      // Un pseudo n'est pas figé dans les matchs en cours : l'arbitre doit voir
      // le nouveau nom sans attendre le prochain mouvement de match.
      if (safeUpdate.pseudo) {
        try {
          refreshLiveMatchIdentities(io, session.user.id);
        } catch (broadcastError) {
          // Le renregistrement est déjà écrit : un échec de diffusion ne doit
          // pas faire répondre 500 au client (le rattrapageira au prochain
          // broadcast de match).
          log.warn('Renvoi des matchs apres changement de pseudo impossible', { error: String(broadcastError?.message || broadcastError) });
        }
      }
      respondJson(res, 200, { ok: true, user: updatedUser }, req);
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (await handleSocialRoutes({ req, res, pathname, io })) return;


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
        // L'index dedie (`hasActiveWithdrawalKey`) ne depend PAS de
        // l'historique de transactions, plafonne a 200 entrees : au-dela, la
        // cle disparait de l'historique et un retry redébitait.
        //
        // Deux etats a distinguer :
        //   - payout CONFIRME  (un payoutId existe) -> doublon strict, on
        //     renvoie l'etat existant, aucun second transfert.
        //   - payout AMBIGU (debit fait, aucun payoutId, pas de tag 'failed')
        //     -> FedaPay a pu envoyer l'argent sans que la reponse arrive.
        //     Relancer automatiquement risquerait un DOUBLE PAIEMENT. On
        //     refuse donc : seule la moderation tranche apres verification.
        if (cleanKey) {
          const userRecord = getUserById(session.user.id);
          const priorTx = (userRecord?.wallet?.transactions || []).find(
            (tx) => tx?.metadata?.idempotencyKey === cleanKey && tx.type === 'withdraw',
          );
          if (hasActiveWithdrawalKey(session.user.id, cleanKey, userRecord?.wallet?.transactions)) {
            if (priorTx && !priorTx.metadata?.payoutId && priorTx.metadata?.payoutStatus !== 'failed') {
              respondJson(res, 409, {
                ok: false,
                error: 'Un retrait avec cette cle est deja engage et son transfert n\'est pas confirme. Contacte le support avant de reessayer.',
                code: 'PAYOUT_PENDING_REVIEW',
                idempotencyKey: cleanKey,
              }, req);
              return;
            }
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
        if (cleanKey) trackWithdrawalKey(session.user.id, cleanKey);
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
          // `type: 'refund'` et non `deposit` : dans l'historique, un
          // remboursement d'un retrait echoue doit se lire comme tel. Ecrit
          // comme un depot, il laissait croire a un versement que personne
          // n'avait effectue.
          await depositToWallet(session.user.id, body.amount, 'Remboursement', {
            type: 'refund',
            description: `Remboursement — retrait echoue (${body.amount} ZC rendus)`,
            metadata: { reason: 'PAYOUT_FAILED', idempotencyKey: cleanKey },
          });
        });
      } catch (refundError) {
        // Perte sèche : l'argent est parti sans que le remboursement passe.
        // On le laisse CRISSER dans les logs plutôt que de l'avaler.
        log.error('CRITICAL: Refund also failed — balance to reconcile manually', {
          userId: session.user.id,
          amount: body.amount,
          idempotencyKey: cleanKey,
          error: refundError.message,
        });
      }
      if (withdrawTxId) {
        try {
          // `status: 'failed'` ETANT `payoutStatus` : le statut est ce que
          // l'historique affiche. Sans lui, un retrait refuse par FedaPay
          // restait « completed » avec une coche verte.
          await tagWalletTransaction(session.user.id, withdrawTxId, { payoutStatus: 'failed', status: 'failed' });
          // La clé est libérée : le joueur a été remboursé, un retry doit
          // pouvoir relancer un vrai payout.
          forgetWithdrawalKey(session.user.id, cleanKey);
        } catch (tagError) {
          // Avant : `.catch(() => {})`. Avalé, le retrait restait NON marqué
          // 'failed', donc compté dans les commissions ZOYD alors que la
          // somme avait été remboursée — et la clé restait bloquée.
          log.error('CRITICAL: payoutStatus not tagged — commission may be over-counted', {
            userId: session.user.id, txId: withdrawTxId, error: tagError.message,
          });
        }
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
  if (await handleTournamentRoutes({ req, res, pathname, io })) return;


  // ─── League Endpoints ───────────────────────────────────────────────────

  if (await handleLeagueRoutes({ req, res, pathname, io })) return;


  // ─── Battle Royale (salon unique, un seul match) ─────────────────────────
  // Voir server/br-engine.mjs. Regle commerciale centrale : le pass est bloque
  // a l'inscription et n'est jamais rembourse une fois la partie lancee.

  // Referentiel : maps, modes et variantes de classement, pour que le front ne
  // code pas ses propres listes (source de verite unique).
  if (await handleBrRoutes({ req, res, pathname, io })) return;


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

  if (await handleMatchRoutes({ req, res, pathname, io })) return;


  // Routes d'administration : extraites dans routes/admin.mjs. Appelees a la
  // MEME position qu'occupait le bloc, donc l'ordre d'evaluation des routes
  // est inchange.
  if (await handleAdminRoutes({ req, res, pathname, io })) return;

  if (await handleChatRoutes({ req, res, pathname, io })) return;

  if (await handleRealtimeRoutes({ req, res, pathname, io })) return;


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

// Chaque onglet du joueur rejoint la room `user:<id>` (voir le handshake plus
// bas). On y pousse le portefeuille a chaque mutation : sans ca, un retrait
// fait dans un onglet laissait les autres afficher l'ancien solde jusqu'au
// rechargement complet de la page.
onWalletUpdated((userId, wallet) => {
  io.to(`user:${userId}`).emit('wallet:update', { wallet });
});

// Socket.io connection rate limit per IP
const socketConnectionCounts = new Map();
const SOCKET_CONNECTION_LIMIT = 10;
const SOCKET_CONNECTION_WINDOW = 60 * 1000;

/**
 * IP reelle du client pour le handshake Socket.IO.
 *
 * `handshake.address` est l'adresse TCP du pair : derriere le LB Render
 * c'est celle du load balancer, donc TOUS les joueurs tombaient dans le
 * meme compteur (10 connexions/minute pour toute la plateforme).
 * `getClientIp` applique deja les bonnes regles (XFF de confiance, dernier
 * saut). On lui fabrique donc un objet `{ socket, headers }` minimal plutot
 * que de reimplementer la resolution ici.
 */
const getClientIpFromHandshake = (handshake) =>
  getClientIp({
    socket: { remoteAddress: handshake?.address },
    headers: handshake?.headers || {},
  });
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
  // Même résolution que le rate-limit HTTP : derrière le LB Render, le peer
  // TCP est l'IP du load balancer, pas celle du joueur. Compter par `peer`
  // faisait partager UN SEUL compteur à toute la plateforme (10 connexions
  // / min au total), et le 11e visiteur se faisait refuser.
  const ip = getClientIpFromHandshake(socket.handshake);
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
    const ip = getClientIpFromHandshake(socket.handshake);
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
    const ip = getClientIpFromHandshake(socket.handshake);
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
    const ip = getClientIpFromHandshake(socket.handshake);
    const { allowed } = checkRateLimit(ip, 'chat');
    if (!allowed) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    if (!payload.channelId) return;
    removeSocketFromChannel(io, socket, payload.channelId);
  });

  socket.on('channel:seen', (payload = {}) => {
    const ip = getClientIpFromHandshake(socket.handshake);
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
    const ip = getClientIpFromHandshake(socket.handshake);
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
    const ip = getClientIpFromHandshake(socket.handshake);
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

  // Verify data integrity after full load.
  // Le résultat reste consultable via /api/health (getHealthInfo) et il est
  // rejoué toutes les heures par le cron.
  const integrity = await verifyDataIntegrity();
  if (!integrity.ok) {
    log.error('DATA INTEGRITY CHECK FAILED at startup', integrity);
  }

  ensureGlobalChatChannel();
  syncMatchChatChannels(getStateCollection('matches'));

  // Index des cles d'idempotence de retrait, reconstruit depuis les
  // portefeuilles charges : sans lui, une cle anterieure au redemarrage
  // serait inconnue et un retry redébitait le joueur.
  hydrateWithdrawalKeys();

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

