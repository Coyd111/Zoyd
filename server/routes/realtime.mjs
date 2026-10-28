/**
 * server/routes/realtime.mjs - Domaine TEMPS REEL : creation de la session
 * temps reel, cle publique VAPID, bootstrap d'etat, souscription / desen-
 * souscription / test de push.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : rate limit (`auth` sur la creation de session) ->
 * session -> lecture du corps -> ecriture. Les routes de bootstrap et de push
 * utilisent `getAuthenticatedRealtimeSession`, c'est-a-dire l'en-tete
 * Bearer UNIQUEMENT.
 *
 * INVARIANT : le bootstrap d'etat et les routes de push exigent une session
 *   TEMPS REEL : le cookie `zoyd_auth` n'est pas un token temps reel et ne
 *   doit pas y servir.
 * INVARIANT : la creation d'une session temps reel est rate limitee
 *   (`auth`) : elle cree une entree serveur.
 * INVARIANT : le bootstrap est BORNE : 100 matchs et 50 tournois, les plus
 *   recents.
 * INVARIANT : seule la cle VAPID PUBLIQUE sort du serveur ; la cle privee
 *   reste cote serveur (cf. vapid-keys.mjs).
 * PIEGE : `POST /api/realtime/state/sync` a ete SUPPRIME : il repondait 409
 *   ou 400 pour tout et donnait l'illusion d'un appel fonctionnel. Ne pas le
 *   rebrancher.
 * PIEGE : le socket ne transporte que des DELTAS : la synchronisation
 *   complete passe par les routes API dediees.
 * PIEGE : la souscription de push exige un `endpoint` : c'est l'identifiant
 *   de la souscription, sans lui rien n'est enregistre.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

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
  // P9 C4 (audit-3) : la lecture la plus couteuse du domaine (100 matchs +
  // 50 tournois sanitises + 4 listes) appelable en boucle etait la SEULE
  // du fichier sans rate limit (le groupe 'default', 60/min, couvre le
  // rythme d'un client : 1 appel a la connexion et aux reconnexions).
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }

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
