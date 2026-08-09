// VAPID Keys for Web Push Notifications
// Les clés doivent être définies dans les variables d'environnement.
// Générer avec : node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"

import { createLogger } from './logger.mjs';

const log = createLogger('vapid');

const ENV_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const ENV_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (!ENV_PUBLIC || !ENV_PRIVATE) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[FATAL] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in production.');
  }
  log.warn('VAPID keys not set — push notifications disabled.');
}

export const vapidKeys = ENV_PUBLIC && ENV_PRIVATE
  ? { publicKey: ENV_PUBLIC, privateKey: ENV_PRIVATE }
  : null;
