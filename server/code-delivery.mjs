// server/code-delivery.mjs — Auth code delivery (activation / password reset).
// Canaux par ordre de priorité :
// 1. SMTP (ex. Outlook smtp.office365.com) si SMTP_HOST/SMTP_USER/SMTP_PASS
//    sont configurés et que le destinataire est un email.
// 2. CODE_DELIVERY_WEBHOOK si défini (POST { to, code, purpose }, 5s timeout).
// 3. Sinon hors production : code loggé pour tests locaux, la route expose
//    le code en JSON (même pattern que register).
// 4. En production sans provider : delivery pending, les routes répondent
//    honnêtement au lieu de prétendre que le message est parti.

import { createLogger } from './logger.mjs';

const log = createLogger('delivery');

const maskDestination = (to) => {
  if (!to || typeof to !== 'string') return '?';
  const at = to.indexOf('@');
  if (at > 1) return `${to[0]}***${to.slice(at)}`;
  if (to.length > 4) return `${to.slice(0, 2)}***${to.slice(-2)}`;
  return '***';
};

const isEmail = (to) => typeof to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);

const SUBJECTS = {
  activation: 'Active ton compte ZOYD',
  'activation-resend': 'Ton nouveau code ZOYD',
  'activation-email': 'Confirme ta nouvelle adresse ZOYD',
  'password-reset': 'Réinitialise ton mot de passe ZOYD',
};

const buildBodies = (code, purpose) => {
  const lines = {
    activation: [
      'Bienvenue sur ZOYD !',
      '',
      `Ton code d'activation : ${code}`,
      '',
      "Entre-le dans l'application pour activer ton compte. Il expire dans 15 minutes.",
    ],
    'activation-resend': [
      `Ton nouveau code ZOYD : ${code}`,
      '',
      'Il expire dans 15 minutes. Si tu ne l\'as pas demandé, ignore ce message.',
    ],
    'activation-email': [
      `Ton code de confirmation : ${code}`,
      '',
      'Il expire dans 15 minutes.',
    ],
    'password-reset': [
      `Ton code de réinitialisation : ${code}`,
      '',
      "Il expire dans 15 minutes. Si tu ne l'as pas demandé, ignore ce message.",
    ],
  };
  const text = (lines[purpose] || lines.activation).join('\n');
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#050505;color:#fff;">
<p style="font-size:14px;color:rgba(255,255,255,.7)">ZOYD — vérification</p>
<p style="font-size:28px;font-weight:900;letter-spacing:.2em;color:#FFFF00">${code}</p>
<p style="font-size:13px;color:rgba(255,255,255,.7)">${(lines[purpose] || lines.activation).slice(1).join('<br>')}</p>
</div>`;
  return { text, html };
};

/**
 * Try sending the code through SMTP (Outlook ou compatible).
 * @returns {Promise<boolean>} true si envoyé
 */
const sendViaSmtp = async ({ to, code, purpose }) => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !isEmail(to)) return false;
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.SMTP_FROM || user;
  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch (error) {
    log.error('smtp module missing (nodemailer not installed)', { message: error.message });
    return false;
  }
  const transporter = (nodemailer.default || nodemailer).createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  const { text, html } = buildBodies(code, purpose);
  await transporter.sendMail({
    from,
    to,
    subject: SUBJECTS[purpose] || SUBJECTS.activation,
    text,
    html,
  });
  return true;
};

/**
 * Deliver a one-time auth code through the configured channel.
 * @param {{ to: string, code: string, purpose: 'activation'|'activation-resend'|'activation-email'|'password-reset' }} input
 * @returns {Promise<{ delivered: boolean, channel: string }>}
 */
export const deliverAuthCode = async ({ to, code, purpose }) => {
  const isProd = process.env.NODE_ENV === 'production';

  // 1. SMTP
  try {
    if (await sendViaSmtp({ to, code, purpose })) {
      return { delivered: true, channel: 'smtp' };
    }
  } catch (error) {
    log.error('smtp delivery failed', { purpose, to: maskDestination(to), message: error.message });
  }

  // 2. Webhook
  const webhook = process.env.CODE_DELIVERY_WEBHOOK;
  if (webhook) {
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
  }

  // 3. Défaut
  if (!isProd) {
    // Local testing only: never log codes in production.
    log.info('dev auth code', { purpose, to: maskDestination(to), code });
  } else {
    log.warn('auth code delivery pending (no provider)', { purpose, to: maskDestination(to) });
  }
  return { delivered: false, channel: 'none' };
};
