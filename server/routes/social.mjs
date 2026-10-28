/**
 * server/routes/social.mjs - Domaine SOCIAL : amis, demandes d'ami, blocs,
 * signalements de joueurs, centre de notifications.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : session (401 `AUTH_REQUIRED`) -> rate limit (`social`,
 * `default` pour les notifications) -> lecture du corps -> `withUserMutex` ->
 * logique metier.
 *
 * INVARIANT : les relations sont modifiees sous `withUserMutex` : le
 *   lecture-modification-ecriture de la liste d'amis doit etre serialise.
 * INVARIANT : le signalement est ecrit avec `sbUpsert` ATTENDU, pas avec
 *   `sbFire` : un signalement perdu = un joueur qui harcele en croyant avoir
 *   ete ecoute.
 * INVARIANT : la gravite du signalement est CALCULEE par le serveur au
 *   depot, a partir du seul motif (`severityForReason`) : elle ne peut pas
 *   dependre d'un champ du client.
 * INVARIANT : le signalement ecrit les colonnes denormalisees (`reporter_id`,
 *   `target_id`, `reason`, `status`, `severity`) : les index de la lecture de
 *   moderation en dependent.
 * INVARIANT : les notifications sont lues et marquees par compte : aucune
 *   route ne renvoie la notification d'un autre joueur.
 * PIEGE : `sbUpsert` renvoie `undefined` en mode memoire (ce n'est pas un
 *   echec) et `false` sur un refus reel : seule la valeur `false` doit
 *   produire un 503 `SERVER_BUSY`.
 * PIEGE : la notification est envoyee APRES l'ecriture et son echec est
 *   rattrape : une notification en erreur ne doit pas faire echouer la
 *   requete metier.
 * PIEGE : une demande d'ami porte une DIRECTION (expediteur -> destinataire) :
 *   c'est le RECIPIENT qui l'accepte (`requestId` + `session.user.id`).
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
// P9 C5 (audit-3) : import EXPLICITE de randomUUID - le suffixe aleatoire
// de l'identifiant de signalement ferme la collision de milliseconde.
import { randomUUID } from 'node:crypto';
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
  getUserById,
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
    // P9 C5 (audit-3, famille S12) : la cible n'etait NI verifiee NI
    // distinguee du signaleur : l'admin recevait un signalement sans pseudo
    // cible (compte inexistant), et un joueur pouvait se signaler lui-meme.
    if (body.targetId === session.user.id) {
      respondJson(res, 400, { ok: false, error: 'Vous ne pouvez pas vous signaler vous-meme.', code: 'SELF_REPORT' });
      return true;
    }
    if (!getUserById(body.targetId)) {
      respondJson(res, 400, { ok: false, error: 'Joueur cible introuvable.', code: 'TARGET_NOT_FOUND' });
      return true;
    }
    const report = {
      // P9 C5 (audit-3) : le suffixe aleatoire ferme la collision - deux
      // depots dans la MEME milliseconde partageaient l'id et sbUpsert
      // ecrasait le premier signalement.
      id: `RP-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8)}`,
      reporterId: session.user.id,
      reporterPseudo: session.user.pseudo,
      targetId: body.targetId,
      // P9 C5 (audit-3) : sanitises mais SANS slice - le corps pouvait
      // porter des description/reason de n'importe quelle taille.
      reason: sanitizeText(body.reason).slice(0, 500),
      description: sanitizeText(body.description || '').slice(0, 1000),
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
