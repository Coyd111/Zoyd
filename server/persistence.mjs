// persistence.mjs — Supabase-primary with in-memory sync cache
// Replaces SQLite entirely. In-memory Maps serve synchronous reads,
// Supabase provides durable persistence. On startup, data loads from Supabase.

import crypto from 'node:crypto';
import { supabase } from './supabase.mjs';

const getNow = () => new Date().toISOString();

// ─── In-memory caches ───────────────────────────────────────────────────────
const memoryUsers = new Map();
const memoryAuthSessions = new Map();
const memoryRealtimeSessions = new Map();
const memoryPushSubscriptions = new Map();
const memoryChatChannels = new Map();
const memoryChatMessages = new Map(); // channelId -> message[]
const memoryChatReads = new Map();    // `${channelId}:${userId}` -> readAt
const memoryStateSnapshots = new Map(); // `${kind}:${entityId}` -> payload
const memoryFriendRequests = new Map();
const memoryFriendships = new Set();   // `${uid1}:${uid2}`
const memoryUserBlocks = new Set();    // `${blocker}:${blocked}`
const memoryNotifications = new Map(); // id -> notification
const memoryProcessedTransactions = new Set();
const memoryWalletTransactions = new Map(); // userId -> tx[]

// ─── Helpers ────────────────────────────────────────────────────────────────
export const makeError = (code, message) => Object.assign(new Error(message), { code });
export const roundAmount = (value) => Math.round(Number(value || 0) * 100) / 100;

export const normalizePseudoKey = (value) => value.trim().toLowerCase();
export const normalizeEmailKey = (value) => value.trim().toLowerCase();
export const normalizePhoneKey = (value) => value.replace(/\D/g, '');
export const normalizeGameIdKey = (value) => value.trim();
export const normalizeChatParticipants = (participants) =>
  [...new Set((Array.isArray(participants) ? participants : []).map((entry) => `${entry || ''}`.trim()).filter(Boolean))];

const defaultStats = {
  wins: 0, losses: 0, draws: 0, totalMatches: 0, totalEarnings: 0,
  winRate: 0, tournamentsWon: 0, tournamentsPlayed: 0, elo: 1200,
};

const defaultProgression = { level: 'BEGINNER', xp: 0, nextLevelXp: 1000 };

const defaultWallet = {
  cashBalance: 0, bonusBalance: 0, lockedBalance: 0, pendingWinnings: 0,
  lockedEntries: {}, transactions: [],
};

export const normalizeWalletSnapshot = (wallet) => ({
  cashBalance: roundAmount(wallet?.cashBalance ?? 0),
  bonusBalance: roundAmount(wallet?.bonusBalance ?? 0),
  lockedBalance: roundAmount(wallet?.lockedBalance ?? 0),
  pendingWinnings: roundAmount(wallet?.pendingWinnings ?? 0),
  lockedEntries: wallet?.lockedEntries && typeof wallet.lockedEntries === 'object' ? wallet.lockedEntries : {},
  transactions: Array.isArray(wallet?.transactions) ? wallet.transactions : [],
});

export const sanitizeUserPayload = (payload) => {
  if (!payload) return null;
  const wallet = normalizeWalletSnapshot(payload.wallet);
  return {
    ...payload,
    wallet,
    walletBalance: roundAmount(wallet.cashBalance + wallet.bonusBalance),
    trustScore: Number(payload.trustScore || 0),
    levelCODM: Number(payload.levelCODM || 1),
    isOnline: false,
    lastSeen: getNow(),
  };
};

export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
};

