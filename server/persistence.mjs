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
import { Mutex } from 'async-mutex';

const log = createLogger('persistence');

// ─── In-memory caches ───────────────────────────────────────────────────────
const memoryUsers = new Map();
const pseudoKeys = new Map(); // userId → normalized pseudo (avoids re-normalizing on search)
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
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<svg[\s\S]*?\/>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe[\s\S]*?\/>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<object[\s\S]*?\/>/gi, '')
    .replace(/<embed[\s\S]*?\/?>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/data:(?!image\/)/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
    .slice(0, 5000);
};

/**
 * Normalize a pseudo for case-insensitive, whitespace-insensitive lookup.
 * @param {string} value - Raw pseudo string
 * @returns {string} Trimmed, lowercased pseudo
 */
export const normalizePseudoKey = (value) => value.trim().toLowerCase();
/**
 * Normalize an email for case-insensitive lookup.
 * @param {string} value - Raw email string
 * @returns {string} Trimmed, lowercased email
 */
export const normalizeEmailKey = (value) => value.trim().toLowerCase();
/**
 * Normalize a phone number by stripping all non-digit characters.
 * @param {string} value - Raw phone string
 * @returns {string} Digits-only phone key
 */
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

/**
 * Hash a password using scrypt with a random 16-byte salt.
 * @param {string} password - Plaintext password
 * @returns {Promise<string>} Hash string in "salt:digest" hex format
 */
export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  // NOTE: Salt is passed as hex string (UTF-8), not as Buffer.
  // This reduces effective entropy but is consistent between hash and verify.
  const digest = (await scryptAsync(password, salt, 64)).toString('hex');
  return `${salt}:${digest}`;
};

/**
 * Verify a password against a stored "salt:digest" hash using timing-safe comparison.
 * @param {string} password - Plaintext password to verify
 * @param {string} passwordHash - Stored hash in "salt:digest" format
 * @returns {Promise<boolean>} True if password matches
 */
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
const sbCatch = (label, err) => { log.error(`[SB] ${label}`, { error: err?.message || String(err) }); };

/** Fire-and-forget: sbUpsert that won't throw even if unawaited. */
export const sbFire = (label, fn) => { fn().catch((e) => sbCatch(label, e)); };

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
/**
 * Load all data from Supabase into in-memory Maps on startup.
 * Populates users, sessions, chat, state snapshots, friends, blocks, notifications, etc.
 * @returns {Promise<boolean>} True if users were loaded successfully
 */
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
        const payload = sanitizeUserPayload(row.payload);
        memoryUsers.set(row.id, payload);
        pseudoKeys.set(row.id, normalizePseudoKey(payload.pseudo || ''));
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
/**
 * Load from Supabase with exponential backoff retry on failure.
 * @param {number} maxRetries - Maximum number of attempts (default 3)
 * @returns {Promise<boolean>} True if load succeeded within retries
 */
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
const reloadMutex = new Mutex();
let reloadInProgress = false;

export const isReloadInProgress = () => reloadInProgress;

/**
 * Force a full reload from Supabase, clearing all in-memory caches first.
 * Mutex-protected: only one reload can run at a time.
 * @returns {Promise<boolean>} True if reload succeeded
 */
export const forceReloadFromSupabase = async () => {
  const release = await reloadMutex.acquire();
  reloadInProgress = true;
  log.warn('Force reload started — all in-flight operations may see stale data');
  try {
    // Clear all in-memory state
    memoryUsers.clear();
    pseudoKeys.clear();
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
    loginAttempts.clear();
    const ok = await loadFromSupabase();
    return ok;
  } finally {
    reloadInProgress = false;
    release();
  }
};

// Health check info
/**
 * Return health check info: Supabase connection status and in-memory collection sizes.
 * @returns {{ supabaseConnected: boolean, usersInMemory: number, adminsInMemory: number, channelsInMemory: number, snapshotsInMemory: number }}
 */
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

