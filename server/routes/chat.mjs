import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  parseRequestBody,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import {
  getUserById,
  getChatChannelById,
  getChatMessagesForChannel,
  appendChatMessage,
  upsertChatChannel,
  markChatChannelRead,
  getUnreadCountForUser,
  sanitizeText,
} from '../persistence.mjs';
import {
  buildChatBootstrapPayload,
  canAccessChatChannel,
  broadcastChatChannel,
  broadcastChatMessage,
  broadcastChatRead,
} from '../chat-helpers.mjs';
import { channels } from '../channel-presence.mjs';
import { getNow } from '../utils.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('chat-routes');

export const handleChatRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/chat/bootstrap') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'chat')) { return true; }
  try {
    respondJson(res, 200, { ok: true, ...buildChatBootstrapPayload(session.user.id) });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du chat.', code: 'LOAD_ERROR' });
  }
  return true;
}

const chatChannelDetail = pathname.match(/^\/api\/chat\/channels\/([^/]+)$/);
if (req.method === 'GET' && chatChannelDetail) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  const channel = getChatChannelById(chatChannelDetail[1]);
  if (!channel || !canAccessChatChannel(channel, session.user)) {
    respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.', code: 'CHANNEL_NOT_FOUND' });
    return true;
  }

  try {
    respondJson(res, 200, {
      ok: true,
      channel: {
        ...channel,
        unreadCount: getUnreadCountForUser(channel.id, session.user.id),
      },
      messages: getChatMessagesForChannel(channel.id, 150),
    });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du canal.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/chat/channels') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'chat')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const CHANNEL_TYPES = ['private', 'match', 'team', 'dm'];
    const channelType = body.type || 'private';
    if (!CHANNEL_TYPES.includes(channelType)) {
      respondJson(res, 400, { ok: false, error: `Type de canal invalide. Valeurs acceptees: ${CHANNEL_TYPES.join(', ')}`, code: 'INVALID_ENUM' });
      return true;
    }
    // Validate participants — only existing user IDs allowed
    const rawParticipants = Array.isArray(body.participants) ? body.participants.filter(Boolean) : [];
    const validParticipants = rawParticipants.filter((id) => getUserById(id));
    const channel = upsertChatChannel({
      id: `CH-${body.type || 'private'}-${Date.now().toString(36).toUpperCase()}`,
      type: body.type || 'private',
      name: body.name || 'Nouvelle conversation',
      participants: [session.user.id, ...validParticipants],
      scope: 'participants',
      inbox: 'participants',
      createdAt: getNow(),
      updatedAt: getNow(),
    });

    broadcastChatChannel(io, channel);
    respondJson(res, 201, {
      ok: true,
      channel: {
        ...channel,
        unreadCount: 0,
      },
      messages: [],
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const chatChannelMessages = pathname.match(/^\/api\/chat\/channels\/([^/]+)\/messages$/);
if (req.method === 'POST' && chatChannelMessages) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'chat')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const channel = getChatChannelById(chatChannelMessages[1]);
    if (!channel || !canAccessChatChannel(channel, session.user)) {
      respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.', code: 'CHANNEL_NOT_FOUND' });
      return true;
    }

    const text = sanitizeText(body.text || '').slice(0, 2000);
    if (!text) {
      respondJson(res, 400, { ok: false, error: 'Le message est vide.', code: 'EMPTY_MESSAGE' });
      return true;
    }

    const message = await appendChatMessage({
      id: `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      channelId: channel.id,
      channelType: channel.type,
      senderId: session.user.id,
      senderPseudo: session.user.pseudo,
      text,
      replyTo: body.replyTo,
      timestamp: getNow(),
    });
    const updatedChannel = getChatChannelById(channel.id);

    broadcastChatMessage(io, updatedChannel, message);
    respondJson(res, 201, {
      ok: true,
      channel: {
        ...updatedChannel,
        unreadCount: 0,
      },
      message,
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const chatChannelRead = pathname.match(/^\/api\/chat\/channels\/([^/]+)\/read$/);
if (req.method === 'POST' && chatChannelRead) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'chat')) { return true; }

  const channel = getChatChannelById(chatChannelRead[1]);
  if (!channel || !canAccessChatChannel(channel, session.user)) {
    respondJson(res, 404, { ok: false, error: 'Canal de discussion introuvable.', code: 'CHANNEL_NOT_FOUND' });
    return true;
  }

  try {
    const receipt = await markChatChannelRead(channel.id, session.user.id, getNow());
    broadcastChatRead(io, receipt.channelId, receipt.userId, receipt.readAt);
    respondJson(res, 200, { ok: true, ...receipt });
  } catch (err) {
    log.error('chat/channel read failed', { channelId: channel.id, userId: session.user.id, error: err.message });
    respondJson(res, 500, { ok: false, error: 'Erreur lors de la marque de lecture.', code: 'READ_ERROR' });
  }
  return true;
}


  return false;
};