export const verifyPassword = (password, passwordHash) => {
  if (!passwordHash?.includes(':')) return false;
  const [salt, expectedDigest] = passwordHash.split(':');
  const actualDigest = crypto.scryptSync(password, salt, 64).toString('hex');
  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  const actualBuffer = Buffer.from(actualDigest, 'hex');
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

// ─── Supabase helpers ───────────────────────────────────────────────────────
const sbUpsert = async (table, data) => {
  if (!supabase) return;
  const { error } = await supabase.from(table).upsert(data);
  if (error) console.error(`[Supabase] ${table} upsert error:`, error.message);
};

const sbDelete = async (table, filters) => {
  if (!supabase) return;
  let q = supabase.from(table).delete();
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { error } = await q;
  if (error) console.error(`[Supabase] ${table} delete error:`, error.message);
};

const sbDeleteMulti = async (table, col, values) => {
  if (!supabase || values.length === 0) return;
  const { error } = await supabase.from(table).delete().in(col, values);
  if (error) console.error(`[Supabase] ${table} delete-in error:`, error.message);
};

const sbSelect = async (table, filters = {}, columns = '*') => {
  if (!supabase) return [];
  let q = supabase.from(table).select(columns);
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { data, error } = await q;
  if (error) {
    console.error(`[Supabase] ${table} select error:`, error.message);
    return [];
  }
  return data || [];
};

// ─── Load from Supabase on startup ──────────────────────────────────────────
export const loadFromSupabase = async () => {
  if (!supabase) {
    console.warn('[Persistence] No Supabase client — running from memory only');
    ensureSeedAdmin();
    ensureGlobalChatChannel();
    return;
  }

  console.log('[Persistence] Loading from Supabase...');
  const t0 = Date.now();

  try {
    // Users
    const { data: users } = await supabase.from('app_users').select('*');
    if (users) {
      for (const row of users) {
        memoryUsers.set(row.id, sanitizeUserPayload(row.payload));
      }
    }

    // Auth sessions
    const { data: authSessions } = await supabase.from('auth_sessions').select('*');
    if (authSessions) {
      for (const s of authSessions) {
        memoryAuthSessions.set(s.token, { token: s.token, userId: s.user_id, issuedAt: s.issued_at, expiresAt: s.expires_at });
      }
    }

    // Realtime sessions
    const { data: rtSessions } = await supabase.from('realtime_sessions').select('*');
    if (rtSessions) {
      for (const s of rtSessions) {
        memoryRealtimeSessions.set(s.token, { token: s.token, userId: s.user_id, pseudo: s.pseudo, role: s.role, issuedAt: s.issued_at, expiresAt: s.expires_at });
      }
    }

    // Chat channels
    const { data: channels } = await supabase.from('chat_channels').select('*');
    if (channels) {
      for (const ch of channels) {
        memoryChatChannels.set(ch.id, normalizeChatChannelPayload(ch.payload));
      }
    }

    // Chat messages (last 500 per channel)
    const { data: messages } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(5000);
    if (messages) {
      const byChannel = new Map();
      for (const msg of messages.reverse()) {
        const parsed = normalizeChatMessagePayload(msg.payload);
        if (!byChannel.has(msg.channel_id)) byChannel.set(msg.channel_id, []);
        byChannel.get(msg.channel_id).push(parsed);
      }
      for (const [chId, msgs] of byChannel) {
        memoryChatMessages.set(chId, msgs);
      }
    }

    // State snapshots
    const { data: snapshots } = await supabase.from('state_snapshots').select('*');
    if (snapshots) {
      for (const snap of snapshots) {
        memoryStateSnapshots.set(`${snap.kind}:${snap.entity_id}`, snap.payload);
      }
    }

    // Friend requests
    const { data: friendReqs } = await supabase.from('friend_requests').select('*');
    if (friendReqs) {
      for (const fr of friendReqs) {
        memoryFriendRequests.set(fr.id, fr);
      }
    }

    // Friendships
    const { data: friendships } = await supabase.from('friendships').select('*');
    if (friendships) {
      for (const f of friendships) {
        memoryFriendships.add(`${f.user_id_1}:${f.user_id_2}`);
      }
    }

    // Blocks
    const { data: blocks } = await supabase.from('user_blocks').select('*');
    if (blocks) {
      for (const b of blocks) {
        memoryUserBlocks.add(`${b.blocker_id}:${b.blocked_id}`);
      }
    }

    // Notifications
    const { data: notifs } = await supabase.from('user_notifications').select('*').order('created_at', { ascending: false }).limit(5000);
    if (notifs) {
      for (const n of notifs) {
        memoryNotifications.set(n.id, {
          id: n.id, userId: n.user_id, type: n.type, title: n.title,
          message: n.message, priority: n.priority, actionUrl: n.action_url,
          metadata: n.metadata, isRead: n.is_read, createdAt: n.created_at,
        });
      }
    }

    // Push subscriptions
    const { data: subs } = await supabase.from('push_subscriptions').select('*');
    if (subs) {
      for (const s of subs) {
        memoryPushSubscriptions.set(s.endpoint, s.payload);
      }
    }

    console.log(`[Persistence] Loaded from Supabase in ${Date.now() - t0}ms`);
    console.log(`  Users: ${memoryUsers.size}, Channels: ${memoryChatChannels.size}, Snapshots: ${memoryStateSnapshots.size}`);
  } catch (err) {
    console.error('[Persistence] Error loading from Supabase:', err.message);
  }

  ensureSeedAdmin();
  ensureGlobalChatChannel();
};

// ─── Users ──────────────────────────────────────────────────────────────────
export const buildUserPayload = (input, role = 'player') => {
  const now = getNow();
  const streamerMode = Boolean(input.streamerMode);
  const wallet = normalizeWalletSnapshot(
    input.wallet || { ...defaultWallet, cashBalance: input.walletBalance || 0 }
  );

  return {
    id: input.id, role,
    pseudo: input.pseudo.trim(), email: input.email.trim(),
    phone: input.phone.trim(), gameId: input.gameId.trim(),
    controllerType: input.controllerType || 'touch',
    device: input.device || 'phone',
    levelCODM: Number(input.levelCODM || 1),
    rankMJ: input.rankMJ || 'Bronze', rankBR: input.rankBR || 'Bronze',
    country: input.country || 'Benin',
    streamerPseudo: streamerMode ? input.streamerPseudo?.trim() || '' : '',
    streamerMode, wallet,
    walletBalance: roundAmount(wallet.cashBalance + wallet.bonusBalance),
    trustScore: Number(input.trustScore || 100),
    stats: input.stats || { ...defaultStats },
    progression: input.progression || { ...defaultProgression },
    achievements: input.achievements || [],
    bio: input.bio || '', dateJoined: input.dateJoined || now,
    avatar: input.avatar, isOnline: false, lastSeen: now,
  };
};

const ensureUniqueRegistration = ({ pseudo, email, phone, gameId }) => {
  const pk = normalizePseudoKey(pseudo);
  const ek = normalizeEmailKey(email);
  const phk = normalizePhoneKey(phone);
  const gk = normalizeGameIdKey(gameId);

  for (const user of memoryUsers.values()) {
    if (normalizePseudoKey(user.pseudo) === pk) throw makeError('DUPLICATE_PSEUDO', 'Ce pseudo CODM est deja utilise sur ZOYD.');
    if (normalizeEmailKey(user.email) === ek) throw makeError('DUPLICATE_EMAIL', 'Cet email est deja rattache a un compte ZOYD.');
    if (normalizePhoneKey(user.phone) === phk) throw makeError('DUPLICATE_PHONE', 'Ce numero est deja rattache a un compte ZOYD.');
    if (normalizeGameIdKey(user.gameId) === gk) throw makeError('DUPLICATE_GAME_ID', 'Cet UID CODM est deja verifie sur la plateforme.');
  }
};

const insertUser = ({ password, role = 'player', ...input }) => {
  if (!input.pseudo?.trim() || !input.email?.trim() || !input.phone?.trim() || !input.gameId?.trim()) {
    throw makeError('INVALID_REGISTRATION', 'Informations joueur incompletes.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw makeError('INVALID_REGISTRATION', 'Le mot de passe doit contenir au moins 8 caracteres.');
  }

  ensureUniqueRegistration(input);

  const id = input.id || crypto.randomUUID();
  const createdAt = input.dateJoined || getNow();
  const payload = buildUserPayload({ ...input, id, dateJoined: createdAt }, role);
  const passwordHash = hashPassword(password);

  // Write to memory
  memoryUsers.set(id, payload);
  storePasswordHash(id, passwordHash, payload.pseudo, payload.email, payload.phone);

  // Write to Supabase
  sbUpsert('app_users', {
    id, pseudo_key: normalizePseudoKey(payload.pseudo),
    email_key: normalizeEmailKey(payload.email), phone_key: normalizePhoneKey(payload.phone),
    game_id_key: normalizeGameIdKey(payload.gameId), role,
    password_hash: passwordHash, payload,
    created_at: createdAt, updated_at: createdAt,
  });

  return sanitizeUserPayload(payload);
};

export const getUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  return user ? sanitizeUserPayload(user) : null;
};

export const updateUserAccount = (userId, updater) => {
  const current = memoryUsers.get(userId);
  if (!current) throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');

  const next = sanitizeUserPayload(updater(structuredClone(sanitizeUserPayload(current))));
  memoryUsers.set(userId, next);

  const passwordHash = memoryPasswordHashes.get(userId)?.[1] || '';

  sbUpsert('app_users', {
    id: userId, pseudo_key: normalizePseudoKey(next.pseudo),
    email_key: normalizeEmailKey(next.email), phone_key: normalizePhoneKey(next.phone),
    game_id_key: normalizeGameIdKey(next.gameId), role: next.role,
    password_hash: passwordHash, payload: next,
    created_at: current.dateJoined, updated_at: getNow(),
  });

  return next;
};

export const getWalletSnapshot = (userId) => getUserById(userId)?.wallet || normalizeWalletSnapshot(defaultWallet);

export const updateWalletSnapshot = (userId, updater) =>
  updateUserAccount(userId, (user) => {
    user.wallet = normalizeWalletSnapshot(updater(structuredClone(user.wallet || defaultWallet), structuredClone(user)));
    user.walletBalance = roundAmount(user.wallet.cashBalance + user.wallet.bonusBalance);
    return user;
  });

export const createUserAccount = (payload) => insertUser(payload);

export const authenticateUserAccount = ({ identifier, password }) => {
  const trimmed = identifier.trim();
  const pk = normalizePseudoKey(trimmed);
  const ek = normalizeEmailKey(trimmed);
  const phk = normalizePhoneKey(trimmed);

  const hash = memoryPasswordHashes.get(pk) || memoryPasswordHashes.get(ek) || memoryPasswordHashes.get(phk);
  if (!hash) throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');

  const [userId, passwordHash] = hash;
  if (!verifyPassword(password, passwordHash)) {
    throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');
  }

  return sanitizeUserPayload(memoryUsers.get(userId));
};

// Password hash lookup: identifier -> [userId, hash]
const memoryPasswordHashes = new Map();

const storePasswordHash = (userId, passwordHash, pseudo, email, phone) => {
  memoryPasswordHashes.set(userId, [userId, passwordHash]);
  if (pseudo) memoryPasswordHashes.set(normalizePseudoKey(pseudo), [userId, passwordHash]);
  if (email) memoryPasswordHashes.set(normalizeEmailKey(email), [userId, passwordHash]);
  if (phone) memoryPasswordHashes.set(normalizePhoneKey(phone), [userId, passwordHash]);
};

// ─── Auth Sessions ──────────────────────────────────────────────────────────
const createTokenRecord = (type, userId, extra = {}) => {
  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = getNow();
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const record = { token, userId, issuedAt, expiresAt, ...extra };

  if (type === 'auth') {
    memoryAuthSessions.set(token, record);
    sbUpsert('auth_sessions', { token, user_id: userId, issued_at: issuedAt, expires_at: expiresAt });
  } else {
    memoryRealtimeSessions.set(token, record);
    sbUpsert('realtime_sessions', { token, user_id: userId, pseudo: extra.pseudo, role: extra.role, issued_at: issuedAt, expires_at: expiresAt });
  }

  return record;
};

const cleanupExpired = (map) => {
  const now = getNow();
  for (const [token, session] of map) {
    if (session.expiresAt <= now) map.delete(token);
  }
};

export const createAuthSession = (userId) => {
  cleanupExpired(memoryAuthSessions);
  const session = createTokenRecord('auth', userId);
  return { ...session, user: getUserById(userId) };
};

export const getAuthSession = (token) => {
  cleanupExpired(memoryAuthSessions);
  if (!token) return null;
  const session = memoryAuthSessions.get(token);
  if (!session) return null;
  const user = getUserById(session.userId);
  if (!user) { memoryAuthSessions.delete(token); return null; }
  return { ...session, user };
};

export const deleteAuthSession = (token) => {
  memoryAuthSessions.delete(token);
  sbDelete('auth_sessions', { token });
};

export const createRealtimeSession = ({ userId, pseudo, role }) => {
  cleanupExpired(memoryRealtimeSessions);
  return createTokenRecord('realtime', userId, { pseudo, role });
};

export const getRealtimeSession = (token) => {
  cleanupExpired(memoryRealtimeSessions);
  return token ? memoryRealtimeSessions.get(token) || null : null;
};

export const deleteRealtimeSession = (token) => {
  memoryRealtimeSessions.delete(token);
  sbDelete('realtime_sessions', { token });
};

export const deleteRealtimeSessionsForUser = (userId) => {
  for (const [token, session] of memoryRealtimeSessions) {
    if (session.userId === userId) memoryRealtimeSessions.delete(token);
  }
  sbDelete('realtime_sessions', { user_id: userId });
};

// ─── Push Subscriptions ─────────────────────────────────────────────────────
export const upsertPushSubscription = (userId, subscription) => {
  memoryPushSubscriptions.set(subscription.endpoint, subscription);
  sbUpsert('push_subscriptions', { user_id: userId, endpoint: subscription.endpoint, payload: subscription, updated_at: getNow() });
};

export const removePushSubscription = (endpoint) => {
  memoryPushSubscriptions.delete(endpoint);
  sbDelete('push_subscriptions', { endpoint });
};

export const getPushSubscriptionsForUser = (userId) => {
  const subs = [];
  for (const [endpoint, payload] of memoryPushSubscriptions) {
    if (payload.userId === userId || payload.user_id === userId) subs.push(payload);
  }
  return subs;
};

export const countPushSubscriptions = () => memoryPushSubscriptions.size;

// ─── Chat ───────────────────────────────────────────────────────────────────
export const normalizeChatChannelPayload = (channel) => {
  const createdAt = channel?.createdAt || channel?.created_at || getNow();
  const updatedAt = channel?.updatedAt || channel?.updated_at || channel?.lastMessageAt || createdAt;
  return {
    id: `${channel?.id || ''}`.trim(),
    type: channel?.type || 'private',
    name: `${channel?.name || 'Canal ZOYD'}`.trim(),
    participants: normalizeChatParticipants(channel?.participants),
    unreadCount: Number(channel?.unreadCount || 0),
    lastMessageAt: channel?.lastMessageAt,
    isMuted: Boolean(channel?.isMuted),
    scope: channel?.scope === 'public' ? 'public' : 'participants',
    inbox: channel?.inbox === 'all' ? 'all' : 'participants',
    createdAt, updatedAt,
  };
};

export const normalizeChatMessagePayload = (message) => ({
  id: `${message?.id || ''}`.trim(),
  channelId: `${message?.channelId || message?.channel_id || ''}`.trim(),
  channelType: message?.channelType || message?.channel_type || 'private',
  senderId: `${message?.senderId || message?.sender_id || ''}`.trim(),
  senderPseudo: `${message?.senderPseudo || message?.sender_pseudo || 'ZOYD'}`.trim(),
  senderAvatar: message?.senderAvatar || message?.sender_avatar,
  text: `${message?.text || ''}`.trim(),
  timestamp: message?.timestamp || message?.created_at || getNow(),
  isSystem: Boolean(message?.isSystem || message?.is_system),
  isDeleted: Boolean(message?.isDeleted || message?.is_deleted),
  replyTo: message?.replyTo || message?.reply_to,
});

export const getChatChannelById = (channelId) => channelId ? memoryChatChannels.get(channelId) || null : null;

export const getChatChannelsForUser = (userId) => {
  const channels = [];
  for (const channel of memoryChatChannels.values()) {
    if (channel.inbox === 'all' || channel.participants.includes(userId)) {
      channels.push({ ...channel, unreadCount: getUnreadCountForUser(channel.id, userId) });
    }
  }
  return channels;
};

export const upsertChatChannel = (channel) => {
  const existing = getChatChannelById(channel.id);
  const next = normalizeChatChannelPayload({ ...existing, ...channel });
  memoryChatChannels.set(next.id, next);

  sbUpsert('chat_channels', { id: next.id, type: next.type, payload: next, created_at: next.createdAt, updated_at: next.updatedAt });
  return next;
};

export const appendChatMessage = (message) => {
  const channel = getChatChannelById(message.channelId);
  if (!channel) throw makeError('CHANNEL_NOT_FOUND', 'Canal de discussion introuvable.');

  const nextMessage = normalizeChatMessagePayload({
    ...message, channelType: message.channelType || channel.type, timestamp: message.timestamp || getNow(),
  });

  const msgs = memoryChatMessages.get(nextMessage.channelId) || [];
  msgs.push(nextMessage);
  memoryChatMessages.set(nextMessage.channelId, msgs);

  sbUpsert('chat_messages', { id: nextMessage.id, channel_id: nextMessage.channelId, payload: nextMessage, created_at: nextMessage.timestamp });
  upsertChatChannel({ ...channel, lastMessageAt: nextMessage.timestamp, updatedAt: nextMessage.timestamp });

  return nextMessage;
};

export const getChatMessagesForChannel = (channelId, limit = 200) => {
  const msgs = memoryChatMessages.get(channelId) || [];
  return msgs.slice(-Math.max(1, Number(limit || 200)));
};

export const markChatChannelRead = (channelId, userId, readAt = getNow()) => {
  memoryChatReads.set(`${channelId}:${userId}`, readAt);
  sbUpsert('chat_reads', { channel_id: channelId, user_id: userId, read_at: readAt });
  return { channelId, userId, readAt };
};

export const getUnreadCountForUser = (channelId, userId) => {
  const readAt = memoryChatReads.get(`${channelId}:${userId}`) || '1970-01-01T00:00:00.000Z';
  const msgs = memoryChatMessages.get(channelId) || [];
  return msgs.filter((m) => m.timestamp > readAt && m.senderId !== userId).length;
};

export const ensureGlobalChatChannel = () =>
  upsertChatChannel({
    id: 'global', type: 'global', name: 'Chat Global ZOYD',
    participants: [], unreadCount: 0, isMuted: false,
    scope: 'public', inbox: 'all', createdAt: getNow(), updatedAt: getNow(),
  });

// ─── State Snapshots (matches, tournaments) ─────────────────────────────────
export const replaceStateCollection = (kind, items) => {
  const itemIds = new Set(items.map((item) => item.id));

  // Update memory
  for (const item of items) {
    memoryStateSnapshots.set(`${kind}:${item.id}`, item);
  }

  // Remove stale
  for (const key of memoryStateSnapshots.keys()) {
    if (key.startsWith(`${kind}:`) && !itemIds.has(key.split(':').slice(1).join(':'))) {
      memoryStateSnapshots.delete(key);
    }
  }

  // Sync to Supabase (batch upsert)
  if (items.length > 0 && supabase) {
    const rows = items.map(item => ({ kind, entity_id: item.id, payload: item, updated_at: getNow() }));
    // Batch in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      sbUpsert('state_snapshots', rows.slice(i, i + 100));
    }
  }
};

