import crypto from 'node:crypto';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import webpush from 'web-push';
import { vapidKeys } from './vapid-keys.mjs';
import { createLogger } from './logger.mjs';
import { metricsToPrometheus, incCounter, startTimer, endTimer, setGauge } from './metrics.mjs';

// Simple cookie serialization function
const serializeCookie = (name, value, options = {}) => {
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
  generateActivationCode,
  getAllUsers,
  getRawUserById,
  getUserById,
  getPushSubscriptionsForUser,
  verifyActivationCode,
  findUsersByPseudo,
  getAuthSession,
  getChatChannelById,
  getChatChannelsForUser,
  getChatMessagesForChannel,
  getRealtimeSession,
  getUnreadCountForUser,
  getStateCollection,
  loadFromSupabase,
  loadAdminTotpSecrets,
  markChatChannelRead,
  removePushSubscription,
  replaceStateCollection,
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
  createNotification,
  getUnreadNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  verifyPassword,
  hashPassword,
  updatePasswordHash,
  sbUpsert,
  getMemoryChatChannels,
} from './persistence.mjs';
import { depositToWallet, getServerWallet, withdrawFromWallet } from './wallet-engine.mjs';
import { withMatchMutex, withTournamentMutex, withLeagueMutex, withWalletMutex } from './mutex.mjs';
import { initCronJobs } from './cron.mjs';
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
  normalizeTournamentCollection,
  registerForTournamentOnServer,
  setTournamentMatchLiveOnServer,
  setTournamentMatchRoomDetailsOnServer,
  startTournamentOnServer,
  submitTournamentMatchResultOnServer,
} from './tournament-engine.mjs';
import {
  normalizeLeagueCollection,
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

const notifyAllAdmins = async (io, payload) => {
  const admins = getAllUsers().filter((u) => u.role === 'admin');
  for (const admin of admins) {
    try {
      await deliverNotification(io, admin.id, payload);
    } catch { /* best effort */ }
  }
};
const ALLOWED_ORIGINS = [
  ...(process.env.ZOYD_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  'https://zoyd.vercel.app',
  'https://zoyd.africa',
  'https://www.zoyd.africa',
];

if (vapidKeys) {
  webpush.setVapidDetails('mailto:ops@zoyd.africa', vapidKeys.publicKey, vapidKeys.privateKey);
}

const channels = new Map();
const channelsBySocket = new Map();
const seenByChannel = new Map();
const typingByChannel = new Map();

const getNow = () => new Date().toISOString();

// Nettoyage périodique des Maps de canaux orphelins (toutes les 30 min)
const MAX_ACTIVE_CHANNELS = 500;
const cleanupChannelMaps = () => {
  const channelIds = new Set(channels.keys());
  // Remove empty channels (no members)
  for (const [id, members] of channels) {
    if (members.size === 0) channels.delete(id);
  }
  for (const [key] of seenByChannel) {
    if (!channelIds.has(key)) seenByChannel.delete(key);
  }
  for (const [key] of typingByChannel) {
    if (!channelIds.has(key)) typingByChannel.delete(key);
  }

  // Evict stale chat channels: 0 members AND last updated > 24h ago
  const MAX_CHAT_CHANNEL_AGE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const chatChannels = getMemoryChatChannels();
  for (const [id, ch] of chatChannels) {
    if (ch.id === 'global') continue;
    const memberCount = channels.get(id)?.size ?? 0;
    const updatedAt = ch.updatedAt ? new Date(ch.updatedAt).getTime() : 0;
    if (memberCount === 0 && now - updatedAt > MAX_CHAT_CHANNEL_AGE_MS) {
      chatChannels.delete(id);
    }
  }
};
setInterval(cleanupChannelMaps, 30 * 60 * 1000);

const getCorsOrigin = (req) => {
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
};

const respondJson = (res, statusCode, payload, req = null) => {
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

const parseQueryParams = (url) => {
  const params = new URL(url, 'http://localhost').searchParams;
  return {
    limit: Math.min(Math.max(parseInt(params.get('limit') || '100', 10) || 100, 1), 500),
    offset: Math.max(parseInt(params.get('offset') || '0', 10) || 0, 0),
  };
};

const paginate = (arr, { limit, offset }) => arr.slice(offset, offset + limit);

const BODY_SIZE_LIMIT = 1 * 1024 * 1024; // 1MB

const parseRequestBody = async (req) => {
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

const readBearerToken = (req) => {
  // First try to get token from HttpOnly cookie
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
  
  // Fallback to Authorization header
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
};

const getAuthenticatedAppSession = (req) => {
  const token = readBearerToken(req);
  return token ? getAuthSession(token) : null;
};

const getAuthenticatedRealtimeSession = (req) => {
  const token = readBearerToken(req);
  return token ? getRealtimeSession(token) : null;
};

const getPathname = (req) => new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

const normalizePathForMetrics = (pathname) =>
  pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/*')
    .replace(/\/M-[A-Za-z0-9]+/g, '/M/*')
    .replace(/\/T-[A-Za-z0-9]+/g, '/T/*')
    .replace(/\/FR-[A-Za-z0-9-]+/g, '/FR/*');

const buildMatchChatChannel = (match) => {
  const channelId = match.channelId || match.chatChannelId || `match-${match.id}`;
  const existing = getChatChannelById(channelId);

  return upsertChatChannel({
    ...existing,
    id: channelId,
    type: 'match',
    name: `Match MJ ${match.id}`,
    participants: [
      ...match.players.map((player) => player.userId),
      ...(match.arbiter?.userId ? [match.arbiter.userId] : []),
    ],
    scope: match.visibility === 'public' ? 'public' : 'participants',
    inbox: 'participants',
    createdAt: existing?.createdAt || match.createdAt || getNow(),
    updatedAt: match.updatedAt || getNow(),
  });
};

const syncMatchChatChannels = (matches) => {
  ensureGlobalChatChannel();
  return matches.map((match) => buildMatchChatChannel(match));
};

const canAccessChatChannel = (channel, user) =>
  !!channel && !!user && (user.role === 'admin' || channel.scope === 'public' || channel.participants.includes(user.id));

const buildChatBootstrapPayload = (userId) => {
  const channels = getChatChannelsForUser(userId).map((channel) => ({
    ...channel,
    unreadCount: getUnreadCountForUser(channel.id, userId),
  }));
  const messages = channels.flatMap((channel) => getChatMessagesForChannel(channel.id, 120));

  return {
    channels,
    messages,
  };
};

const broadcastChatChannel = (io, channel) => {
  if (!channel) return;

  if (channel.inbox === 'all') {
    io.emit('chat:channel', { channel });
  }

  for (const participantId of channel.participants || []) {
    io.to(`user:${participantId}`).emit('chat:channel', { channel });
  }
};

const broadcastChatMessage = (io, channel, message) => {
  if (!channel || !message) return;
  const payload = { channel, message };

  if (channel.id === 'global') {
    io.emit('chat:message', payload);
    return;
  }

  if (channel.scope === 'public') {
    io.to(channel.id).emit('chat:message', payload);
  }

  for (const participantId of channel.participants || []) {
    io.to(`user:${participantId}`).emit('chat:message', payload);
  }
};

const broadcastChatRead = (io, channelId, userId, readAt) => {
  io.to(`user:${userId}`).emit('chat:read', { channelId, userId, readAt });
};

const saveMatches = (io, matches, changedMatch = null) => {
  syncMatchChatChannels(matches);
  replaceStateCollection('matches', matches);
  const storedMatches = getStateCollection('matches');
  const sanitizedMatches = storedMatches.map(sanitizeMatchForBroadcast);
  broadcastStateSnapshot(io, 'matches', sanitizedMatches);
  if (changedMatch) {
    broadcastChatChannel(io, buildMatchChatChannel(changedMatch));
  }
  return storedMatches;
};

const getStoredTournaments = () => normalizeTournamentCollection(getStateCollection('tournaments'));

const saveTournaments = (io, tournaments) => {
  replaceStateCollection('tournaments', tournaments);
  const storedTournaments = getStoredTournaments();
  broadcastStateSnapshot(io, 'tournaments', storedTournaments);
  return storedTournaments;
};

const buildMatchActionPayload = (match, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    match: sanitizeMatchForBroadcast(match),
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

const sanitizeMatchForBroadcast = (match) => {
  const { roomPassword, ...safe } = match;
  if (safe.arbiter) {
    const { roomPassword: _ap, ...safeArbiter } = safe.arbiter;
    safe.arbiter = safeArbiter;
  }
  return safe;
};

const buildTournamentActionPayload = (tournament, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    tournament,
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

const getStoredLeagues = () => normalizeLeagueCollection(getStateCollection('leagues'));

const saveLeagues = (io, seasons) => {
  replaceStateCollection('leagues', seasons);
  const storedLeagues = getStoredLeagues();
  broadcastStateSnapshot(io, 'leagues', storedLeagues);
  return storedLeagues;
};

const buildLeagueActionPayload = (season, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    season,
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

const mapPersistenceError = (error) => {
  switch (error?.code) {
    case 'INVALID_REGISTRATION':
      return { status: 400, message: error.message };
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
      return { status: 400, message: error.message };
    case 'INVALID_CREDENTIALS':
      return { status: 401, message: error.message };
    case 'FORBIDDEN':
      return { status: 403, message: error.message };
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
    case 'RESULT_NOT_FOUND':
    case 'DISPUTE_ALREADY_OPEN':
      return { status: 409, message: error.message };
    case 'MATCH_NOT_FOUND':
    case 'TOURNAMENT_NOT_FOUND':
    case 'LEAGUE_NOT_FOUND':
    case 'CHANNEL_NOT_FOUND':
    case 'PLAYER_NOT_FOUND':
    case 'USER_NOT_FOUND':
      return { status: 404, message: error.message };
    case 'NOT_ENOUGH_PLAYERS':
    case 'QUALIFICATION_INCOMPLETE':
    case 'REGISTRATION_CLOSED':
    case 'NOT_JOINED':
    case 'MATCH_ALREADY_LIVE':
    case 'NO_PLAYERS':
    case 'INVALID_DAY':
    case 'INVALID_RESULTS':
    default:
      return { status: 500, message: 'Une erreur serveur est survenue.' };
  }
};

const getChannelMemberMap = (channelId) => {
  if (!channels.has(channelId)) {
    if (channels.size >= MAX_ACTIVE_CHANNELS) return new Map();
    channels.set(channelId, new Map());
  }
  return channels.get(channelId);
};

const getSeenMap = (channelId) => {
  if (!seenByChannel.has(channelId)) {
    seenByChannel.set(channelId, new Map());
  }
  return seenByChannel.get(channelId);
};

const getTypingMap = (channelId) => {
  if (!typingByChannel.has(channelId)) {
    typingByChannel.set(channelId, new Map());
  }
  return typingByChannel.get(channelId);
};

const publicMember = (member) => ({
  userId: member.userId,
  pseudo: member.pseudo,
  role: member.role,
  team: member.team,
  isCheckedIn: member.isCheckedIn,
  isReady: member.isReady,
  isOnline: member.socketIds.size > 0,
  lastActiveAt: member.lastActiveAt,
});

const emitChannelSnapshots = (io, channelId) => {
  const members = [...getChannelMemberMap(channelId).values()].map(publicMember);
  const seen = Object.fromEntries(getSeenMap(channelId).entries());
  const typing = [...getTypingMap(channelId).values()].map((member) => ({
    userId: member.userId,
    pseudo: member.pseudo,
    startedAt: member.startedAt,
  }));

  io.to(channelId).emit('presence:snapshot', { channelId, members, seen });
  io.to(channelId).emit('typing:snapshot', { channelId, members: typing });
};

const trackSocketChannel = (socketId, channelId) => {
  const currentChannels = channelsBySocket.get(socketId) || new Set();
  currentChannels.add(channelId);
  channelsBySocket.set(socketId, currentChannels);
};

const untrackSocketChannel = (socketId, channelId) => {
  const currentChannels = channelsBySocket.get(socketId);
  if (!currentChannels) return;
  currentChannels.delete(channelId);
  if (currentChannels.size === 0) {
    channelsBySocket.delete(socketId);
  }
};

const upsertChannelMember = (socket, payload) => {
  const { channelId, userId, pseudo, role = 'spectator', team, isCheckedIn = false, isReady = false } = payload;
  if (!channelId || !userId || !pseudo) return null;

  const members = getChannelMemberMap(channelId);
  const existingMember = members.get(userId);
  const nextMember =
    existingMember || {
      userId,
      pseudo,
      role,
      team,
      isCheckedIn,
      isReady,
      socketIds: new Set(),
      lastActiveAt: getNow(),
    };

  nextMember.pseudo = pseudo;
  nextMember.role = role;
  nextMember.team = typeof team === 'number' ? team : nextMember.team;
  nextMember.isCheckedIn = Boolean(isCheckedIn);
  nextMember.isReady = Boolean(isReady);
  nextMember.lastActiveAt = getNow();
  nextMember.socketIds.add(socket.id);

  members.set(userId, nextMember);
  trackSocketChannel(socket.id, channelId);
  socket.join(channelId);
  return nextMember;
};

const removeSocketFromChannel = (io, socket, channelId) => {
  const members = getChannelMemberMap(channelId);
  for (const [userId, member] of members.entries()) {
    if (!member.socketIds.has(socket.id)) continue;

    member.socketIds.delete(socket.id);
    member.lastActiveAt = getNow();
    if (member.socketIds.size === 0 && member.role === 'spectator') {
      members.delete(userId);
    } else {
      members.set(userId, member);
    }
  }

  const typing = getTypingMap(channelId);
  for (const [userId, member] of typing.entries()) {
    if (member.socketId === socket.id) {
      typing.delete(userId);
    }
  }

  socket.leave(channelId);
  untrackSocketChannel(socket.id, channelId);
  emitChannelSnapshots(io, channelId);
};

const sendPushToUser = async (userId, payload) => {
  if (!vapidKeys) return { delivered: 0, attempted: 0 };
  const subscriptions = getPushSubscriptionsForUser(userId);
  if (subscriptions.length === 0) {
    return { delivered: 0, attempted: 0 };
  }

  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        delivered += 1;
      } catch (error) {
        const statusCode = error?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removePushSubscription(subscription.endpoint);
        }
      }
    })
  );

  return { delivered, attempted: subscriptions.length };
};

const deliverNotification = async (io, targetUserId, payload) => {
  const { title, body, url, tag, requireInteraction, type = 'system' } = payload;
  const priority = requireInteraction ? 'urgent' : 'high';

  const notification = createNotification(
    targetUserId,
    type,
    title,
    body || 'Notification ZOYD',
    priority,
    url,
    { source: 'server-push', browserTag: tag }
  );

  io.to(`user:${targetUserId}`).emit('notification:deliver', notification);
  await sendPushToUser(targetUserId, payload);
};

const broadcastStateSnapshot = (io, kind, items) => {
  io.emit(`state:${kind}`, { items });
};

const rateLimitBuckets = new Map();
const RATE_LIMIT_CONFIG = {
  auth:    { max: 50,  windowMs: 15 * 60 * 1000 },  // 50 req / 15 min
  social:  { max: 30,  windowMs: 60 * 1000 },        // 30 req / 1 min
  wallet:  { max: 20,  windowMs: 10 * 60 * 1000 },   // 20 req / 10 min
  chat:    { max: 60,  windowMs: 60 * 1000 },         // 60 req / 1 min
  admin:   { max: 20,  windowMs: 5 * 60 * 1000 },    // 20 req / 5 min
  default: { max: 60,  windowMs: 60 * 1000 },         // 60 req / 1 min
};

const checkRateLimit = (ip, group = 'default') => {
  const config = RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default;
  const key = `${ip}:${group}`;
  const now = Date.now();
  const record = rateLimitBuckets.get(key);
  if (!record || now - record.windowStart > config.windowMs) {
    rateLimitBuckets.set(key, { windowStart: now, attempts: 1 });
    return { allowed: true, remaining: config.max - 1 };
  }
  record.attempts += 1;
  const allowed = record.attempts <= config.max;
  return { allowed, remaining: Math.max(0, config.max - record.attempts) };
};

const cleanupRateLimits = () => {
  const now = Date.now();
  for (const [key, record] of rateLimitBuckets) {
    const group = key.split(':').pop();
    const config = RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default;
    if (now - record.windowStart > config.windowMs) rateLimitBuckets.delete(key);
  }
};
setInterval(cleanupRateLimits, 60 * 1000);

// Use X-Forwarded-For (set by Render proxy) to get real client IP.
// Validate format to prevent spoofing via arbitrary header values.
const isValidIp = (ip) => /^[\d.:a-fA-F]+$/.test(ip);
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (isValidIp(firstIp)) return firstIp;
  }
  return req.socket.remoteAddress || '127.0.0.1';
};

const rateLimitGuard = (res, ip, group) => {
  const { allowed, remaining } = checkRateLimit(ip, group);
  if (!allowed) {
    respondJson(res, 429, { ok: false, error: 'Trop de requetes. Reessayez plus tard.' });
    return false;
  }
  return true;
};

// ─── TOTP 2FA (RFC 6238) ──────────────────────────────────────────────────
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_ALGORITHM = 'sha1';

const generateTotpSecret = () => {
  return crypto.randomBytes(20).toString('base64');
};

const base32Decode = (encoded) => {
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

const verifyTotp = (secret, code) => {
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

const toBase32 = (buffer) => {
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

// ─── Admin 2FA secrets storage ─────────────────────────────────────────────
const adminTotpSecrets = new Map(); // adminUserId -> { secret, enabled, verifiedAt }

const requireAdmin2fa = (req, res) => {
  const session = getAuthenticatedAppSession(req);
  if (!session || session.user.role !== 'admin') return false;
  const totpEntry = adminTotpSecrets.get(session.user.id);
  if (totpEntry?.enabled && (!session.admin2faVerified || session.admin2faExpires <= Date.now())) {
    respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', requires2fa: true });
    return false;
  }
  return true;
};

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    respondJson(res, 404, { error: 'Not found' });
    return;
  }

  const pathname = getPathname(req);
  req._metricsStart = startTimer();
  req._metricsPathname = normalizePathForMetrics(pathname);
  res._req = req;

  // INFRA-R2: Structured request logging (skip health checks and OPTIONS)
  if (req.method !== 'OPTIONS' && pathname !== '/api/health' && !pathname.startsWith('/metrics')) {
    const clientIp = getClientIp(req);
    log.info('request', { method: req.method, path: pathname, ip: clientIp });
  }

  if (req.method === 'OPTIONS') {
    respondJson(res, 204, {}, req);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    respondJson(res, 200, {
      ok: true,
      service: 'zoyd-api',
      timestamp: getNow(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/realtime/health') {
    respondJson(res, 200, {
      ok: true,
      service: 'zoyd-realtime',
      channels: channels.size,
      subscriptions: countPushSubscriptions(),
      storedMatches: getStateCollection('matches').length,
      storedTournaments: getStoredTournaments().length,
      timestamp: getNow(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/metrics') {
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
      const { role: _role, ...rawBody } = body;
      const safeBody = {
        ...rawBody,
        pseudo: sanitizeText(rawBody.pseudo || ''),
        bio: sanitizeText(rawBody.bio || ''),
        streamerPseudo: sanitizeText(rawBody.streamerPseudo || ''),
      };
      const user = await createUserAccount(safeBody);
      
      respondJson(res, 201, {
        ok: true,
        user: sanitizeUserPayload(user),
        message: 'Compte cree avec succes.',
      });
    } catch (error) {
      log.error('register error', { message: error.message, code: error.code });
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
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
      
      const session = createAuthSession(user.id);

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
        token: session.token,
        user: session.user,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
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
        respondJson(res, 400, { ok: false, error: 'Email et code requis.' });
        return;
      }
      
      const verification = verifyActivationCode(email, code);
      
      if (!verification.valid) {
        respondJson(res, 400, { ok: false, error: verification.error });
        return;
      }
      
      const activatedUser = activateUserAccount(verification.userId);
      
      respondJson(res, 200, {
        ok: true,
        user: sanitizeUserPayload(activatedUser),
        message: 'Compte active avec succes. Vous pouvez maintenant vous connecter.',
      });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

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
      for (const field of ALLOWED_PROFILE_FIELDS) {
        if (field in body) {
          safeUpdate[field] = STRING_FIELDS.includes(field) ? sanitizeText(body[field]) : body[field];
        }
      }
      const updatedUser = updateUserAccount(session.user.id, (user) => {
        return { ...user, ...safeUpdate };
      });
      respondJson(res, 200, { ok: true, user: updatedUser }, req);
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/request') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      const request = sendFriendRequest(session.user.id, body.targetId, body.message);
      
      deliverNotification(io, body.targetId, {
        type: 'friend_request',
        title: "Demande d'ami",
        body: `${session.user.pseudo} t'a envoyé une demande d'ami.`,
        url: `/profil`,
        requireInteraction: false
      }).catch(err => log.error('Notification delivery failed', err));

      respondJson(res, 200, { ok: true, request });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/accept') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      const friend = acceptFriendRequest(body.requestId, session.user.id);
      
      const requests = getFriendRequestsForUser(session.user.id);
      const reqInfo = requests.find(r => r.id === body.requestId);
      // Wait, `reqInfo` may not be available if it was just accepted (it's no longer 'pending').
      // Let's rely on the `friend` output from acceptFriendRequest which returns the new friend record.
      // `friend` has `{ id, pseudo }` of the user.
      
      deliverNotification(io, friend.id, {
        type: 'friend_online',
        title: 'Demande acceptée',
        body: `${session.user.pseudo} a accepté ta demande d'ami.`,
        url: `/profil/${session.user.id}`,
        requireInteraction: false
      }).catch(err => log.error('Notification delivery failed', err));

      respondJson(res, 200, { ok: true, friend });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/decline') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      declineFriendRequest(body.requestId, session.user.id);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const socialFriendMatch = pathname.match(/^\/api\/social\/friends\/(.+)$/);
  if (req.method === 'DELETE' && socialFriendMatch) {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      removeFriend(session.user.id, socialFriendMatch[1]);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/block') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      blockUser(session.user.id, body.targetId);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/unblock') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      unblockUser(session.user.id, body.targetId);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/social/report') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;
    try {
      const body = await parseRequestBody(req);
      if (!body.targetId || !body.reason) {
        respondJson(res, 400, { ok: false, error: 'targetId et reason requis.' });
        return;
      }
      const report = {
        id: `RP-${Date.now().toString(36).toUpperCase()}`,
        reporterId: session.user.id,
        reporterPseudo: session.user.pseudo,
        targetId: body.targetId,
        reason: body.reason,
        description: sanitizeText(body.description || ''),
        status: 'pending',
        createdAt: getNow(),
      };
      sbUpsert('user_reports', { id: report.id, payload: report, created_at: getNow() });
      respondJson(res, 201, { ok: true, report });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/notifications/read') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const body = await parseRequestBody(req);
      const success = markNotificationAsRead(session.user.id, body.notificationId);
      respondJson(res, 200, { ok: true, success });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    if (!rateLimitGuard(res, getClientIp(req), 'default')) return;
    try {
      const changes = markAllNotificationsAsRead(session.user.id);
      respondJson(res, 200, { ok: true, changes });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
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
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try {
      const body = await parseRequestBody(req);
      const { currentPassword, newPassword } = body;
      if (!currentPassword || !newPassword) {
        respondJson(res, 400, { ok: false, error: 'Les deux mots de passe sont requis.' });
        return;
      }
      if (newPassword.length < 8) {
        respondJson(res, 400, { ok: false, error: 'Le nouveau mot de passe doit faire au moins 8 caracteres.' });
        return;
      }
      const user = getRawUserById(session.user.id);
      if (!user) {
        respondJson(res, 404, { ok: false, error: 'Utilisateur introuvable.' });
        return;
      }
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        respondJson(res, 403, { ok: false, error: 'Mot de passe actuel incorrect.' });
        return;
      }
      const newHash = await hashPassword(newPassword);
      updatePasswordHash(session.user.id, newHash);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    try {
      const allUsers = getAllUsers();
      const leaderboard = allUsers
        .filter((u) => u.stats && (u.stats.totalMatches > 0 || u.stats.totalEarnings > 0))
        .map((u) => ({
          id: u.id,
          pseudo: u.pseudo,
          country: u.country,
          elo: u.stats?.elo || 1200,
          winRate: u.stats?.winRate || 0,
          totalMatches: u.stats?.totalMatches || 0,
          totalEarnings: u.stats?.totalEarnings || 0,
          wins: u.stats?.wins || 0,
          trustScore: u.trustScore || 0,
          controllerType: u.controllerType,
          rankMJ: u.rankMJ,
          isOnline: u.isOnline || false,
        }))
        .sort((a, b) => b.elo - a.elo || b.winRate - a.winRate || b.totalMatches - a.totalMatches);
      const { limit, offset } = parseQueryParams(req.url);
      respondJson(res, 200, { ok: true, players: paginate(leaderboard, { limit, offset }), total: leaderboard.length });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du classement.' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/wallet/me') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    const user = getUserById(session.user.id);
    respondJson(res, 200, {
      ok: true,
      wallet: user?.wallet || getServerWallet(session.user.id),
      user,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/wallet/deposit') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'wallet')) return;

    try { await withWalletMutex(session.user.id, async () => {
      const body = await parseRequestBody(req);
      const wallet = depositToWallet(session.user.id, body.amount, body.method);
      const user = getUserById(session.user.id);
      respondJson(res, 200, { ok: true, wallet, user });
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/wallet/withdraw') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'wallet')) return;

    try { await withWalletMutex(session.user.id, async () => {
      const body = await parseRequestBody(req);
      const wallet = withdrawFromWallet(session.user.id, body.amount, body.method, body.phone);
      const user = getUserById(session.user.id);
      respondJson(res, 200, { ok: true, wallet, user });
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/matches') {
    const token = readBearerToken(req);
    const matchSession = token ? getAuthSession(token) : null;
    const matchCurrentUser = matchSession?.user ? getUserById(matchSession.user.id) : null;
    const allMatches = getStateCollection('matches');
    const visibleMatches = getPublicMatchesForUser(allMatches, matchCurrentUser);
    const { limit, offset } = parseQueryParams(req.url);

    respondJson(res, 200, {
      ok: true,
      matches: paginate(visibleMatches.map(sanitizeMatchForBroadcast), { limit, offset }),
      total: visibleMatches.length,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tournaments') {
    const { limit, offset } = parseQueryParams(req.url);
    const all = getStoredTournaments();
    respondJson(res, 200, {
      ok: true,
      tournaments: paginate(all, { limit, offset }),
      total: all.length,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/users/search') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get('q') || '';
    const { limit, offset } = parseQueryParams(req.url);
    const allMatches = findUsersByPseudo(q).filter((u) => u.id !== session.user.id);
    const matches = paginate(allMatches, { limit: Math.min(limit, 50), offset });
    respondJson(res, 200, {
      ok: true,
      users: matches.map((u) => ({
        id: u.id, pseudo: u.pseudo, avatar: u.avatar, country: u.country,
        trustScore: u.trustScore, controllerType: u.controllerType, isOnline: u.isOnline,
      })),
    });
    return;
  }

  const tournamentDetail = pathname.match(/^\/api\/tournaments\/([^/]+)$/);
  if (req.method === 'GET' && tournamentDetail) {
    const tournament = getStoredTournaments().find((entry) => entry.id === tournamentDetail[1]);
    if (!tournament) {
      respondJson(res, 404, { ok: false, error: 'Tournoi introuvable.' });
      return;
    }

    respondJson(res, 200, {
      ok: true,
      tournament,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tournaments') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = createTournamentOnServer(getStoredTournaments(), session.user, body);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 201, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentRegister = pathname.match(/^\/api\/tournaments\/([^/]+)\/register$/);
  if (req.method === 'POST' && tournamentRegister) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await registerForTournamentOnServer(getStoredTournaments(), session.user, tournamentRegister[1], body);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentLeave = pathname.match(/^\/api\/tournaments\/([^/]+)\/leave$/);
  if (req.method === 'POST' && tournamentLeave) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = await leaveTournamentOnServer(getStoredTournaments(), session.user, tournamentLeave[1]);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentArbiter = pathname.match(/^\/api\/tournaments\/([^/]+)\/arbiter$/);
  if (req.method === 'POST' && tournamentArbiter) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = assignTournamentArbiterOnServer(getStoredTournaments(), session.user, tournamentArbiter[1]);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentStart = pathname.match(/^\/api\/tournaments\/([^/]+)\/start$/);
  if (req.method === 'POST' && tournamentStart) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = startTournamentOnServer(getStoredTournaments(), session.user, tournamentStart[1]);
      saveTournaments(io, outcome.tournaments);

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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentRoom = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/room$/);
  if (req.method === 'POST' && tournamentRoom) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentLive = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/live$/);
  if (req.method === 'POST' && tournamentLive) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withTournamentMutex(async () => {
      const outcome = setTournamentMatchLiveOnServer(
        getStoredTournaments(),
        session.user,
        tournamentLive[1],
        tournamentLive[2]
      );
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const tournamentResult = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/result$/);
  if (req.method === 'POST' && tournamentResult) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  // ─── League Endpoints ───────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/leagues') {
    const { limit, offset } = parseQueryParams(req.url);
    const all = getStoredLeagues();
    respondJson(res, 200, { ok: true, seasons: paginate(all, { limit, offset }), total: all.length });
    return;
  }

  const leagueGetOne = pathname.match(/^\/api\/leagues\/([^/]+)$/);
  if (req.method === 'GET' && leagueGetOne) {
    const seasons = getStoredLeagues();
    const season = seasons.find((s) => s.id === leagueGetOne[1]);
    if (!season) {
      respondJson(res, 404, { ok: false, error: 'Ligue introuvable.' });
      return;
    }
    respondJson(res, 200, { ok: true, season });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/leagues') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = createLeagueSeasonOnServer(getStoredLeagues(), session.user, body);
      saveLeagues(io, outcome.seasons);
      respondJson(res, 201, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueJoin = pathname.match(/^\/api\/leagues\/([^/]+)\/join$/);
  if (req.method === 'POST' && leagueJoin) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = await joinLeagueSeasonOnServer(getStoredLeagues(), session.user, leagueJoin[1]);
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueLeave = pathname.match(/^\/api\/leagues\/([^/]+)\/leave$/);
  if (req.method === 'POST' && leagueLeave) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = await leaveLeagueSeasonOnServer(getStoredLeagues(), session.user, leagueLeave[1]);
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueStartQualification = pathname.match(/^\/api\/leagues\/([^/]+)\/start-qualification$/);
  if (req.method === 'POST' && leagueStartQualification) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = startLeagueQualificationOnServer(getStoredLeagues(), session.user, leagueStartQualification[1]);
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueStartDay = pathname.match(/^\/api\/leagues\/([^/]+)\/days\/([^/]+)\/start$/);
  if (req.method === 'POST' && leagueStartDay) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = startLeagueDayOnServer(getStoredLeagues(), session.user, leagueStartDay[1], leagueStartDay[2]);
      saveLeagues(io, outcome.seasons);

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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueDayResults = pathname.match(/^\/api\/leagues\/([^/]+)\/days\/([^/]+)\/results$/);
  if (req.method === 'POST' && leagueDayResults) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueAdvanceToFinal = pathname.match(/^\/api\/leagues\/([^/]+)\/advance-to-final$/);
  if (req.method === 'POST' && leagueAdvanceToFinal) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = advanceToFinalOnServer(getStoredLeagues(), session.user, leagueAdvanceToFinal[1]);
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueFinalResults = pathname.match(/^\/api\/leagues\/([^/]+)\/final-results$/);
  if (req.method === 'POST' && leagueFinalResults) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueLeaderboard = pathname.match(/^\/api\/leagues\/([^/]+)\/leaderboard$/);
  if (req.method === 'GET' && leagueLeaderboard) {
    try {
      const standings = getLeagueLeaderboard(getStoredLeagues(), leagueLeaderboard[1]);
      respondJson(res, 200, { ok: true, standings });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueUpdateSettings = pathname.match(/^\/api\/leagues\/([^/]+)$/);
  if (req.method === 'PATCH' && leagueUpdateSettings) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = updateLeagueSettingsOnServer(getStoredLeagues(), session.user, leagueUpdateSettings[1], body);
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueReassign = pathname.match(/^\/api\/leagues\/([^/]+)\/reassign$/);
  if (req.method === 'POST' && leagueReassign) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leagueRefund = pathname.match(/^\/api\/leagues\/([^/]+)\/refund\/([^/]+)$/);
  if (req.method === 'POST' && leagueRefund) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withLeagueMutex(async () => {
      const outcome = await refundLeaguePlayerOnServer(
        getStoredLeagues(),
        session.user,
        leagueRefund[1],
        leagueRefund[2]
      );
      saveLeagues(io, outcome.seasons);
      respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
    }); } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const leaguePayments = pathname.match(/^\/api\/leagues\/([^/]+)\/payments$/);
  if (req.method === 'GET' && leaguePayments) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (session.user.role !== 'admin') {
      respondJson(res, 403, { ok: false, error: 'Acces admin requis.' });
      return;
    }
    try {
      const payments = getLeaguePayments(getStoredLeagues(), leaguePayments[1]);
      respondJson(res, 200, { ok: true, payments });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  // ─── End League Endpoints ───────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/wallet/verify-fedapay') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'wallet')) return;

    try { await withWalletMutex(session.user.id, async () => {
      const body = await parseRequestBody(req);
      if (!body.transactionId) {
        respondJson(res, 400, { ok: false, error: 'transactionId manquant.' });
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
      respondJson(res, 400, { ok: false, error: 'Verification du paiement echouee.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/matches') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'social')) return;

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await withWalletMutex(session.user.id, () =>
        createMatchOnServer(getStateCollection('matches'), session.user, body)
      );
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 201, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchJoin = pathname.match(/^\/api\/matches\/([^/]+)\/join$/);
  if (req.method === 'POST' && matchJoin) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await withWalletMutex(session.user.id, () =>
        joinMatchOnServer(getStateCollection('matches'), session.user, matchJoin[1], body.team)
      );
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchArbiter = pathname.match(/^\/api\/matches\/([^/]+)\/arbiter$/);
  if (req.method === 'POST' && matchArbiter) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = assignArbiterOnServer(getStateCollection('matches'), session.user, matchArbiter[1]);
      saveMatches(io, outcome.matches, outcome.match);

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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchCheckIn = pathname.match(/^\/api\/matches\/([^/]+)\/check-in$/);
  if (req.method === 'POST' && matchCheckIn) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = checkInMatchOnServer(getStateCollection('matches'), session.user, matchCheckIn[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchReady = pathname.match(/^\/api\/matches\/([^/]+)\/ready$/);
  if (req.method === 'POST' && matchReady) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = toggleReadyOnServer(getStateCollection('matches'), session.user, matchReady[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchSchedule = pathname.match(/^\/api\/matches\/([^/]+)\/schedule$/);
  if (req.method === 'POST' && matchSchedule) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = scheduleMatchOnServer(getStateCollection('matches'), session.user, matchSchedule[1], body.scheduledAt);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchRoom = pathname.match(/^\/api\/matches\/([^/]+)\/room$/);
  if (req.method === 'POST' && matchRoom) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchLaunch = pathname.match(/^\/api\/matches\/([^/]+)\/launch$/);
  if (req.method === 'POST' && matchLaunch) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = launchMatchOnServer(getStateCollection('matches'), session.user, matchLaunch[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchResult = pathname.match(/^\/api\/matches\/([^/]+)\/result$/);
  if (req.method === 'POST' && matchResult) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await submitMatchResultOnServer(getStateCollection('matches'), session.user, matchResult[1], body);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchConfirm = pathname.match(/^\/api\/matches\/([^/]+)\/confirm$/);
  if (req.method === 'POST' && matchConfirm) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const outcome = confirmMatchResultOnServer(getStateCollection('matches'), session.user, matchConfirm[1]);
      saveMatches(io, outcome.matches, outcome.match);

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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchDisputes = pathname.match(/^\/api\/matches\/([^/]+)\/disputes$/);
  if (req.method === 'POST' && matchDisputes) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = openDisputeOnServer(getStateCollection('matches'), session.user, matchDisputes[1], body);
      saveMatches(io, outcome.matches, outcome.match);

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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchDisputeEvidence = pathname.match(/^\/api\/matches\/([^/]+)\/dispute\/evidence$/);
  if (req.method === 'POST' && matchDisputeEvidence) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const matchDisputeEscalate = pathname.match(/^\/api\/matches\/([^/]+)\/dispute\/escalate$/);
  if (req.method === 'POST' && matchDisputeEscalate) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    try { await withMatchMutex(async () => {
      const outcome = escalateDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        matchDisputeEscalate[1]
      );
      saveMatches(io, outcome.matches, outcome.match);

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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  // SEC-R4: Admin 2FA setup — generate TOTP secret for admin
  if (req.method === 'POST' && pathname === '/api/admin/2fa/setup') {
    const session = getAuthenticatedAppSession(req);
    if (!session || session.user.role !== 'admin') {
      respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.' }, req);
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
    const session = getAuthenticatedAppSession(req);
    if (!session || session.user.role !== 'admin') {
      respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.' }, req);
      return;
    }
    const body = await parseRequestBody(req).catch(() => ({}));
    const { code } = body || {};
    if (!code || typeof code !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Code 2FA requis.' });
      return;
    }
    const totpEntry = adminTotpSecrets.get(session.user.id);
    if (!totpEntry || !totpEntry.secret) {
      respondJson(res, 400, { ok: false, error: 'Aucune configuration 2FA en cours. Effectuez /api/admin/2fa/setup d\'abord.' });
      return;
    }
    if (totpEntry.enabled) {
      respondJson(res, 400, { ok: false, error: '2FA deja activee.' });
      return;
    }
    if (!verifyTotp(totpEntry.secret, code)) {
      log.warn('Admin 2FA enable failed — invalid code', { adminId: session.user.id });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.' });
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
    const session = getAuthenticatedAppSession(req);
    if (!session || session.user.role !== 'admin') {
      respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.' }, req);
      return;
    }
    const body = await parseRequestBody(req).catch(() => ({}));
    const { code } = body || {};
    if (!code || typeof code !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Code 2FA requis.' });
      return;
    }
    const totpEntry = adminTotpSecrets.get(session.user.id);
    if (!totpEntry?.enabled) {
      respondJson(res, 400, { ok: false, error: '2FA non active pour ce compte admin.' });
      return;
    }
    if (!verifyTotp(totpEntry.secret, code)) {
      log.warn('Admin 2FA verify failed — invalid code', { adminId: session.user.id });
      respondJson(res, 400, { ok: false, error: 'Code 2FA invalide.' });
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
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    if (session.user.role !== 'admin') {
      log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id, target: `award match ${adminMatchAward[1]}` });
      respondJson(res, 403, { ok: false, error: 'Accès réservé aux administrateurs.' }, req);
      return;
    }
    const totpEntryAward = adminTotpSecrets.get(session.user.id);
    if (totpEntryAward?.enabled && (!session.admin2faVerified || session.admin2faExpires <= Date.now())) {
      respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', requires2fa: true });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
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
      saveMatches(io, outcome.matches, outcome.match);
      log.info('Admin action: award match', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchAward[1], winnerTeam: body.winnerTeam });
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const adminMatchResolve = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/resolve-dispute$/);
  if (req.method === 'POST' && adminMatchResolve) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    if (session.user.role !== 'admin') {
      log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id, target: `resolve-dispute match ${adminMatchResolve[1]}` });
      respondJson(res, 403, { ok: false, error: 'Accès réservé aux administrateurs.' }, req);
      return;
    }
    const totpEntryResolve = adminTotpSecrets.get(session.user.id);
    if (totpEntryResolve?.enabled && (!session.admin2faVerified || session.admin2faExpires <= Date.now())) {
      respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', requires2fa: true });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = resolveDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchResolve[1],
        body.resolution || 'Litige clos par moderation.'
      );
      saveMatches(io, outcome.matches, outcome.match);
      log.info('Admin action: resolve dispute', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchResolve[1], resolution: body.resolution });
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const adminMatchCancel = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && adminMatchCancel) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'admin')) return;
    if (session.user.role !== 'admin') {
      log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id, target: `cancel match ${adminMatchCancel[1]}` });
      respondJson(res, 403, { ok: false, error: 'Accès réservé aux administrateurs.' }, req);
      return;
    }
    const totpEntryCancel = adminTotpSecrets.get(session.user.id);
    if (totpEntryCancel?.enabled && (!session.admin2faVerified || session.admin2faExpires <= Date.now())) {
      respondJson(res, 403, { ok: false, error: 'Verification 2FA requise pour cette action.', requires2fa: true });
      return;
    }

    try { await withMatchMutex(async () => {
      const body = await parseRequestBody(req);
      const outcome = await cancelMatchOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchCancel[1],
        body.reason || 'Match annule par moderation.'
      );
      saveMatches(io, outcome.matches, outcome.match);
      log.info('Admin action: cancel match', { adminId: session.user.id, adminPseudo: session.user.pseudo, matchId: adminMatchCancel[1], reason: body.reason });
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/bootstrap') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    respondJson(res, 200, {
      ok: true,
      ...buildChatBootstrapPayload(session.user.id),
    });
    return;
  }

  const chatChannelDetail = pathname.match(/^\/api\/chat\/channels\/([^/]+)$/);
  if (req.method === 'GET' && chatChannelDetail) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    const channel = getChatChannelById(chatChannelDetail[1]);
    if (!channel || !canAccessChatChannel(channel, session.user)) {
      respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.' });
      return;
    }

    respondJson(res, 200, {
      ok: true,
      channel: {
        ...channel,
        unreadCount: getUnreadCountForUser(channel.id, session.user.id),
      },
      messages: getChatMessagesForChannel(channel.id, 150),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat/channels') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;

    try {
      const body = await parseRequestBody(req);
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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const chatChannelMessages = pathname.match(/^\/api\/chat\/channels\/([^/]+)\/messages$/);
  if (req.method === 'POST' && chatChannelMessages) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;

    try {
      const body = await parseRequestBody(req);
      const channel = getChatChannelById(chatChannelMessages[1]);
      if (!channel || !canAccessChatChannel(channel, session.user)) {
        respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.' });
        return;
      }

      const text = sanitizeText(body.text || '');
      if (!text) {
        respondJson(res, 400, { ok: false, error: 'Le message est vide.' });
        return;
      }

      const message = appendChatMessage({
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
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const chatChannelRead = pathname.match(/^\/api\/chat\/channels\/([^/]+)\/read$/);
  if (req.method === 'POST' && chatChannelRead) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }
    if (!rateLimitGuard(res, getClientIp(req), 'chat')) return;

    const channel = getChatChannelById(chatChannelRead[1]);
    if (!channel || !canAccessChatChannel(channel, session.user)) {
      respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.' });
      return;
    }

    try {
      const receipt = markChatChannelRead(channel.id, session.user.id, getNow());
      broadcastChatRead(io, receipt.channelId, receipt.userId, receipt.readAt);
      respondJson(res, 200, { ok: true, ...receipt });
    } catch (err) {
      log.error('chat/channel read failed', { channelId: channel.id, userId: session.user.id, error: err.message });
      respondJson(res, 500, { ok: false, error: 'Erreur lors de la marque de lecture.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/auth/session') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try {
      const realtimeSession = createRealtimeSession({
        userId: session.user.id,
        pseudo: session.user.pseudo,
        role: session.user.role,
      });
      respondJson(res, 200, { ok: true, session: realtimeSession });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Unable to create realtime session.' });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/realtime/push/public-key') {
    if (!vapidKeys) {
      respondJson(res, 503, { ok: false, error: 'Push notifications not configured.' });
    } else {
      respondJson(res, 200, { publicKey: vapidKeys.publicKey });
    }
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/realtime/state/bootstrap')) {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Realtime session required.' });
      return;
    }

    respondJson(res, 200, {
      ok: true,
      matches: getStateCollection('matches').map(sanitizeMatchForBroadcast),
      tournaments: getStoredTournaments(),
      friends: getFriendsForUser(session.userId),
      friendRequests: getFriendRequestsForUser(session.userId),
      blockedIds: getBlockedUsers(session.userId),
      notifications: getUnreadNotificationsForUser(session.userId),
      timestamp: getNow(),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/state/sync') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Realtime session required.' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      if (body?.kind === 'tournaments') {
        respondJson(res, 409, { ok: false, error: 'Tournament state is now managed by dedicated API routes.' });
        return;
      }

      respondJson(res, 400, { ok: false, error: 'Invalid state sync payload.' });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Unable to validate server state sync.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/push/subscribe') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Realtime session required.' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const { subscription } = body;

      if (!subscription?.endpoint) {
        respondJson(res, 400, { ok: false, error: 'Missing subscription endpoint.' });
        return;
      }

      upsertPushSubscription(session.userId, subscription);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Unable to save subscription.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/push/unsubscribe') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Realtime session required.' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const { endpoint } = body;

      if (!endpoint) {
        respondJson(res, 400, { ok: false, error: 'Missing endpoint.' });
        return;
      }

      removePushSubscription(endpoint);
      respondJson(res, 200, { ok: true });
    } catch (error) {
      respondJson(res, 500, { ok: false, error: 'Unable to remove subscription.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/realtime/push/test') {
    const session = getAuthenticatedRealtimeSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Realtime session required.' });
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
      respondJson(res, 500, { ok: false, error: 'Unable to send test notification.' });
    }
    return;
  }

  respondJson(res, 404, { error: 'Not found' });
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

    await deliverNotification(io, targetUserId, {
      title,
      body: notifBody || 'Notification ZOYD',
      url: url || '/mj',
      tag: tag || `zoyd-${Date.now()}`,
      requireInteraction: Boolean(requireInteraction),
    });
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
  await loadFromSupabase();

  // Load admin 2FA secrets from Supabase
  const loaded2fa = await loadAdminTotpSecrets();
  for (const [userId, entry] of loaded2fa) {
    adminTotpSecrets.set(userId, entry);
  }

  ensureGlobalChatChannel();
  syncMatchChatChannels(getStateCollection('matches'));
  initCronJobs();

  setInterval(async () => {
    try { await withMatchMutex(async () => {
      const outcome = await processMatchAutomationOnServer(getStateCollection('matches'));
      if (outcome.changed) {
        saveMatches(io, outcome.matches);
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
  log.fatal('Uncaught exception', err);
});

start();
