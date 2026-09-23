// server/code-delivery.mjs — Auth code delivery (activation / password reset).
// Canaux par ordre de priorité :
// 1. Resend API HTTPS (port 443, compatible Render gratuit) si RESEND_API_KEY
//    est configuré et que le destinataire est un email.
//    → https://resend.com → API Keys → RESEND_API_KEY + EMAIL_FROM
// 2. Brevo API HTTPS (port 443) si BREVO_API_KEY est configuré.
//    → https://app.brevo.com → API Keys → BREVO_API_KEY + EMAIL_FROM
// 3. SMTP si SMTP_HOST/SMTP_USER/SMTP_PASS sont configurés.
//    ⚠️ BLOQUÉ sur Render gratuit (ports 25/465/587 fermés depuis sept 2025 :
//    "Connection timeout"). Ne marche qu'en local ou instance payante.
// 4. CODE_DELIVERY_WEBHOOK si défini (POST { to, code, purpose }, 5s timeout).
// 5. Sinon hors production : code loggé pour tests locaux, la route expose
//    le code en JSON (même pattern que register).
// 6. En production sans provider : delivery pending, les routes répondent
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
  const footerText = '\n\n—\nZOYD, Cotonou (Bénin) — 18+. Assistance : coyd2976@gmail.com / WhatsApp +2290165240654 (8h-01h GMT+1).';
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#050505;color:#fff;">
<p style="font-size:14px;color:rgba(255,255,255,.7)">ZOYD — vérification</p>
<p style="font-size:28px;font-weight:900;letter-spacing:.2em;color:#FFFF00">${code}</p>
<p style="font-size:13px;color:rgba(255,255,255,.7)">${(lines[purpose] || lines.activation).slice(1).join('<br>')}</p>
<p style="font-size:11px;color:rgba(255,255,255,.4);margin-top:24px;border-top:1px solid rgba(255,255,255,.1);padding-top:12px;">ZOYD, Cotonou (Bénin) — 18+.<br>Assistance : coyd2976@gmail.com / WhatsApp +2290165240654 (8h-01h GMT+1).</p>
</div>`;
  return { text: text + footerText, html };
};

/**
 * Try sending the code through Resend HTTP API (port 443 — marche sur Render gratuit).
 * Docs : https://resend.com/docs/api-reference/emails/send-email
 * Env : RESEND_API_KEY (re_...), EMAIL_FROM (ex. "ZOYD <noreply@zoyd.africa>").
 * Sans domaine vérifié, EMAIL_FROM = "ZOYD <onboarding@resend.dev>" (test uniquement).
 * @returns {Promise<boolean>} true si envoyé
 */
const sendViaResend = async ({ to, code, purpose }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !isEmail(to)) return false;
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'ZOYD <onboarding@resend.dev>';
  const { text, html } = buildBodies(code, purpose);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: SUBJECTS[purpose] || SUBJECTS.activation,
        text,
        html,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Resend HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Try sending the code through Brevo HTTP API (port 443 — marche sur Render gratuit).
 * Docs : https://developers.brevo.com/reference/sendtransacemail
 * Env : BREVO_API_KEY (xkeysib-...), EMAIL_FROM (expéditeur vérifié dans Brevo).
 * @returns {Promise<boolean>} true si envoyé
 */
const sendViaBrevo = async ({ to, code, purpose }) => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || !isEmail(to)) return false;
  const fromRaw = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'coyd2976@gmail.com';
  const m = String(fromRaw).match(/^(.*)<([^<>]+)>$/);
  const sender = m
    ? { name: m[1].trim().replace(/^["']|["']$/g, '') || 'ZOYD', email: m[2].trim() }
    : { name: 'ZOYD', email: fromRaw.trim() };
  const { text, html } = buildBodies(code, purpose);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject: SUBJECTS[purpose] || SUBJECTS.activation,
        htmlContent: html,
        textContent: text,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Brevo HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Try sending the code through SMTP (Outlook ou compatible).
 * ⚠️ Render gratuit bloque les ports SMTP (25/465/587) → "Connection timeout".
 * Gardé pour dev local / instance payante uniquement.
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

  // 1. Resend API (HTTPS — compatible Render gratuit)
  try {
    if (await sendViaResend({ to, code, purpose })) {
      return { delivered: true, channel: 'resend' };
    }
  } catch (error) {
    log.error('resend delivery failed', { purpose, to: maskDestination(to), message: error.message });
  }

  // 2. Brevo API (HTTPS — compatible Render gratuit)
  try {
    if (await sendViaBrevo({ to, code, purpose })) {
      return { delivered: true, channel: 'brevo' };
    }
  } catch (error) {
    log.error('brevo delivery failed', { purpose, to: maskDestination(to), message: error.message });
  }

  // 3. SMTP (local / instance payante uniquement — bloqué sur Render gratuit)
  try {
    if (await sendViaSmtp({ to, code, purpose })) {
      return { delivered: true, channel: 'smtp' };
    }
  } catch (error) {
    log.error('smtp delivery failed', { purpose, to: maskDestination(to), message: error.message });
    // Conseil actionnable : Render gratuit ferme les ports SMTP.
    if (/timeout|ETIMEDOUT|ENOTFOUND|ECONN/i.test(error.message || '')) {
      log.warn('smtp blocked? use RESEND_API_KEY or BREVO_API_KEY (HTTPS port 443)', {
        purpose,
        to: maskDestination(to),
      });
    }
  }

  // 4. Webhook (allowlist https: stricte — anti-SSRF : pas d'http, pas d'IP/host local)
  const webhook = process.env.CODE_DELIVERY_WEBHOOK;
  const webhookAllowed = (() => {
    if (!webhook) return false;
    try {
      const url = new URL(webhook);
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false; // IPv4 (dont privées)
      if (host.includes(':')) return false; // IPv6
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) return false;
      return true;
    } catch {
      return false;
    }
  })();
  if (webhook && !webhookAllowed) {
    log.error('webhook blocked (not https public url)', { host: maskDestination(webhook) });
  }
  if (webhookAllowed) {
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

  // 5. Défaut
  // Fail-closed : le code n'est loggé qu'avec ALLOW_DEBUG_CODES=true explicite.
  if (process.env.ALLOW_DEBUG_CODES === 'true') {
    // Local testing only: never log codes in production.
    log.info('dev auth code', { purpose, to: maskDestination(to), code });
  } else if (isProd || !process.env.NODE_ENV) {
    log.warn('auth code delivery pending (no provider)', { purpose, to: maskDestination(to) });
  }
  return { delivered: false, channel: 'none' };
};