export const getStateCollection = (kind) => {
  const results = [];
  for (const [key, payload] of memoryStateSnapshots) {
    if (key.startsWith(`${kind}:`)) results.push(payload);
  }
  return results;
};

// ─── Social ─────────────────────────────────────────────────────────────────
export const getFriendRequestsForUser = (userId) => {
  const results = [];
  for (const fr of memoryFriendRequests.values()) {
    if (fr.target_id === userId || fr.sender_id === userId) results.push(fr);
  }
  return results;
};

export const getFriendsForUser = (userId) => {
  const friends = [];
  for (const key of memoryFriendships) {
    const [u1, u2] = key.split(':');
    const friendId = u1 === userId ? u2 : u2 === userId ? u1 : null;
    if (friendId) {
      const user = getUserById(friendId);
      if (user) friends.push(user);
    }
  }
  return friends;
};

export const getBlockedUsers = (userId) => {
  const blocked = [];
  for (const key of memoryUserBlocks) {
    const [blocker, blocked_id] = key.split(':');
    if (blocker === userId) blocked.push(blocked_id);
  }
  return blocked;
};

export const sendFriendRequest = (senderId, targetId, message) => {
  if (senderId === targetId) throw makeError('INVALID_REQUEST', 'Cannot add yourself.');
  const target = getUserById(targetId);
  if (!target) throw makeError('USER_NOT_FOUND', 'Utilisateur introuvable.');

  for (const fr of memoryFriendRequests.values()) {
    if ((fr.sender_id === senderId && fr.target_id === targetId) || (fr.sender_id === targetId && fr.target_id === senderId)) {
      if (fr.status === 'accepted') throw makeError('ALREADY_FRIENDS', 'Vous etes deja amis.');
      if (fr.status === 'pending') throw makeError('REQUEST_PENDING', 'Une demande est deja en attente.');
    }
  }

  const id = `FR-${crypto.randomUUID()}`;
  const now = getNow();
  const record = { id, sender_id: senderId, target_id: targetId, status: 'pending', message: message || null, created_at: now, updated_at: now };

  memoryFriendRequests.set(id, record);
  sbUpsert('friend_requests', record);
  return { id, senderId, targetId, status: 'pending', message, timestamp: now };
};

