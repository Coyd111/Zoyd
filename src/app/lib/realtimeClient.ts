import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { User } from '../stores/authStore';
import { useAuthStore } from '../stores/authStore';
import type { ChatChannelDef, ChatMessage } from '../stores/chatStore';
import type { Match } from '../stores/matchStore';
import type { Tournament } from '../stores/tournamentStore';

export interface ServerPresenceSnapshot {
  channelId: string;
  members: Array<{
    userId: string;
    pseudo: string;
    role: 'player' | 'arbiter' | 'spectator';
    team?: 0 | 1;
    isCheckedIn: boolean;
    isReady: boolean;
    isOnline: boolean;
    lastActiveAt?: string;
  }>;
  seen: Record<string, string>;
}

export interface ServerTypingSnapshot {
  channelId: string;
  members: Array<{
    userId: string;
    pseudo: string;
    startedAt: string;
  }>;
}

export interface PushDeliveryPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

interface RealtimeSession {
  token: string;
  userId: string;
  pseudo: string;
  role: string;
  issuedAt: string;
  expiresAt: string;
}

interface RealtimeHandlers {
  onConnect?: (socket: Socket) => void;
  onDisconnect?: () => void;
  onPresenceSnapshot?: (snapshot: ServerPresenceSnapshot) => void;
  onTypingSnapshot?: (snapshot: ServerTypingSnapshot) => void;
  onPushDelivery?: (payload: PushDeliveryPayload) => void;
  onMatchesSnapshot?: (matches: Match[]) => void;
  onTournamentsSnapshot?: (tournaments: Tournament[]) => void;
  onChatChannel?: (channel: ChatChannelDef) => void;
  onChatMessage?: (payload: { channel: ChatChannelDef; message: ChatMessage }) => void;
  onChatRead?: (payload: { channelId: string; userId: string; readAt: string }) => void;
}

let socket: Socket | null = null;
let boundHandlers: RealtimeHandlers | null = null;
let identifiedUser: Pick<User, 'id' | 'pseudo' | 'role'> | null = null;
let activeSession: RealtimeSession | null = null;
let sessionPromise: Promise<RealtimeSession> | null = null;

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }
  return window.location.origin;
};

const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;

const isSessionValid = (session: RealtimeSession | null, user: User) => {
  if (!session) return false;
  if (session.userId !== user.id) return false;
  return new Date(session.expiresAt).getTime() - Date.now() > 60_000;
};

const ensureRealtimeSession = async (user: User) => {
  if (isSessionValid(activeSession, user)) {
    return activeSession as RealtimeSession;
  }

  if (sessionPromise) {
    return sessionPromise;
  }

  const appSessionToken = useAuthStore.getState().sessionToken;
  if (!appSessionToken) {
    throw new Error('Application session required before realtime connection.');
  }

  sessionPromise = fetch(getApiUrl('/api/realtime/auth/session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${appSessionToken}`,
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Unable to create realtime session.');
      }
      const payload = await response.json();
      activeSession = payload.session as RealtimeSession;
      return activeSession;
    })
    .finally(() => {
      sessionPromise = null;
    });

  return sessionPromise;
};

export const getRealtimeSocket = () => {
  if (!socket) {
    socket = io(getBaseUrl(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: false,
      withCredentials: false,
    });
  }

  return socket;
};

export const bindRealtimeHandlers = (handlers: RealtimeHandlers) => {
  const currentSocket = getRealtimeSocket();
  boundHandlers = handlers;

  currentSocket.off('connect');
  currentSocket.off('disconnect');
  currentSocket.off('presence:snapshot');
  currentSocket.off('typing:snapshot');
  currentSocket.off('notification:deliver');
  currentSocket.off('state:matches');
  currentSocket.off('state:tournaments');
  currentSocket.off('chat:channel');
  currentSocket.off('chat:message');
  currentSocket.off('chat:read');

  currentSocket.on('connect', () => handlers.onConnect?.(currentSocket));
  currentSocket.on('disconnect', () => handlers.onDisconnect?.());
  currentSocket.on('presence:snapshot', (snapshot) => handlers.onPresenceSnapshot?.(snapshot));
  currentSocket.on('typing:snapshot', (snapshot) => handlers.onTypingSnapshot?.(snapshot));
  currentSocket.on('notification:deliver', (payload) => handlers.onPushDelivery?.(payload));
  currentSocket.on('state:matches', (payload) => handlers.onMatchesSnapshot?.(payload.items || []));
  currentSocket.on('state:tournaments', (payload) => handlers.onTournamentsSnapshot?.(payload.items || []));
  currentSocket.on('chat:channel', (payload) => handlers.onChatChannel?.(payload.channel));
  currentSocket.on('chat:message', (payload) => handlers.onChatMessage?.(payload));
  currentSocket.on('chat:read', (payload) => handlers.onChatRead?.(payload));
};