/**
 * Verify data integrity by comparing in-memory user count vs Supabase count.
 * Results are cached for 60 seconds to avoid hammering the DB.
 * @returns {Promise<{ ok: boolean, memoryUsers?: number, dbUsers?: number, reason?: string }>}
 */
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
/**
 * Build a normalized user payload from raw input, applying defaults and sanitization.
 * @param {object} input - Raw user fields (pseudo, email, phone, gameId, etc.)
 * @param {string} role - User role, defaults to 'player'
 * @returns {object} Normalized user payload with wallet, stats, and progression defaults
 */
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
    pseudoKeys.set(id, normalizePseudoKey(payload.pseudo || ''));
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

/**
 * Get a sanitized user from in-memory cache by ID.
 * @param {string} userId - User UUID
 * @returns {object|null} Sanitized user payload or null if not found
 */
export const getUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  return user ? sanitizeUserPayload(user) : null;
};

/**
 * Get a public user profile (no wallet, email, or phone) from memory.
 * @param {string} userId - User UUID
 * @returns {object|null} Public user payload or null if not found
 */
export const getPublicUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  return user ? sanitizePublicUserPayload(user) : null;
};

export const getRawUserById = (userId) => {
  if (!userId) return null;
  const user = memoryUsers.get(userId);
  if (!user) return null;
  return { ...user };
};

/**
 * Verify a user's password without exposing the hash.
 * @param {string} userId
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export const verifyUserPassword = async (userId, password) => {
  const hashEntry = memoryPasswordHashes.get(userId);
  if (!hashEntry) return false;
  return verifyPassword(password, hashEntry[1]);
};

/**
 * Search users by pseudo substring (case-insensitive).
 * @param {string} query - Partial pseudo to search for
 * @param {number} limit - Max results to return (default 20)
 * @returns {object[]} Array of public user payloads matching the query
 */
export const findUsersByPseudo = (query, limit = 20) => {
  const q = normalizePseudoKey(query);
  if (!q) return [];
  const results = [];
  for (const [userId, user] of memoryUsers) {
    const key = pseudoKeys.get(userId) || normalizePseudoKey(user.pseudo || '');
    if (key.includes(q)) {
      results.push(sanitizePublicUserPayload(user));
      if (results.length >= limit) break;
    }
  }
  return results;
};

/**
 * Get all users as an array of sanitized payloads.
 * @returns {object[]} Array of all user payloads
 */
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

/**
 * Get the leaderboard: users with matches/earnings sorted by ELO, win rate, then matches.
 * Cached for 60 seconds.
 * @returns {object[]} Ranked leaderboard entries
 */
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

/**
 * Update a user account using an async updater function, protected by user-level mutex.
 * Persists changes to both memory and Supabase.
 * @param {string} userId - User UUID
 * @param {Function} updater - Async function that receives current user and returns modified user
 * @returns {Promise<object>} Updated sanitized user payload
 */
export const updateUserAccount = async (userId, updater) => {
  return await withUserMutex(userId, async () => {
    const current = memoryUsers.get(userId);
    if (!current) throw makeError('USER_NOT_FOUND', 'Compte joueur introuvable.');

    const next = sanitizeUserPayload(updater(structuredClone(sanitizeUserPayload(current))));
    memoryUsers.set(userId, next);
    pseudoKeys.set(userId, normalizePseudoKey(next.pseudo || ''));

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

    await sbUpsert('app_users', {
      id: userId, pseudo_key: normalizePseudoKey(next.pseudo),
      email_key: normalizeEmailKey(next.email), phone_key: normalizePhoneKey(next.phone),
      game_id_key: normalizeGameIdKey(next.gameId), role: next.role,
      password_hash: passwordHash, payload: next,
      created_at: current.dateJoined, updated_at: getNow(),
    });

    return next;
  });
};

/**
 * Get a user's wallet state, returning defaults if not found.
 * @param {string} userId - User UUID
 * @returns {object} Wallet snapshot with cashBalance, bonusBalance, etc.
 */
export const getWalletSnapshot = (userId) => getUserById(userId)?.wallet || normalizeWalletSnapshot(defaultWallet);

export const updateWalletSnapshot = async (userId, updater) =>
  updateUserAccount(userId, (user) => {
    user.wallet = normalizeWalletSnapshot(updater(structuredClone(user.wallet || defaultWallet), structuredClone(user)));
    user.walletBalance = roundAmount(user.wallet.cashBalance + user.wallet.bonusBalance);
    return user;
  });

