import { getMemoryChatChannels } from './persistence.mjs';
import { getNow } from './utils.mjs';

/** @type {Map<string, Map<string, object>>} channelId → userId → member */
const channels = new Map();

/** @type {Map<string, Set<string>>} socketId → channelIds */
const channelsBySocket = new Map();

/** @type {Map<string, Map<string, object>>} channelId → userId → seen info */
const seenByChannel = new Map();

/** @type {Map<string, Map<string, object>>} channelId → userId → typing info */
const typingByChannel = new Map();

/** Maximum number of active channel maps before new channels are rejected. */
const MAX_ACTIVE_CHANNELS = 500;

/** Periodic cleanup of orphaned channel maps (every 10 minutes). */
const cleanupChannelMaps = () => {
  const channelIds = new Set(channels.keys());
  for (const [id, members] of channels) {
    if (members.size === 0) channels.delete(id);
  }
  for (const [key] of seenByChannel) {
    if (!channelIds.has(key)) seenByChannel.delete(key);
  }
  for (const [key] of typingByChannel) {
    if (!channelIds.has(key)) typingByChannel.delete(key);
  }

  const MAX_CHAT_CHANNEL_AGE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const chatChannels = getMemoryChatChannels();
  for (const [id, ch] of chatChannels) {
    if (ch.id === 'global') continue;
    const memberCount = channels.get(id)?.size ?? 0;
    const updatedAt = ch.updatedAt ? new Date(ch.updatedAt).getTime() : 0;
    if (memberCount === 0 && now - updatedAt > MAX_CHAT_CHANNEL_AGE_MS) {
      chatChannels.delete(id);
    }
  }
};

setInterval(cleanupChannelMaps, 10 * 60 * 1000);

/**
 * Get or create the member map for a channel.
 * @param {string} channelId
 * @returns {Map<string, object>}
 */
const getChannelMemberMap = (channelId) => {
  if (!channels.has(channelId)) {
    if (channels.size >= MAX_ACTIVE_CHANNELS) return new Map();
    channels.set(channelId, new Map());
  }
  return channels.get(channelId);
};

/**
 * Get or create the seen-by map for a channel.
 * @param {string} channelId
 * @returns {Map<string, object>}
 */
const getSeenMap = (channelId) => {
  if (!seenByChannel.has(channelId)) {
    seenByChannel.set(channelId, new Map());
  }
  return seenByChannel.get(channelId);
};

/**
 * Get or create the typing map for a channel.
 * @param {string} channelId
 * @returns {Map<string, object>}
 */
const getTypingMap = (channelId) => {
  if (!typingByChannel.has(channelId)) {
    typingByChannel.set(channelId, new Map());
  }
  return typingByChannel.get(channelId);
};

/**
 * Return the public-safe subset of a member object.
 * @param {object} member
 * @returns {object}
 */
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

/**
 * Emit presence and typing snapshots for a channel to all connected sockets.
 * @param {object} io - Socket.IO server instance
 * @param {string} channelId
 */
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

/**
 * Track a socket's membership in a channel.
 * @param {string} socketId
 * @param {string} channelId
 */
const trackSocketChannel = (socketId, channelId) => {
  const currentChannels = channelsBySocket.get(socketId) || new Set();
  currentChannels.add(channelId);
  channelsBySocket.set(socketId, currentChannels);
};

/**
 * Remove a socket's membership from a channel. Cleans up the tracking map
 * if the socket no longer belongs to any channels.
 * @param {string} socketId
 * @param {string} channelId
 */
const untrackSocketChannel = (socketId, channelId) => {
  const currentChannels = channelsBySocket.get(socketId);
  if (!currentChannels) return;
  currentChannels.delete(channelId);
  if (currentChannels.size === 0) {
    channelsBySocket.delete(socketId);
  }
};

/**
 * Insert or update a member in a channel and join the socket to the room.
 * @param {object} socket - Socket.IO socket
 * @param {object} payload
 * @param {string} payload.channelId
 * @param {string} payload.userId
 * @param {string} payload.pseudo
 * @param {string} [payload.role='spectator']
 * @param {number} [payload.team]
 * @param {boolean} [payload.isCheckedIn=false]
 * @param {boolean} [payload.isReady=false]
 * @returns {object|null} The upserted member, or null if required fields are missing.
 */
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

/**
 * Remove a socket from a channel. Spectators with no remaining sockets are
 * fully removed; non-spectators are kept but marked offline. Also cleans up
 * typing state and re-emits snapshots.
 * @param {object} io - Socket.IO server instance
 * @param {object} socket - Socket.IO socket
 * @param {string} channelId
 */
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

export {
  channels,
  channelsBySocket,
  seenByChannel,
  typingByChannel,
  MAX_ACTIVE_CHANNELS,
  cleanupChannelMaps,
  getChannelMemberMap,
  getSeenMap,
  getTypingMap,
  publicMember,
  emitChannelSnapshots,
  trackSocketChannel,
  untrackSocketChannel,
  upsertChannelMember,
  removeSocketFromChannel,
};
