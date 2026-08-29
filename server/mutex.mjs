import { Mutex } from 'async-mutex';

const matchMutex = new Mutex();
const tournamentMutex = new Mutex();
const leagueMutex = new Mutex();
const walletMutex = new Map();
const userMutex = new Map();
const channelMutex = new Map();
const WALLET_MUTEX_MAX_AGE = 30 * 60 * 1000; // 30 minutes
const MUTEX_MAX_SIZE = 10000;
const walletMutexTimestamps = new Map();
const userMutexTimestamps = new Map();
const channelMutexTimestamps = new Map();

export const withMatchMutex = async (fn) => {
  const release = await matchMutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
};

export const withTournamentMutex = async (fn) => {
  const release = await tournamentMutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
};

export const withLeagueMutex = async (fn) => {
  const release = await leagueMutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
};

const evictOldestMutex = (map, timestamps) => {
  if (map.size >= MUTEX_MAX_SIZE) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, ts] of timestamps) {
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      map.delete(oldestKey);
      timestamps.delete(oldestKey);
    }
  }
};

export const withWalletMutex = async (userId, fn) => {
  evictOldestMutex(walletMutex, walletMutexTimestamps);
  if (!walletMutex.has(userId)) walletMutex.set(userId, new Mutex());
  const mutex = walletMutex.get(userId);
  const release = await mutex.acquire();
  walletMutexTimestamps.set(userId, Date.now());
  try {
    return await fn();
  } finally {
    release();
  }
};

export const withUserMutex = async (userId, fn) => {
  evictOldestMutex(userMutex, userMutexTimestamps);
  if (!userMutex.has(userId)) userMutex.set(userId, new Mutex());
  const mutex = userMutex.get(userId);
  const release = await mutex.acquire();
  userMutexTimestamps.set(userId, Date.now());
  try {
    return await fn();
  } finally {
    release();
  }
};

export const withChannelMutex = async (channelId, fn) => {
  evictOldestMutex(channelMutex, channelMutexTimestamps);
  if (!channelMutex.has(channelId)) channelMutex.set(channelId, new Mutex());
  const mutex = channelMutex.get(channelId);
  const release = await mutex.acquire();
  channelMutexTimestamps.set(channelId, Date.now());
  try {
    return await fn();
  } finally {
    release();
  }
};

// Periodic cleanup of idle mutexes (runs every 5 minutes)
const cleanupIdleMutexes = () => {
  const now = Date.now();
  for (const [userId, timestamp] of walletMutexTimestamps) {
    if (now - timestamp > WALLET_MUTEX_MAX_AGE) {
      const mutex = walletMutex.get(userId);
      if (mutex && !mutex.isLocked()) {
        walletMutex.delete(userId);
        walletMutexTimestamps.delete(userId);
      }
    }
  }
  for (const [userId, timestamp] of userMutexTimestamps) {
    if (now - timestamp > WALLET_MUTEX_MAX_AGE) {
      const mutex = userMutex.get(userId);
      if (mutex && !mutex.isLocked()) {
        userMutex.delete(userId);
        userMutexTimestamps.delete(userId);
      }
    }
  }
  for (const [channelId, timestamp] of channelMutexTimestamps) {
    if (now - timestamp > WALLET_MUTEX_MAX_AGE) {
      const mutex = channelMutex.get(channelId);
      if (mutex && !mutex.isLocked()) {
        channelMutex.delete(channelId);
        channelMutexTimestamps.delete(channelId);
      }
    }
  }
};
setInterval(cleanupIdleMutexes, 5 * 60 * 1000);
