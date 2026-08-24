import { Mutex } from 'async-mutex';

const matchMutex = new Mutex();
const tournamentMutex = new Mutex();
const leagueMutex = new Mutex();
const walletMutex = new Map();
const WALLET_MUTEX_MAX_AGE = 30 * 60 * 1000; // 30 minutes
const walletMutexTimestamps = new Map();

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

export const withWalletMutex = async (userId, fn) => {
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

// Periodic cleanup of idle wallet mutexes (runs every 5 minutes)
const cleanupIdleWalletMutexes = () => {
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
};
setInterval(cleanupIdleWalletMutexes, 5 * 60 * 1000);
