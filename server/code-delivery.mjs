// server/code-delivery.mjs — Auth code delivery hook (activation / password reset).
// No email/SMS provider is configured yet. Behavior:
// - If CODE_DELIVERY_WEBHOOK is set, POST { to, code, purpose } to it (5s timeout).
// - Otherwise, outside production the code is logged for local testing and the
//   caller route exposes it in the JSON response (same pattern as register).
// - In production without a provider, delivery is reported as pending and routes
//   answer honestly instead of pretending a message was sent.
// Recommended next step: Brevo free tier (300 emails/day) via this webhook.

import { createLogger } from './logger.mjs';

const log = createLogger('delivery');

const maskDestination = (to) => {
  if (!to || typeof to !== 'string') return '?';
  const at = to.indexOf('@');
  if (at > 1) return `${to[0]}***${to.slice(at)}`;
  if (to.length > 4) return `${to.slice(0, 2)}***${to.slice(-2)}`;
  return '***';
};

/**
 * Deliver a one-time auth code through the configured channel.
 * @param {{ to: string, code: string, purpose: 'activation'|'activation-resend'|'activation-email'|'password-reset' }} input
 * @returns {Promise<{ delivered: boolean, channel: string }>}
 */
export const deliverAuthCode = async ({ to, code, purpose }) => {
  const webhook = process.env.CODE_DELIVERY_WEBHOOK;
  const isProd = process.env.NODE_ENV === 'production';

  if (!webhook) {
    if (!isProd) {
      // Local testing only: never log codes in production.
      log.info('dev auth code', { purpose, to: maskDestination(to), code });
    } else {
      log.warn('auth code delivery pending (no provider)', { purpose, to: maskDestination(to) });
    }
    return { delivered: false, channel: 'none' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, code, purpose }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { delivered: true, channel: 'webhook' };
  } catch (error) {
    log.error('auth code delivery failed', { purpose, to: maskDestination(to), message: error.message });
    return { delivered: false, channel: 'webhook' };
  }
};
