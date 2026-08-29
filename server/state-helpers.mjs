import { syncMatchChatChannels, buildMatchChatChannel, broadcastChatChannel } from './chat-helpers.mjs';
import { broadcastStateSnapshot } from './push-notifications.mjs';
import { replaceStateCollection, getStateCollection, getUserById } from './persistence.mjs';
import { normalizeTournamentCollection } from './tournament-engine.mjs';
import { normalizeLeagueCollection } from './league-engine.mjs';
import { getServerWallet } from './wallet-engine.mjs';

/**
 * Persist matches to state storage, sync chat channels, sanitize for broadcast, and push snapshot.
 * Now broadcasts only the changed match delta instead of full collection.
 * @param {object} io - Socket.IO server instance
 * @param {Array} matches - The matches to persist
 * @param {object|null} [changedMatch=null] - Optional match that changed, used for delta broadcast
 * @returns {Promise<Array>} The stored matches
 */
const saveMatches = async (io, matches, changedMatch = null) => {
  syncMatchChatChannels(matches);
  await replaceStateCollection('matches', matches);
  // Broadcast only the changed match delta instead of full collection
  if (changedMatch) {
    broadcastStateSnapshot(io, 'matches', [sanitizeMatchForBroadcast(changedMatch)]);
    broadcastChatChannel(io, buildMatchChatChannel(changedMatch));
  } else {
    const storedMatches = getStateCollection('matches');
    broadcastStateSnapshot(io, 'matches', storedMatches.map(sanitizeMatchForBroadcast));
  }
  return getStateCollection('matches');
};

/**
 * Retrieve stored tournaments from state, normalized for consumption.
 * @returns {Array} Normalized tournament collection
 */
const getStoredTournaments = () => normalizeTournamentCollection(getStateCollection('tournaments'));

/**
 * Persist tournaments to state storage and push snapshot to clients.
 * @param {object} io - Socket.IO server instance
 * @param {Array} tournaments - The tournaments to persist
 * @returns {Promise<Array>} The stored tournaments
 */
const saveTournaments = async (io, tournaments) => {
  await replaceStateCollection('tournaments', tournaments);
  const storedTournaments = getStoredTournaments();
  broadcastStateSnapshot(io, 'tournaments', storedTournaments.map(sanitizeTournamentForBroadcast));
  return storedTournaments;
};

/**
 * Build a match action response payload containing the sanitized match, user, and wallet info.
 * @param {object} match - The match object
 * @param {string} userId - The user performing the action
 * @returns {{ ok: boolean, match: object, user: object|null, wallet: object }} Action payload
 */
const buildMatchActionPayload = (match, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    match: sanitizeMatchForBroadcast(match),
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

/**
 * Remove sensitive fields (e.g. roomPassword, screenshots, userId, system actor names) from a match before broadcasting.
 * @param {object} match - The match to sanitize
 * @returns {object} A shallow copy with sensitive fields stripped
 */
const sanitizeMatchForBroadcast = (match) => {
  const { roomPassword, screenshots, ...safe } = match;
  if (safe.arbiter) {
    const { roomPassword: _ap, ...safeArbiter } = safe.arbiter;
    safe.arbiter = safeArbiter;
  }
  if (Array.isArray(safe.players)) {
    safe.players = safe.players.map(({ userId, ...rest }) => rest);
  }
  if (safe.submittedBy === 'system-no-show' || safe.submittedBy === 'admin-dashboard') {
    safe.submittedBy = null;
  }
  return safe;
};

/**
 * Sanitize a tournament: strip roomPassword from all embedded matches.
 * Also strip admin internal IDs from public view, including entry members and captains.
 * @param {object} tournament - The tournament to sanitize
 * @returns {object} A sanitized copy safe for public broadcast
 */
const sanitizeTournamentForBroadcast = (tournament) => {
  const safe = { ...tournament };
  if (Array.isArray(safe.matches)) {
    safe.matches = safe.matches.map(sanitizeMatchForBroadcast);
  }
  if (Array.isArray(safe.arbiters)) {
    safe.arbiters = safe.arbiters.map(({ userId, ...rest }) => rest);
  }
  if (Array.isArray(safe.entries)) {
    safe.entries = safe.entries.map((entry) => {
      const sanitized = { ...entry };
      delete sanitized.captainId;
      if (Array.isArray(sanitized.members)) {
        sanitized.members = sanitized.members.map(({ userId, ...rest }) => rest);
      }
      return sanitized;
    });
  }
  return safe;
};

/**
 * Build a tournament action response payload containing the tournament, user, and wallet info.
 * @param {object} tournament - The tournament object
 * @param {string} userId - The user performing the action
 * @returns {{ ok: boolean, tournament: object, user: object|null, wallet: object }} Action payload
 */
const buildTournamentActionPayload = (tournament, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    tournament,
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

/**
 * Retrieve stored leagues from state, normalized for consumption.
 * @returns {Array} Normalized league collection
 */
const getStoredLeagues = () => normalizeLeagueCollection(getStateCollection('leagues'));

/**
 * Persist leagues (seasons) to state storage and push snapshot to clients.
 * @param {object} io - Socket.IO server instance
 * @param {Array} seasons - The league seasons to persist
 * @returns {Promise<Array>} The stored leagues
 */
const saveLeagues = async (io, seasons) => {
  await replaceStateCollection('leagues', seasons);
  const storedLeagues = getStoredLeagues();
  broadcastStateSnapshot(io, 'leagues', storedLeagues);
  return storedLeagues;
};

/**
 * Build a league action response payload containing the season, user, and wallet info.
 * @param {object} season - The league season object
 * @param {string} userId - The user performing the action
 * @returns {{ ok: boolean, season: object, user: object|null, wallet: object }} Action payload
 */
const buildLeagueActionPayload = (season, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    season,
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

export {
  saveMatches,
  getStoredTournaments,
  saveTournaments,
  buildMatchActionPayload,
  sanitizeMatchForBroadcast,
  sanitizeTournamentForBroadcast,
  buildTournamentActionPayload,
  getStoredLeagues,
  saveLeagues,
  buildLeagueActionPayload,
};
