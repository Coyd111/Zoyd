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
import { handleWalletRoutes } from './routes/wallet.mjs';
import { handleAuthRoutes } from './routes/auth.mjs';
import { handlePublicRoutes } from './routes/public.mjs';

// Ordre de consultation. Sans portee semantique — voir le commentaire sur la
// table de routes dans `handleRequest`.
const ROUTE_MODULES = [
  handlePublicRoutes,
  handleAuthRoutes,
  handleSocialRoutes,
  handleWalletRoutes,
  handleTournamentRoutes,
  handleLeagueRoutes,
  handleBrRoutes,
  handleMatchRoutes,
  handleAdminRoutes,
  handleChatRoutes,
  handleRealtimeRoutes,
];
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
  hydrateWinningsKeys,
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

  // ─── Table de routes ────────────────────────────────────────────────────
  //
  // Chaque module reçoit la requête et renvoie `true` s'il l'a traitée.
  // L'ordre n'a AUCUNE portée sémantique : une vérification sur les 27 routes
  // restantes puis sur les 73 routes des modules a montré qu'aucune paire ne
  // peut répondre à la même requête (un seul chevauchement existe,
  // `/api/users/:id` face à `/api/users/search`, neutralisé par une garde
  // explicite dans la route). On peut donc regrouper par domaine librement.
  //
  // Conséquence pratique : ajouter une route ne touche plus un `if` parmi
  // 3100 lignes, mais le module de son domaine.
  for (const routeModule of ROUTE_MODULES) {
    if (await routeModule({ req, res, pathname, io })) return;
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

    // Meme raison pour les gains : une cle anterieure au redemarrage doit
    // rester connue, sinon un reglement rejoue recredite le joueur.
    hydrateWinningsKeys();

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

