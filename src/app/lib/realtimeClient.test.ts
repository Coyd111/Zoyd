/**
 * realtimeClient.test.ts - session temps reel, course d'identite et push.
 *
 * P11 C2/C3 (audit-3) :
 *  - C2 : `disconnectRealtimeSocket` n'invalide pas `sessionPromise` ; un
 *    compte B qui se connecte pendant que le POST de session du compte A est
 *    en vol recoit LA PROMESSE DE A (rooms user:A, token A) jusqu'a
 *    expiration. Le test prouve qu'un B connecte juste apres une
 *    deconnexion repart sur un NOUVEAU POST et porte son propre token.
 *  - C3 : `subscribeToRealtimePush` / `unsubscribeFromRealtimePush` ne lisaient
 *    pas la reponse serveur : un 401 ou un 500 repondaient un succes. Le
 *    contrat est desormais `!response.ok` -> throw, et la desinscription
 *    navigateur ne saute plus si le serveur est en echec.
 *
 * Le module est un SINGLETON (socket + activeSession) : chaque test repart
 * d'un `disconnectRealtimeSocket()` qui remet tout a null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sockets, ioMock } = vi.hoisted(() => {
  type FakeSocket = {
    auth: { token?: string } | undefined;
    connected: boolean;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  const sockets: FakeSocket[] = [];
  const ioMock = vi.fn(() => {
    const socket: FakeSocket = {
      auth: undefined,
      connected: false,
      on: vi.fn(),
      off: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    sockets.push(socket);
    return socket;
  });
  return { sockets, ioMock };
});

vi.mock('socket.io-client', () => ({
  io: ioMock,
}));

import {
  connectRealtimeSocket,
  disconnectRealtimeSocket,
  subscribeToRealtimePush,
  unsubscribeFromRealtimePush,
} from './realtimeClient';

const makeUser = (id: string, pseudo: string) =>
  ({ id, pseudo, role: 'player' }) as never;

const sessionPayload = (userId: string, token: string) => ({
  session: {
    token,
    userId,
    pseudo: `pseudo-${userId}`,
    role: 'player',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  },
});

const makeResponse = (payload: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => payload }) as unknown as Response;

const fakeSubscription = () => {
  const unsubscribe = vi.fn(async () => true);
  const subscription = { endpoint: 'https://push.example/endpoint-1', unsubscribe };
  return { subscription, unsubscribe } as const;
};

const fakeRegistration = (subscription: ReturnType<typeof fakeSubscription>['subscription']) =>
  ({ pushManager: { getSubscription: vi.fn(async () => subscription) } }) as never;

let sessionCalls = 0;

const stubSessionFetch = (options: {
  /** Premier POST de session : en vol (jamais resolu). */
  hangFirst: boolean;
  session: { userId: string; token: string };
}) => {
  sessionCalls = 0;
  const sessionFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/realtime/auth/session')) {
      sessionCalls += 1;
      if (options.hangFirst && sessionCalls === 1) {
        return new Promise<Response>(() => { /* le POST de A reste en vol */ });
      }
      return makeResponse(sessionPayload(options.session.userId, options.session.token));
    }
    throw new Error(`fetch inattendu: ${url}`);
  });
  vi.stubGlobal('fetch', sessionFetch);
  return sessionFetch;
};

describe('course d identite — sessionPromise (P11 C2)', () => {
  beforeEach(() => {
    disconnectRealtimeSocket();
    sockets.length = 0;
  });

  it('deconnexion pendant le vol : B repart sur un NOUVEAU POST et porte son token', async () => {
    stubSessionFetch({ hangFirst: true, session: { userId: 'user-b', token: 'token-b' } });
    const userA = makeUser('user-a', 'Alice');
    const userB = makeUser('user-b', 'Bob');

    // Le POST de session de A part et reste en vol (jamais resole).
    void connectRealtimeSocket(userA);
    // B se connecte apres une deconnexion : la promesse de A NE DOIT PAS etre
    // re-servie (avant le correctif, B awaitait la promesse de A : le test
    // pendait jusqu'au timeout).
    disconnectRealtimeSocket();
    const socketB = await connectRealtimeSocket(userB);

    expect(sessionCalls).toBe(2);
    expect(socketB.auth).toEqual({ token: 'token-b' });
  });

  it('sans deconnexion : un second appel pendant le vol reutilise la meme promesse (deja correct)', async () => {
    stubSessionFetch({ hangFirst: true, session: { userId: 'user-b', token: 'token-b' } });
    const userA = makeUser('user-a', 'Alice');
    const userB = makeUser('user-b', 'Bob');

    void connectRealtimeSocket(userA);
    void connectRealtimeSocket(userB); // second appel : agrege a la promesse en vol (comportement pre-existant)

    expect(sessionCalls).toBe(1);
  });
});