export const connectRealtimeSocket = async (user: User) => {
  const currentSocket = getRealtimeSocket();
  identifiedUser = {
    id: user.id,
    pseudo: user.pseudo,
    role: user.role,
  };

  const session = await ensureRealtimeSession(user);
  currentSocket.auth = {
    token: session.token,
  };

  if (boundHandlers) {
    bindRealtimeHandlers(boundHandlers);
  }

  if (!currentSocket.connected) {
    currentSocket.connect();
  }

  return currentSocket;
};

export const disconnectRealtimeSocket = () => {
  identifiedUser = null;
  activeSession = null;
  socket?.disconnect();
};

export const isRealtimeSocketConnected = () => Boolean(socket?.connected);

export const emitPresenceJoin = (payload: {
  channelId: string;
  userId: string;
  pseudo: string;
  role?: 'player' | 'arbiter' | 'spectator';
  team?: 0 | 1;
  isCheckedIn?: boolean;
  isReady?: boolean;
}) => {
  getRealtimeSocket().emit('presence:join', payload);
};

export const emitPresenceUpdate = (payload: {
  channelId: string;
  userId: string;
  pseudo: string;
  role?: 'player' | 'arbiter' | 'spectator';
  team?: 0 | 1;
  isCheckedIn?: boolean;
  isReady?: boolean;
}) => {
  getRealtimeSocket().emit('presence:update', payload);
};

export const emitPresenceLeave = (payload: { channelId: string }) => {
  getRealtimeSocket().emit('presence:leave', payload);
};

export const emitChannelSeen = (payload: { channelId: string; userId: string }) => {
  getRealtimeSocket().emit('channel:seen', payload);
};

export const emitTypingUpdate = (payload: {
  channelId: string;
  userId: string;
  pseudo: string;
  isTyping: boolean;
}) => {
  getRealtimeSocket().emit('typing:update', payload);
};

export const emitPushNotification = (payload: {
  targetUserId: string;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}) => {
  getRealtimeSocket().emit('notification:push', payload);
};

const buildAuthHeaders = async (user: User) => {
  const session = await ensureRealtimeSession(user);
  return {
    Authorization: `Bearer ${session.token}`,
  };
};

export const fetchRealtimeBootstrap = async (user: User) => {
  const headers = await buildAuthHeaders(user);
  const response = await fetch(getApiUrl('/api/realtime/state/bootstrap'), {
    headers,
  });

  if (!response.ok) {
    throw new Error('Unable to fetch realtime bootstrap.');
  }

  return (await response.json()) as {
    ok: boolean;
    matches: Match[];
    tournaments: Tournament[];
    timestamp: string;
  };
};

export const syncRealtimeState = async (
  kind: 'matches' | 'tournaments',
  items: Match[] | Tournament[],
  user: User
) => {
  const headers = await buildAuthHeaders(user);
  const response = await fetch(getApiUrl('/api/realtime/state/sync'), {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, items }),
  });

  if (!response.ok) {
    throw new Error(`Unable to sync realtime ${kind}.`);
  }

  return response.json();
};

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; ++index) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
};

export const fetchVapidPublicKey = async () => {
  const response = await fetch(getApiUrl('/api/realtime/push/public-key'));
  if (!response.ok) {
    throw new Error('Unable to load VAPID public key.');
  }

  const payload = await response.json();
  return payload.publicKey as string;
};

export const subscribeToRealtimePush = async (user: User, registration: ServiceWorkerRegistration) => {
  if (!('PushManager' in window)) {
    return false;
  }

  const publicKey = await fetchVapidPublicKey();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const headers = await buildAuthHeaders(user);
  await fetch(getApiUrl('/api/realtime/push/subscribe'), {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscription,
    }),
  });

  return true;
};

export const unsubscribeFromRealtimePush = async (user: User, registration: ServiceWorkerRegistration) => {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const headers = await buildAuthHeaders(user);
  await fetch(getApiUrl('/api/realtime/push/unsubscribe'), {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
    }),
  });

  await subscription.unsubscribe();
};
