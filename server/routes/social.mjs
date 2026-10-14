import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  respondJson,
  parseQueryParams,
  paginate,
  parseRequestBody,
  getAuthenticatedAppSession,
  respondMappedError,
} from '../http-utils.mjs';
import {
  getFriendsForUser,
  getFriendRequestsForUser,
  getBlockedUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  getUnreadNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  sanitizeText,
  sbFire,
  sbUpsert,
} from '../persistence.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { withUserMutex } from '../mutex.mjs';
import { severityForReason } from '../moderation.mjs';
import { getNow } from '../utils.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('social-routes');


export const handleSocialRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/social/friends') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  try {
    const { limit, offset } = parseQueryParams(req.url);
    const all = getFriendsForUser(session.user.id);
    const { items: friends, hasMore } = paginate(all, { limit, offset });
    respondJson(res, 200, { ok: true, friends, hasMore });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des amis.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/social/pending') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  try {
    const { limit, offset } = parseQueryParams(req.url);
    const all = getFriendRequestsForUser(session.user.id).filter((fr) => fr.status === 'pending');
    const { items: requests, hasMore } = paginate(all, { limit, offset });
    respondJson(res, 200, { ok: true, requests, hasMore });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des demandes.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/social/request') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const body = await parseRequestBody(req);
    const request = await withUserMutex(session.user.id, async () =>
      sendFriendRequest(session.user.id, body.targetId, body.message)
    );
    
    deliverNotification(io, body.targetId, {
      type: 'friend_request',
      title: "Demande d'ami",
      body: `${session.user.pseudo} t'a envoyé une demande d'ami.`,
      url: `/profil`,
      requireInteraction: false
    }).catch(err => log.error('Notification delivery failed', err));

    respondJson(res, 200, { ok: true, request });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/social/accept') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const body = await parseRequestBody(req);
    const friend = await withUserMutex(session.user.id, async () =>
      acceptFriendRequest(body.requestId, session.user.id)
    );
    
    deliverNotification(io, friend.id, {
      type: 'friend_online',
      title: 'Demande acceptée',
      body: `${session.user.pseudo} a accepté ta demande d'ami.`,
      url: `/profil/${session.user.id}`,
      requireInteraction: false
    }).catch(err => log.error('Notification delivery failed', err));

    respondJson(res, 200, { ok: true, friend });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/social/decline') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const body = await parseRequestBody(req);
    await withUserMutex(session.user.id, async () =>
      declineFriendRequest(body.requestId, session.user.id)
    );
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const socialFriendMatch = pathname.match(/^\/api\/social\/friends\/(.+)$/);
if (req.method === 'DELETE' && socialFriendMatch) {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    await withUserMutex(session.user.id, async () => {
      removeFriend(session.user.id, socialFriendMatch[1]);
    });
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/social/block') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const body = await parseRequestBody(req);
    await withUserMutex(session.user.id, async () => {
      blockUser(session.user.id, body.targetId);
    });
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/social/unblock') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const body = await parseRequestBody(req);
    await withUserMutex(session.user.id, async () => {
      unblockUser(session.user.id, body.targetId);
    });
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/social/report') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const body = await parseRequestBody(req);
    if (!body.targetId || !body.reason) {
      respondJson(res, 400, { ok: false, error: 'targetId et reason requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    const report = {
      id: `RP-${Date.now().toString(36).toUpperCase()}`,
      reporterId: session.user.id,
      reporterPseudo: session.user.pseudo,
      targetId: body.targetId,
      reason: sanitizeText(body.reason),
      description: sanitizeText(body.description || ''),
      status: 'pending',
      createdAt: getNow(),
    };
    // Ecriture AWAITEE, pas `sbFire`.
    //
    // En best-effort, la route repondait 201 AVANT que l'ecriture n'aboutisse :
    // si la table manquait ou si la base etait indisponible, le joueur lisait
    // « Signalement envoye » et le signalement disparaitait. Or c'est une
    // information de moderation — un signalement perdu, c'est un joueur qui
    // continue a harceler en croyant avoir ete ecoute.
    //
    // `sbUpsert` renvoie `undefined` quand aucun client Supabase n'est configure
    // (mode memoire) : ce n'est pas un echec. `false` signifie une ecriture
    // reellement refusee.
    const written = await sbUpsert('user_reports', {
      id: report.id,
      // Les colonnes denormalisees ne sont pas de la redondance inutile :
      // ce sont elles que filtre la lecture de moderation, via les index de
      // `supabase/schema.sql`. Les laisser a NULL rendrait ces index
      // inexploitables et forcerait a filtrer sur `payload`, donc a tout
      // charger en memoire pour trier en JavaScript.
      reporter_id: report.reporterId,
      target_id: report.targetId,
      reason: report.reason,
      status: report.status,
      // La gravite est CALCULEE par le serveur au depot, a partir du seul
      // motif connu. Elle decide de la sanction recommandee dans la file :
      // la calculer plus tard obligerait a la deviner de nouveau, et le
      // joueur pourrait changer d'avis sur le motif entre le depot et le
      // traitement.
      severity: severityForReason(report.reason),
      payload: report,
      created_at: report.createdAt,
    });
    if (written === false) {
      respondJson(res, 503, {
        ok: false,
        error: "Signalement non enregistre, reessaie dans un instant.",
        code: 'SERVER_BUSY',
      });
      return true;
    }
    respondJson(res, 201, { ok: true, report });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/notifications/read') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const body = await parseRequestBody(req);
    const success = markNotificationAsRead(session.user.id, body.notificationId);
    respondJson(res, 200, { ok: true, success });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const changes = markAllNotificationsAsRead(session.user.id);
    respondJson(res, 200, { ok: true, changes });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/notifications') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  try {
    const unread = getUnreadNotificationsForUser(session.user.id);
    respondJson(res, 200, { ok: true, notifications: unread, count: unread.length });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

  return false;
};
