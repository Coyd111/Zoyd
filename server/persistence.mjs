import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { db, supabase } from './supabase.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'realtime.db');
const localDb = new DatabaseSync(dbPath);

localDb.exec(`
  CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    pseudo_key TEXT NOT NULL UNIQUE,
    email_key TEXT NOT NULL UNIQUE,
    phone_key TEXT NOT NULL UNIQUE,
    game_id_key TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS realtime_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    pseudo TEXT NOT NULL,
    role TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id TEXT NOT NULL,
    endpoint TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_channels (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_reads (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS state_snapshots (
    kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, entity_id)
  );
`);

const getNow = () => new Date().toISOString();

const defaultStats = {
  wins: 0,
  losses: 0,
  draws: 0,
  totalMatches: 0,
  totalEarnings: 0,
  winRate: 0,
  tournamentsWon: 0,
  tournamentsPlayed: 0,
  elo: 1200,
};

const defaultProgression = {
  level: 'BEGINNER',
  xp: 0,
  nextLevelXp: 1000,
};

const roundAmount = (value) => Math.round(Number(value || 0) * 100) / 100;
const defaultWallet = {
  cashBalance: 0,
  bonusBalance: 0,
  lockedBalance: 0,
  pendingWinnings: 0,
  lockedEntries: {},
  transactions: [],
};

const normalizePseudoKey = (value) => value.trim().toLowerCase();
const normalizeEmailKey = (value) => value.trim().toLowerCase();
const normalizePhoneKey = (value) => value.replace(/\D/g, '');
const normalizeGameIdKey = (value) => value.trim();
const normalizeChatParticipants = (participants) =>
  [...new Set((Array.isArray(participants) ? participants : []).map((entry) => `${entry || ''}`.trim()).filter(Boolean))];

const makeError = (code, message) => Object.assign(new Error(message), { code });

const cleanupExpiredAuthSessions = () => {
  localDb.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(getNow());
};

const cleanupExpiredRealtimeSessions = () => {
  localDb.prepare('DELETE FROM realtime_sessions WHERE expires_at <= ?').run(getNow());
};

const normalizeChatChannelPayload = (channel) => {
  const createdAt = channel?.createdAt || getNow();
  const updatedAt = channel?.updatedAt || channel?.lastMessageAt || createdAt;

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
    createdAt,
    updatedAt,
  };
};

const normalizeChatMessagePayload = (message) => ({
  id: `${message?.id || ''}`.trim(),
  channelId: `${message?.channelId || ''}`.trim(),
  channelType: message?.channelType || 'private',
  senderId: `${message?.senderId || ''}`.trim(),
  senderPseudo: `${message?.senderPseudo || 'ZOYD'}`.trim(),
  senderAvatar: message?.senderAvatar,
  text: `${message?.text || ''}`.trim(),
  timestamp: message?.timestamp || getNow(),
  isSystem: Boolean(message?.isSystem),
  isDeleted: Boolean(message?.isDeleted),
  replyTo: message?.replyTo,
});

const getChatChannelRowById = (channelId) =>
  db
    .prepare(
      `
        SELECT payload
        FROM chat_channels
        WHERE id = ?
      `
    )
    .get(channelId);

const getChatReadAt = (channelId, userId) =>
  db
    .prepare(
      `
        SELECT read_at AS readAt
        FROM chat_reads
        WHERE channel_id = ? AND user_id = ?
      `
    )
    .get(channelId, userId)?.readAt;

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
};

