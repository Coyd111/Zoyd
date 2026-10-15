import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  getAuthenticatedRealtimeSession,
  parseRequestBody,
  respondJson,
} from '../http-utils.mjs';
import {
  createRealtimeSession,
  getStateCollection,
  getFriendsForUser,
  getFriendRequestsForUser,
  getUnreadNotificationsForUser,
  getBlockedUsers,
  upsertPushSubscription,
  removePushSubscription,
} from '../persistence.mjs';
import { vapidKeys } from '../vapid-keys.mjs';
import {
  sanitizeMatchForBroadcast,
  sanitizeTournamentForBroadcast,
  getStoredTournaments,
} from '../state-helpers.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { getNow } from '../utils.mjs';

export const handleRealtimeRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'POST' && pathname === '/api/realtime/auth/session') {
  if (!rateLimitGuard(res, getClientIp(req), 'auth')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try {
    const realtimeSession = await createRealtimeSession({
      userId: session.user.id,
      pseudo: session.user.pseudo,
      role: session.user.role,
    });
    respondJson(res, 200, { ok: true, session: realtimeSession });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors de la creation de la session temps reel.', code: 'SESSION_ERROR' });
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/realtime/push/public-key') {
  if (!vapidKeys) {
    respondJson(res, 503, { ok: false, error: 'Notifications push non configurees.', code: 'PUSH_NOT_CONFIGURED' });
  } else {
    respondJson(res, 200, { publicKey: vapidKeys.publicKey });
  }
  return true;
}

if (req.method === 'GET' && pathname.startsWith('/api/realtime/state/bootstrap')) {
  const session = getAuthenticatedRealtimeSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try {
const allMatches = getStateCollection('matches');
    const recentMatches = allMatches.slice(-100)
      .map((match) => sanitizeMatchForBroadcast(match, session.userId));
    const allTournaments = getStoredTournaments();
    const recentTournaments = allTournaments.slice(-50)
      .map((t) => sanitizeTournamentForBroadcast(t, session.userId));
    respondJson(res, 200, {
      ok: true,
      matches: recentMatches,
      tournaments: recentTournaments,
      friends: getFriendsForUser(session.userId),
      friendRequests: getFriendRequestsForUser(session.userId),
      blockedIds: getBlockedUsers(session.userId),
      notifications: getUnreadNotificationsForUser(session.userId),
      timestamp: getNow(),
    });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement de l\'etat realtime.' });
  }
  return true;
}

// `POST /api/realtime/state/sync` a ete SUPPRIME.
//
// Cette route ne pouvait rien accepter : les tournois repondaient 409, tout le
// reste 400. Elle ne servait donc a rien, et son appelant cote client
// (`syncRealtimeState` puis `syncServerState`) n etait appele par personne.
//
// Elle avait surtout un cout invisible : la fonction client ressemblait a un
// appel qui marche. Un developpeur pouvait la rebrancher, decouvrir un 400 en
// production, et perdre du temps a comprendre pourquoi — le serveur ne
// signalait rien.
//
// La synchronisation d etat passe par les routes API dediees, et le socket ne
// transporte que des deltas, fusionnes par `hydrateFromServer`.

if (req.method === 'POST' && pathname === '/api/realtime/push/subscribe') {
  const session = getAuthenticatedRealtimeSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try {
    const body = await parseRequestBody(req);
    const { subscription } = body;

    if (!subscription?.endpoint) {
      respondJson(res, 400, { ok: false, error: 'Point de souscription manquant.', code: 'MISSING_FIELDS' });
      return true;
    }

    upsertPushSubscription(session.userId, subscription);
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Impossible de sauvegarder la souscription.', code: 'SUBSCRIPTION_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/realtime/push/unsubscribe') {
  const session = getAuthenticatedRealtimeSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try {
    const body = await parseRequestBody(req);
    const { endpoint } = body;

    if (!endpoint) {
      respondJson(res, 400, { ok: false, error: 'Endpoint manquant.', code: 'MISSING_FIELDS' });
      return true;
    }

    removePushSubscription(endpoint);
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Impossible de supprimer la souscription.', code: 'SUBSCRIPTION_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/realtime/push/test') {
  const session = getAuthenticatedRealtimeSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session temps reel requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try {
    const body = await parseRequestBody(req);
    const { title, body: messageBody, url, tag } = body;

    const payload = {
      title: title || 'ZOYD',
      body: messageBody || 'Notification de test ZOYD',
      url: url || '/mj',
      tag: tag || `zoyd-test-${Date.now()}`,
      requireInteraction: false,
    };

    await deliverNotification(io, session.userId, payload);
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: "Impossible d'envoyer la notification test.", code: 'PUSH_ERROR' });
  }
  return true;
}

  return false;
};
