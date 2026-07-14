import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import webpush from 'web-push';
import { vapidKeys } from './vapid-keys.mjs';
import {
  authenticateUserAccount,
  appendChatMessage,
  countPushSubscriptions,
  createAuthSession,
  createRealtimeSession,
  createUserAccount,
  deleteAuthSession,
  deleteRealtimeSessionsForUser,
  ensureGlobalChatChannel,
  getUserById,
  getPushSubscriptionsForUser,
  getAuthSession,
  getChatChannelById,
  getChatChannelsForUser,
  getChatMessagesForChannel,
  getRealtimeSession,
  getUnreadCountForUser,
  getStateCollection,
  loadFromSupabase,
  markChatChannelRead,
  removePushSubscription,
  replaceStateCollection,
  upsertChatChannel,
  upsertPushSubscription,
  updateUserAccount,
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
} from './persistence.mjs';
import { depositToWallet, getServerWallet, withdrawFromWallet } from './wallet-engine.mjs';
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

const PORT = Number(process.env.PORT || process.env.ZOYD_REALTIME_PORT || 4001);
const allowedOrigins = (process.env.ZOYD_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

webpush.setVapidDetails('mailto:ops@zoyd.africa', vapidKeys.publicKey, vapidKeys.privateKey);

const channels = new Map();
const channelsBySocket = new Map();
const seenByChannel = new Map();
const typingByChannel = new Map();

const getNow = () => new Date().toISOString();

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4001',
  'https://zoyd.africa',
  'https://www.zoyd.africa',
];

const getCorsOrigin = (req) => {
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
};

const respondJson = (res, statusCode, payload, req = null) => {
  const origin = req ? getCorsOrigin(req) : ALLOWED_ORIGINS[0];
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(payload));
};

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
  broadcastStateSnapshot(io, 'matches', storedMatches);
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
    match,
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
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
    case 'CHANNEL_NOT_FOUND':
    case 'PLAYER_NOT_FOUND':
    case 'USER_NOT_FOUND':
      return { status: 404, message: error.message };
    default:
      return { status: 500, message: 'Une erreur serveur est survenue.' };
  }
};

