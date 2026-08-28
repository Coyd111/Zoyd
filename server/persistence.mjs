// persistence.mjs — Supabase-primary with in-memory sync cache
// Replaces SQLite entirely. In-memory Maps serve synchronous reads,
// Supabase provides durable persistence. On startup, data loads from Supabase.

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
import { supabase } from './supabase.mjs';
import { createLogger } from './logger.mjs';
import { roundAmount, getNow, makeError } from './utils.mjs';
import { withUserMutex, withChannelMutex } from './mutex.mjs';

const log = createLogger('persistence');

// ─── In-memory caches ───────────────────────────────────────────────────────
const memoryUsers = new Map();
const memoryAuthSessions = new Map();
const memoryRealtimeSessions = new Map();
const memoryPushSubscriptions = new Map();
const memoryChatChannels = new Map();
const MAX_CHAT_CHANNELS = 1000;
const memoryChatMessages = new Map(); // channelId -> message[]
const memoryChatReads = new Map();    // `${channelId}:${userId}` -> readAt
const memoryStateSnapshots = new Map(); // `${kind}:${entityId}` -> payload (kept for compat)
const memoryStateByKind = new Map();   // kind -> Map<entityId, payload> (O(1) lookups)
const memoryAdminIds = new Set();     // fast admin lookup (avoids getAllUsers scan)
const memoryFriendRequests = new Map();
const memoryFriendships = new Set();   // `${uid1}:${uid2}`
const memoryFriendshipsByUser = new Map(); // userId -> Set<friendId> (O(1) lookups)
const memoryUserBlocks = new Set();    // `${blocker}:${blocked}`
const memoryBlocksByUser = new Map();  // userId -> Set<blockedId> (O(1) lookups)
const memoryNotifications = new Map(); // id -> notification
const memoryUnreadByUser = new Map();  // userId -> Set<notificationId> (O(1) unread lookups)
const memoryProcessedTransactions = new Set();
const MAX_PROCESSED_TX = 10000;

// ─── Helpers ────────────────────────────────────────────────────────────────
export { roundAmount, makeError };

/**
 * Sanitize user input to prevent XSS attacks
 * Removes HTML tags, javascript: protocols, and event handlers
 */
export const sanitizeText = (input) => {
  if (!input) return '';
  return String(input)
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')       // Remove SVG tags and content
    .replace(/<svg[\s\S]*?\/>/gi, '')           // Remove self-closing SVG tags
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '') // Remove iframe tags and content
    .replace(/<iframe[\s\S]*?\/>/gi, '')        // Remove self-closing iframe tags
    .replace(/<object[\s\S]*?<\/object>/gi, '') // Remove object tags and content
    .replace(/<object[\s\S]*?\/>/gi, '')        // Remove self-closing object tags
    .replace(/<embed[\s\S]*?\/?>/gi, '')        // Remove embed tags
    .replace(/<script[\s\S]*?<\/script>/gi, '') // Remove script tags
    .replace(/<style[\s\S]*?<\/style>/gi, '')   // Remove style tags
    .replace(/<[^>]*>/g, '')                    // Remove remaining HTML tags
    .replace(/javascript:/gi, '')               // Remove javascript: protocol
    .replace(/vbscript:/gi, '')                 // Remove vbscript: protocol
    .replace(/data:(?!image\/)/gi, '')          // Remove data: URIs except images
    .replace(/on\w+\s*=/gi, '')                 // Remove event handlers (e.g. onclick=)
    .trim()
    .slice(0, 5000);                            // Limit length
};

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
  };
};

export const sanitizePublicUserPayload = (payload) => {
  if (!payload) return null;
  const { wallet, walletBalance, email, phone, ...publicFields } = payload;
  return {
    ...publicFields,
    trustScore: Number(payload.trustScore || 0),
    levelCODM: Number(payload.levelCODM || 1),
  };
};

export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  // NOTE: Salt is passed as hex string (UTF-8), not as Buffer.
  // This reduces effective entropy but is consistent between hash and verify.
  const digest = (await scryptAsync(password, salt, 64)).toString('hex');
  return `${salt}:${digest}`;
};

