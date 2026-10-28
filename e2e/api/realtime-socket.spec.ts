import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import {
  call,
  callAnonymous,
  registerPlayer,
  disposeActors,
  API_BASE_URL,
  type Actor,
  type ApiResult,
} from './support/harness';

// ─────────────────────────────────────────────────────────────────────────────
// Domaine TEMPS RÉEL : smoke socket.io + session realtime + push (P15 C5, audit-3).
//
// Le constat : aucun e2e ne couvrait le temps réel (socket.io) ni le Web Push —
// la voie qui plante n'avait aucun filet. Depuis P9 C1 (persistance des
// souscriptions push), le domaine est complet et testable de bout en bout :
//
//   1. POST /api/realtime/auth/session : la session joueur (Bearer app) est
//      échangée contre une session TEMPS RÉEL dédiée. INVARIANT
//      (realtime.mjs:13-15) : le bootstrap exige un Bearer temps réel, le
//      token app y est refusé.
//   2. Socket.io : le handshake porte le token temps réel (auth.token,
//      realtime-server.mjs:420) ; à la connexion le serveur rejoint la room
//      `user:<id>` et émet `server:hello` (realtime-server.mjs:442-452). Un
//      message posté par HTTP dans un DM arrive au socket de l'AUTRE
//      participant via cette room (chat-helpers.mjs:150-151) — c'est la
//      diffusion réelle qui rend le chat « en direct ».
//   3. Reconnexion : le token temps réel est réutilisable (pas one-shot),
//      le client se reconnecte avec la même session.
//   4. Push : cycle REST subscribe/unsubscribe sans toucher au réseau réel
//      (l'envoi d'une vraie notification partirait vers FCM). La clé
//      publique VAPID reste absente en mode test (503, déterministe).
//
// Hors périmètre assumé : la diffusion `state:matches` partage le même
// `io.emit` (les émissions sont testées ici via le chat), et un envoi push
// réel exigerait un endpoint FCM valide — ce serait une dépendance réseau
// dans des tests hermétiques.
// ─────────────────────────────────────────────────────────────────────────────

/** Crée une session temps réel à partir d'un acteur (Bearer app). */
const createRealtimeSession = async (actor: Actor): Promise<string> => {
  const res = await call<{ ok: boolean; session?: { token: string; userId: string } }>(
    actor,
    'POST',
    '/api/realtime/auth/session',
  );
  expect(res.status).toBe(200);
  expect(res.body?.ok).toBe(true);
  const token = res.body?.session?.token;
  expect(token).toBeTruthy();
  return token as string;
};

/**
 * Appel Bearer avec le token TEMPS RÉEL (le harnais `call` envoie le token
 * app, refusé sur le bootstrap et les routes push — INVARIANT realtime).
 */
const callRealtime = async (
  actor: Actor,
  realtimeToken: string,
  method: 'GET' | 'POST',
  route: string,
  data?: unknown,
): Promise<ApiResult> => {
  const response = await actor.context.fetch(route, {
    method,
    headers: { Authorization: `Bearer ${realtimeToken}` },
    data: data === undefined ? undefined : (data as Record<string, unknown>),
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status(), body };
};

const SOCKET_TIMEOUT = 10_000;

/** Attend le prochain événement d'un socket, avec timeout explicite. */
const onceEvent = <T = any>(socket: Socket, event: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event);
      reject(new Error(`event ${event} : timeout ${SOCKET_TIMEOUT} ms`));
    }, SOCKET_TIMEOUT);
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

/**
 * Client socket.io avec la même configuration que le front
 * (realtimeClient.ts:149-155) : autoConnect false (on inscrit les
 * listeners AVANT de connecter, sinon `server:hello` peut arriver entre le
 * handshake et l'inscription), reconnection false (le cas négatif doit
 * s'arrêter, ne pas boucler).
 */
const createSocket = (token: string): Socket =>
  io(API_BASE_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: false,
    auth: { token },
  });