export const acceptFriendRequest = (requestId, userId) => {
  const req = memoryFriendRequests.get(requestId);
  if (!req) throw makeError('NOT_FOUND', 'Demande introuvable.');
  if (req.target_id !== userId) throw makeError('UNAUTHORIZED', 'Non autorise.');

  req.status = 'accepted';
  req.updated_at = getNow();
  memoryFriendRequests.set(requestId, req);
  memoryFriendships.add(`${req.sender_id}:${req.target_id}`);
  memoryFriendships.add(`${req.target_id}:${req.sender_id}`);

  sbUpsert('friend_requests', req);
  sbUpsert('friendships', { user_id_1: req.sender_id, user_id_2: req.target_id, created_at: getNow() });

  return getUserById(req.sender_id);
};

export const declineFriendRequest = (requestId, userId) => {
  const req = memoryFriendRequests.get(requestId);
  if (!req) throw makeError('NOT_FOUND', 'Demande introuvable.');
  if (req.target_id !== userId) throw makeError('UNAUTHORIZED', 'Non autorise.');
  req.status = 'declined';
  req.updated_at = getNow();
  memoryFriendRequests.set(requestId, req);
  sbUpsert('friend_requests', req);
};

export const removeFriend = (userId, friendId) => {
  memoryFriendships.delete(`${userId}:${friendId}`);
  memoryFriendships.delete(`${friendId}:${userId}`);
  sbDelete('friendships', { user_id_1: userId, user_id_2: friendId });
  sbDelete('friendships', { user_id_1: friendId, user_id_2: userId });

  for (const [id, fr] of memoryFriendRequests) {
    if ((fr.sender_id === userId && fr.target_id === friendId) || (fr.sender_id === friendId && fr.target_id === userId)) {
      memoryFriendRequests.delete(id);
    }
  }
};

