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

export const fetchChatBootstrap = () => authorizedGet<ChatBootstrapResponse>('/api/chat/bootstrap');

export const fetchServerChatChannel = (channelId: string) =>
  authorizedGet<ChatChannelResponse>(`/api/chat/channels/${channelId}`);

export const createServerChatChannel = (payload: {
  id?: string;
  type: ChatChannel;
  name: string;
  participants: string[];
}) => authorizedPost<ChatChannelResponse>('/api/chat/channels', payload);

export const sendServerChatMessage = (channelId: string, text: string, replyTo?: string) =>
  authorizedPost<ChatMessageResponse>(`/api/chat/channels/${channelId}/messages`, { text, replyTo });

export const markServerChatChannelRead = (channelId: string) =>
  authorizedPost<ChatReadResponse>(`/api/chat/channels/${channelId}/read`);
