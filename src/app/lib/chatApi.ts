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
  try {
    return await authorizedGet<ChatBootstrapResponse>('/api/chat/bootstrap');
  } catch (error) {
    console.error('Erreur chargement chat:', error instanceof Error ? error.message : 'Erreur inconnue');
    throw error;
  }
};

export const fetchServerChatChannel = async (channelId: string) => {
  try {
    return await authorizedGet<ChatChannelResponse>(`/api/chat/channels/${channelId}`);
  } catch (error) {
    console.error('Erreur chargement salon:', error instanceof Error ? error.message : 'Erreur inconnue');
    throw error;
  }
};

export const createServerChatChannel = async (payload: {
  id?: string;
  type: ChatChannel;
  name: string;
  participants: string[];
}) => {
  try {
    return await authorizedPost<ChatChannelResponse>('/api/chat/channels', payload);
  } catch (error) {
    console.error('Erreur creation salon:', error instanceof Error ? error.message : 'Erreur inconnue');
    throw error;
  }
};

export const sendServerChatMessage = async (channelId: string, text: string, replyTo?: string) => {
  try {
    return await authorizedPost<ChatMessageResponse>(`/api/chat/channels/${channelId}/messages`, { text, replyTo });
  } catch (error) {
    console.error('Erreur envoi message:', error instanceof Error ? error.message : 'Erreur inconnue');
    throw error;
  }
};

export const markServerChatChannelRead = async (channelId: string) => {
  try {
    return await authorizedPost<ChatReadResponse>(`/api/chat/channels/${channelId}/read`);
  } catch (error) {
    console.error('Erreur marquage lu:', error instanceof Error ? error.message : 'Erreur inconnue');
    throw error;
  }
};