export const blockUser = (blockerId, blockedId) => {
  removeFriend(blockerId, blockedId);
  memoryUserBlocks.add(`${blockerId}:${blockedId}`);
  sbUpsert('user_blocks', { blocker_id: blockerId, blocked_id: blockedId, created_at: getNow() });
};

export const unblockUser = (blockerId, blockedId) => {
  memoryUserBlocks.delete(`${blockerId}:${blockedId}`);
  sbDelete('user_blocks', { blocker_id: blockerId, blocked_id: blockedId });
};

// ─── Notifications ──────────────────────────────────────────────────────────
export const createNotification = (userId, type, title, message, priority, actionUrl, metadata) => {
  const id = `NOTIF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = getNow();
  const notification = { id, userId, type, title, message, priority, actionUrl, metadata, isRead: false, createdAt: now };

  memoryNotifications.set(id, notification);
  sbUpsert('user_notifications', {
    id, user_id: userId, type, title, message, priority,
    action_url: actionUrl || null, metadata: metadata || null,
    is_read: false, created_at: now,
  });

  return notification;
};

export const getUnreadNotificationsForUser = (userId) => {
  const results = [];
  for (const n of memoryNotifications.values()) {
    if (n.userId === userId && !n.isRead) results.push(n);
  }
  return results;
};

export const markNotificationAsRead = (userId, notificationId) => {
  const n = memoryNotifications.get(notificationId);
  if (!n || n.userId !== userId) return false;
  n.isRead = true;
  memoryNotifications.set(notificationId, n);
  if (supabase) supabase.from('user_notifications').update({ is_read: true }).eq('id', notificationId).then(() => {});
  return true;
};

export const markAllNotificationsAsRead = (userId) => {
  let count = 0;
  for (const [id, n] of memoryNotifications) {
    if (n.userId === userId && !n.isRead) { n.isRead = true; memoryNotifications.set(id, n); count++; }
  }
  if (supabase && count > 0) supabase.from('user_notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false).then(() => {});
  return count;
};

// ─── FedaPay Transaction Idempotency ────────────────────────────────────────
export const hasTransactionBeenProcessed = (transactionId) => memoryProcessedTransactions.has(transactionId);

export const markTransactionAsProcessed = (transactionId, userId, amountZC) => {
  memoryProcessedTransactions.add(transactionId);
  sbUpsert('processed_transactions', { transaction_id: transactionId, user_id: userId, amount_zc: amountZC });
};

// ─── Seed data ──────────────────────────────────────────────────────────────
const ensureSeedAdmin = () => {
  const adminEmail = normalizeEmailKey('admin@zoyd.com');
  for (const user of memoryUsers.values()) {
    if (normalizeEmailKey(user.email) === adminEmail) return;
  }

  insertUser({
    id: 'admin-zoyd-control', role: 'admin',
    pseudo: 'ZOYD Control', email: 'admin@zoyd.com', phone: '+22960000000',
    password: process.env.ZOYD_ADMIN_PASSWORD || (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[FATAL] ZOYD_ADMIN_PASSWORD must be set in production.');
      }
      console.warn('[WARN] ZOYD_ADMIN_PASSWORD not set — using dev password.');
      return 'Admin@ZOYD2026';
    })(),
    gameId: 'ADMIN-ZOYD-0001', controllerType: 'touch', device: 'pc',
    levelCODM: 150, rankMJ: 'Legendary', rankBR: 'Legendary', country: 'Benin',
    walletBalance: 0, trustScore: 100,
    stats: { ...defaultStats }, progression: { level: 'PRO', xp: 20000, nextLevelXp: 20000 },
    achievements: ['Control Room'], bio: 'Compte de moderation ZOYD.',
  });
};
