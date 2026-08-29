import { create } from 'zustand';

export type ChatChannel = 'global' | 'match' | 'team' | 'private' | 'arbitration';

export interface ChatMessage {
  id: string;
  channelId: string;
  channelType: ChatChannel;
  senderId: string;
  senderPseudo: string;
  senderAvatar?: string;
  text: string;
  timestamp: string;
  isSystem?: boolean;
  isDeleted?: boolean;
  replyTo?: string;
}

export interface ChatChannelDef {
  id: string;
  type: ChatChannel;
  name: string;
  participants: string[];
  unreadCount: number;
  lastMessageAt?: string;
  isMuted: boolean;
  scope?: 'public' | 'participants';
  inbox?: 'all' | 'participants';
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatState {
  channels: ChatChannelDef[];
  messages: ChatMessage[];
  activeChannelId: string | null;
  setActiveChannel: (id: string | null) => void;
  replaceFromServer: (channels: ChatChannelDef[], messages: ChatMessage[]) => void;
  hydrateFromServer: (channels: ChatChannelDef[], messages: ChatMessage[]) => void;
  upsertServerChannel: (channel: ChatChannelDef) => void;
  receiveServerMessage: (message: ChatMessage, currentUserId?: string | null) => void;
  applyServerRead: (channelId: string, userId?: string | null, currentUserId?: string | null) => void;
  createChannel: (type: ChatChannel, name: string, participants: string[]) => string;
  syncChannelParticipants: (channelId: string, participants: string[]) => void;
  sendMessage: (channelId: string, text: string, senderId: string, senderPseudo: string, isSystem?: boolean) => void;
  deleteMessage: (messageId: string) => void;
  markAsRead: (channelId: string) => void;
  muteChannel: (channelId: string) => void;
  unmuteChannel: (channelId: string) => void;
  getMessagesForChannel: (channelId: string) => ChatMessage[];
  getChannelById: (channelId: string) => ChatChannelDef | undefined;
  getUnreadTotal: () => number;
}

const MAX_MESSAGES = 500;

const normalizeChannel = (channel: ChatChannelDef): ChatChannelDef => ({
  ...channel,
  participants: [...new Set(Array.isArray(channel.participants) ? channel.participants : [])],
  unreadCount: Math.max(0, Number(channel.unreadCount || 0)),
  isMuted: Boolean(channel.isMuted),
});

const normalizeMessage = (message: ChatMessage): ChatMessage => ({
  ...message,
  text: message.isDeleted ? '[Message supprime]' : message.text,
});

const sortChannels = (channels: ChatChannelDef[]) =>
  [...channels].sort((left, right) => {
    const rightTs = new Date(right.lastMessageAt || right.updatedAt || right.createdAt || 0).getTime();
    const leftTs = new Date(left.lastMessageAt || left.updatedAt || left.createdAt || 0).getTime();
    return rightTs - leftTs;
  });

const sortMessages = (messages: ChatMessage[]) =>
  [...messages].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

const mergeChannelCollections = (current: ChatChannelDef[], incoming: ChatChannelDef[]) => {
  const mutedById = new Map(current.map((channel) => [channel.id, channel.isMuted]));
  const merged = new Map(current.map((channel) => [channel.id, normalizeChannel(channel)]));

  for (const incomingChannel of incoming) {
    const normalizedIncoming = normalizeChannel(incomingChannel);
    const existing = merged.get(normalizedIncoming.id);
    merged.set(normalizedIncoming.id, {
      ...existing,
      ...normalizedIncoming,
      isMuted: mutedById.get(normalizedIncoming.id) ?? normalizedIncoming.isMuted,
    });
  }

  return sortChannels([...merged.values()]);
};

const mergeMessageCollections = (current: ChatMessage[], incoming: ChatMessage[]) => {
  const merged = new Map(current.map((message) => [message.id, normalizeMessage(message)]));
  for (const incomingMessage of incoming) {
    merged.set(incomingMessage.id, normalizeMessage(incomingMessage));
  }
  const sorted = sortMessages([...merged.values()]);
  return sorted.length > MAX_MESSAGES ? sorted.slice(sorted.length - MAX_MESSAGES) : sorted;
};

const resolveActiveChannelId = (channels: ChatChannelDef[], preferredId: string | null) => {
  if (preferredId && channels.some((channel) => channel.id === preferredId)) {
    return preferredId;
  }
  return channels.find((channel) => channel.id === 'global')?.id || channels[0]?.id || null;
};

export const useChatStore = create<ChatState>((set, get) => ({
  channels: [],
  messages: [],
  activeChannelId: 'global',

  setActiveChannel: (id) => set({ activeChannelId: id }),

  replaceFromServer: (channels, messages) => {
    set((state) => {
      const nextChannels = mergeChannelCollections([], channels);
      const sorted = sortMessages(messages.map(normalizeMessage));
      return {
        channels: nextChannels,
        messages: sorted.length > MAX_MESSAGES ? sorted.slice(sorted.length - MAX_MESSAGES) : sorted,
        activeChannelId: resolveActiveChannelId(nextChannels, state.activeChannelId),
      };
    });
  },

  hydrateFromServer: (channels, messages) => {
    set((state) => {
      const nextChannels = mergeChannelCollections(state.channels, channels);
      return {
        channels: nextChannels,
        messages: mergeMessageCollections(state.messages, messages),
        activeChannelId: resolveActiveChannelId(nextChannels, state.activeChannelId),
      };
    });
  },

  upsertServerChannel: (channel) => {
    set((state) => {
      const nextChannels = mergeChannelCollections(state.channels, [channel]);
      return {
        channels: nextChannels,
        activeChannelId: resolveActiveChannelId(nextChannels, state.activeChannelId),
      };
    });
  },

  receiveServerMessage: (message, currentUserId) => {
    const normalizedMessage = normalizeMessage(message);
    set((state) => {
      if (state.messages.some((entry) => entry.id === normalizedMessage.id)) {
        return state;
      }

      const isDuplicate = state.messages.some(
        (entry) =>
          entry.channelId === normalizedMessage.channelId &&
          entry.senderId === normalizedMessage.senderId &&
          entry.text === normalizedMessage.text &&
          Math.abs(new Date(entry.timestamp).getTime() - new Date(normalizedMessage.timestamp).getTime()) < 5000
      );
      if (isDuplicate) {
        return state;
      }

      const existingChannel = state.channels.find((channel) => channel.id === normalizedMessage.channelId);
      const fallbackChannel: ChatChannelDef = existingChannel || {
        id: normalizedMessage.channelId,
        type: normalizedMessage.channelType,
        name: normalizedMessage.channelType === 'global' ? 'Chat Global ZOYD' : `Canal ${normalizedMessage.channelId}`,
        participants: [],
        unreadCount: 0,
        isMuted: false,
        lastMessageAt: normalizedMessage.timestamp,
      };

      const shouldIncrementUnread =
        state.activeChannelId !== normalizedMessage.channelId &&
        normalizedMessage.senderId !== currentUserId;

      const nextChannels = mergeChannelCollections(state.channels, [
        {
          ...fallbackChannel,
          lastMessageAt: normalizedMessage.timestamp,
          updatedAt: normalizedMessage.timestamp,
          unreadCount: shouldIncrementUnread
            ? Number(fallbackChannel.unreadCount || 0) + 1
            : Number(fallbackChannel.unreadCount || 0),
        },
      ]);

      return {
        channels: nextChannels,
        messages: (() => {
          const next = sortMessages([...state.messages, normalizedMessage]);
          return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
        })(),
        activeChannelId: resolveActiveChannelId(nextChannels, state.activeChannelId),
      };
    });
  },

  applyServerRead: (channelId, userId, currentUserId) => {
    if (userId && currentUserId && userId !== currentUserId) return;

    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, unreadCount: 0 } : channel
      ),
    }));
  },

  createChannel: (type, name, participants) => {
    const existing = get().channels.find((channel) => channel.name === name && channel.type === type);
    if (existing) {
      get().syncChannelParticipants(existing.id, participants);
      return existing.id;
    }

    const id = `CH-${type}-${Date.now()}`;
    const channel: ChatChannelDef = {
      id,
      type,
      name,
      participants: [...new Set(participants)],
      unreadCount: 0,
      isMuted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    set((state) => ({
      channels: sortChannels([channel, ...state.channels]),
      activeChannelId: state.activeChannelId || id,
    }));

    return id;
  },

  syncChannelParticipants: (channelId, participants) => {
    const uniqueParticipants = [...new Set(participants)];
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, participants: uniqueParticipants } : channel
      ),
    }));
  },

  sendMessage: (channelId, text, senderId, senderPseudo, isSystem = false) => {
    const msg: ChatMessage = {
      id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      channelId,
      channelType: get().channels.find((channel) => channel.id === channelId)?.type || 'global',
      senderId,
      senderPseudo,
      text,
      timestamp: new Date().toISOString(),
      isSystem,
    };

    set((state) => {
      const updatedChannels = state.channels.map((channel) =>
        channel.id === channelId
          ? { ...channel, lastMessageAt: msg.timestamp }
          : channel
      );

      return {
        messages: (() => {
          const next = sortMessages([...state.messages, msg]);
          return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
        })(),
        channels: sortChannels(updatedChannels),
      };
    });
  },

  deleteMessage: (messageId) => {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? { ...message, isDeleted: true, text: '[Message supprime]' }
          : message
      ),
    }));
  },

  markAsRead: (channelId) => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, unreadCount: 0 } : channel
      ),
    }));
  },

  muteChannel: (channelId) => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, isMuted: true } : channel
      ),
    }));
  },

  unmuteChannel: (channelId) => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, isMuted: false } : channel
      ),
    }));
  },

  getMessagesForChannel: (channelId) => get().messages.filter((message) => message.channelId === channelId),

  getChannelById: (channelId) => get().channels.find((channel) => channel.id === channelId),

  getUnreadTotal: () =>
    get().channels.reduce((sum, channel) => sum + (channel.isMuted ? 0 : channel.unreadCount), 0),
}));
