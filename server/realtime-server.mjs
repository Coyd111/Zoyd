import crypto from 'node:crypto';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import webpush from 'web-push';
import { vapidKeys } from './vapid-keys.mjs';
import { createLogger } from './logger.mjs';
import { metricsToPrometheus, incCounter, startTimer, endTimer, setGauge } from './metrics.mjs';
import { serializeCookie, ALLOWED_ORIGINS, getCorsOrigin, respondJson, parseQueryParams, paginate, parseRequestBody, readBearerToken, getAuthenticatedAppSession, getAuthenticatedRealtimeSession, getPathname, normalizePathForMetrics, mapPersistenceError, respondMappedError } from './http-utils.mjs';
import { checkRateLimit, getClientIp, rateLimitGuard } from './rate-limiter.mjs';
import { sendPushToUser, deliverNotification, broadcastStateSnapshot, notifyAllAdmins } from './push-notifications.mjs';
import { channels, channelsBySocket, seenByChannel, typingByChannel, cleanupChannelMaps, getChannelMemberMap, getSeenMap, getTypingMap, publicMember, emitChannelSnapshots, trackSocketChannel, untrackSocketChannel, upsertChannelMember, removeSocketFromChannel } from './channel-presence.mjs';
import { buildMatchChatChannel, syncMatchChatChannels, canAccessChatChannel, buildChatBootstrapPayload, broadcastChatChannel, broadcastChatMessage, broadcastChatRead } from './chat-helpers.mjs';
import { saveMatches, getStoredTournaments, saveTournaments, buildMatchActionPayload, sanitizeMatchForBroadcast, sanitizeTournamentForBroadcast, buildTournamentActionPayload, getStoredLeagues, saveLeagues, buildLeagueActionPayload } from './state-helpers.mjs';
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
  ensureGlobalChatChannel,
  getAuthSession,
  getLeaderboard,
  getUserById,
  verifyUserPassword,
  verifyActivationCode,
  generateActivationCode,
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
} from './persistence.mjs';
import { depositToWallet, getServerWallet, withdrawFromWallet } from './wallet-engine.mjs';
import { withMatchMutex, withTournamentMutex, withLeagueMutex, withWalletMutex, withUserMutex } from './mutex.mjs';
import { initCronJobs } from './cron.mjs';
import { getNow } from './utils.mjs';
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
  toggleReadyOnServer,
  addEvidenceToDisputeOnServer,
  escalateDisputeOnServer,
} from './match-engine.mjs';
import { verifyFedaPayTransactionAndCredit } from './payment-engine.mjs';
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

const log = createLogger('realtime');
const PORT = Number(process.env.PORT || process.env.ZOYD_REALTIME_PORT || 4001);
const API_KEY_ROTATION_DAYS = Number(process.env.ZOYD_API_KEY_ROTATION_DAYS || 90);
let matchAutomationIntervalId = null;

if (vapidKeys) {
  webpush.setVapidDetails('mailto:ops@zoyd.africa', vapidKeys.publicKey, vapidKeys.privateKey);
}

