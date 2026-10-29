import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSocketConnectionStore } from './socketConnectionStore';
import { useNotificationStore } from './notificationStore';

const { handlers, fetchRealtimeBootstrap } = vi.hoisted(() => ({
  handlers: { current: null as Record<string, () => void> | null },
  fetchRealtimeBootstrap: vi.fn(),
}));

vi.mock('../lib/realtimeClient', () => ({
  bindRealtimeHandlers: (h: Record<string, () => void>) => {
    handlers.current = h;
  },
  connectRealtimeSocket: vi.fn(),
  disconnectRealtimeSocket: vi.fn(),
  emitPresenceUpdate: vi.fn(),
  fetchRealtimeBootstrap,
  isRealtimeSocketConnected: vi.fn(() => true),
}));

// `connect()` court-circuite sur `typeof window === 'undefined'` : les tests
// unitaires tournent en Node (voir vitest.config.ts). On installe donc un
// `window` minimal pour survivre a cette garde, qui existe pour le SSR.
beforeEach(() => {
  (globalThis as unknown as { window?: unknown }).window = globalThis;
});
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const user = { id: 'u1', pseudo: 'FAVARO', email: 'a@b.c' } as never;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('socketConnectionStore — reprise apres coupure', () => {
  beforeEach(() => {
    handlers.current = null;
    fetchRealtimeBootstrap.mockReset();
    fetchRealtimeBootstrap.mockResolvedValue({
      friends: [],
      friendRequests: [],
      blockedIds: [],
      notifications: [],
      matches: [],
      tournaments: [],
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    useSocketConnectionStore.getState().disconnect();
    useSocketConnectionStore.setState({
      isConnected: false,
      serverConnected: false,
      bootstrapReady: false,
      bootstrapFailed: false,
      dirtySinceDisconnect: false,
      connectionLabel: 'offline',
    });
  });

  it('ne resynchronise pas a la premiere connexion (le bootstrap de montage suffit)', async () => {
    useSocketConnectionStore.getState().connect(user);
    handlers.current!.onConnect();
    await flush();
    expect(fetchRealtimeBootstrap).not.toHaveBeenCalled();
  });

  it('resynchronise apres une coupure, sinon le delta perdu est definitif', async () => {
    useSocketConnectionStore.getState().connect(user);

    // Bootstrap initial : le joueur a un etat synchronise.
    await useSocketConnectionStore.getState().bootstrapServerState(user);
    expect(useSocketConnectionStore.getState().bootstrapReady).toBe(true);
    fetchRealtimeBootstrap.mockClear();

    // Coupure reseau.
    handlers.current!.onDisconnect();
    expect(useSocketConnectionStore.getState().connectionLabel).toBe('syncing');

    // Retour du socket.
    handlers.current!.onConnect();
    await flush();

    expect(fetchRealtimeBootstrap).toHaveBeenCalledTimes(1);
    expect(useSocketConnectionStore.getState().connectionLabel).toBe('live');
    expect(useSocketConnectionStore.getState().dirtySinceDisconnect).toBe(false);
  });

  it('ne resynchronise pas deux fois si la coupure suit un echec de bootstrap', async () => {
    fetchRealtimeBootstrap.mockRejectedValueOnce(new Error('reseau'));
    useSocketConnectionStore.getState().connect(user);

    handlers.current!.onConnect();
    await flush();
    expect(fetchRealtimeBootstrap).not.toHaveBeenCalled();

    handlers.current!.onDisconnect();
    handlers.current!.onConnect();
    await flush();
    // bootstrapReady est false : on ne relance rien, le hook heartbeat
    // retryera au prochain montage plutot que de boucler ici.
    expect(fetchRealtimeBootstrap).not.toHaveBeenCalled();
  });

  it('ne confond pas un logout avec une coupure', async () => {
    useSocketConnectionStore.getState().connect(user);
    await useSocketConnectionStore.getState().bootstrapServerState(user);
    fetchRealtimeBootstrap.mockClear();

    useSocketConnectionStore.getState().disconnect();
    handlers.current!.onConnect();
    await flush();

    expect(fetchRealtimeBootstrap).not.toHaveBeenCalled();
  });

  it('signale syncing tant que la reprise n a pas abouti', async () => {
    useSocketConnectionStore.getState().connect(user);
    await useSocketConnectionStore.getState().bootstrapServerState(user);

    fetchRealtimeBootstrap.mockRejectedValueOnce(new Error('toujours pas'));
    handlers.current!.onDisconnect();
    handlers.current!.onConnect();
    await flush();

    const state = useSocketConnectionStore.getState();
    expect(state.connectionLabel).toBe('syncing');
    expect(state.dirtySinceDisconnect).toBe(true);
  });
});

/**
 * F2 - un echec de bootstrap doit etre VISIBLE, pas silencieux.
 *
 * Avant le correctif, l'echec ne remettait que `serverConnected` et
 * `connectionLabel` : `bootstrapReady` restait false, et les cinq ecrans qui
 * pilotaient leur squelette dessus restaient bloques A JAMAIS - le joueur ne
 * voyait jamais son solde. Desormais `bootstrapFailed` porte l'echec, se
 * revele (les ecrans rendent "chargement impossible + Reessayer"), et est
 * efface par une reussite ULTERIEURE ou par une deconnexion volontaire.
 */
describe('socketConnectionStore — echec de bootstrap visible (F2)', () => {
  beforeEach(() => {
    handlers.current = null;
    fetchRealtimeBootstrap.mockReset();
    useSocketConnectionStore.getState().disconnect();
    useSocketConnectionStore.setState({
      isConnected: false,
      serverConnected: false,
      bootstrapReady: false,
      bootstrapFailed: false,
      dirtySinceDisconnect: false,
      connectionLabel: 'offline',
    });
  });

  it('pose bootstrapFailed quand le bootstrap echoue', async () => {
    fetchRealtimeBootstrap.mockRejectedValueOnce(new Error('serveur en veille'));

    await useSocketConnectionStore.getState().bootstrapServerState(user);

    const state = useSocketConnectionStore.getState();
    expect(state.bootstrapReady).toBe(false);
    expect(state.bootstrapFailed).toBe(true);
  });

  it('efface bootstrapFailed quand une nouvelle tentative reussit', async () => {
    fetchRealtimeBootstrap.mockRejectedValueOnce(new Error("d'abord rate"));

    await useSocketConnectionStore.getState().bootstrapServerState(user);
    expect(useSocketConnectionStore.getState().bootstrapFailed).toBe(true);

    fetchRealtimeBootstrap.mockResolvedValueOnce({
      friends: [],
      friendRequests: [],
      blockedIds: [],
      notifications: [],
      matches: [],
      tournaments: [],
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    await useSocketConnectionStore.getState().bootstrapServerState(user);

    const state = useSocketConnectionStore.getState();
    expect(state.bootstrapReady).toBe(true);
    expect(state.bootstrapFailed).toBe(false);
  });

  it('reset bootstrapFailed a la deconnexion volontaire', async () => {
    fetchRealtimeBootstrap.mockRejectedValue(new Error('jamais repondu'));
    await useSocketConnectionStore.getState().bootstrapServerState(user);
    expect(useSocketConnectionStore.getState().bootstrapFailed).toBe(true);

    useSocketConnectionStore.getState().disconnect();

    // Deco volontaire (logout) : la session suivante repart a zero, l'echec
    // ne doit pas trainer.
    expect(useSocketConnectionStore.getState().bootstrapFailed).toBe(false);
  });
});

/**
 * P12 C6 (audit-3) : le push serveur ne contourne PLUS le garde documente.
 *
 * Avant le correctif, `deliverServerNotification` posait `showBrowser: true`
 * sur toute notification socket : le garde « priorite haute/urgente ET
 * onglet en arriere-plan » de notificationStore etait contourné
 * systematiquement, et la notification navigateur s'affichait meme
 * au-dessus d un onglet actif. Desormais le socket prend les notifications
 * comme les chemins REST : le garde tranche.
 */
describe('socketConnectionStore — push serveur sans contourner le garde (P12 C6)', () => {
  beforeEach(() => {
    handlers.current = null;
    fetchRealtimeBootstrap.mockReset();
    fetchRealtimeBootstrap.mockResolvedValue({
      friends: [],
      friendRequests: [],
      blockedIds: [],
      notifications: [],
      matches: [],
      tournaments: [],
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    useNotificationStore.setState({ notifications: [] });
    useSocketConnectionStore.getState().disconnect();
    useSocketConnectionStore.setState({
      isConnected: false,
      serverConnected: false,
      bootstrapReady: false,
      bootstrapFailed: false,
      dirtySinceDisconnect: false,
      connectionLabel: 'offline',
    });
  });

  afterEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('onPushDelivery ne pose PAS showBrowser, le garde d arriere-plan decide', () => {
    useSocketConnectionStore.getState().connect(user);

    handlers.current!.onPushDelivery!({
      title: 'Salle disponible',
      body: 'Le match est pret.',
      url: '/matches',
      tag: 'room-1',
      requireInteraction: false,
    } as never);

    const [notif] = useNotificationStore.getState().notifications;
    expect(notif).toBeDefined();
    expect(notif?.metadata?.showBrowser).not.toBe(true);
    expect(notif?.priority).toBe('high');
    expect(notif?.metadata?.source).toBe('server-push');
  });
});