/**
 * chatApi - appels REST du chat : bootstrap, canaux, messages, lecture.
 *
 * Client dedie du chat global et des canaux de match. Le temps reel (canaux
 * et messages qui arrivent) passe par le socket ; l'ecriture passe par ici.
 *
 * INVARIANT : l'ecriture d'un message se fait par cette API, pas par
 * chatStore.sendMessage (qui ne fait qu'une mutation locale et disparait au
 * rechargement).
 * PIEGE : les canaux de match sont crees par le serveur a la creation du
 * match. Un `chatChannelId` et un `channelId` coexistent dans le modele :
 * le premier est le canal de chat, le second le canal de presence.
 * PIEGE : marquer un canal comme lu est une ecriture : elle part au serveur
 * et se propage aux autres onglets par l'evenement socket chat:read.
 *
 * Voir aussi : docs/08-frontend.md - section 7.2 (Les 13 evenements)
 */
import type { ChatChannel, ChatChannelDef, ChatMessage } from '../stores/chatStore';
import { authorizedGet, authorizedPost } from './apiClient';

interface ChatBootstrapResponse {
  ok: boolean;
  channels: ChatChannelDef[];
  messages: ChatMessage[];
}

interface ChatChannelResponse {
  ok: boolean;
  channel: ChatChannelDef;
  messages: ChatMessage[];
}

interface ChatMessageResponse {
  ok: boolean;
  channel: ChatChannelDef;
  message: ChatMessage;
}

interface ChatReadResponse {
  ok: boolean;
  channelId: string;
  userId: string;
  readAt: string;
}

export const fetchChatBootstrap = async () => {
  return authorizedGet<ChatBootstrapResponse>('/api/chat/bootstrap');
};

export const fetchServerChatChannel = async (channelId: string) => {
  return authorizedGet<ChatChannelResponse>(`/api/chat/channels/${channelId}`);
};

export const createServerChatChannel = async (payload: {
  id?: string;
  type: ChatChannel;
  name: string;
  participants: string[];
}) => {
  return authorizedPost<ChatChannelResponse>('/api/chat/channels', payload);
};

export const sendServerChatMessage = async (channelId: string, text: string, replyTo?: string) => {
  return authorizedPost<ChatMessageResponse>(`/api/chat/channels/${channelId}/messages`, { text, replyTo });
};

export const markServerChatChannelRead = async (channelId: string) => {
  return authorizedPost<ChatReadResponse>(`/api/chat/channels/${channelId}/read`);
};