const getChannelMemberMap = (channelId) => {
  if (!channels.has(channelId)) {
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

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    respondJson(res, 404, { error: 'Not found' });
    return;
  }

  const pathname = getPathname(req);

  if (req.method === 'OPTIONS') {
    respondJson(res, 204, {});
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

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    try {
      const body = await parseRequestBody(req);
      const user = createUserAccount(body);
      const session = createAuthSession(user.id);

      respondJson(res, 201, {
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

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = await parseRequestBody(req);
      const user = authenticateUserAccount({
        identifier: body.identifier || '',
        password: body.password || '',
      });
      const session = createAuthSession(user.id);

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
      ];
      const safeUpdate = {};
      for (const field of ALLOWED_PROFILE_FIELDS) {
        if (field in body) safeUpdate[field] = body[field];
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
    try {
      const body = await parseRequestBody(req);
      const request = sendFriendRequest(session.user.id, body.targetId, body.message);
      
      deliverNotification(io, body.targetId, {
        type: 'friend_request',
        title: "Demande d'ami",
        body: `${session.user.pseudo} t'a envoyé une demande d'ami.`,
        url: `/profil`,
        requireInteraction: false
      }).catch(console.error);

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
      }).catch(console.error);

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

  if (req.method === 'POST' && pathname === '/api/notifications/read') {
    const session = getAuthenticatedAppSession(req);
    if (!session) return respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
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

    respondJson(res, 200, { ok: true });
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

    try {
      const body = await parseRequestBody(req);
      const wallet = depositToWallet(session.user.id, body.amount, body.method);
      const user = getUserById(session.user.id);
      respondJson(res, 200, { ok: true, wallet, user });
    } catch (error) {
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

    try {
      const body = await parseRequestBody(req);
      const wallet = withdrawFromWallet(session.user.id, body.amount, body.method, body.phone);
      const user = getUserById(session.user.id);
      respondJson(res, 200, { ok: true, wallet, user });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/matches') {
    // Filter matches server-side based on the connected user's device type
    const matchSession = readBearerToken(req) ? getAuthSession(readBearerToken(req)) : null;
    const matchCurrentUser = matchSession?.user ? getUserById(matchSession.user.id) : null;
    const allMatches = getStateCollection('matches');
    const visibleMatches = getPublicMatchesForUser(allMatches, matchCurrentUser);

    respondJson(res, 200, {
      ok: true,
      matches: visibleMatches,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tournaments') {
    respondJson(res, 200, {
      ok: true,
      tournaments: getStoredTournaments(),
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

    try {
      const body = await parseRequestBody(req);
      const outcome = createTournamentOnServer(getStoredTournaments(), session.user, body);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 201, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
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

    try {
      const body = await parseRequestBody(req);
      const outcome = registerForTournamentOnServer(getStoredTournaments(), session.user, tournamentRegister[1], body);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
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

    try {
      const outcome = leaveTournamentOnServer(getStoredTournaments(), session.user, tournamentLeave[1]);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
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

    try {
      const outcome = assignTournamentArbiterOnServer(getStoredTournaments(), session.user, tournamentArbiter[1]);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
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

    try {
      const outcome = startTournamentOnServer(getStoredTournaments(), session.user, tournamentStart[1]);
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
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

    try {
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
    } catch (error) {
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

    try {
      const outcome = setTournamentMatchLiveOnServer(
        getStoredTournaments(),
        session.user,
        tournamentLive[1],
        tournamentLive[2]
      );
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
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

    try {
      const body = await parseRequestBody(req);
      const outcome = submitTournamentMatchResultOnServer(
        getStoredTournaments(),
        session.user,
        tournamentResult[1],
        tournamentResult[2],
        body
      );
      saveTournaments(io, outcome.tournaments);
      respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/wallet/verify-fedapay') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      if (!body.transactionId) {
        respondJson(res, 400, { ok: false, error: 'transactionId manquant.' });
        return;
      }

      const outcome = await verifyFedaPayTransactionAndCredit(body.transactionId, session.user);
      // Synchronize the updated wallet state
      const { depositToWallet, getServerWallet } = await import('./wallet-engine.mjs');
      // The payment-engine already modifies the wallet in memory. We just return it.
      respondJson(res, 200, { 
        ok: true, 
        amount: outcome.amountZC, 
        wallet: getServerWallet(session.user.id),
        user: outcome.user
      });
    } catch (error) {
      respondJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/matches') {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const outcome = createMatchOnServer(getStateCollection('matches'), session.user, body);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 201, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const body = await parseRequestBody(req);
      const outcome = joinMatchOnServer(getStateCollection('matches'), session.user, matchJoin[1], body.team);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const outcome = assignArbiterOnServer(getStateCollection('matches'), session.user, matchArbiter[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const outcome = checkInMatchOnServer(getStateCollection('matches'), session.user, matchCheckIn[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const outcome = toggleReadyOnServer(getStateCollection('matches'), session.user, matchReady[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const body = await parseRequestBody(req);
      const outcome = scheduleMatchOnServer(getStateCollection('matches'), session.user, matchSchedule[1], body.scheduledAt);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
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

    try {
      const outcome = launchMatchOnServer(getStateCollection('matches'), session.user, matchLaunch[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const body = await parseRequestBody(req);
      const outcome = submitMatchResultOnServer(getStateCollection('matches'), session.user, matchResult[1], body);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const outcome = confirmMatchResultOnServer(getStateCollection('matches'), session.user, matchConfirm[1]);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const body = await parseRequestBody(req);
      const outcome = openDisputeOnServer(getStateCollection('matches'), session.user, matchDisputes[1], body);
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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
    try {
      const body = await parseRequestBody(req);
      const outcome = addEvidenceToDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        matchDisputeEvidence[1],
        body.evidence
      );
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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
    try {
      const outcome = escalateDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        matchDisputeEscalate[1]
      );
      saveMatches(io, outcome.matches, outcome.match);

      // Notify admins of escalation
      const match = outcome.match;
      deliverNotification(io, '__admin__', {
        type: 'dispute_update',
        title: 'Litige escaladé',
        body: `Match ${match.id} — Litige escaladé au niveau admin par ${session.user.pseudo}.`,
        url: `/admin`,
        requireInteraction: true,
      }).catch(console.error);

      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
    } catch (error) {
      const mapped = mapPersistenceError(error);
      respondJson(res, mapped.status, { ok: false, error: mapped.message });
    }
    return;
  }

  const adminMatchAward = pathname.match(/^\/api\/admin\/matches\/([^/]+)\/award$/);
  if (req.method === 'POST' && adminMatchAward) {
    const session = getAuthenticatedAppSession(req);
    if (!session) {
      respondJson(res, 401, { ok: false, error: 'Session joueur requise.' }, req);
      return;
    }
    if (session.user.role !== 'admin') {
      console.warn(`[SECURITY] Tentative admin non autorisée par ${session.user.pseudo} (${session.user.id}) sur award match ${adminMatchAward[1]}`);
      respondJson(res, 403, { ok: false, error: 'Accès réservé aux administrateurs.' }, req);
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const currentMatches = getStateCollection('matches');
      const targetMatch = currentMatches.find((entry) => entry.id === adminMatchAward[1]);
      const defaultScores = body.winnerTeam === 0 ? { team0: 1, team1: 0 } : { team0: 0, team1: 1 };
      const outcome = submitMatchResultOnServer(currentMatches, session.user, adminMatchAward[1], {
        winnerTeam: body.winnerTeam,
        scores: targetMatch?.result?.scores || defaultScores,
        screenshots: targetMatch?.result?.screenshots || [],
        proofs: targetMatch?.result?.proofs,
        arbiterNotes: body.arbiterNotes || 'Resolution admin depuis le command center.',
        submittedBy: 'admin-dashboard',
      });
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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
    if (session.user.role !== 'admin') {
      console.warn(`[SECURITY] Tentative admin non autorisée par ${session.user.pseudo} (${session.user.id}) sur resolve-dispute match ${adminMatchResolve[1]}`);
      respondJson(res, 403, { ok: false, error: 'Accès réservé aux administrateurs.' }, req);
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const outcome = resolveDisputeOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchResolve[1],
        body.resolution || 'Litige clos par moderation.'
      );
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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
    if (session.user.role !== 'admin') {
      console.warn(`[SECURITY] Tentative admin non autorisée par ${session.user.pseudo} (${session.user.id}) sur cancel match ${adminMatchCancel[1]}`);
      respondJson(res, 403, { ok: false, error: 'Accès réservé aux administrateurs.' }, req);
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const outcome = cancelMatchOnServer(
        getStateCollection('matches'),
        session.user,
        adminMatchCancel[1],
        body.reason || 'Match annule par moderation.'
      );
      saveMatches(io, outcome.matches, outcome.match);
      respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
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

    try {
      const body = await parseRequestBody(req);
      const channel = upsertChatChannel({
        id: body.id || `CH-${body.type || 'private'}-${Date.now().toString(36).toUpperCase()}`,
        type: body.type || 'private',
        name: body.name || 'Nouvelle conversation',
        participants: [session.user.id, ...((Array.isArray(body.participants) ? body.participants : []).filter(Boolean))],
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

    try {
      const body = await parseRequestBody(req);
      const channel = getChatChannelById(chatChannelMessages[1]);
      if (!channel || !canAccessChatChannel(channel, session.user)) {
        respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.' });
        return;
      }

      const text = `${body.text || ''}`.trim();
      if (!text) {
        respondJson(res, 400, { ok: false, error: 'Le message est vide.' });
        return;
      }

      const message = appendChatMessage({
        id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

    const channel = getChatChannelById(chatChannelRead[1]);
    if (!channel || !canAccessChatChannel(channel, session.user)) {
      respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.' });
      return;
    }

    const receipt = markChatChannelRead(channel.id, session.user.id, getNow());
    broadcastChatRead(io, receipt.channelId, receipt.userId, receipt.readAt);
    respondJson(res, 200, { ok: true, ...receipt });
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
    respondJson(res, 200, { publicKey: vapidKeys.publicKey });
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
      matches: getStateCollection('matches'),
      tournaments: getStoredTournaments(),
      friends: getFriendsForUser(session.user.id),
      friendRequests: getFriendRequestsForUser(session.user.id),
      blockedIds: getBlockedUsers(session.user.id),
      notifications: getUnreadNotificationsForUser(session.user.id),
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
        respondJson(res, 400, { error: 'Missing subscription endpoint.' });
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
        respondJson(res, 400, { error: 'Missing endpoint.' });
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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST'],
  },
});

io.use((socket, next) => {
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

  socket.emit('server:hello', {
    socketId: socket.id,
    serverTime: getNow(),
    userId: session.userId,
  });

  socket.on('presence:join', (payload = {}) => {
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
    const safePayload = {
      ...payload,
      userId: session.userId,
      pseudo: session.pseudo,
    };
    const { channelId, userId } = safePayload;
    if (!channelId || !userId) return;

    const members = getChannelMemberMap(channelId);
    const existingMember = members.get(userId);
    if (!existingMember) {
      const createdMember = upsertChannelMember(socket, safePayload);
      if (!createdMember) return;
    } else {
      existingMember.role = safePayload.role || existingMember.role;
      existingMember.team = typeof safePayload.team === 'number' ? safePayload.team : existingMember.team;
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
    if (!payload.channelId) return;
    removeSocketFromChannel(io, socket, payload.channelId);
  });

  socket.on('channel:seen', (payload = {}) => {
    const { channelId } = payload;
    if (!channelId) return;

    const seen = getSeenMap(channelId);
    seen.set(session.userId, getNow());
    emitChannelSnapshots(io, channelId);
  });

  socket.on('typing:update', (payload = {}) => {
    const { channelId, isTyping } = payload;
    if (!channelId) return;

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
    const { targetUserId, title, body, url, tag, requireInteraction } = payload;
    if (!targetUserId || !title) return;

    await deliverNotification(io, targetUserId, {
      title,
      body: body || 'Notification ZOYD',
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
  });
});

const start = async () => {
  await loadFromSupabase();

  ensureGlobalChatChannel();
  syncMatchChatChannels(getStateCollection('matches'));

  setInterval(() => {
    try {
      const outcome = processMatchAutomationOnServer(getStateCollection('matches'));
      if (outcome.changed) {
        saveMatches(io, outcome.matches);
      }
    } catch (error) {
      console.error('[zoyd-realtime] match automation error', error);
    }
  }, MATCH_AUTOMATION_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`[zoyd-realtime] listening on http://localhost:${PORT}`);
  });
};

start();
