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
