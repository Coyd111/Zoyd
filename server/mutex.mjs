import { Mutex } from 'async-mutex';

const matchMutex = new Mutex();
const tournamentMutex = new Mutex();
const leagueMutex = new Mutex();
const walletMutex = new Map();

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
  try {
    return await fn();
  } finally {
    release();
  }
};