describe('contrat de reponse du push (P11 C3)', () => {
  beforeEach(() => {
    disconnectRealtimeSocket();
    // Meme shim que socketConnectionStore.test.ts : sous l'environnement node,
    // `window` n'existe pas ; le garde SSR de subscribeToRealtimePush
    // (`'PushManager' in window`) doit survivre au test.
    (globalThis as unknown as { window?: unknown }).window = globalThis;
    (globalThis as unknown as { PushManager?: unknown }).PushManager = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
  });

  it('subscribe : HTTP 200 -> true', async () => {
    const sessionFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/realtime/push/public-key')) {
        return makeResponse({ publicKey: 'BJJk1rRL6y1Z1jDd7H1' });
      }
      if (url.includes('/realtime/auth/session')) {
        return makeResponse(sessionPayload('user-b', 'token-b'));
      }
      if (url.includes('/realtime/push/subscribe')) {
        return makeResponse({ ok: true });
      }
      throw new Error(`fetch inattendu: ${url}`);
    });
    vi.stubGlobal('fetch', sessionFetch);

    const { subscription } = fakeSubscription();
    const result = await subscribeToRealtimePush(makeUser('user-b', 'Bob'), fakeRegistration(subscription));

    expect(result).toBe(true);
  });

  it('subscribe : HTTP 401 -> throw (avant le correctif : succes silencieux)', async () => {
    const sessionFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/realtime/push/public-key')) {
        return makeResponse({ publicKey: 'BJJk1rRL6y1Z1jDd7H1' });
      }
      if (url.includes('/realtime/auth/session')) {
        return makeResponse(sessionPayload('user-b', 'token-b'));
      }
      if (url.includes('/realtime/push/subscribe')) {
        return makeResponse({ erreur: 'session expiree' }, false, 401);
      }
      throw new Error(`fetch inattendu: ${url}`);
    });
    vi.stubGlobal('fetch', sessionFetch);

    const { subscription } = fakeSubscription();
    await expect(
      subscribeToRealtimePush(makeUser('user-b', 'Bob'), fakeRegistration(subscription)),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('unsubscribe : HTTP 500 -> throw et l abonnement navigateur CONSERVE', async () => {
    const sessionFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/realtime/auth/session')) {
        return makeResponse(sessionPayload('user-b', 'token-b'));
      }
      if (url.includes('/realtime/push/unsubscribe')) {
        return makeResponse({ erreur: 'ko' }, false, 500);
      }
      throw new Error(`fetch inattendu: ${url}`);
    });
    vi.stubGlobal('fetch', sessionFetch);

    const { subscription, unsubscribe } = fakeSubscription();
    await expect(
      unsubscribeFromRealtimePush(makeUser('user-b', 'Bob'), fakeRegistration(subscription)),
    ).rejects.toThrow(/HTTP 500/);

    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribe : HTTP 200 -> desinscription navigateur effectuee une fois', async () => {
    const sessionFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/realtime/auth/session')) {
        return makeResponse(sessionPayload('user-b', 'token-b'));
      }
      if (url.includes('/realtime/push/unsubscribe')) {
        return makeResponse({ ok: true });
      }
      throw new Error(`fetch inattendu: ${url}`);
    });
    vi.stubGlobal('fetch', sessionFetch);

    const { subscription, unsubscribe } = fakeSubscription();
    await unsubscribeFromRealtimePush(makeUser('user-b', 'Bob'), fakeRegistration(subscription));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