const verifyPassword = (password, passwordHash) => {
  if (!passwordHash?.includes(':')) return false;
  const [salt, expectedDigest] = passwordHash.split(':');
  const actualDigest = crypto.scryptSync(password, salt, 64).toString('hex');

  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  const actualBuffer = Buffer.from(actualDigest, 'hex');

  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

const normalizeWalletSnapshot = (wallet) => ({
  cashBalance: roundAmount(wallet?.cashBalance ?? 0),
  bonusBalance: roundAmount(wallet?.bonusBalance ?? 0),
  lockedBalance: roundAmount(wallet?.lockedBalance ?? 0),
  pendingWinnings: roundAmount(wallet?.pendingWinnings ?? 0),
  lockedEntries: wallet?.lockedEntries && typeof wallet.lockedEntries === 'object' ? wallet.lockedEntries : {},
  transactions: Array.isArray(wallet?.transactions) ? wallet.transactions : [],
});

const sanitizeUserPayload = (payload) => {
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

const getUserRowById = (userId) =>
  localDb
    .prepare(
      `
        SELECT payload
        FROM app_users
        WHERE id = ?
      `
    )
    .get(userId);

export const getUserById = (userId) => {
  if (!userId) return null;
  const row = getUserRowById(userId);
  return row ? sanitizeUserPayload(JSON.parse(row.payload)) : null;
};

const findUserRowByIdentifier = (identifier) => {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const pseudoKey = normalizePseudoKey(trimmed);
  const emailKey = normalizeEmailKey(trimmed);
  const phoneKey = normalizePhoneKey(trimmed);

  return localDb
    .prepare(
      `
        SELECT id, password_hash AS passwordHash, payload
        FROM app_users
        WHERE pseudo_key = ?
           OR email_key = ?
           OR phone_key = ?
      `
    )
    .get(pseudoKey, emailKey, phoneKey);
};

const ensureUniqueRegistration = ({ pseudo, email, phone, gameId }) => {
  const duplicate = db
    .prepare(
      `
        SELECT
          pseudo_key AS pseudoKey,
          email_key AS emailKey,
          phone_key AS phoneKey,
          game_id_key AS gameIdKey
        FROM app_users
        WHERE pseudo_key = ?
           OR email_key = ?
           OR phone_key = ?
           OR game_id_key = ?
        LIMIT 1
      `
    )
    .get(
      normalizePseudoKey(pseudo),
      normalizeEmailKey(email),
      normalizePhoneKey(phone),
      normalizeGameIdKey(gameId)
    );

  if (!duplicate) return;

  if (duplicate.pseudoKey === normalizePseudoKey(pseudo)) {
    throw makeError('DUPLICATE_PSEUDO', 'Ce pseudo CODM est deja utilise sur ZOYD.');
  }
  if (duplicate.emailKey === normalizeEmailKey(email)) {
    throw makeError('DUPLICATE_EMAIL', 'Cet email est deja rattache a un compte ZOYD.');
  }
  if (duplicate.phoneKey === normalizePhoneKey(phone)) {
    throw makeError('DUPLICATE_PHONE', 'Ce numero est deja rattache a un compte ZOYD.');
  }
  if (duplicate.gameIdKey === normalizeGameIdKey(gameId)) {
    throw makeError('DUPLICATE_GAME_ID', 'Cet UID CODM est deja verifie sur la plateforme.');
  }
};

const buildUserPayload = (input, role = 'player') => {
  const now = getNow();
  const streamerMode = Boolean(input.streamerMode);
  const wallet = normalizeWalletSnapshot(
    input.wallet || {
      ...defaultWallet,
      cashBalance: input.walletBalance || 0,
    }
  );

  return {
    id: input.id,
    role,
    pseudo: input.pseudo.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    gameId: input.gameId.trim(),
    controllerType: input.controllerType || 'touch',
    device: input.device || 'phone',
    levelCODM: Number(input.levelCODM || 1),
    rankMJ: input.rankMJ || 'Bronze',
    rankBR: input.rankBR || 'Bronze',
    country: input.country || 'Benin',
    streamerPseudo: streamerMode ? input.streamerPseudo?.trim() || '' : '',
    streamerMode,
    wallet,
    walletBalance: roundAmount(wallet.cashBalance + wallet.bonusBalance),
    trustScore: Number(input.trustScore || 100),
    stats: input.stats || defaultStats,
    progression: input.progression || defaultProgression,
    achievements: input.achievements || [],
    bio: input.bio || '',
    dateJoined: input.dateJoined || now,
    avatar: input.avatar,
    isOnline: false,
    lastSeen: now,
  };
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
  const updatedAt = getNow();

  localDb.prepare(
    `
      INSERT INTO app_users (
        id,
        pseudo_key,
        email_key,
        phone_key,
        game_id_key,
        role,
        password_hash,
        payload,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    normalizePseudoKey(payload.pseudo),
    normalizeEmailKey(payload.email),
    normalizePhoneKey(payload.phone),
    normalizeGameIdKey(payload.gameId),
    role,
    passwordHash,
    JSON.stringify(payload),
    createdAt,
    updatedAt
  );

  supabase.from('app_users').upsert({
    id,
    pseudo_key: normalizePseudoKey(payload.pseudo),
    email_key: normalizeEmailKey(payload.email),
    phone_key: normalizePhoneKey(payload.phone),
    game_id_key: normalizeGameIdKey(payload.gameId),
    role,
    password_hash: passwordHash,
    payload,
    created_at: createdAt,
    updated_at: updatedAt
  }).then(({ error }) => { if (error) console.error('Supabase app_users sync error:', error); });

  return sanitizeUserPayload(payload);
};

export const updateUserAccount = (userId, updater) => {
  const row = getUserRowById(userId);
  if (!row) {
    throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');
  }

  const currentPayload = sanitizeUserPayload(JSON.parse(row.payload));
  const nextRawPayload = updater(structuredClone(currentPayload));
  const nextPayload = sanitizeUserPayload(nextRawPayload);

  localDb.prepare(
    `
      UPDATE app_users
      SET payload = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(JSON.stringify(nextPayload), getNow(), userId);

  supabase.from('app_users').update({
    payload: nextPayload,
    updated_at: getNow()
  }).eq('id', userId).then(({ error }) => { if (error) console.error('Supabase app_users update error:', error); });

  return nextPayload;
};

export const getWalletSnapshot = (userId) => getUserById(userId)?.wallet || normalizeWalletSnapshot(defaultWallet);

export const updateWalletSnapshot = (userId, updater) =>
  updateUserAccount(userId, (user) => {
    user.wallet = normalizeWalletSnapshot(updater(structuredClone(user.wallet || defaultWallet), structuredClone(user)));
    user.walletBalance = roundAmount(user.wallet.cashBalance + user.wallet.bonusBalance);
    return user;
  });

const createTokenRecord = (tableName, userId, extra = {}) => {
  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = getNow();
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  if (tableName === 'auth_sessions') {
    localDb.prepare(
      `
        INSERT INTO auth_sessions (token, user_id, issued_at, expires_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(token, userId, issuedAt, expiresAt);
    
    // Sync to Supabase
    supabase.from('auth_sessions').upsert({
      token,
      user_id: userId,
      issued_at: issuedAt,
      expires_at: expiresAt
    }).then(({ error }) => { if (error) console.error('Supabase auth_sessions sync error:', error); });
  } else {
    localDb.prepare(
      `
        INSERT INTO realtime_sessions (token, user_id, pseudo, role, issued_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(token, userId, extra.pseudo, extra.role, issuedAt, expiresAt);
    
    // Sync to Supabase
    supabase.from('realtime_sessions').upsert({
      token,
      user_id: userId,
      pseudo: extra.pseudo,
      role: extra.role,
      issued_at: issuedAt,
      expires_at: expiresAt
    }).then(({ error }) => { if (error) console.error('Supabase realtime_sessions sync error:', error); });
  }

  return {
    token,
    userId,
    issuedAt,
    expiresAt,
    ...extra,
  };
};

const ensureSeedAdmin = () => {
  const existingAdmin = localDb
    .prepare(
      `
        SELECT id
        FROM app_users
        WHERE email_key = ?
        LIMIT 1
      `
    )
    .get(normalizeEmailKey('admin@zoyd.com'));

  if (existingAdmin) return;

  insertUser({
    id: 'admin-zoyd-control',
    role: 'admin',
    pseudo: 'ZOYD Control',
    email: 'admin@zoyd.com',
    phone: '+22960000000',
    password: process.env.ZOYD_ADMIN_PASSWORD || 'Admin@ZOYD2026',
    gameId: 'ADMIN-ZOYD-0001',
    controllerType: 'touch',
    device: 'pc',
    levelCODM: 150,
    rankMJ: 'Legendary',
    rankBR: 'Legendary',
    country: 'Benin',
    walletBalance: 0,
    trustScore: 100,
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      totalMatches: 0,
      totalEarnings: 0,
      winRate: 0,
      tournamentsWon: 0,
      tournamentsPlayed: 0,
    },
    progression: {
      level: 'PRO',
      xp: 20000,
      nextLevelXp: 20000,
    },
    achievements: ['Control Room'],
    bio: 'Compte de moderation et de supervision ZOYD.',
    dateJoined: getNow(),
  });
};

ensureSeedAdmin();

export const getChatChannelById = (channelId) => {
  if (!channelId) return null;
  const row = getChatChannelRowById(channelId);
  return row ? normalizeChatChannelPayload(JSON.parse(row.payload)) : null;
};

export const getChatChannels = () =>
  db
    .prepare(
      `
        SELECT payload
        FROM chat_channels
        ORDER BY updated_at DESC, created_at DESC
      `
    )
    .all()
    .map((row) => normalizeChatChannelPayload(JSON.parse(row.payload)));

export const getChatChannelsForUser = (userId) =>
  getChatChannels().filter((channel) => channel.inbox === 'all' || channel.participants.includes(userId));

export const upsertChatChannel = (channel) => {
  const existing = getChatChannelById(channel.id);
  const next = normalizeChatChannelPayload({
    ...existing,
    ...channel,
    createdAt: existing?.createdAt || channel.createdAt || getNow(),
    updatedAt: channel.updatedAt || channel.lastMessageAt || getNow(),
    isMuted: existing?.isMuted || channel.isMuted,
  });

  localDb.prepare(
    `
      INSERT INTO chat_channels (id, type, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `
  ).run(next.id, next.type, JSON.stringify(next), next.createdAt, next.updatedAt);

  // Sync to Supabase
  supabase.from('chat_channels').upsert({
    id: next.id,
    type: next.type,
    payload: next,
    created_at: next.createdAt,
    updated_at: next.updatedAt
  }).then(({ error }) => { if (error) console.error('Supabase chat_channels sync error:', error); });

  return next;
};

export const appendChatMessage = (message) => {
  const channel = getChatChannelById(message.channelId);
  if (!channel) {
    throw makeError('CHANNEL_NOT_FOUND', 'Canal de discussion introuvable.');
  }

  const nextMessage = normalizeChatMessagePayload({
    ...message,
    channelType: message.channelType || channel.type,
    timestamp: message.timestamp || getNow(),
  });

  localDb.prepare(
    `
      INSERT INTO chat_messages (id, channel_id, payload, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload
    `
  ).run(nextMessage.id, nextMessage.channelId, JSON.stringify(nextMessage), nextMessage.timestamp);

  // Sync to Supabase
  supabase.from('chat_messages').upsert({
    id: nextMessage.id,
    channel_id: nextMessage.channelId,
    payload: nextMessage,
    created_at: nextMessage.timestamp
  }).then(({ error }) => { if (error) console.error('Supabase chat_messages sync error:', error); });

  upsertChatChannel({
    ...channel,
    lastMessageAt: nextMessage.timestamp,
    updatedAt: nextMessage.timestamp,
  });

  return nextMessage;
};

export const getChatMessagesForChannel = (channelId, limit = 200) =>
  db
    .prepare(
      `
        SELECT payload
        FROM (
          SELECT payload, created_at
          FROM chat_messages
          WHERE channel_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        )
        ORDER BY created_at ASC
      `
    )
    .all(channelId, Math.max(1, Number(limit || 200)))
    .map((row) => normalizeChatMessagePayload(JSON.parse(row.payload)));

export const getChatReadMapForUser = (userId) =>
  Object.fromEntries(
    db
      .prepare(
        `
          SELECT channel_id AS channelId, read_at AS readAt
          FROM chat_reads
          WHERE user_id = ?
        `
      )
      .all(userId)
      .map((row) => [row.channelId, row.readAt])
  );

export const markChatChannelRead = (channelId, userId, readAt = getNow()) => {
  localDb.prepare(
    `
      INSERT INTO chat_reads (channel_id, user_id, read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(channel_id, user_id) DO UPDATE SET
        read_at = excluded.read_at
    `
  ).run(channelId, userId, readAt);

  // Sync to Supabase
  supabase.from('chat_reads').upsert({
    channel_id: channelId,
    user_id: userId,
    read_at: readAt
  }).then(({ error }) => { if (error) console.error('Supabase chat_reads sync error:', error); });

  return {
    channelId,
    userId,
    readAt,
  };
};

export const getUnreadCountForUser = (channelId, userId) => {
  const readAt = getChatReadAt(channelId, userId) || '1970-01-01T00:00:00.000Z';
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM chat_messages
        WHERE channel_id = ?
          AND created_at > ?
      `
    )
    .get(channelId, readAt);

  const messages = getChatMessagesForChannel(channelId, Number(row?.total || 0) || 1);
  return messages.filter((message) => message.senderId !== userId).length;
};

export const ensureGlobalChatChannel = () =>
  upsertChatChannel({
    id: 'global',
    type: 'global',
    name: 'Chat Global ZOYD',
    participants: [],
    unreadCount: 0,
    isMuted: false,
    scope: 'public',
    inbox: 'all',
    createdAt: getNow(),
    updatedAt: getNow(),
  });

ensureGlobalChatChannel();

export const createUserAccount = (payload) => insertUser(payload);

export const authenticateUserAccount = ({ identifier, password }) => {
  const row = findUserRowByIdentifier(identifier);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');
  }

  return sanitizeUserPayload(JSON.parse(row.payload));
};

export const createAuthSession = (userId) => {
  cleanupExpiredAuthSessions();
  const session = createTokenRecord('auth_sessions', userId);
  return {
    ...session,
    user: getUserById(userId),
  };
};

export const getAuthSession = (token) => {
  cleanupExpiredAuthSessions();
  if (!token) return null;

  const row = db
    .prepare(
      `
        SELECT token, user_id AS userId, issued_at AS issuedAt, expires_at AS expiresAt
        FROM auth_sessions
        WHERE token = ?
      `
    )
    .get(token);

  if (!row) return null;

  const user = getUserById(row.userId);
  if (!user) {
    localDb.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    ...row,
    user,
  };
};

export const deleteAuthSession = (token) => {
  localDb.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  
  // Sync to Supabase
  supabase.from('auth_sessions').delete().eq('token', token)
    .then(({ error }) => { if (error) console.error('Supabase auth_sessions delete error:', error); });
};

export const createRealtimeSession = ({ userId, pseudo, role }) => {
  cleanupExpiredRealtimeSessions();
  return createTokenRecord('realtime_sessions', userId, { pseudo, role });
};

export const getRealtimeSession = (token) => {
  cleanupExpiredRealtimeSessions();
  if (!token) return null;

  const row = db
    .prepare(
      `
        SELECT token, user_id AS userId, pseudo, role, issued_at AS issuedAt, expires_at AS expiresAt
        FROM realtime_sessions
        WHERE token = ?
      `
    )
    .get(token);

  return row || null;
};

export const deleteRealtimeSession = (token) => {
  localDb.prepare('DELETE FROM realtime_sessions WHERE token = ?').run(token);
  
  // Sync to Supabase
  supabase.from('realtime_sessions').delete().eq('token', token)
    .then(({ error }) => { if (error) console.error('Supabase realtime_sessions delete error:', error); });
};

export const deleteRealtimeSessionsForUser = (userId) => {
  localDb.prepare('DELETE FROM realtime_sessions WHERE user_id = ?').run(userId);
  
  // Sync to Supabase
  supabase.from('realtime_sessions').delete().eq('user_id', userId)
    .then(({ error }) => { if (error) console.error('Supabase realtime_sessions delete user error:', error); });
};

export const upsertPushSubscription = (userId, subscription) => {
  localDb.prepare(
    `
      INSERT INTO push_subscriptions (user_id, endpoint, payload, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `
  ).run(userId, subscription.endpoint, JSON.stringify(subscription), getNow());
  
  // Sync to Supabase
  supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    payload: subscription,
    updated_at: getNow()
  }).then(({ error }) => { if (error) console.error('Supabase push_subscriptions sync error:', error); });
};

export const removePushSubscription = (endpoint) => {
  localDb.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  
  // Sync to Supabase
  supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    .then(({ error }) => { if (error) console.error('Supabase push_subscriptions delete error:', error); });
};

export const getPushSubscriptionsForUser = (userId) =>
  localDb
    .prepare('SELECT payload FROM push_subscriptions WHERE user_id = ?')
    .all(userId)
    .map((row) => JSON.parse(row.payload));

export const countPushSubscriptions = () =>
  localDb.prepare('SELECT COUNT(*) AS total FROM push_subscriptions').get().total;

const getItemTimestamp = (item) => {
  if (typeof item?.updatedAt === 'string') return item.updatedAt;
  if (typeof item?.createdAt === 'string') return item.createdAt;
  return getNow();
};

export const replaceStateCollection = (kind, items) => {
  localDb.exec('BEGIN');
  try {
    const itemIds = new Set(items.map((item) => item.id));

    for (const item of items) {
      localDb.prepare(
        `
          INSERT INTO state_snapshots (kind, entity_id, payload, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(kind, entity_id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `
      ).run(kind, item.id, JSON.stringify(item), getItemTimestamp(item));
    }

    const existingIds = localDb.prepare('SELECT entity_id FROM state_snapshots WHERE kind = ?').all(kind);
    const deletedIds = [];
    for (const row of existingIds) {
      if (!itemIds.has(row.entity_id)) {
        localDb.prepare('DELETE FROM state_snapshots WHERE kind = ? AND entity_id = ?').run(kind, row.entity_id);
        deletedIds.push(row.entity_id);
      }
    }

    localDb.exec('COMMIT');

    // Supabase background sync
    if (items.length > 0) {
      supabase.from('state_snapshots').upsert(
        items.map(item => ({
          kind,
          entity_id: item.id,
          payload: item,
          updated_at: getItemTimestamp(item)
        }))
      ).then(({ error }) => { if (error) console.error('Supabase state_snapshots sync error:', error); });
    }
    if (deletedIds.length > 0) {
      supabase.from('state_snapshots').delete().eq('kind', kind).in('entity_id', deletedIds)
        .then(({ error }) => { if (error) console.error('Supabase state_snapshots delete error:', error); });
    }

  } catch (error) {
    localDb.exec('ROLLBACK');
    throw error;
  }
};

export const getStateCollection = (kind) =>
  localDb
    .prepare(
      `
        SELECT payload
        FROM state_snapshots
        WHERE kind = ?
        ORDER BY updated_at DESC
      `
    )
    .all(kind)
    .map((row) => JSON.parse(row.payload));
