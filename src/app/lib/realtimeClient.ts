/**
 * realtimeClient - client socket.io : session temps reel, rooms, emissions, push.
 *
 * Cree le socket (singleton), obtient un jeton temps reel par POST
 * /api/realtime/auth/session, branche les 13 evenements, emet presence et
 * push, et gere l'abonnement Web Push.
 *
 * INVARIANT : ce module n'importe JAMAIS apiClient. Il utilise apiUrl.ts pour
 * casser le cycle d'imports (apiClient -> ... -> realtimeClient -> apiClient).
 * INVARIANT : autoConnect est false. Le socket ne se connecte qu'APRES
 * obtention d'une session temps reel valide ; sinon il part en unauthorized.
 * PIEGE : bindRealtimeHandlers retire les handlers avant de les rebrancher.
 * Une omission sur la liste des `off()` empile les handlers a chaque
 * remontage : c'est le cas de `wallet:update`, pose mais jamais retire.
 * PIEGE : le socket diffuse des DELTAS et n'envoie aucun etat initial a la
 * connexion (seulement server:hello). Hors ligne, tout ce qui s'est passe
 * pendant la coupure est perdu : c'est dirtySinceDisconnect, cote store, qui
 * organise la resynchronisation.
 * PIEGE : le push et l'authentification temps reel utilisent un Bearer, pas
 * le cookie applicatif.
 *
 * Voir aussi : docs/08-frontend.md - section 7 (Le client temps reel)
 */
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { User } from '../stores/authStore';
// `./apiUrl` et non `./apiClient` : apiClient tire sessionReset -> socketStore
// -> socketConnectionStore -> nous-memes. Passer par le module feuille casse
// le cycle (cf. apiUrl.ts).
import { getApiUrl, getBaseUrl } from './apiUrl';
import type { ChatChannelDef, ChatMessage } from '../stores/chatStore';
import type { Match } from '../stores/matchStore';
import type { Tournament } from '../stores/tournamentStore';
import type { LeagueSeason } from '../stores/leagueStore';
import type { FriendRequestStatus } from '../stores/friendsStore';
import type { WalletSnapshot } from './walletApi';

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
  onLeaguesSnapshot?: (seasons: LeagueSeason[]) => void;
  /**
   * Portefeuille mis à jour par le serveur après une mutation (retrait,
   * cagnotte, remise, litige).
   *
   * Sans cet événement, un joueur qui retirait dans un onglet voyait tous les
   * autres afficher l'ancien solde jusqu'au rechargement de la page.
   */
  onWalletUpdate?: (wallet: WalletSnapshot) => void;
  onChatChannel?: (channel: ChatChannelDef) => void;
  onChatMessage?: (payload: { channel: ChatChannelDef; message: ChatMessage }) => void;
  onChatRead?: (payload: { channelId: string; userId: string; readAt: string }) => void;
}

let socket: Socket | null = null;
let boundHandlers: RealtimeHandlers | null = null;
let identifiedUser: Pick<User, 'id' | 'pseudo' | 'role'> | null = null;
let activeSession: RealtimeSession | null = null;
let sessionPromise: Promise<RealtimeSession> | null = null;

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

  // La session app est prouvée par le cookie httpOnly (credentials:include),
  // plus besoin du token en JS.
  sessionPromise = fetch(getApiUrl('/api/realtime/auth/session'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
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
      // Envoie le cookie httpOnly pendant le handshake (fallback serveur).
      withCredentials: true,
    });
  }

  return socket;
};

