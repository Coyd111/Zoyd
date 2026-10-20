/**
 * server/mutex.mjs - Verrous de processus serialisant les sections
 * lecture-modification-ecriture sur l'etat en memoire.
 *
 * Trois verrous GLOBAUX (matchs, tournois, ligues) et quatre families de
 * verrous PAR ENTITE (salon BR, portefeuille, utilisateur, canal).
 *
 * INVARIANT : le verrou GLOBAL est toujours pris AVANT le verrou par entite.
 *   L'ordre inverse ouvre un risque de deadlock entre deux requetes.
 * INVARIANT : ces verrous protegent l'etat du PROCESSUS courant. Ils ne
 *   valent rien en multi-processus : c'est le role de single-process-guard.mjs
 *   de refuser de demarrer dans ce cas.
 * INVARIANT : un mutex VERROILLE n'est JAMAIS evince. Supprimer celui d'un
 *   joueur en cours d'operation ferait creer un second Mutex a l'appel
 *   suivant, donc deux ecritures concurrentes sur le meme portefeuille.
 * INVARIANT : la valeur de retour de `fn` est propagee et le verrou est
 *   relache dans un `finally` : une exception ne doit jamais le retenir.
 * PIEGE : le debit se fait SOUS verrou, l'appel de paiement HORS verrou
 *   (voir POST /api/wallet/withdraw). L'inverse rend le double paiement
 *   possible.
 * PIEGE : `withChannelMutex` n'est utilise que par la couche de persistance
 *   (canaux de chat), pas par les modules de routes.
 * PIEGE : le verrou BR est PAR SALON : deux salons distincts se reglent en
 *   meme temps, c'est voulu.
 * PIEGE : le nettoyage toutes les 5 min ne retire que les verrous INACTIFS
 *   depuis plus de 30 min ET non verrouilles.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { Mutex } from 'async-mutex';

const matchMutex = new Mutex();
const tournamentMutex = new Mutex();
const leagueMutex = new Mutex();
const walletMutex = new Map();
const userMutex = new Map();
const channelMutex = new Map();
const brLobbyMutex = new Map();
const WALLET_MUTEX_MAX_AGE = 30 * 60 * 1000; // 30 minutes
const MUTEX_MAX_SIZE = 10000;
const walletMutexTimestamps = new Map();
const userMutexTimestamps = new Map();
const channelMutexTimestamps = new Map();
const brLobbyMutexTimestamps = new Map();

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

/**
 * Evict the oldest IDLE mutex when at capacity.
 *
 * Un mutex VERROILLE est expressement ecarte. Supprimer celui d'un joueur
 * en cours d'operation creeait un nouveau Mutex au prochain appel : deux
 * ecritures concurrentes sur le meme portefeuille — exactement ce que le
 * mutex doit empecher (double debit, double credit).
 */
const evictOldestMutex = (map, timestamps) => {
  if (map.size < MUTEX_MAX_SIZE) return;
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [key, ts] of timestamps) {
    const mutex = map.get(key);
    // On saute les verrous actifs : le plafond est une limite de memoroire,
    // pas une raison de perdre l'exclusion mutuelle.
    if (!mutex || mutex.isLocked()) continue;
    if (ts < oldestTime) {
      oldestTime = ts;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    map.delete(oldestKey);
    timestamps.delete(oldestKey);
  }
};

/**
 * Verrou par salon Battle Royale.
 *
 * Les actions de salon (`join`, `leave`, `checkin`, `start`, `eliminate`,
 * `finish`) font toutes un read-modify-write sur la collection `brLobbies`.
 * Sans sérialisation, deux requêtes simultanées lisent le même instantané :
 * les deux modifient le même clone, et seule la dernière écriture est conservée.
 *
 * Sur `finish`, cela ne perdait pas qu'un joueur : les deux appels passaient le
 * garde `status === 'settling'` — evalue sur le clone, jamais persiste — et
 * versaient donc la cagnotte DEUX FOIS. Le rate limiter (20 requêtes / 5 min)
 * laisse largement passer un double-clic.
 *
 * Le verrou est PAR SALON, et non global comme `withMatchMutex` : deux salons
 * distincts peuvent regler en meme temps, ce qui est le cas normal.
 */
export const withBrLobbyMutex = async (lobbyId, fn) => {
  evictOldestMutex(brLobbyMutex, brLobbyMutexTimestamps);
  if (!brLobbyMutex.has(lobbyId)) brLobbyMutex.set(lobbyId, new Mutex());
  const mutex = brLobbyMutex.get(lobbyId);
  const release = await mutex.acquire();
  brLobbyMutexTimestamps.set(lobbyId, Date.now());
  try {
    return await fn();
  } finally {
    release();
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
