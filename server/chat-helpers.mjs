import {
  getChatChannelById,
  upsertChatChannel,
  ensureGlobalChatChannel,
  getChatChannelsForUser,
  getUnreadCountForUser,
  getChatMessagesForChannel,
} from './persistence.mjs';
import { getNow } from './utils.mjs';

/**
 * Build or upsert a chat channel for a match.
 * @param {object} match
 * @returns {object}
 */
export const buildMatchChatChannel = (match) => {
  const channelId = match.channelId || match.chatChannelId || `match-${match.id}`;
  const existing = getChatChannelById(channelId);

  return upsertChatChannel({
    ...existing,
    id: channelId,
    type: 'match',
    name: `Match MJ ${match.id}`,
    participants: [
      ...match.players.map((player) => player.userId),
      ...(match.arbiter?.userId ? [match.arbiter.userId] : []),
    ],
    scope: match.visibility === 'public' ? 'public' : 'participants',
    inbox: 'participants',
    createdAt: existing?.createdAt || match.createdAt || getNow(),
    updatedAt: match.updatedAt || getNow(),
  });
};

/**
 * Ensure the global chat channel exists, then build channels for all matches.
 * @param {object[]} matches
 * @returns {object[]}
 */
export const syncMatchChatChannels = (matches) => {
  ensureGlobalChatChannel();
  return matches.map((match) => buildMatchChatChannel(match));
};

/**
 * Check whether a user can access a given chat channel.
 * @param {object} channel
 * @param {object} user
 * @returns {boolean}
 */
export const canAccessChatChannel = (channel, user) =>
  !!channel && !!user && (user.role === 'admin' || channel.scope === 'public' || channel.participants.includes(user.id));

/**
 * Build the bootstrap payload sent to a user on connect.
 * Returns all channels (with unread counts) and recent messages
 * from the top 5 most active channels.
 * @param {string} userId
 * @returns {{ channels: object[], messages: object[] }}
 */
export const buildChatBootstrapPayload = (userId) => {
  const channels = getChatChannelsForUser(userId).map((channel) => ({
    ...channel,
    unreadCount: getUnreadCountForUser(channel.id, userId),
  }));

  const sorted = [...channels].sort((a, b) => {
    if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
    if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  const activeChannels = sorted.slice(0, 10);
  const messages = activeChannels.flatMap((channel) =>
    getChatMessagesForChannel(channel.id, 20)
  );

  return {
    channels: sorted.slice(0, 50),
    messages,
  };
};

/**
 * Broadcast a chat channel update to all relevant clients.
 * @param {object} io - Socket.IO server instance
 * @param {object} channel
 */
export const broadcastChatChannel = (io, channel) => {
  if (!channel) return;

  if (channel.inbox === 'all') {
    io.emit('chat:channel', { channel });
  }

  for (const participantId of channel.participants || []) {
    io.to(`user:${participantId}`).emit('chat:channel', { channel });
  }
};

/**
 * Broadcast a new chat message to all relevant clients.
 * @param {object} io - Socket.IO server instance
 * @param {object} channel
 * @param {object} message
 */
export const broadcastChatMessage = (io, channel, message) => {
  if (!channel || !message) return;
  const payload = { channel, message };

  if (channel.id === 'global') {
    io.emit('chat:message', payload);
    return;
  }

  if (channel.scope === 'public') {
    io.to(channel.id).emit('chat:message', payload);
  }

  for (const participantId of channel.participants || []) {
    io.to(`user:${participantId}`).emit('chat:message', payload);
  }
};

/**
 * Broadcast a chat-read receipt to the user's personal room.
 * @param {object} io - Socket.IO server instance
 * @param {string} channelId
 * @param {string} userId
 * @param {string} readAt
 */
export const broadcastChatRead = (io, channelId, userId, readAt) => {
  io.to(`user:${userId}`).emit('chat:read', { channelId, userId, readAt });
};
