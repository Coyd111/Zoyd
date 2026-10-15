import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSocketConnectionStore } from './socketConnectionStore';

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