export const bindRealtimeHandlers = (handlers: RealtimeHandlers) => {
  const currentSocket = getRealtimeSocket();
  boundHandlers = handlers;

  currentSocket.off('connect');
  currentSocket.off('disconnect');
  currentSocket.off('connect_error');
  currentSocket.off('presence:snapshot');
  currentSocket.off('typing:snapshot');
  currentSocket.off('notification:deliver');
  currentSocket.off('state:matches');
  currentSocket.off('state:tournaments');
  currentSocket.off('state:leagues');
  currentSocket.off('chat:channel');
  currentSocket.off('chat:message');
  currentSocket.off('chat:read');

  currentSocket.on('connect', () => handlers.onConnect?.(currentSocket));
  currentSocket.on('disconnect', () => handlers.onDisconnect?.());
  // Session realtime expirée (sleep Render…) : on régénère puis on retente,
  // au lieu de boucler en unauthorized avec le même token.
  currentSocket.on('connect_error', (err: Error) => {
    if (String(err?.message || '').includes('unauthorized') && identifiedUser) {
      activeSession = null;
      ensureRealtimeSession(identifiedUser as User)
        .then((session) => {
          currentSocket.auth = { token: session.token };
          currentSocket.connect();
        })
        .catch(() => { /* retry au prochain cycle */ });
    }
  });
  currentSocket.on('presence:snapshot', (snapshot) => handlers.onPresenceSnapshot?.(snapshot));
  currentSocket.on('typing:snapshot', (snapshot) => handlers.onTypingSnapshot?.(snapshot));
  currentSocket.on('notification:deliver', (payload) => handlers.onPushDelivery?.(payload));
  currentSocket.on('state:matches', (payload) => handlers.onMatchesSnapshot?.(payload.items || []));
  currentSocket.on('state:tournaments', (payload) => handlers.onTournamentsSnapshot?.(payload.items || []));
  currentSocket.on('state:leagues', (payload) => handlers.onLeaguesSnapshot?.(payload.items || []));
  currentSocket.on('wallet:update', (payload) => handlers.onWalletUpdate?.(payload?.wallet));
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
  // P11 C2 (audit-3) : la promesse de session n'était pas invalidée — si le
  // compte B se connectait pendant que le POST /api/realtime/auth/session du
  // compte A était EN VOL, `ensureRealtimeSession` (garde `if (sessionPromise)
  // return sessionPromise`) rendait la promesse de A : activeSession devient
  // la session de A et le socket de B s'authentifie avec le token de A
  // (rooms user:A, notifications de A) jusqu'à déconnexion ou expiration
  // (6 h). Fenêtre = durée du POST, aucune escalade — mais une ligne suffit :
  // la déconnexion coupe aussi la course. La recopie tardive de la promesse
  // résolue ne contamine plus rien : le socket lu via `await
  // ensureRealtimeSession(user)` est par appel, et le garde
  // `isSessionValid` refuse une session qui ne correspond pas au compte.
  sessionPromise = null;
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

/**
 * Le serveur renvoie `getFriendsForUser()` = `getPublicUserById()` sur chaque
 * ami, donc des PROFILS PUBLICS (`id`, `country`, `controllerType`,
 * `trustScore`, `streamerMode`…) et non des `{ userId, status }`.
 * Le type précédent annonçait `userId`/`status`/`createdAt` : `friend.id`
 * valait undefined à l'exécution et la liste d'amis était cassée.
 * `status` et `isStreamer` sont dérivés côté store.
 *
 * P11 C4 (audit-3) : ces trois interfaces vivaient DANS le corps de
 * `fetchRealtimeBootstrap`, entre le garde `response.ok` et le `return` —
 * légal en TypeScript (types de bloc, aucun impact runtime), mais un
 * placement accidentel qui mentait sur la structure. Remontées au niveau
 * module, aucun changement de comportement.
 */
interface BootstrapFriend {
  id: string;
  pseudo: string;
  avatar?: string;
  country: string;
  controllerType: string;
  trustScore: number;
  streamerMode?: boolean;
  lastSeen?: string;
}

/** Normalisé côté serveur (`getFriendRequestsForUser` renvoie déjà
 *  `senderPseudo` et `timestamp`, plus les ids bruts). */
interface BootstrapFriendRequest {
  id: string;
  senderId: string;
  targetId: string;
  senderPseudo?: string;
  senderAvatar?: string;
  status: FriendRequestStatus;
  message?: string;
  timestamp?: string;
}

interface BootstrapNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
}

export const fetchRealtimeBootstrap = async (user: User) => {
  const headers = await buildAuthHeaders(user);
  const response = await fetch(getApiUrl('/api/realtime/state/bootstrap'), {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error('Unable to fetch realtime bootstrap.');
  }

  return (await response.json()) as {
    ok: boolean;
    matches: Match[];
    tournaments: Tournament[];
    friends: BootstrapFriend[];
    friendRequests: BootstrapFriendRequest[];
    blockedIds: string[];
    notifications: BootstrapNotification[];
    timestamp: string;
  };
};

// `syncRealtimeState` et la route `/api/realtime/state/sync` ont ete
// supprimes : le serveur refusait tout (409 pour les tournois, 400 sinon), et
// rien ne l appelait. La fonction avait l air de fonctionner, ce qui en
// faisait un piege : la rebrancher produisait un 400 sans explication.
// La synchronisation passe par les routes API dediees.

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
  const response = await fetch(getApiUrl('/api/realtime/push/subscribe'), {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscription,
    }),
  });

  // P11 C3 (audit-3) : la réponse serveur n'était pas lue — un 401 (session
  // temps réel expirée entre-temps) ou un 500 répondaient `true`, et
  // l'avertissement du hook ne se déclenchait que si le fetch JETTAIT.
  // Aligné sur fetchRealtimeBootstrap / fetchVapidPublicKey qui, eux,
  // vérifient : échec applicatif = échec annoncé. Les appels existants sont
  // couverts (useServiceWorker logue, useLogout avale volontairement).
  if (!response.ok) {
    throw new Error(`Realtime push subscribe refused: HTTP ${response.status}`);
  }

  return true;
};

export const unsubscribeFromRealtimePush = async (user: User, registration: ServiceWorkerRegistration) => {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const headers = await buildAuthHeaders(user);
  const response = await fetch(getApiUrl('/api/realtime/push/unsubscribe'), {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
    }),
  });

  // P11 C3 (audit-3) : la désinscription navigateur n'avait lieu QUE SI le
  // serveur a accepté — avant, un 500 côté serveur laissait l'abonnement
  // navigateur supprimé avec une entrée orpheline côté serveur. L'échec est
  // annoncé (throw) ; l'appelant useLogout avale volontairement, le
  // navigateur retente à la prochaine déconnexion.
  if (!response.ok) {
    throw new Error(`Realtime push unsubscribe refused: HTTP ${response.status}`);
  }

  await subscription.unsubscribe();
};
