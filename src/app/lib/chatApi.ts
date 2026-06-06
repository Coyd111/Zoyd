import { useAuthStore } from '../stores/authStore';
import type { ChatChannel, ChatChannelDef, ChatMessage } from '../stores/chatStore';

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

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

const getAuthHeaders = () => {
  const token = useAuthStore.getState().sessionToken;
  if (!token) {
    throw new Error('Session joueur requise.');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Une erreur reseau est survenue.');
  }

  return payload as T;
};

const authorizedGet = async <T>(path: string) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
      },
    })
  );

const authorizedPost = async <T>(path: string, body?: unknown) =>
  readJson<T>(
    await fetch(getApiUrl(path), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

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