/**
 * Create a new user account. Mutex-protected to ensure uniqueness checks are atomic.
 * @param {object} payload - Registration data including password, pseudo, email, phone, gameId
 * @returns {Promise<object>} Sanitized created user payload
 */
export const createUserAccount = async (payload) => await insertUser(payload);

/**
 * Authenticate a user by pseudo, email, or phone + password.
 * @param {object} params - { identifier: string, password: string }
 * @returns {Promise<object>} Sanitized user payload on success
 * @throws {Error} INVALID_CREDENTIALS if identifier or password is wrong
 */
export const authenticateUserAccount = async ({ identifier, password }) => {
  const trimmed = identifier.trim();
  const pk = normalizePseudoKey(trimmed);
  const ek = normalizeEmailKey(trimmed);
  const phk = normalizePhoneKey(trimmed);
  const lookupKey = pk || ek || phk;

  // Check account lockout
  const attempt = loginAttempts.get(lookupKey);
  if (attempt?.lockedUntil && Date.now() < attempt.lockedUntil) {
    throw makeError('ACCOUNT_LOCKED', 'Compte temporairement bloque. Reessayez dans 15 minutes.');
  }

  const hash = memoryPasswordHashes.get(pk) || memoryPasswordHashes.get(ek) || memoryPasswordHashes.get(phk);
  if (!hash) throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');

  const [userId, passwordHash] = hash;
  if (!(await verifyPassword(password, passwordHash))) {
    // Track failed attempt
    const prev = loginAttempts.get(lookupKey) || { count: 0 };
    const newCount = prev.count + 1;
    if (newCount >= MAX_LOGIN_ATTEMPTS) {
      loginAttempts.set(lookupKey, { count: 0, lockedUntil: Date.now() + LOCKOUT_DURATION_MS });
    } else {
      loginAttempts.set(lookupKey, { count: newCount, lockedUntil: null });
    }
    throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');
  }

  // Reset failed attempts on success
  loginAttempts.delete(lookupKey);

  const user = memoryUsers.get(userId);
  if (!user) throw makeError('INVALID_CREDENTIALS', 'Identifiants invalides.');
  if (user.isActive === false) {
    throw makeError('ACCOUNT_NOT_ACTIVATED', 'Activez votre compte via le code envoye par email.');
  }

  return sanitizeUserPayload(user);
};

// Password hash lookup: identifier -> [userId, hash]
const memoryPasswordHashes = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map(); // identifier -> { count, lockedUntil }

const storePasswordHash = (userId, passwordHash, pseudo, email, phone) => {
  memoryPasswordHashes.set(userId, [userId, passwordHash]);
  if (pseudo) memoryPasswordHashes.set(normalizePseudoKey(pseudo), [userId, passwordHash]);
  if (email) memoryPasswordHashes.set(normalizeEmailKey(email), [userId, passwordHash]);
  if (phone) memoryPasswordHashes.set(normalizePhoneKey(phone), [userId, passwordHash]);
};