const server = http.createServer(async (req, res) => {
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

  if (req.method === 'GET' && pathname === '/api/health') {
    const health = getHealthInfo();
    respondJson(res, 200, {
      ok: true,
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
      const country = storeUrl.searchParams.get('country') || 'IN';
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
          shopLang: 'en_in',
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

      respondJson(res, 200, { ok: true, bundles, categories }, req);
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
      const { role: _role, ...rawBody } = body;
      const safeBody = {
        ...rawBody,
        pseudo: sanitizeText(rawBody.pseudo || ''),
        bio: sanitizeText(rawBody.bio || ''),
        streamerPseudo: sanitizeText(rawBody.streamerPseudo || ''),
      };
      const user = await createUserAccount(safeBody);
      const activationCode = generateActivationCode(user.email, user.id);
      
      respondJson(res, 201, {
        ok: true,
        user: sanitizeUserPayload(user),
        ...(process.env.NODE_ENV !== 'production' && { activationCode }),
        message: 'Compte cree avec succes.',
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

      // Set HttpOnly cookie for enhanced security
      const cookieValue = serializeCookie('zoyd_auth', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 6 * 60 * 60, // 6 hours — matches session expiry in persistence.mjs
        path: '/',
      });

      res.setHeader('Set-Cookie', cookieValue);

      respondJson(res, 200, {
        ok: true,
        user: session.user,
        expiresAt: session.expiresAt,
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
      const updatedUser = await updateUserAccount(session.user.id, (user) => {
        return { ...user, ...safeUpdate };
      });
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
    const token = readBearerToken(req);
    const session = token ? getAuthSession(token) : null;
    if (token) {
      deleteAuthSession(token);
    }
    if (session?.user?.id) {
      deleteRealtimeSessionsForUser(session.user.id);
    }

    // Clear HttpOnly cookie
    const cookieValue = serializeCookie('zoyd_auth', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });

    res.setHeader('Set-Cookie', cookieValue);

    respondJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/change-password') {
    const clientIp = getClientIp(req);
    if (!rateLimitGuard(res, clientIp, 'auth')) return;
    const token = readBearerToken(req);
    const session = token ? getAuthSession(token) : null;
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
      if (newPassword.length < 8) {
        respondJson(res, 400, { ok: false, error: 'Le nouveau mot de passe doit faire au moins 8 caracteres.', code: 'WEAK_PASSWORD' });
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
      deleteAuthSession(token);
      deleteRealtimeSessionsForUser(session.user.id);
      const cookieValue = serializeCookie('zoyd_auth', '', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
      });
      res.setHeader('Set-Cookie', cookieValue);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondMappedError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
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
    try {
      const user = getUserById(session.user.id);
      respondJson(res, 200, { ok: true, wallet: user?.wallet || getServerWallet(session.user.id), user });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du wallet.', code: 'LOAD_ERROR' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/wallet/deposit') {
    // Deposit endpoint admin-only (deposits go through /api/wallet/verify-fedapay in production)
    const adminSession = requireAdmin2fa(req);
    if (!adminSession) {
      respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.', code: 'ADMIN_REQUIRED' });
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
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 10_000_000) {
      respondJson(res, 400, { ok: false, error: 'Montant invalide (max 10 000 000 FCFA).', code: 'INVALID_AMOUNT' });
      return;
    }
    // Idempotency: prevent double-withdrawal on retry/double-click
    const idempotencyKey = body.idempotencyKey || req.headers['x-idempotency-key'];

    try { await withWalletMutex(session.user.id, async () => {
      // Check idempotency INSIDE mutex to prevent TOCTOU race
      if (idempotencyKey && typeof idempotencyKey === 'string') {
        const existingTx = (getUserById(session.user.id)?.wallet?.transactions || [])
          .find((tx) => tx.metadata?.idempotencyKey === idempotencyKey && tx.type === 'withdraw');
        if (existingTx) {
          respondJson(res, 200, { ok: true, wallet: getServerWallet(session.user.id), user: getUserById(session.user.id), duplicate: true });
          return;
        }
      }
      const wallet = await withdrawFromWallet(session.user.id, body.amount, body.method, body.phone);
      // Tag transaction with idempotency key for dedup on retry
      if (idempotencyKey && typeof idempotencyKey === 'string') {
        const user = getUserById(session.user.id);
        const lastTx = user?.wallet?.transactions?.[0];
        if (lastTx?.type === 'withdraw' && !lastTx.metadata?.idempotencyKey) {
          lastTx.metadata = { ...lastTx.metadata, idempotencyKey };
        }
      }
      const user = getUserById(session.user.id);
      respondJson(res, 200, { ok: true, wallet, user });
    }); } catch (error) {
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
      const { items: matches, hasMore } = paginate(visibleMatches.map(sanitizeMatchForBroadcast), { limit, offset });
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
      const { items: tournaments, hasMore } = paginate(all.map(sanitizeTournamentForBroadcast), { limit, offset });
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
      if (body.entryFee !== undefined && (typeof body.entryFee !== 'number' || body.entryFee < 0)) {
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
      if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 3) {
        respondJson(res, 400, { ok: false, error: 'Nom de la ligue requis (3-100 caractères).', code: 'INVALID_LEAGUE_NAME' });
        return;
      }
      if (!body.format || typeof body.format !== 'string') {
        respondJson(res, 400, { ok: false, error: 'Format requis.', code: 'INVALID_FORMAT' });
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
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
      return;
    }
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
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const payments = getLeaguePayments(getStoredLeagues(), leaguePayments[1]);
      respondJson(res, 200, { ok: true, payments });
    } catch (error) {
      respondMappedError(res, error);
    }
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
      if (!body.transactionId || typeof body.transactionId !== 'string' || !/^\d{1,20}$/.test(body.transactionId)) {
        respondJson(res, 400, { ok: false, error: 'transactionId invalide.', code: 'INVALID_TRANSACTION_ID' });
        return;
      }

      const outcome = await verifyFedaPayTransactionAndCredit(body.transactionId, session.user);
      const wallet = getServerWallet(session.user.id);
      respondJson(res, 200, { 
        ok: true, 
        amount: outcome.amountZC, 
        wallet,
        user: outcome.user
      });
    }); } catch (error) {
      log.error('Payment verification failed', { message: error.message });
      respondJson(res, 400, { ok: false, error: 'Verification du paiement echouee.', code: 'PAYMENT_FAILED' });
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

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      if (body.tournamentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tournamentId)) {
        respondJson(res, 400, { ok: false, error: 'tournamentId invalide.', code: 'INVALID_JSON' });
        return;
      }
      if (!body.format || !/^\d+VS\d+$/i.test(body.format)) {
        respondJson(res, 400, { ok: false, error: 'format invalide (ex: 1VS1, 5VS5).', code: 'INVALID_FORMAT' });
        return;
      }
      if (body.entryFee !== undefined && (typeof body.entryFee !== 'number' || body.entryFee < 0)) {
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

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
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
      const outcome = await submitMatchResultOnServer(getStateCollection('matches'), session.user, matchResult[1], body);
      await saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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
      const outcome = confirmMatchResultOnServer(getStateCollection('matches'), session.user, matchConfirm[1]);
      await saveMatches(io, outcome.matches, outcome.match);

      const match = outcome.match;
      const otherPlayerId = match.players?.find(p => p.userId !== session.user.id)?.userId;
      if (otherPlayerId) {
        deliverNotification(io, otherPlayerId, {
          type: 'match_result',
          title: 'Resultat confirme',
          body: `${session.user.pseudo} a confirme le resultat du match.`,
          url: `/mj/match/${match.id}`,
          requireInteraction: false
        }).catch(err => log.error('Notification delivery failed', err));
      }

      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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
    const session = requireAdmin(req, res);
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

  // SEC-R4: Admin 2FA setup — generate TOTP secret for admin
  if (req.method === 'POST' && pathname === '/api/admin/2fa/setup') {
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    const session = requireAdmin(req, res);
    if (!session) return;
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
    session.admin2faVerified = true;
    session.admin2faExpires = Date.now() + 5 * 60 * 1000;
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
    session.admin2faVerified = true;
    session.admin2faExpires = Date.now() + 5 * 60 * 1000;
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
      const outcome = await submitMatchResultOnServer(currentMatches, session.user, adminMatchAward[1], {
        winnerTeam: body.winnerTeam,
        scores: targetMatch?.result?.scores || defaultScores,
        screenshots: targetMatch?.result?.screenshots || [],
        proofs: targetMatch?.result?.proofs,
        arbiterNotes: body.arbiterNotes || 'Resolution admin depuis le command center.',
        submittedBy: 'admin-dashboard',
      });
      await saveMatches(io, outcome.matches, outcome.match);
      log.info('Admin action: award match', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchAward[1], winnerTeam: body.winnerTeam });
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
      const outcome = resolveDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchResolve[1],
        body.resolution || 'Litige clos par moderation.'
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
      const recentMatches = allMatches.slice(-100).map(sanitizeMatchForBroadcast);
      const allTournaments = getStoredTournaments();
      const recentTournaments = allTournaments.slice(-50).map(sanitizeTournamentForBroadcast);
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
});

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST'],
  },
});

// Socket.io connection rate limit per IP
const socketConnectionCounts = new Map();
const SOCKET_CONNECTION_LIMIT = 10;
const SOCKET_CONNECTION_WINDOW = 60 * 1000;

const cleanupSocketConnectionCounts = () => {
  const now = Date.now();
  for (const [ip, entry] of socketConnectionCounts) {
    if (now - entry.start > SOCKET_CONNECTION_WINDOW * 2) {
      socketConnectionCounts.delete(ip);
    }
  }
};
setInterval(cleanupSocketConnectionCounts, 5 * 60 * 1000);

io.use((socket, next) => {
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

  const token = socket.handshake.auth?.token;
  const session = getRealtimeSession(token);

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
    log.error('CRITICAL: Failed to load data from Supabase after 3 attempts — users may not be available');
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
    try { await withMatchMutex(async () => {
      const outcome = await processMatchAutomationOnServer(getStateCollection('matches'));
      if (outcome.changed) {
        await saveMatches(io, outcome.matches);
      }
    });
    } catch (error) {
      log.error('Match automation error', error);
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