test.describe('Realtime - session, socket et push (smoke)', () => {
  test.afterAll(async () => {
    await disposeActors();
  });

  test('la session temps reel se cree, sert le bootstrap et refuse le token app', async () => {
    const alice = await registerPlayer('RtSess');

    // Sans aucune session : refuse.
    const anonyme = await callAnonymous('POST', '/api/realtime/auth/session');
    expect(anonyme.status).toBe(401);
    expect(anonyme.body?.code).toBe('AUTH_REQUIRED');

    // INVARIANT : le bootstrap exige un Bearer TEMPS REEL, pas le token app.
    const appSurBootstrap = await call(alice, 'GET', '/api/realtime/state/bootstrap');
    expect(appSurBootstrap.status).toBe(401);

    const rt = await createRealtimeSession(alice);
    const bootstrap = await callRealtime(alice, rt, 'GET', '/api/realtime/state/bootstrap');
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body?.ok).toBe(true);
    // Le serveur e2e est partagé entre les specs : on vérifie la FORME (le
    // bornage 100/50 est couvert côté serveur), pas le contenu exact.
    expect(Array.isArray(bootstrap.body?.matches)).toBe(true);
    expect(Array.isArray(bootstrap.body?.tournaments)).toBe(true);
    expect(bootstrap.body?.timestamp).toBeTruthy();
  });

  test('le socket diffuse un message de chat a l autre participant', async () => {
    const alice = await registerPlayer('RtSock');
    const bob = await registerPlayer('RtSockB');

    const created = await call(alice, 'POST', '/api/chat/channels', {
      type: 'private',
      participants: [bob.id],
    });
    expect(created.status).toBe(201);
    const channelId = created.body.channel.id as string;

    const rt = await createRealtimeSession(alice);
    const socket = createSocket(rt);
    try {
      // Listeners inscrits AVANT connect : la room `user:<id>` est jointe
      // pendant le handshake, `server:hello` confirme les deux.
      const hello = onceEvent<{ socketId: string; userId: string }>(socket, 'server:hello');
      const message = onceEvent<{ channel: { id: string }; message: { text: string } }>(
        socket,
        'chat:message',
      );
      socket.connect();

      const helloRecu = await hello;
      expect(helloRecu?.userId).toBe(alice.id);
      expect(helloRecu?.socketId).toBe(socket.id);

      // Bob écrit via l'API HTTP : la diffusion part sur la room
      // `user:<aliceId>` (chat-helpers.mjs:150-151) et arrive au socket.
      const envoi = await call(bob, 'POST', `/api/chat/channels/${channelId}/messages`, {
        text: 'Smoke socket : message diffuse',
      });
      expect(envoi.status).toBe(201);

      const recu = await message;
      expect(recu?.channel?.id).toBe(channelId);
      expect(recu?.message?.text).toBe('Smoke socket : message diffuse');
    } finally {
      socket.disconnect();
    }
  });

  test('un handshake sans session valide est refuse (unauthorized)', async () => {
    const socket = createSocket('PAS-UN-JETON-TEMPS-REEL');
    try {
      const erreur = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('connect_error attendu : timeout')),
          SOCKET_TIMEOUT,
        );
        socket.once('connect_error', (err: Error) => {
          clearTimeout(timeout);
          resolve(err.message);
        });
        socket.once('connect', () => {
          clearTimeout(timeout);
          reject(new Error('connexion acceptee alors qu elle devait etre refusee'));
        });
      });
      socket.connect();
      expect(await erreur).toBe('unauthorized');
    } finally {
      socket.disconnect();
    }
  });

  test('la reconnexion reutilise la meme session temps reel', async () => {
    const alice = await registerPlayer('RtReco');
    const rt = await createRealtimeSession(alice);

    const socket = createSocket(rt);
    try {
      const premier = await (async () => {
        const hello = onceEvent<{ userId: string }>(socket, 'server:hello');
        socket.connect();
        return hello;
      })();
      expect(premier?.userId).toBe(alice.id);

      socket.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Même token : la session n'est PAS consommée par la connexion.
      const hello = onceEvent<{ userId: string }>(socket, 'server:hello');
      socket.connect();
      const deuxieme = await hello;
      expect(deuxieme?.userId).toBe(alice.id);
    } finally {
      socket.disconnect();
    }
  });

  test('le cycle push subscribe/unsubscribe repond au contrat REST', async () => {
    const alice = await registerPlayer('RtPush');

    // Mode test sans VAPID : 503 déterministe (vapid-keys.mjs:37-44).
    const cle = await callAnonymous('GET', '/api/realtime/push/public-key');
    expect(cle.status).toBe(503);
    expect(cle.body?.code).toBe('PUSH_NOT_CONFIGURED');

    // Sans session temps réel : refuse (INVARIANT realtime.mjs:13-15).
    const sansSession = await callAnonymous('POST', '/api/realtime/push/subscribe', {
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/e2e' },
    });
    expect(sansSession.status).toBe(401);

    const rt = await createRealtimeSession(alice);
    const endpoint = `https://fcm.googleapis.com/fcm/e2e-${crypto.randomBytes(8).toString('hex')}`;

    // Sans endpoint : 400.
    const sansEndpoint = await callRealtime(alice, rt, 'POST', '/api/realtime/push/subscribe', {});
    expect(sansEndpoint.status).toBe(400);
    expect(sansEndpoint.body?.code).toBe('MISSING_FIELDS');

    // Souscription factice stockée en mémoire (P9 C1) — aucun réseau réel.
    const souscrite = await callRealtime(alice, rt, 'POST', '/api/realtime/push/subscribe', {
      subscription: {
        endpoint,
        keys: { p256dh: 'cle-p256dh-factice', auth: 'auth-factice' },
      },
    });
    expect(souscrite.status).toBe(200);
    expect(souscrite.body?.ok).toBe(true);

    // Unsubscribe : sans endpoint 400, avec l'endpoint 200.
    const unsubSansEndpoint = await callRealtime(alice, rt, 'POST', '/api/realtime/push/unsubscribe', {});
    expect(unsubSansEndpoint.status).toBe(400);

    const desabonnement = await callRealtime(alice, rt, 'POST', '/api/realtime/push/unsubscribe', { endpoint });
    expect(desabonnement.status).toBe(200);
    expect(desabonnement.body?.ok).toBe(true);
  });
});