export const updatePasswordHash = async (userId, newHash) => {
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
    await sbUpsert('app_users', {
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

/**
 * Generate an 8-digit activation code for email verification (15-minute TTL).
 * @param {string} email - Email address to associate with the code
 * @param {string} userId - User UUID to activate on verification
 * @returns {string} The generated numeric code
 */
export const generateActivationCode = (email, userId) => {
  const max = Math.pow(10, ACTIVATION_CODE_MAX_LENGTH);
  const code = crypto.randomInt(0, max).toString().padStart(ACTIVATION_CODE_MAX_LENGTH, '0');
  const expiresAt = new Date(Date.now() + ACTIVATION_CODE_EXPIRY_MS).toISOString();
  memoryActivationCodes.set(email, { code, expiresAt, userId, attempts: 0 });
  return code;
};

/**
 * Verify an activation code using timing-safe comparison.
 * Max 5 attempts before the code is invalidated.
 * @param {string} email - Email the code was sent to
 * @param {string} code - The code entered by the user
 * @returns {{ valid: boolean, userId?: string, error?: string }}
 */
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

/**
 * Activate a user account by setting isActive=true and persisting to Supabase.
 * @param {string} userId - User UUID to activate
 * @returns {object} The updated user object
 * @throws {Error} If user not found
 */
export const activateUserAccount = async (userId) => {
  const user = memoryUsers.get(userId);
  if (!user) throw new Error('Utilisateur introuvable.');
  
  user.isActive = true;
  user.activatedAt = getNow();
  
  // Update in Supabase
  await sbUpsert('app_users', {
    id: userId,
    payload: user,
    updated_at: getNow(),
  });
  
  return user;
};

// ─── Auth Sessions ──────────────────────────────────────────────────────────
const createTokenRecord = async (type, userId, extra = {}) => {
  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = getNow();
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const record = { token, userId, issuedAt, expiresAt, ...extra };

  if (type === 'auth') {
    memoryAuthSessions.set(token, record);
    await sbUpsert('auth_sessions', { token, user_id: userId, issued_at: issuedAt, expires_at: expiresAt });
  } else {
    memoryRealtimeSessions.set(token, record);
    await sbUpsert('realtime_sessions', { token, user_id: userId, pseudo: extra.pseudo, role: extra.role, issued_at: issuedAt, expires_at: expiresAt });
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

  // Purge old friend requests (>30 days)
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const [id, req] of memoryFriendRequests) {
    if (req.timestamp && req.timestamp < cutoff30d && req.status !== 'pending') {
      memoryFriendRequests.delete(id);
    }
  }

  // Purge old notifications (>30 days, already read)
  for (const [id, notif] of memoryNotifications) {
    if (notif.createdAt && notif.createdAt < cutoff30d && notif.isRead) {
      memoryNotifications.delete(id);
      const userUnread = memoryUnreadByUser.get(notif.userId);
      if (userUnread) userUnread.delete(id);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create an auth session with a 6-hour TTL. Persists to memory and Supabase.
 * @param {string} userId - User UUID
 * @returns {{ token: string, userId: string, expiresAt: string, user: object }}
 */
export const createAuthSession = async (userId) => {
  const session = await createTokenRecord('auth', userId);
  return { ...session, user: getUserById(userId) };
};

/**
 * Get an auth session by token, auto-deleting if expired or user not found.
 * @param {string} token - Session token
 * @returns {{ token: string, userId: string, user: object }|null} Session with user or null
 */
export const getAuthSession = (token) => {
  if (!token) return null;
  const session = memoryAuthSessions.get(token);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    memoryAuthSessions.delete(token);
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) { memoryAuthSessions.delete(token); return null; }

  // Session rotation: if session is older than 30 minutes, fire-and-forget rotation
  const sessionAge = Date.now() - new Date(session.issuedAt).getTime();
  if (sessionAge > 30 * 60 * 1000) {
    rotateAuthSession(session, user).catch(err => log.error('Session rotation failed', err));
  }

  return { ...session, user };
};

/**
 * Rotate an auth session: create a new token, delete the old one.
 * Called as fire-and-forget from getAuthSession.
 */
const rotateAuthSession = async (session, user) => {
  const newSession = await createTokenRecord('auth', session.userId);
  memoryAuthSessions.delete(session.token);
  await sbDelete('auth_sessions', { token: session.token });
  // Pre-populate the new session in memory so the caller's next request uses it
  const entry = memoryAuthSessions.get(newSession.token);
  if (entry) entry.user = user;
};

/**
 * Delete an auth session from memory and Supabase.
 * @param {string} token - Session token to delete
 */
export const deleteAuthSession = (token) => {
  memoryAuthSessions.delete(token);
  sbFire('deleteAuthSession', () => sbDelete('auth_sessions', { token }));
};

/**
 * Create a realtime (WebSocket) session with a 6-hour TTL.
 * @param {object} params - { userId, pseudo, role }
 * @returns {{ token: string, userId: string, pseudo: string, role: string, expiresAt: string }}
 */
export const createRealtimeSession = async ({ userId, pseudo, role }) => {
  return await createTokenRecord('realtime', userId, { pseudo, role });
};

export const getRealtimeSession = (token) => {
  return token ? memoryRealtimeSessions.get(token) || null : null;
};

export const deleteRealtimeSession = (token) => {
  memoryRealtimeSessions.delete(token);
  sbFire('deleteRealtimeSession', () => sbDelete('realtime_sessions', { token }));
};

export const deleteRealtimeSessionsForUser = (userId) => {
  const tokensToDelete = [];
  for (const [token, session] of memoryRealtimeSessions) {
    if (session.userId === userId) tokensToDelete.push(token);
  }
  for (const token of tokensToDelete) {
    memoryRealtimeSessions.delete(token);
  }
  sbFire('deleteRealtimeSessionsForUser', () => sbDelete('realtime_sessions', { user_id: userId }));
};

// ─── Push Subscriptions ─────────────────────────────────────────────────────
export const upsertPushSubscription = (userId, subscription) => {
  memoryPushSubscriptions.set(subscription.endpoint, subscription);
  sbFire('upsertPushSubscription', () => sbUpsert('push_subscriptions', { user_id: userId, endpoint: subscription.endpoint, payload: subscription, updated_at: getNow() }));
};

export const removePushSubscription = (endpoint) => {
  memoryPushSubscriptions.delete(endpoint);
  sbFire('removePushSubscription', () => sbDelete('push_subscriptions', { endpoint }));
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

  sbFire('upsertChatChannel', () => sbUpsert('chat_channels', { id: next.id, type: next.type, payload: next, created_at: next.createdAt, updated_at: next.updatedAt }));
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

    sbFire('appendChatMessage', () => sbUpsert('chat_messages', { id: nextMessage.id, channel_id: nextMessage.channelId, payload: nextMessage, created_at: nextMessage.timestamp }));
    upsertChatChannel({ ...channel, lastMessageAt: nextMessage.timestamp, updatedAt: nextMessage.timestamp });

    return nextMessage;
  });
};

export const getChatMessagesForChannel = (channelId, limit = 200) => {
  const msgs = memoryChatMessages.get(channelId) || [];
  return msgs.slice(-Math.max(1, Number(limit || 200)));
};

export const markChatChannelRead = async (channelId, userId, readAt = getNow()) => {
  return withChannelMutex(channelId, () => {
    memoryChatReads.set(`${channelId}:${userId}`, readAt);
    if (memoryChatReads.size > 50000) {
      const oldest = memoryChatReads.keys().next().value;
      memoryChatReads.delete(oldest);
    }
    sbFire('markChatChannelRead', () => sbUpsert('chat_reads', { channel_id: channelId, user_id: userId, read_at: readAt }));
    return { channelId, userId, readAt };
  });
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
/**
 * Replace an entire state collection (e.g. matches, tournaments) with retry.
 * Updates memory and syncs to Supabase in batches of 100 with 3 retries each.
 * @param {string} kind - Collection kind identifier
 * @param {object[]} items - Full array of items to replace the collection with
 */
export const replaceStateCollection = async (kind, items) => {
  if (reloadInProgress) {
    log.warn(`replaceStateCollection(${kind}) deferred — reload in progress`);
  }

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

  // Sync to Supabase (batch upsert with retry)
  if (items.length > 0 && supabase && !reloadInProgress) {
    const rows = items.map(item => ({ kind, entity_id: item.id, payload: item, updated_at: getNow() }));
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      let upserted = false;
      for (let attempt = 1; attempt <= 3 && !upserted; attempt++) {
        upserted = await sbUpsert('state_snapshots', batch);
        if (!upserted && attempt < 3) {
          const delay = attempt * 1000;
          log.warn(`replaceStateCollection(${kind}) batch ${i} attempt ${attempt} failed — retrying in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      if (!upserted) {
        log.error(`replaceStateCollection(${kind}) batch ${i} failed after 3 attempts — memory and Supabase may diverge`, { batchIds: batch.map((r) => r.entity_id).slice(0, 5) });
      }
    }
  }
};

// O(1) per-kind lookup — no full scan needed
/**
 * Get all entities in a state collection by kind. O(1) lookup.
 * @param {string} kind - Collection kind identifier (e.g. "match", "tournament")
 * @returns {object[]} Array of state entities for that kind
 */
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
  sbFire('sendFriendRequest', () => sbUpsert('friend_requests', record));
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

  sbFire('acceptFriendRequest', () => sbUpsert('friend_requests', req));
  sbFire('acceptFriendRequest', () => sbUpsert('friendships', { user_id_1: req.sender_id, user_id_2: req.target_id, created_at: getNow() }));
  sbFire('acceptFriendRequest', () => sbUpsert('friendships', { user_id_1: req.target_id, user_id_2: req.sender_id, created_at: getNow() }));

  return getUserById(req.sender_id);
};

export const declineFriendRequest = (requestId, userId) => {
  const req = memoryFriendRequests.get(requestId);
  if (!req) throw makeError('NOT_FOUND', 'Demande introuvable.');
  if (req.target_id !== userId) throw makeError('UNAUTHORIZED', 'Non autorise.');
  req.status = 'declined';
  req.updated_at = getNow();
  memoryFriendRequests.set(requestId, req);
  sbFire('declineFriendRequest', () => sbUpsert('friend_requests', req));
};

export const removeFriend = (userId, friendId) => {
  memoryFriendships.delete(`${userId}:${friendId}`);
  memoryFriendships.delete(`${friendId}:${userId}`);
  // Update per-user friendship index
  memoryFriendshipsByUser.get(userId)?.delete(friendId);
  memoryFriendshipsByUser.get(friendId)?.delete(userId);
  sbFire('removeFriend', () => sbDelete('friendships', { user_id_1: userId, user_id_2: friendId }));
  sbFire('removeFriend', () => sbDelete('friendships', { user_id_1: friendId, user_id_2: userId }));

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
  sbFire('blockUser', () => sbUpsert('user_blocks', { blocker_id: blockerId, blocked_id: blockedId, created_at: getNow() }));
};

export const unblockUser = (blockerId, blockedId) => {
  memoryUserBlocks.delete(`${blockerId}:${blockedId}`);
  memoryBlocksByUser.get(blockerId)?.delete(blockedId);
  sbFire('unblockUser', () => sbDelete('user_blocks', { blocker_id: blockerId, blocked_id: blockedId }));
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

  sbFire('createNotification', () => sbUpsert('user_notifications', {
    id, user_id: userId, type, title, message, priority,
    action_url: actionUrl || null, metadata: metadata || null,
    is_read: false, created_at: now,
  }));

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
  try {
    const rows = await sbSelect('processed_transactions', { transaction_id: transactionId }, 'transaction_id');
    if (rows && rows.length > 0) {
      memoryProcessedTransactions.add(transactionId);
      return true;
    }
  } catch { /* ignore — will be caught by rate limit or processing check */ }
  return false;
};

/**
 * Atomically claim a transaction for idempotent processing.
 * Checks memory first, then DB, and marks it as processed.
 * @param {string} transactionId - FedaPay transaction ID
 * @param {string} userId - User who initiated the transaction
 * @param {number} amountZC - Transaction amount in ZC
 * @returns {Promise<boolean>} True if newly claimed, false if already processed
 */
export const claimTransaction = async (transactionId, userId, amountZC) => {
  // Check memory cache first (fast path)
  if (memoryProcessedTransactions.has(transactionId)) return false;

  // Check DB as source of truth BEFORE adding to memory
  try {
    const rows = await sbSelect('processed_transactions', { transaction_id: transactionId }, 'transaction_id');
    if (rows && rows.length > 0) {
      memoryProcessedTransactions.add(transactionId);
      return false;
    }
  } catch { /* if DB check fails, proceed with memory-only dedup */ }

  // Now safe to add to memory and persist
  memoryProcessedTransactions.add(transactionId);
  if (memoryProcessedTransactions.size > MAX_PROCESSED_TX) {
    const first = memoryProcessedTransactions.values().next().value;
    memoryProcessedTransactions.delete(first);
  }
  await sbUpsert('processed_transactions', { transaction_id: transactionId, user_id: userId, amount_zc: amountZC });
  return true;
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
