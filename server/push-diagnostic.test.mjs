import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le diagnostic push doit dire la VERITE (audit-4, passe 12).
 *
 * Le trou : la route `/api/realtime/push/test` repondait `{ ok: true }`
 * SANS dire ce qui avait ete livre. Le push est optionnel par
 * conception (« son absence n est pas une panne »), mais un diagnostic
 * qui repond « ok » quand rien n a ete envoye ne sert a rien : c est
 * justement la situation qu on cherche a diagnostiquer.
 *
 * Ce que le verrou exige :
 *  1. `deliverNotification` RENVOIE le resultat de l envoi ;
 *  2. la route publie les compteurs (tentatives, livraisons).
 *
 * PIEGE : `sendPushToUser` renvoie `{delivered, attempted}`. Un
 * `delivered: 0` avec `attempted: 3` dit « trois souscriptions, aucune
 * livree » — c'est une information, pas une panne.
 */

// PIEGE : `vi.mock` est HOISTE : une fabrique ne peut pas referencer une
// variable de niveau module (elle serait initialisee apres le mock).
// `vi.hoisted`declare les partagees avant le hoisting.
const { pushEnvoye, abonnement } = vi.hoisted(() => ({
  pushEnvoye: vi.fn(async () => ({ delivered: 2, attempted: 3 })),
  abonnement: vi.fn(),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async (io, userId, payload) => ({
    notification: { id: 'N-1', title: payload.title },
    push: await pushEnvoye(userId, payload),
  })),
  sendPushToUser: pushEnvoye,
  broadcastStateSnapshot: vi.fn(),
  notifyAllAdmins: vi.fn(),
}));

vi.mock('./persistence.mjs', () => ({
  getPushSubscriptionsForUser: vi.fn(() => [{ endpoint: 'https://push.test/1' }]),
  upsertPushSubscription: abonnement,
  removePushSubscription: vi.fn(),
  createNotification: vi.fn((userId, type, title, body, priority, url, extra) => ({
    id: 'N-1', userId, type, title, body, priority, url, ...extra,
  })),
  getUserById: vi.fn(() => ({ id: 'u1', pseudo: 'AUDIT01', role: 'player' })),
  getUsersByIds: vi.fn(() => []),
  getFriendsForUser: vi.fn(() => []),
  getFriendRequestsForUser: vi.fn(() => []),
  getAdminIds: vi.fn(() => []),
  getNotificationsForUser: vi.fn(() => []),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getUnreadNotificationCount: vi.fn(() => 0),
  getPublicUserById: vi.fn(() => null),
  getRealtimeSession: vi.fn(() => ({ userId: 'u1', pseudo: 'AUDIT01', role: 'player' })),
  findUsersByPseudo: vi.fn(() => []),
  getChatChannelsForUser: vi.fn(() => []),
  getChatMessages: vi.fn(() => []),
  createChatMessage: vi.fn(() => ({ id: 'M-1' })),
  ensureChatChannel: vi.fn(() => ({ id: 'global' })),
  updatePresence: vi.fn(),
}));

import { handleRealtimeRoutes } from './routes/realtime.mjs';
import { deliverNotification } from './push-notifications.mjs';

const reponse = { statut: 200, corps: null };
const requete = (methode, url) => ({
  method: methode,
  url,
  // La session temps reel passe par l en-tete Authorization (PAS le cookie :
  // le cookie zoyd_auth n est pas un jeton realtime).
  headers: { host: 'localhost', authorization: 'Bearer jeton-realtime' },
  on: () => {},
  once: () => {},
  removeListener: () => {},
  // PIEGE : `parseRequestBody` lit le corps avec `for await (const chunk
  // of req)` : une requete qui n est pas ASYNC-ITERABLE fait echouer la
  // route avant meme le handler (500 au lieu de la reponse attendue).
  [Symbol.asyncIterator]: async function* () { /* corps vide */ },
});

const res = {
  setHeader: () => {},
  getHeader: () => undefined,
  statusCode: 200,
  end: vi.fn(),
  writeHead: vi.fn(),
  headersSent: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  res.statusCode = 200;
  res.end.mockImplementation((corps) => { reponse.corps = corps; });
});

describe('diagnostic push', () => {
  it('deliverNotification renvoie les compteurs de livraison', async () => {
    const io = { to: () => ({ emit: vi.fn() }) };
    const resultat = await deliverNotification(io, 'u1', { title: 'Test', body: 'Corps' });
    expect(resultat).toBeTruthy();
    expect(resultat.push).toBeTruthy();
    expect(resultat.push.delivered).toBe(2);
    expect(resultat.push.attempted).toBe(3);
  });

  it('la route de test push publie ce qui a ete livre', async () => {
    const { deliverNotification: mockDeliver } = await import('./push-notifications.mjs');
    mockDeliver.mockResolvedValueOnce({ notification: { id: 'N-1' }, push: { delivered: 1, attempted: 2 } });

    await handleRealtimeRoutes({
      req: requete('POST', '/api/realtime/push/test'),
      res,
      pathname: '/api/realtime/push/test',
      io: { to: () => ({ emit: vi.fn() }) },
    });

    const envoye = res.end.mock.calls.at(-1)?.[0];
    expect(envoye, 'la route repond du JSON').toBeTruthy();
    const corps = JSON.parse(envoye);
    expect(corps.ok).toBe(true);
    // PIEGE : sans ces compteurs, un push non livre se lit « ok ».
    expect(corps.push).toBeTruthy();
    expect(corps.push.delivered).toBe(1);
    expect(corps.push.attempted).toBe(2);
  });
});