export const verifyPassword = async (password, passwordHash) => {
  if (!passwordHash?.includes(':')) return false;
  const [salt, expectedDigest] = passwordHash.split(':');
  // NOTE: Uses same hex string salt as hashPassword for consistency.
  const actualDigest = (await scryptAsync(password, salt, 64)).toString('hex');
  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  const actualBuffer = Buffer.from(actualDigest, 'hex');
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

// ─── Supabase helpers ───────────────────────────────────────────────────────
export const sbUpsert = async (table, data) => {
  if (!supabase) return;
  const { error } = await supabase.from(table).upsert(data);
  if (error) {
    log.error(`${table} upsert error`, { message: error.message, code: error.code, detail: error.detail });
    return false;
  }
  return true;
};

const sbDelete = async (table, filters) => {
  if (!supabase) return;
  let q = supabase.from(table).delete();
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { error } = await q;
  if (error) log.error(`${table} delete error`, { message: error.message });
};

const sbDeleteMulti = async (table, col, values) => {
  if (!supabase || values.length === 0) return;
  const { error } = await supabase.from(table).delete().in(col, values);
  if (error) log.error(`${table} delete-in error`, { message: error.message });
};

const sbSelect = async (table, filters = {}, columns = '*') => {
  if (!supabase) return [];
  let q = supabase.from(table).select(columns);
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { data, error } = await q;
  if (error) {
    log.error(`${table} select error`, { message: error.message });
    return [];
  }
  return data || [];
};

// ─── Load from Supabase on startup ──────────────────────────────────────────
export const loadFromSupabase = async () => {
  if (!supabase) {
    log.warn('No Supabase client — running from memory only');
    await ensureSeedAdmin();
    ensureGlobalChatChannel();
    return false;
  }

  log.info('Loading from Supabase...');
  const t0 = Date.now();

  try {
    // Users
    const { data: users, error: usersErr } = await supabase.from('app_users').select('*');
    if (usersErr) {
      log.error('Failed to load users from Supabase', { message: usersErr.message, code: usersErr.code });
      throw usersErr;
    }
    if (users) {
      for (const row of users) {
        memoryUsers.set(row.id, sanitizeUserPayload(row.payload));
        if (row.role === 'admin') memoryAdminIds.add(row.id);
        if (row.password_hash) {
          storePasswordHash(row.id, row.password_hash, row.payload?.pseudo, row.payload?.email, row.payload?.phone);
        }
      }
    }
    log.info('Users loaded', { count: memoryUsers.size });

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

    // State snapshots (populate both old flat map and new per-kind map)
    const { data: snapshots } = await supabase.from('state_snapshots').select('*');
    if (snapshots) {
      for (const snap of snapshots) {
        memoryStateSnapshots.set(`${snap.kind}:${snap.entity_id}`, snap.payload);
        if (!memoryStateByKind.has(snap.kind)) memoryStateByKind.set(snap.kind, new Map());
        memoryStateByKind.get(snap.kind).set(snap.entity_id, snap.payload);
      }
    }

    // Friend requests
    const { data: friendReqs } = await supabase.from('friend_requests').select('*');
    if (friendReqs) {
      for (const fr of friendReqs) {
        memoryFriendRequests.set(fr.id, fr);
      }
    }

    // Friendships (populate both Set and per-user index)
    const { data: friendships } = await supabase.from('friendships').select('*');
    if (friendships) {
      for (const f of friendships) {
        memoryFriendships.add(`${f.user_id_1}:${f.user_id_2}`);
        if (!memoryFriendshipsByUser.has(f.user_id_1)) memoryFriendshipsByUser.set(f.user_id_1, new Set());
        memoryFriendshipsByUser.get(f.user_id_1).add(f.user_id_2);
      }
    }

    // Blocks (populate both Set and per-user index)
    const { data: blocks } = await supabase.from('user_blocks').select('*');
    if (blocks) {
      for (const b of blocks) {
        memoryUserBlocks.add(`${b.blocker_id}:${b.blocked_id}`);
        if (!memoryBlocksByUser.has(b.blocker_id)) memoryBlocksByUser.set(b.blocker_id, new Set());
        memoryBlocksByUser.get(b.blocker_id).add(b.blocked_id);
      }
    }

    // Notifications (populate both map and per-user unread index)
    const { data: notifs } = await supabase.from('user_notifications').select('*').order('created_at', { ascending: false }).limit(5000);
    if (notifs) {
      for (const n of notifs) {
        memoryNotifications.set(n.id, {
          id: n.id, userId: n.user_id, type: n.type, title: n.title,
          message: n.message, priority: n.priority, actionUrl: n.action_url,
          metadata: n.metadata, isRead: n.is_read, createdAt: n.created_at,
        });
        if (!n.is_read) {
          if (!memoryUnreadByUser.has(n.user_id)) memoryUnreadByUser.set(n.user_id, new Set());
          memoryUnreadByUser.get(n.user_id).add(n.id);
        }
      }
    }

    // Push subscriptions
    const { data: subs } = await supabase.from('push_subscriptions').select('*');
    if (subs) {
      for (const s of subs) {
        memoryPushSubscriptions.set(s.endpoint, s.payload);
      }
    }

    // Processed transactions (FedaPay idempotency)
    const { data: processed } = await supabase.from('processed_transactions').select('transaction_id');
    if (processed) {
      for (const p of processed) {
        memoryProcessedTransactions.add(p.transaction_id);
      }
    }

    log.info('Loaded from Supabase', { durationMs: Date.now() - t0, users: memoryUsers.size, channels: memoryChatChannels.size, snapshots: memoryStateSnapshots.size });
  } catch (err) {
    log.error('Error loading from Supabase', { message: err.message, stack: err.stack });
  }

  await ensureSeedAdmin();
  ensureGlobalChatChannel();
  return memoryUsers.size > 0;
};

// Retry wrapper — retries up to 3 times with exponential backoff
export const loadFromSupabaseWithRetry = async (maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ok = await loadFromSupabase();
    if (ok) return true;
    if (attempt < maxRetries) {
      const delay = attempt * 3000;
      log.warn(`Load attempt ${attempt}/${maxRetries} failed — retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  log.error(`All ${maxRetries} load attempts failed — running with empty state`);
  return false;
};

// Force reload from Supabase (admin endpoint)
export const forceReloadFromSupabase = async () => {
  memoryUsers.clear();
  memoryAdminIds.clear();
  memoryPasswordHashes.clear();
  memoryAuthSessions.clear();
  memoryRealtimeSessions.clear();
  memoryChatChannels.clear();
  memoryChatMessages.clear();
  memoryStateSnapshots.clear();
  memoryStateByKind.clear();
  memoryFriendRequests.clear();
  memoryFriendships.clear();
  memoryFriendshipsByUser.clear();
  memoryUserBlocks.clear();
  memoryBlocksByUser.clear();
  memoryNotifications.clear();
  memoryUnreadByUser.clear();
  memoryProcessedTransactions.clear();
  memoryPushSubscriptions.clear();
  return await loadFromSupabase();
};

// Health check info
export const getHealthInfo = () => ({
  supabaseConnected: !!supabase,
  usersInMemory: memoryUsers.size,
  adminsInMemory: memoryAdminIds.size,
  channelsInMemory: memoryChatChannels.size,
  snapshotsInMemory: memoryStateSnapshots.size,
});

// Verify data integrity — compares memory count vs Supabase count (cached 60s)
let integrityCache = null;
let integrityCacheAt = 0;
const INTEGRITY_CACHE_TTL = 60_000;

export const verifyDataIntegrity = async () => {
  const now = Date.now();
  if (integrityCache && now - integrityCacheAt < INTEGRITY_CACHE_TTL) {
    return integrityCache;
  }

  if (!supabase) return { ok: false, reason: 'No Supabase client' };

  try {
    const { count: dbUserCount, error } = await supabase
      .from('app_users')
      .select('*', { count: 'exact', head: true });

    if (error) return { ok: false, reason: error.message };

    const memoryCount = memoryUsers.size;
    const match = memoryCount === dbUserCount;

    if (!match) {
      log.error('DATA INTEGRITY MISMATCH', {
        memoryUsers: memoryCount,
        dbUsers: dbUserCount,
        diff: dbUserCount - memoryCount,
      });
    } else {
      log.info('Data integrity OK', { users: memoryCount });
    }

    integrityCache = { ok: match, memoryUsers: memoryCount, dbUsers: dbUserCount };
    integrityCacheAt = now;
    return integrityCache;
  } catch (err) {
    return { ok: false, reason: err.message };
  }
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

import { Mutex } from 'async-mutex';
const registrationMutex = new Mutex();

const ensureUniqueRegistration = ({ pseudo, email, phone, gameId }) => {
  const pk = normalizePseudoKey(pseudo);
  const ek = normalizeEmailKey(email);
  const phk = normalizePhoneKey(phone);
  const gk = normalizeGameIdKey(gameId);

  // O(1) lookups via password hash index (keys are normalized identifiers)
  if (memoryPasswordHashes.has(pk)) throw makeError('DUPLICATE_PSEUDO', 'Ce pseudo CODM est deja utilise sur ZOYD.');
  if (memoryPasswordHashes.has(ek)) throw makeError('DUPLICATE_EMAIL', 'Cet email est deja rattache a un compte ZOYD.');
  if (memoryPasswordHashes.has(phk)) throw makeError('DUPLICATE_PHONE', 'Ce numero est deja rattache a un compte ZOYD.');

  // gameId check still needs linear scan (not indexed in passwordHashes)
  for (const user of memoryUsers.values()) {
    if (normalizeGameIdKey(user.gameId) === gk) throw makeError('DUPLICATE_GAME_ID', 'Cet UID CODM est deja verifie sur la plateforme.');
  }
};

const insertUser = async ({ password, role = 'player', ...input }) => {
  if (!input.pseudo?.trim() || !input.email?.trim() || !input.phone?.trim() || !input.gameId?.trim()) {
    throw makeError('INVALID_REGISTRATION', 'Informations joueur incompletes.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw makeError('INVALID_REGISTRATION', 'Le mot de passe doit contenir au moins 8 caracteres.');
  }

  const release = await registrationMutex.acquire();
  try {
    ensureUniqueRegistration(input);

    const id = input.id || crypto.randomUUID();
    const createdAt = input.dateJoined || getNow();
    const payload = buildUserPayload({ ...input, id, dateJoined: createdAt, isActive: true }, role);
    const passwordHash = await hashPassword(password);

    // Write to memory
    memoryUsers.set(id, payload);
    if (role === 'admin') memoryAdminIds.add(id);
    storePasswordHash(id, passwordHash, payload.pseudo, payload.email, payload.phone);

    // Write to Supabase
    await sbUpsert('app_users', {
      id, pseudo_key: normalizePseudoKey(payload.pseudo),
      email_key: normalizeEmailKey(payload.email), phone_key: normalizePhoneKey(payload.phone),
      game_id_key: normalizeGameIdKey(payload.gameId), role,
      password_hash: passwordHash, payload,
      created_at: createdAt, updated_at: createdAt,
    });

  return sanitizeUserPayload(payload);
  } finally {
    release();
  }
};

export const getUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  return user ? sanitizeUserPayload(user) : null;
};

export const getPublicUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  return user ? sanitizePublicUserPayload(user) : null;
};

export const getRawUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  if (!user) return null;
  const hashEntry = memoryPasswordHashes.get(userId);
  return { ...user, passwordHash: hashEntry?.[1] || '' };
};

export const findUsersByPseudo = (query, limit = 20) => {
  const q = normalizePseudoKey(query);
  if (!q) return [];
  const results = [];
  for (const user of memoryUsers.values()) {
    if (normalizePseudoKey(user.pseudo).includes(q)) {
      results.push(sanitizePublicUserPayload(user));
      if (results.length >= limit) break;
    }
  }
  return results;
};

export const getAllUsers = () => {
  return Array.from(memoryUsers.values()).map(sanitizeUserPayload);
};

export const getAdminIds = () => {
  return [...memoryAdminIds];
};

// ─── Leaderboard cache (refreshes every 60s) ────────────────────────────────
let leaderboardCache = null;
let leaderboardCacheAt = 0;
const LEADERBOARD_CACHE_TTL = 60_000;

export const getLeaderboard = () => {
  const now = Date.now();
  if (leaderboardCache && now - leaderboardCacheAt < LEADERBOARD_CACHE_TTL) {
    return leaderboardCache;
  }
  const allUsers = Array.from(memoryUsers.values()).map(sanitizeUserPayload);
  leaderboardCache = allUsers
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
  leaderboardCacheAt = now;
  return leaderboardCache;
};

export const updateUserAccount = async (userId, updater) => {
  return withUserMutex(userId, async () => {
    const current = memoryUsers.get(userId);
    if (!current) throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');

    const next = sanitizeUserPayload(updater(structuredClone(sanitizeUserPayload(current))));
    memoryUsers.set(userId, next);

    // Track admin role changes
    if (next.role === 'admin') memoryAdminIds.add(userId);
    else memoryAdminIds.delete(userId);

    // Clean up old password hash lookup entries when pseudo/email/phone change
    const oldPseudoKey = normalizePseudoKey(current.pseudo);
    const oldEmailKey = normalizeEmailKey(current.email);
    const oldPhoneKey = normalizePhoneKey(current.phone);
    const newPseudoKey = normalizePseudoKey(next.pseudo);
    const newEmailKey = normalizeEmailKey(next.email);
    const newPhoneKey = normalizePhoneKey(next.phone);
    if (oldPseudoKey !== newPseudoKey) memoryPasswordHashes.delete(oldPseudoKey);
    if (oldEmailKey !== newEmailKey) memoryPasswordHashes.delete(oldEmailKey);
    if (oldPhoneKey !== newPhoneKey) memoryPasswordHashes.delete(oldPhoneKey);

    const passwordHash = memoryPasswordHashes.get(userId)?.[1] || '';

    sbUpsert('app_users', {
      id: userId, pseudo_key: normalizePseudoKey(next.pseudo),
      email_key: normalizeEmailKey(next.email), phone_key: normalizePhoneKey(next.phone),
      game_id_key: normalizeGameIdKey(next.gameId), role: next.role,
      password_hash: passwordHash, payload: next,
      created_at: current.dateJoined, updated_at: getNow(),
    });

    return next;
  });
};

export const getWalletSnapshot = (userId) => getUserById(userId)?.wallet || normalizeWalletSnapshot(defaultWallet);

export const updateWalletSnapshot = async (userId, updater) =>
  updateUserAccount(userId, (user) => {
    user.wallet = normalizeWalletSnapshot(updater(structuredClone(user.wallet || defaultWallet), structuredClone(user)));
    user.walletBalance = roundAmount(user.wallet.cashBalance + user.wallet.bonusBalance);
    return user;
  });

export const createUserAccount = async (payload) => await insertUser(payload);

export const authenticateUserAccount = async ({ identifier, password }) => {
  const trimmed = identifier.trim();
  const pk = normalizePseudoKey(trimmed);
  const ek = normalizeEmailKey(trimmed);
  const phk = normalizePhoneKey(trimmed);

  const hash = memoryPasswordHashes.get(pk) || memoryPasswordHashes.get(ek) || memoryPasswordHashes.get(phk);
  if (!hash) throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');

  const [userId, passwordHash] = hash;
  if (!(await verifyPassword(password, passwordHash))) {
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

export const updatePasswordHash = (userId, newHash) => {
  const user = memoryUsers.get(userId);
  if (!user) return;
  // Clear old hash entries
  memoryPasswordHashes.delete(userId);
  if (user.pseudo) memoryPasswordHashes.delete(normalizePseudoKey(user.pseudo));
  if (user.email) memoryPasswordHashes.delete(normalizeEmailKey(user.email));
  if (user.phone) memoryPasswordHashes.delete(normalizePhoneKey(user.phone));
  // Store new hash
  storePasswordHash(userId, newHash, user.pseudo, user.email, user.phone);
  // Persist to Supabase
  sbUpsert('app_users', {
    id: userId,
    pseudo_key: normalizePseudoKey(user.pseudo),
    email_key: normalizeEmailKey(user.email),
    phone_key: normalizePhoneKey(user.phone),
    game_id_key: normalizeGameIdKey(user.gameId),
    role: user.role,
    password_hash: newHash,
    payload: user,
    created_at: user.dateJoined,
    updated_at: getNow(),
  });
};

// ─── Account Activation Codes ─────────────────────────────────────────────────
const memoryActivationCodes = new Map(); // email -> { code, expiresAt, userId, attempts }
const ACTIVATION_CODE_MAX_LENGTH = 8;
const ACTIVATION_CODE_MAX_ATTEMPTS = 5;
const ACTIVATION_CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export const generateActivationCode = (email, userId) => {
  const max = Math.pow(10, ACTIVATION_CODE_MAX_LENGTH);
  const code = crypto.randomInt(0, max).toString().padStart(ACTIVATION_CODE_MAX_LENGTH, '0');
  const expiresAt = new Date(Date.now() + ACTIVATION_CODE_EXPIRY_MS).toISOString();
  memoryActivationCodes.set(email, { code, expiresAt, userId, attempts: 0 });
  return code;
};

export const verifyActivationCode = (email, code) => {
  const record = memoryActivationCodes.get(email);
  if (!record) return { valid: false, error: 'Code invalide ou expire.' };

  const expected = Buffer.from(record.code, 'utf-8');
  const actual = Buffer.from(code, 'utf-8');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts >= ACTIVATION_CODE_MAX_ATTEMPTS) {
      memoryActivationCodes.delete(email);
      return { valid: false, error: 'Trop de tentatives. Demande un nouveau code.' };
    }
    return { valid: false, error: 'Code incorrect.' };
  }

  if (new Date(record.expiresAt) < new Date()) {
    memoryActivationCodes.delete(email);
    return { valid: false, error: 'Code expire.' };
  }

  // Atomic: delete immediately after successful verification
  memoryActivationCodes.delete(email);
  return { valid: true, userId: record.userId };
};

export const cleanupExpiredActivationCodes = () => {
  const now = new Date();
  for (const [email, record] of memoryActivationCodes) {
    if (new Date(record.expiresAt) < now) {
      memoryActivationCodes.delete(email);
    }
  }
};

export const activateUserAccount = (userId) => {
  const user = memoryUsers.get(userId);
  if (!user) throw new Error('Utilisateur introuvable.');
  
  user.isActive = true;
  user.activatedAt = getNow();
  
  // Update in Supabase
  sbUpsert('app_users', {
    id: userId,
    payload: user,
    updated_at: getNow(),
  });
  
  return user;
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

// Timer-based session cleanup (every 5 minutes instead of per-request)
setInterval(() => {
  cleanupExpired(memoryAuthSessions);
  cleanupExpired(memoryRealtimeSessions);
}, 5 * 60 * 1000);

export const createAuthSession = (userId) => {
  const session = createTokenRecord('auth', userId);
  return { ...session, user: getUserById(userId) };
};

export const getAuthSession = (token) => {
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
  return createTokenRecord('realtime', userId, { pseudo, role });
};

export const getRealtimeSession = (token) => {
  return token ? memoryRealtimeSessions.get(token) || null : null;
};

export const deleteRealtimeSession = (token) => {
  memoryRealtimeSessions.delete(token);
  sbDelete('realtime_sessions', { token });
};

export const deleteRealtimeSessionsForUser = (userId) => {
  const tokensToDelete = [];
  for (const [token, session] of memoryRealtimeSessions) {
    if (session.userId === userId) tokensToDelete.push(token);
  }
  for (const token of tokensToDelete) {
    memoryRealtimeSessions.delete(token);
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
  text: sanitizeText(`${message?.text || ''}`.trim()),
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

  // Evict oldest entries when limit is exceeded
  if (memoryChatChannels.size > MAX_CHAT_CHANNELS) {
    const entries = [...memoryChatChannels.entries()]
      .sort((a, b) => new Date(a[1].updatedAt || 0) - new Date(b[1].updatedAt || 0));
    const toEvict = entries.slice(0, memoryChatChannels.size - MAX_CHAT_CHANNELS);
    for (const [id] of toEvict) {
      if (id === 'global') continue;
      memoryChatChannels.delete(id);
    }
  }

  sbUpsert('chat_channels', { id: next.id, type: next.type, payload: next, created_at: next.createdAt, updated_at: next.updatedAt });
  return next;
};

export const appendChatMessage = async (message) => {
  return withChannelMutex(message.channelId, async () => {
    const channel = getChatChannelById(message.channelId);
    if (!channel) throw makeError('CHANNEL_NOT_FOUND', 'Canal de discussion introuvable.');

    const nextMessage = normalizeChatMessagePayload({
      ...message, channelType: message.channelType || channel.type, timestamp: message.timestamp || getNow(),
    });

    const msgs = memoryChatMessages.get(nextMessage.channelId) || [];
    msgs.push(nextMessage);
    if (msgs.length > 500) msgs.splice(0, msgs.length - 500);
    memoryChatMessages.set(nextMessage.channelId, msgs);

    sbUpsert('chat_messages', { id: nextMessage.id, channel_id: nextMessage.channelId, payload: nextMessage, created_at: nextMessage.timestamp });
    upsertChatChannel({ ...channel, lastMessageAt: nextMessage.timestamp, updatedAt: nextMessage.timestamp });

    return nextMessage;
  });
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
export const replaceStateCollection = async (kind, items) => {
  const itemIds = new Set(items.map((item) => item.id));
  if (!memoryStateByKind.has(kind)) memoryStateByKind.set(kind, new Map());
  const kindMap = memoryStateByKind.get(kind);

  // Update memory (both flat and per-kind maps)
  for (const item of items) {
    memoryStateSnapshots.set(`${kind}:${item.id}`, item);
    kindMap.set(item.id, item);
  }

  // Remove stale
  const idsToDelete = [];
  for (const id of kindMap.keys()) {
    if (!itemIds.has(id)) idsToDelete.push(id);
  }
  for (const id of idsToDelete) {
    memoryStateSnapshots.delete(`${kind}:${id}`);
    kindMap.delete(id);
  }

  // Sync to Supabase (batch upsert)
  if (items.length > 0 && supabase) {
    const rows = items.map(item => ({ kind, entity_id: item.id, payload: item, updated_at: getNow() }));
    for (let i = 0; i < rows.length; i += 100) {
      await sbUpsert('state_snapshots', rows.slice(i, i + 100));
    }
  }
};

// O(1) per-kind lookup — no full scan needed
export const getStateCollection = (kind) => {
  const kindMap = memoryStateByKind.get(kind);
  if (!kindMap) return [];
  return Array.from(kindMap.values());
};

// O(1) single entity lookup
export const getStateEntity = (kind, entityId) => {
  const kindMap = memoryStateByKind.get(kind);
  return kindMap ? kindMap.get(entityId) || null : null;
};

// Upsert a single entity (avoids full collection replacement)
export const upsertStateEntity = async (kind, entity) => {
  if (!memoryStateByKind.has(kind)) memoryStateByKind.set(kind, new Map());
  memoryStateByKind.get(kind).set(entity.id, entity);
  memoryStateSnapshots.set(`${kind}:${entity.id}`, entity);

  if (supabase) {
    await sbUpsert('state_snapshots', { kind, entity_id: entity.id, payload: entity, updated_at: getNow() });
  }
};

// ─── Social ─────────────────────────────────────────────────────────────────
export const getFriendRequestsForUser = (userId) => {
  const results = [];
  for (const fr of memoryFriendRequests.values()) {
    if (fr.target_id === userId || fr.sender_id === userId) results.push(fr);
  }
  return results;
};

// O(1) per-user friendship lookup via index
export const getFriendsForUser = (userId) => {
  const friendIds = memoryFriendshipsByUser.get(userId);
  if (!friendIds) return [];
  const friends = [];
  for (const friendId of friendIds) {
    const user = getPublicUserById(friendId);
    if (user) friends.push(user);
  }
  return friends;
};

// O(1) per-user block lookup via index
export const getBlockedUsers = (userId) => {
  const blockedIds = memoryBlocksByUser.get(userId);
  return blockedIds ? [...blockedIds] : [];
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

  // Update per-user friendship index
  if (!memoryFriendshipsByUser.has(req.sender_id)) memoryFriendshipsByUser.set(req.sender_id, new Set());
  if (!memoryFriendshipsByUser.has(req.target_id)) memoryFriendshipsByUser.set(req.target_id, new Set());
  memoryFriendshipsByUser.get(req.sender_id).add(req.target_id);
  memoryFriendshipsByUser.get(req.target_id).add(req.sender_id);

  sbUpsert('friend_requests', req);
  sbUpsert('friendships', { user_id_1: req.sender_id, user_id_2: req.target_id, created_at: getNow() });
  sbUpsert('friendships', { user_id_1: req.target_id, user_id_2: req.sender_id, created_at: getNow() });

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
  // Update per-user friendship index
  memoryFriendshipsByUser.get(userId)?.delete(friendId);
  memoryFriendshipsByUser.get(friendId)?.delete(userId);
  sbDelete('friendships', { user_id_1: userId, user_id_2: friendId });
  sbDelete('friendships', { user_id_1: friendId, user_id_2: userId });

  for (const [id, fr] of memoryFriendRequests) {
    if ((fr.sender_id === userId && fr.target_id === friendId) || (fr.sender_id === friendId && fr.target_id === userId)) {
      memoryFriendRequests.delete(id);
    }
  }
};

export const blockUser = (blockerId, blockedId) => {
  if (blockerId === blockedId) throw makeError('SELF_BLOCK', 'Impossible de se bloquer soi-meme.');
  removeFriend(blockerId, blockedId);
  memoryUserBlocks.add(`${blockerId}:${blockedId}`);
  // Update per-user block index
  if (!memoryBlocksByUser.has(blockerId)) memoryBlocksByUser.set(blockerId, new Set());
  memoryBlocksByUser.get(blockerId).add(blockedId);
  sbUpsert('user_blocks', { blocker_id: blockerId, blocked_id: blockedId, created_at: getNow() });
};

export const unblockUser = (blockerId, blockedId) => {
  memoryUserBlocks.delete(`${blockerId}:${blockedId}`);
  memoryBlocksByUser.get(blockerId)?.delete(blockedId);
  sbDelete('user_blocks', { blocker_id: blockerId, blocked_id: blockedId });
};

// ─── Notifications ──────────────────────────────────────────────────────────
export const createNotification = (userId, type, title, message, priority, actionUrl, metadata) => {
  const id = `NOTIF-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().substring(0, 4)}`;
  const now = getNow();
  const notification = { id, userId, type, title, message, priority, actionUrl, metadata, isRead: false, createdAt: now };

  memoryNotifications.set(id, notification);
  // Update per-user unread index
  if (!memoryUnreadByUser.has(userId)) memoryUnreadByUser.set(userId, new Set());
  memoryUnreadByUser.get(userId).add(id);

  sbUpsert('user_notifications', {
    id, user_id: userId, type, title, message, priority,
    action_url: actionUrl || null, metadata: metadata || null,
    is_read: false, created_at: now,
  });

  return notification;
};

// O(1) per-user unread lookup via index
export const getUnreadNotificationsForUser = (userId) => {
  const unreadIds = memoryUnreadByUser.get(userId);
  if (!unreadIds) return [];
  const results = [];
  for (const id of unreadIds) {
    const n = memoryNotifications.get(id);
    if (n && !n.isRead) results.push(n);
  }
  return results;
};

export const markNotificationAsRead = (userId, notificationId) => {
  const n = memoryNotifications.get(notificationId);
  if (!n || n.userId !== userId) return false;
  n.isRead = true;
  memoryNotifications.set(notificationId, n);
  memoryUnreadByUser.get(userId)?.delete(notificationId);
  if (supabase) supabase.from('user_notifications').update({ is_read: true }).eq('id', notificationId).then(() => {}).catch((err) => log.warn('DB sync failed: mark notification read', { notificationId, error: err.message }));
  return true;
};

export const markAllNotificationsAsRead = (userId) => {
  let count = 0;
  const unreadIds = memoryUnreadByUser.get(userId);
  if (unreadIds) {
    for (const id of unreadIds) {
      const n = memoryNotifications.get(id);
      if (n && !n.isRead) { n.isRead = true; memoryNotifications.set(id, n); count++; }
    }
    unreadIds.clear();
  }
  if (supabase && count > 0) supabase.from('user_notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false).then(() => {}).catch((err) => log.warn('DB sync failed: mark all notifications read', { userId, error: err.message }));
  return count;
};

// ─── Memory Cleanup ──────────────────────────────────────────────────────────
export const cleanupMemoryChatReads = () => {
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  const cutoff = new Date(Date.now() - maxAge).toISOString();
  for (const [key, readAt] of memoryChatReads) {
    if (readAt < cutoff) memoryChatReads.delete(key);
  }
};

export const cleanupMemoryNotifications = () => {
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  const cutoff = new Date(Date.now() - maxAge).toISOString();
  for (const [id, n] of memoryNotifications) {
    if (n.isRead && n.createdAt < cutoff) memoryNotifications.delete(id);
  }
};

export const cleanupMemoryFriendRequests = () => {
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  const cutoff = new Date(Date.now() - maxAge).toISOString();
  for (const [id, fr] of memoryFriendRequests) {
    if ((fr.status === 'declined' || fr.status === 'cancelled') && fr.created_at < cutoff) {
      memoryFriendRequests.delete(id);
    }
  }
};

export const getMemoryChatChannels = () => memoryChatChannels;

// ─── FedaPay Transaction Idempotency ────────────────────────────────────────
export const hasTransactionBeenProcessed = async (transactionId) => {
  if (memoryProcessedTransactions.has(transactionId)) return true;
  // Fallback: check Supabase in case entry was evicted from memory
  try {
    const rows = await sbSelect('processed_transactions', { transaction_id: transactionId }, 'transaction_id');
    if (rows && rows.length > 0) {
      memoryProcessedTransactions.add(transactionId);
      return true;
    }
  } catch { /* ignore — will be caught by rate limit or processing check */ }
  return false;
};

export const markTransactionAsProcessed = async (transactionId, userId, amountZC) => {
  memoryProcessedTransactions.add(transactionId);
  if (memoryProcessedTransactions.size > MAX_PROCESSED_TX) {
    const first = memoryProcessedTransactions.values().next().value;
    memoryProcessedTransactions.delete(first);
  }
  await sbUpsert('processed_transactions', { transaction_id: transactionId, user_id: userId, amount_zc: amountZC });
};

// ─── Admin 2FA Persistence ─────────────────────────────────────────────────
export const saveAdminTotpSecret = async (userId, secret, enabled = false) => {
  await sbUpsert('admin_2fa_secrets', { user_id: userId, secret, enabled });
};

export const loadAdminTotpSecrets = async () => {
  const result = new Map();
  try {
    const rows = await sbSelect('admin_2fa_secrets');
    if (rows) {
      for (const row of rows) {
        result.set(row.user_id, { secret: row.secret, enabled: row.enabled, verifiedAt: null });
      }
    }
  } catch { /* table may not exist yet */ }
  return result;
};

// ─── Seed data ──────────────────────────────────────────────────────────────
const ensureSeedAdmin = async () => {
  const adminEmail = normalizeEmailKey('admin@zoyd.com');
  for (const user of memoryUsers.values()) {
    if (normalizeEmailKey(user.email) === adminEmail) return;
  }

  await insertUser({
    id: 'admin-zoyd-control', role: 'admin',
    pseudo: 'ZOYD Control', email: 'admin@zoyd.com', phone: '+22960000000',
    password: (() => {
      const pw = process.env.ZOYD_ADMIN_PASSWORD;
      if (!pw) {
        throw new Error('[FATAL] ZOYD_ADMIN_PASSWORD must be set.');
      }
      return pw;
    })(),
    gameId: 'ADMIN-ZOYD-0001', controllerType: 'touch', device: 'pc',
    levelCODM: 150, rankMJ: 'Legendary', rankBR: 'Legendary', country: 'Benin',
    walletBalance: 0, trustScore: 100,
    stats: { ...defaultStats }, progression: { level: 'PRO', xp: 20000, nextLevelXp: 20000 },
    achievements: ['Control Room'], bio: 'Compte de moderation ZOYD.',
  });
};
