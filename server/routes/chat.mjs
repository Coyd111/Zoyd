/**
 * server/routes/chat.mjs - Domaine CHAT : bootstrap, detail d'un canal,
 * creation d'un canal, envoi d'un message, accuse de lecture.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : session (401 `AUTH_REQUIRED`) -> rate limit (`chat`) ->
 * lecture du corps -> controle d'acces au canal (`canAccessChatChannel`, 404
 * `CHANNEL_NOT_FOUND`) -> ecriture -> diffusion.
 *
 * INVARIANT : l'acces au canal est verifie par `canAccessChatChannel` sur
 *   CHAQUE route qui touche un canal, et un refus repond 404 (et non 403) :
 *   l'existence du canal n'est pas divulguee.
 * INVARIANT : le texte du message est sanitise (`sanitizeText`) et tronque a
 *   2000 caracteres AVANT d'etre stocke.
 * INVARIANT : l'expediteur est la SESSION (`senderId`, `senderPseudo`), pas
 *   un champ du corps de requete.
 * INVARIANT : les participants d'un canal cree sont la session plus les
 *   utilisateurs EXISTANTS : un identifiant inconnu est ecarte
 *   silencieusement. P9 C2 (audit-3) : la liste est BORNEE a 50 avant le
 *   filtre d'existence, le name du canal est sanitize + tronque a 80, et
 *   un canal private a la meme paire existant est RETOURNE (200) au lieu
 *   d'en creer un second (deduplication de la course DM).
 * INVARIANT : replyTo n'est conserve que s'il reference un message NON
 *   SUPPRIME du canal courant (P9 C2 : sinon l'identifiant fantome
 *   passait tel quel).
 * INVARIANT : la diffusion suit les helpers de chat-helpers.mjs (global,
 *   scope public, ou room `user:<id>` de chaque participant).
 * PIEGE : le refus d'acces est un 404 : un 403 confirmerait l'existence du
 *   canal et permettrait d'enumerer les canaux prives.
 * PIEGE : le detail renvoie 150 messages, le bootstrap 20 par canal actif :
 *   les deux bornes sont differentes et voulues.
 * PIEGE : l'accuse de lecture est diffusee dans la room personnelle
 *   `user:<userId>`, pas dans la room du canal.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

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
  getChatChannelsForUser,
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
    // Validate participants — only existing user IDs allowed.
    // P9 C2 (audit-3) : bornage AVANT le filtre d'existence - chaque id
    // declenche un getUserById (scan de la Map users) : un tableau de
    // 10 000 identifiants etait un DoS d'entree gratuite (famille S12,
    // ledger audit-2 #94). Plafond 50 : le DM en attend 1, une equipe
    // 5vs5 en a 10 (MAX_TEAM_SIZE) - 50 garde toute marge.
    const rawParticipants = (Array.isArray(body.participants) ? body.participants.filter(Boolean) : []).slice(0, 50);
    const validParticipants = rawParticipants.filter((id) => getUserById(id));

    // P9 C2 (audit-3) : le name partait BRUT du corps de requete - le
    // createur nommait le canal CHEZ LES AUTRES participants (usurpation :
    // "Support officiel ZOYD"), sans sanitisation ni bornage.
    const channelName = sanitizeText(`${body.name || ''}`.trim()).slice(0, 80) || 'Nouvelle conversation';

    // P9 C2 (audit-3) : deux utilisateurs qui se creent chacun un canal DM
    // vers l'autre produisaient DEUX canaux jumeaux (id = timestamp :
    // aucune deduplication par paire). Un canal private a EXACTEMENT la
    // meme paire existant est retourne tel quel (200) au lieu d'en creer
    // un second : le front fait deja un find-or-create cote client, ce
    // garde ferme la course de deux clics simultanes.
    if (channelType === 'private') {
      const pair = [...new Set([session.user.id, ...validParticipants])];
      if (pair.length === 2) {
        const pairSet = new Set(pair);
        const twin = getChatChannelsForUser(session.user.id).find(
          (candidate) => candidate.type === 'private' && candidate.participants.length === 2 && candidate.participants.every((id) => pairSet.has(id))
        );
        if (twin) {
          respondJson(res, 200, { ok: true, channel: twin, messages: getChatMessagesForChannel(twin.id, 150) });
          return true;
        }
      }
    }

    const channel = upsertChatChannel({
      id: `CH-${body.type || 'private'}-${Date.now().toString(36).toUpperCase()}`,
      type: body.type || 'private',
      name: channelName,
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

    // P9 C2 (audit-3) : replyTo partait sans validation - un identifiant
    // fantome (message d'un autre canal, ou invente) passait tel quel. Il
    // n'est conserve que s'il reference un message NON SUPPRIME du canal
    // courant (la memoire borne chaque canal a 500 messages : la fenetre
    // 500 couvre tout).
    let replyTo = typeof body.replyTo === 'string' ? body.replyTo.trim() : '';
    if (replyTo) {
      const referenced = getChatMessagesForChannel(channel.id, 500).some((m) => m.id === replyTo && !m.isDeleted);
      if (!referenced) replyTo = '';
    }

    const message = await appendChatMessage({
      id: `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      channelId: channel.id,
      channelType: channel.type,
      senderId: session.user.id,
      senderPseudo: session.user.pseudo,
      text,
      replyTo: replyTo || undefined,
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
