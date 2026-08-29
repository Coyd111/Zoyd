import webpush from 'web-push';
import { vapidKeys } from './vapid-keys.mjs';
import {
  getPushSubscriptionsForUser,
  removePushSubscription,
  createNotification,
  getAdminIds,
  sanitizeText,
} from './persistence.mjs';

if (vapidKeys) {
  webpush.setVapidDetails('mailto:ops@zoyd.africa', vapidKeys.publicKey, vapidKeys.privateKey);
}

/**
 * Send a web push notification to all subscriptions belonging to a user.
 * Removes stale subscriptions that return 404/410.
 * @param {string} userId - Target user ID.
 * @param {object} payload - JSON-serialisable payload to send.
 * @returns {Promise<{delivered: number, attempted: number}>}
 */
const sendPushToUser = async (userId, payload) => {
  if (!vapidKeys) return { delivered: 0, attempted: 0 };
  const subscriptions = getPushSubscriptionsForUser(userId);
  if (subscriptions.length === 0) {
    return { delivered: 0, attempted: 0 };
  }

  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        delivered += 1;
      } catch (error) {
        const statusCode = error?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removePushSubscription(subscription.endpoint);
        }
      }
    })
  );

  return { delivered, attempted: subscriptions.length };
};

/**
 * Persist a notification, emit it over the socket, and deliver via web push.
 * @param {import('socket.io').Server} io - Socket.IO server instance.
 * @param {string} targetUserId - User to notify.
 * @param {object} payload - { title, body, url, tag, requireInteraction, type }
 */
const deliverNotification = async (io, targetUserId, payload) => {
  const { title, body, url, tag, requireInteraction, type = 'system' } = payload;
  const priority = requireInteraction ? 'urgent' : 'high';

  const notification = createNotification(
    targetUserId,
    type,
    sanitizeText(title),
    sanitizeText(body || 'Notification ZOYD'),
    priority,
    sanitizeText(url),
    { source: 'server-push', browserTag: tag }
  );

  io.to(`user:${targetUserId}`).emit('notification:deliver', notification);
  await sendPushToUser(targetUserId, payload);
};

/**
 * Broadcast a state snapshot to every connected client.
 * @param {import('socket.io').Server} io - Socket.IO server instance.
 * @param {string} kind - State category (e.g. "players", "lobby").
 * @param {Array} items - Current state items.
 */
const broadcastStateSnapshot = (io, kind, items) => {
  io.emit(`state:${kind}`, { items });
};

/**
 * Send a push notification to every admin user.
 * @param {import('socket.io').Server} io - Socket.IO server instance.
 * @param {object} payload - Notification payload (title, body, url, …).
 */
const notifyAllAdmins = async (io, payload) => {
  const adminIds = getAdminIds();
  for (const adminId of adminIds) {
    try {
      await deliverNotification(io, adminId, payload);
    } catch (err) {
      log.warn('Failed to notify admin', { adminId, error: err.message });
    }
  }
};

export { sendPushToUser, deliverNotification, broadcastStateSnapshot, notifyAllAdmins };
