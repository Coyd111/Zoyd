/**
 * server/routes/auth.mjs - Domaine AUTHENTIFICATION : inscription, connexion,
 * activation, renvoi de code, reinitialisation de mot de passe, profil
 * (lecture / modification / suppression), deconnexion, changement de mot de
 * passe.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : rate limit -> lecture du corps -> session -> logique
 * metier. Exception : sur `POST /api/auth/logout`, le rate limit vient
 * EN PREMIER et la session est OPTIONNELLE (on peut se deconnecter sans
 * etre connecte).
 *
 * INVARIANT : l'inscription n'accepte qu'une LISTE BLANCHE stricte
 *   (`REGISTER_FIELDS`) : un client qui poste `{id, wallet, trustScore}` ne
 *   doit pas pouvoir creer un compte avec un solde.
 * INVARIANT : la modification du profil utilise elle aussi une liste blanche
 *   stricte (`ALLOWED_PROFILE_FIELDS`) : c'est ce qui bloque l'escalade de
 *   role (mass assignment).
 * INVARIANT : le changement d'email exige le MOT DE PASSE ACTUEL : l'email
 *   est l'identifiant du compte.
 * INVARIANT : le pseudo ne peut pas devenir vide, et le telephone doit
 *   correspondre a un format qu'un retrait pourrait payer.
 * INVARIANT : la deconnexion revoque la session applicative ET les sessions
 *   temps reel du compte.
 * INVARIANT : le changement de mot de passe revoque TOUTES les sessions du
 *   compte.
 * INVARIANT : la suppression du compte exige une confirmation explicite
 *   (`confirmForfeit`) et annonce le solde abandonne.
 * PIEGE : la sanction bloquante est verifiee APRES l'authentification et
 *   repond un code DEDIE (`ACCOUNT_SANCTIONED`) : un "identifiants
 *   invalides" generique ferait croire a un mot de passe oublie.
 * PIEGE : la reinitialisation repond la MEME chose que le compte existe ou
 *   non : pas d'oracle d'enumeration (contrairement a l'inscription, ou le
 *   joueur doit savoir quel champ est deja pris).
 * PIEGE : la connexion utilise le groupe `auth` (50 / 15 min) mais la
 *   deconnexion utilise `auth_logout` : partager le groupe permettait de
 *   verrouiller la connexion de toute une IP partagee pendant 15 minutes.
 * PIEGE : l'inscription cree un compte DIRECTEMENT ACTIF (decision du
 *   18/09/2026) : la route d'activation existe encore mais n'est pas sur le
 *   chemin nominal.
 * PIEGE : la suppression du compte est irreversible et le solde est perdu :
 *   la confirmation n'est pas une formalite.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import { isAnySupportedPhone, phoneFormatErrorAll } from '../payout-countries.mjs';
import {
  ALLOW_DEBUG_CODES,
  getAuthenticatedAppSession,
  paginate,
  parseQueryParams,
  parseRequestBody,
  readBearerToken,
  respondJson,
  respondMappedError,
  serializeAuthCookie,
} from '../http-utils.mjs';
import {
  activateUserAccount,
  applyCovenantAccepted,
  assertStrongPassword,
  authenticateUserAccount,
  changeActivationEmail,
  checkProfileUniqueness,
  COVENANT_VERSION,
  createAuthSession,
  createUserAccount,
  deleteAuthSession,
  deleteRealtimeSessionsForUser,
  deleteUserAccount,
  findUsersByPseudo,
  getAuthSession,
  getPublicUserById,
  getUserById,
  hashPassword,
  isEmailAvailable,
  normalizeEmailKey,
  requestPasswordReset,
  resendActivationCode,
  resetPasswordWithCode,
  revokeAuthSessionsForUser,
  sanitizeText,
  sanitizeUserPayload,
  sbUpsert,
  updatePasswordHash,
  updateUserAccount,
  verifyActivationCode,
  verifyUserPassword,
  getBlockingSanction,
  withRegistrationMutex,
} from '../persistence.mjs';
import { deliverAuthCode } from '../code-delivery.mjs';
import { createLogger } from '../logger.mjs';
import { randomUUID } from 'node:crypto';
import { getNow } from '../utils.mjs';
import { severityForReason } from '../moderation.mjs';

const log = createLogger('auth-routes');
import { refreshLiveMatchIdentities } from '../state-helpers.mjs';
import { getServerWallet } from '../wallet-engine.mjs';

export const handleAuthRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'POST' && pathname === '/api/auth/register') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    if (!body.email || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      respondJson(res, 400, { ok: false, error: 'Adresse email invalide.', code: 'INVALID_EMAIL' });
      return true;
    }
    // Whitelist STRICTE : sans elle, un POST {id, wallet, trustScore, stats}
    // écrasait un compte en RAM+base et créditait un solde arbitraire.
    const REGISTER_FIELDS = [
      'pseudo', 'email', 'phone', 'password', 'gameId',
      'controllerType', 'device', 'levelCODM', 'rankMJ', 'rankBR',
      'country', 'streamerMode', 'streamerPseudo',
      'acceptAdult', 'acceptTerms',
      // A-5 (audit-5) : `acceptedAt` n'est plus accepte — la trace legale
      // (adultAt/termsAt) est posee par le serveur (persistence.mjs), la date
      // client n'est pas probante.
    ];
    const safeBody = {};
    for (const field of REGISTER_FIELDS) {
      if (field in body) safeBody[field] = body[field];
    }
    for (const field of ['pseudo', 'bio', 'streamerPseudo']) {
      if (field in safeBody) safeBody[field] = sanitizeText(safeBody[field] || '');
    }
    const user = await createUserAccount(safeBody);
    // V1 simplifiée (décision 2026-09-18) : compte directement actif,
    // session immédiate. Pas de code d'activation (pas d'email/SMS pour l'instant).
    const session = await createAuthSession(user.id);
    res.setHeader('Set-Cookie', serializeAuthCookie(session.token, 6 * 60 * 60));

    respondJson(res, 201, {
      ok: true,
      user: session.user,
      expiresAt: session.expiresAt,
      // Dev/test uniquement : jamais de token en réponse en production.
      ...(ALLOW_DEBUG_CODES && { token: session.token }),
      message: 'Compte cree avec succes. Bienvenue sur ZOYD !',
    });
  } catch (error) {
    log.error('register error', { message: error.message, code: error.code });
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/login') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const user = await authenticateUserAccount({
      identifier: body.identifier || '',
      password: body.password || '',
    });

    // Sanction bloquante : message DEDIE, jamais un echec d'identifiants
    // generique. Un joueur banni qui voit « identifiants invalides » croit a
    // un mot de passe oublie et le redemande, ou contacte le support sans
    // savoir pourquoi. Le code distinct permet aussi au client de proposer
    // le bon geste.
    const sanction = getBlockingSanction(user.id);
    if (sanction) {
      const permanente = sanction.kind === 'permanent_ban';
      const jusquAu = sanction.expiresAt
        ? new Date(sanction.expiresAt).toLocaleDateString('fr-FR')
        : null;
      respondJson(res, 403, {
        ok: false,
        code: 'ACCOUNT_SANCTIONED',
        error: permanente
          ? 'Ce compte est banni definitivement.'
          : `Ce compte est suspendu jusqu'au ${jusquAu}.`,
        sanction: {
          kind: sanction.kind,
          expiresAt: sanction.expiresAt || null,
          // La raison est un MOTIF de sanction, pas une sanction a son tour :
          // une sanction levee reste lisible, c'est l historique.
          reason: sanction.reason || '',
          issuedAt: sanction.issuedAt,
        },
      });
      return true;
    }

    const session = await createAuthSession(user.id);

    // Cookie httpOnly = seul credential du navigateur (plus de token en JS).
    res.setHeader('Set-Cookie', serializeAuthCookie(session.token, 6 * 60 * 60));

    respondJson(res, 200, {
      ok: true,
      user: session.user,
      expiresAt: session.expiresAt,
      // Dev/test uniquement : jamais de token en réponse en production.
      ...(ALLOW_DEBUG_CODES && { token: session.token }),
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/activate') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const { email, code } = body;
    
    if (!email || !code) {
      respondJson(res, 400, { ok: false, error: 'Email et code requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    
    const verification = verifyActivationCode(email, code);
    
    if (!verification.valid) {
      respondJson(res, 400, { ok: false, error: verification.error, code: 'ACTIVATION_FAILED' });
      return true;
    }
    
    const activatedUser = await activateUserAccount(verification.userId);
    
    respondJson(res, 200, {
      ok: true,
      user: sanitizeUserPayload(activatedUser),
      message: 'Compte active avec succes. Vous pouvez maintenant vous connecter.',
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/resend-code') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const { email } = body;
    if (!email || typeof email !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Email requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    // A-1 (audit-5) : anti-enumeration. L'ancien code laissait remonter
    // `USER_NOT_FOUND` et `ACCOUNT_ALREADY_ACTIVE` (404/409 distincts) :
    // trois reponses possibles = un oracle gratuit sur l'existence d'un
    // compte et son etat d'activation. Meme invariant que forgot-password
    // (P13 C14) : la reponse est IDENTIQUE dans les trois cas. Le code est
    // genere et envoye UNIQUEMENT quand un compte inactif existe vraiment.
    let code = null;
    try {
      ({ code } = resendActivationCode(email));
    } catch (erreurCompte) {
      if (erreurCompte?.code !== 'USER_NOT_FOUND' && erreurCompte?.code !== 'ACCOUNT_ALREADY_ACTIVE') {
        throw erreurCompte;
      }
    }
    if (code) {
      await deliverAuthCode({ to: email, code, purpose: 'activation-resend' });
    }
    respondJson(res, 200, {
      ok: true,
      // Conserve pour compatibilite, mais toujours a `true`.
      found: true,
      message: 'Si un compte inactif est rattache a cet email, un nouveau code vient d etre envoye. Verifie ta boite de reception.',
      ...(ALLOW_DEBUG_CODES && code ? { activationCode: code } : {}),
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/activation-email') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const { oldEmail, newEmail } = body;
    const password = body.password;
    if (!oldEmail || !newEmail || !password || typeof password !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Ancien et nouvel email requis, avec le mot de passe actuel du compte.', code: 'MISSING_FIELDS' });
      return true;
    }
    // A-3 (audit-5) : preuve de possession. L'ancien email ne prouve rien (on
    // peut le connaitre d'autrui) ; le mot de passe, lui, prouve qu'on parle
    // bien du compte. Les erreurs « compte inconnu / deja actif / mauvais
    // mot de passe » repondent IDENTIQUEMENT (Meme invariant que
    // forgot-password, P13 C14) : une distinction serait un oracle sur la
    // possession d'un email et sur l'etat d'activation des comptes.
    let code;
    try {
      ({ code } = await changeActivationEmail(oldEmail, newEmail, password));
    } catch (erreurCompte) {
      if (
        erreurCompte?.code === 'USER_NOT_FOUND'
        || erreurCompte?.code === 'ACCOUNT_ALREADY_ACTIVE'
        || erreurCompte?.code === 'WRONG_PASSWORD'
      ) {
        respondJson(res, 200, {
          ok: true,
          found: true,
          message: 'Si un compte inactif correspond a cet ancien email et a ce mot de passe, la nouvelle adresse a ete enregistree. Verifie ta nouvelle boite de reception.',
        });
        return true;
      }
      throw erreurCompte;
    }
    const delivery = await deliverAuthCode({ to: newEmail, code, purpose: 'activation-email' });
    respondJson(res, 200, {
      ok: true,
      message: delivery.delivered
        ? 'Email mis a jour. Nouveau code envoye.'
        : "Email mis a jour. L'envoi automatique n'est pas encore configure : contacte le support si tu ne recois pas le code.",
      delivery: delivery.delivered ? 'sent' : 'pending-provider',
      ...(ALLOW_DEBUG_CODES && { activationCode: code }),
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/forgot-password') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const { identifier } = body;
    if (!identifier || typeof identifier !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Identifiant requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    // P13 C14 (audit-3) : l'ancien commentaire affirmait ici l'inverse du
    // code (« le front a besoin de savoir si le compte existe », residu
    // d'un choix produit abandonne). La reponse ci-dessous est IDENTIQUE
    // que le compte existe ou non : anti-enumeration, voir le bloc
    // detaille quelques lignes plus bas.
    const result = requestPasswordReset(identifier);
    let delivery = { delivered: false };
    if (result.found) {
      delivery = await deliverAuthCode({ to: identifier, code: result.code, purpose: 'password-reset' });
    }
    // Reponse IDENTIQUE que le compte existe ou non.
    //
    // La reponse disait `found: false` ET un message different (« Aucun compte
    // associe a cet identifiant »). C etait un oracle d enumeration gratuit :
    // il suffisait de soumettre un email pour savoir s il etait inscrit.
    //
    // Ici, contrairement a l inscription, rien n excuse de repondre : pendant
    // l inscription, le joueur doit savoir quel champ est deja pris. Pour une
    // reinitialisation, l attaquant n a aucun besoin legitime de le savoir, et
    // l inscription d un compte inexistant ne peut pas « echouer » puisque
    // rien n est cree a ce stade.
    //
    // Le detail de l envoi n est pas non plus divulgue : repondre « le code a
    // ete envoye » quand rien n a ete envoye guiderait un attaquant vers les
    // providers et %{ transporterait l'information par un canal secondaire.
    respondJson(res, 200, {
      ok: true,
      // Conserve pour compatibilite, mais toujours a `true`.
      found: true,
      message: 'Si un compte est associe a cet identifiant, un code vient d etre envoye. Verifie ta boite de reception.',
      ...(ALLOW_DEBUG_CODES && result.found && { resetCode: result.code }),
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    const { identifier, code, newPassword } = body;
    if (!identifier || !code || !newPassword) {
      respondJson(res, 400, { ok: false, error: 'Identifiant, code et nouveau mot de passe requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    await resetPasswordWithCode(identifier, code, newPassword);
    respondJson(res, 200, {
      ok: true,
      message: 'Mot de passe reinitialise. Connecte-toi avec ton nouveau mot de passe.',
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

  if (req.method === 'GET' && pathname === '/api/auth/me') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  respondJson(res, 200, {
    ok: true,
    user: session.user,
    expiresAt: session.expiresAt,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// COVENANT — serment d'intégrité anti-triche (F1..F10 présenté après login).
//
// INVARIANT : `applyCovenantAccepted` est idempotent et date par le SERVEUR —
//   rejouer ne repousse pas la date (un compte, une fois, une date).
// INVARIANT : les réponses oui/non des fenêtres ne sont PAS envoyées : le
//   client n'envoie que `version` + le signalement optionnel F7. Aucun aveu
//   nominatif en base — c'est un engagement affiché, pas un interrogatoire.
// INVARIANT : le signalement F7 est ANONYME par construction : `reporter_id`
//   reste NULL (`reporterPseudo` jamais rempli). La promesse rendue à
//   l'écran (« ton pseudo n'apparaît nulle part ») est tenue au schéma.
// ORDRE D'ÉCRITURE : le signalement part d'abord. Si son écriture est
//   réellement refusée (base indisponible), la route répond 503 SANS avoir
//   scellé le serment : le client répète, rien n'est perdu. Écrire le
//   serment d'abord puis avaler la perte du signal ferait disparaître un
//   signalement de triche dans le silence.
// OBJET DU SIGNALEMENT : pseudo LIBRE (le suspect peut ne pas avoir de
//   compte, ou en changer) — `target_id` reste NULL. `reason` = `cheating`
//   (gravité `grave` par `severityForReason`), la description porte le
//   contexte du serment. L'admin tranche : la recommandation ne s'applique
//   pas seule (moderation.mjs).
// ─────────────────────────────────────────────────────────────────────────────
if (req.method === 'POST' && pathname === '/api/auth/covenant') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);

    // Déjà scellé (rejeu, double-clic, onglet en retard) : rien à réécrire,
    // et UN REJEU NE POSE JAMAIS DE SIGNAL : le serment est clos, sa fenêtre
    // F7 aussi — réaccepter un signal à ce stade fermerait les yeux d'un
    // administrateur sur une accusation fantôme.
    const existant = getUserById(session.user.id);
    if (existant?.covenant?.acceptedAt) {
      respondJson(res, 200, { ok: true, user: existant, already: true, signalRegistered: false });
      return true;
    }

    // F7 optionnel : pseudo (30 = la limite d'un pseudo réel) + note libre.
    const suspectPseudo = sanitizeText(String(body.report?.pseudo || '')).slice(0, 30);
    const suspectNote = sanitizeText(String(body.report?.note || '')).slice(0, 300);

    // ORDRE D'ECRITURE RÉEL (test server/covenant.test.mjs) : le signalement
    // part AVANT applyCovenantAccepted. Si son écriture est réellement
    // refusée (base indisponible), la route répond 503 SANS avoir scellé le
    // serment : le client répète, rien n'est perdu. Sceller d'abord puis
    // avaler la perte du signal reviendrait à répondre « serment scellé » à
    // un joueur dont le signalement viendrait de disparaître — et tout
    // rejeu ultérieur tomberait sur `already` ci-dessus : le signal serait
    // perdu pour toujours.
    let signalRegistered = false;
    if (suspectPseudo) {
      const description = `Serment d'intégrité — pseudo suspect « ${suspectPseudo} ». ${suspectNote}`.slice(0, 1000);
      const report = {
        id: `RP-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8)}`,
        // Anonyme : reportage anti-triche du serment, pas une accusation
        // nominale. La table autorise NULL (schema.sql l.361).
        reporterId: null,
        reporterPseudo: '',
        targetId: null,
        targetPseudo: suspectPseudo,
        reason: 'cheating',
        description,
        status: 'pending',
        createdAt: getNow(),
      };
      const written = await sbUpsert('user_reports', {
        id: report.id,
        reporter_id: null,
        target_id: null,
        reason: report.reason,
        status: report.status,
        severity: severityForReason(report.reason),
        payload: report,
        created_at: report.createdAt,
      });
      // `undefined` = mode mémoire (pas de Supabase configuré) : les autres
      // routes le traitent comme un succès, même convention ici. `false` seul
      // signale un refus réel d'écriture.
      if (written === false) {
        respondJson(res, 503, {
          ok: false,
          error: "Serment non scellé : le signalement n'a pas pu être enregistré, réessaie.",
          code: 'SERVER_BUSY',
        });
        return true;
      }
      signalRegistered = true;
    }

    // Le sceau, DERNIER : idempotent (au cas où une requête concurrente
    // l'aurait posé — la réponse déjà scellée l'admet honnêtement) et daté
    // par le serveur, jamais par le client.
    const { user, already } = await applyCovenantAccepted(session.user.id, COVENANT_VERSION);
    respondJson(res, 200, { ok: true, user, already, signalRegistered });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'PATCH' && pathname === '/api/auth/me') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'auth')) { return true; }

  try {
    const body = await parseRequestBody(req);
    // Whitelist strict — empêche l'escalade de rôle (mass assignment)
    const ALLOWED_PROFILE_FIELDS = [
      'pseudo', 'avatar', 'bio', 'device', 'controllerType',
      'country', 'streamerMode', 'streamerPseudo', 'notifications',
      'phone', 'levelCODM', 'rankMJ', 'rankBR',
    ];
    const safeUpdate = {};
    const STRING_FIELDS = ['pseudo', 'bio', 'avatar', 'streamerPseudo', 'country', 'phone'];
    const ENUM_FIELDS = {
      controllerType: ['touch', 'controller', 'emulator', 'pc', 'other'],
      device: ['phone', 'tablet', 'pc', 'other'],
    };
    const RANK_VALUES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Legendary', 'Rookie'];
    for (const field of ALLOWED_PROFILE_FIELDS) {
      if (field in body) {
        let value = STRING_FIELDS.includes(field) ? sanitizeText(body[field]) : body[field];
        if (ENUM_FIELDS[field] && (typeof value !== 'string' || !ENUM_FIELDS[field].includes(value))) {
          respondJson(res, 400, { ok: false, error: `Valeur invalide pour ${field}. Valeurs acceptees: ${ENUM_FIELDS[field].join(', ')}`, code: 'INVALID_ENUM' });
          return true;
        }
        if ((field === 'rankMJ' || field === 'rankBR') && !RANK_VALUES.includes(value)) {
          respondJson(res, 400, { ok: false, error: `Rang invalide pour ${field}. Valeurs acceptees: ${RANK_VALUES.join(', ')}`, code: 'INVALID_ENUM' });
          return true;
        }
        if (field === 'levelCODM' && (typeof value !== 'number' || value < 1 || value > 150 || !Number.isFinite(value))) {
          respondJson(res, 400, { ok: false, error: 'Level CODM invalide (1-150).', code: 'INVALID_ENUM' });
          return true;
        }
        // Le telephone n'etait valide par AUCUNE validation, alors qu'il est
        // en `STRING_FIELDS` : il suffisait donc `sanitizeText`.
        //
        // `normalizePhoneKey` ne garde que les chiffres, et la cle
        // d'unicité `phone_key` en base n'est PAS NULL. Un joueur pouvait donc
        // poser `phone: ""` — ou `phone: "abc"`, dont la cle vaut aussi `""` —
        // et occuper la cle VIDE de l'index. Le joueur suivant qui tentait la
        // meme chose violait `phone_key UNIQUE`, ce qui faisait echouer son
        // ecriture et le renvoyait en 503 : DEFINITIVEMENT.
        //
        // Un joueur pouvait donc casser la mise a jour de profil de tous les
        // autres, sans etre administrateur.
        if (field === 'phone' && value !== '' && !isAnySupportedPhone(value)) {
          respondJson(res, 400, {
            ok: false,
            error: phoneFormatErrorAll(),
            code: 'INVALID_PHONE',
          });
          return true;
        }
        if (field === 'bio' && typeof value === 'string' && value.length > 500) {
          value = value.slice(0, 500);
        }
        if (field === 'pseudo' && typeof value === 'string' && value.length > 30) {
          value = value.slice(0, 30);
        }
        // Un pseudo vide effacerait l'identité du joueur : il disparaît des
        // matchs en cours, des classements et de la file de l'arbitre.
        // `checkProfileUniqueness` ignoreait justement les valeurs vides, le
        // compte restait donc « valide »… sans nom.
        if (field === 'pseudo' && !String(value || '').trim()) {
          respondJson(res, 400, { ok: false, error: 'Le pseudo ne peut pas etre vide.', code: 'PSEUDO_REQUIRED' });
          return true;
        }
        safeUpdate[field] = value;
      }
    }

    // Changement d'email de connexion : opération sensible, traitée à part.
    //
    // L'email est l'IDENTIFIANT du compte. Le changer sans prouver son mot
    // de passe permettrait à une session volée (XSS, poste partagé) de prendre
    // la main définitivement : l'ancien mot de passe ne servirait plus à rien
    // pour revenir. D'où la reauthentification obligatoire.
    if (typeof body.email === 'string' && body.email.trim()) {
      const nextEmail = body.email.trim().toLowerCase();
      const currentEmail = normalizeEmailKey(getUserById(session.user.id)?.email || '');
      if (nextEmail !== currentEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nextEmail) || nextEmail.length > 120) {
          respondJson(res, 400, { ok: false, error: 'Email invalide.', code: 'INVALID_EMAIL' });
          return true;
        }
        if (!isEmailAvailable(nextEmail, session.user.id)) {
          respondJson(res, 409, { ok: false, error: 'Cet email est deja rattache a un compte ZOYD.', code: 'DUPLICATE_EMAIL' });
          return true;
        }
        // `verifyPassword` part dans scrypt : un `undefined` le ferait
        // exploser en 500 au lieu de repondre 403.
        if (
          typeof body.currentPassword !== 'string'
          || !body.currentPassword
          || !(await verifyUserPassword(session.user.id, body.currentPassword))
        ) {
          respondJson(res, 403, { ok: false, error: 'Mot de passe incorrect : confirmation requise pour changer d’email.', code: 'PASSWORD_CONFIRMATION_REQUIRED' });
          return true;
        }
        safeUpdate.email = nextEmail;
      }
    }
    const updatedUser = await withRegistrationMutex(() => updateUserAccount(session.user.id, (user) => {
      // Unicité pseudo/email/phone (sinon collisions auth) — throw DUPLICATE_* → 409.
      // Sous mutex global : deux PATCH concurrents ne peuvent plus prendre le même identifiant.
      checkProfileUniqueness(session.user.id, safeUpdate);
      return { ...user, ...safeUpdate };
    }));
    // Un pseudo n'est pas figé dans les matchs en cours : l'arbitre doit voir
    // le nouveau nom sans attendre le prochain mouvement de match.
    if (safeUpdate.pseudo) {
      try {
        refreshLiveMatchIdentities(io, session.user.id);
      } catch (broadcastError) {
        // Le renregistrement est déjà écrit : un échec de diffusion ne doit
        // pas faire répondre 500 au client (le rattrapageira au prochain
        // broadcast de match).
        log.warn('Renvoi des matchs apres changement de pseudo impossible', { error: String(broadcastError?.message || broadcastError) });
      }
    }
    respondJson(res, 200, { ok: true, user: updatedUser }, req);
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/logout') {
    // Groupe DEDIE, et non `auth`.
    //
    // Le rate limit est pose AVANT toute lecture de token, et le token est
    // facultatif : sans session, la route repond quand meme 200. `logout` est
    // donc appelable par n'importe qui, sans rien prouver.
    //
    // Sur le groupe `auth`, 50 appels suffisaient a renvoyer 429 sur TOUTES les
    // routes d'authentification pendant 15 minutes : `login`, `register`,
    // `forgot-password`, `reset-password`. Derriere un CGNAT mobile, ou une IP
    // d'entreprise partagee, tous les utilisateurs de cette IP ne pouvaient
    // plus se connecter du tout. Un deni de connexion de masse, gratuit.
    //
    // `logout` n'a aucun cout serveur notable, donc son propre quota suffit a
    // le contenir.
    if (!rateLimitGuard(res, getClientIp(req), 'auth_logout')) { return true; }
  const token = readBearerToken(req);
  // skipRotation: sans ça, getAuthSession déclenche une rotation
  // fire-and-forget qui INSÈRE le nouveau token en mémoire de façon
  // synchrone AVANT que la route ne supprime l'ancien => une session
  // serveur valide de 6h survivait au logout (poste partagé).
  const session = token ? getAuthSession(token, { skipRotation: true }) : null;
  if (token) {
    deleteAuthSession(token);
  }
  if (session?.user?.id) {
    deleteRealtimeSessionsForUser(session.user.id);
  }

  // Clear HttpOnly cookie
  res.setHeader('Set-Cookie', serializeAuthCookie('', 0));

  respondJson(res, 200, { ok: true });
  return true;
}

if (req.method === 'POST' && pathname === '/api/auth/change-password') {
  const clientIp = getClientIp(req);
  if (!rateLimitGuard(res, clientIp, 'auth')) { return true; }
  const token = readBearerToken(req);
  const session = token ? getAuthSession(token, { skipRotation: true }) : null;
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try {
    const body = await parseRequestBody(req);
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      respondJson(res, 400, { ok: false, error: 'Les deux mots de passe sont requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    try {
      assertStrongPassword(newPassword);
    } catch (e) {
      respondMappedError(res, e);
      return true;
    }
    const user = getUserById(session.user.id);
    if (!user) {
      respondJson(res, 404, { ok: false, error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });
      return true;
    }
    if (!(await verifyUserPassword(session.user.id, currentPassword))) {
      respondJson(res, 403, { ok: false, error: 'Mot de passe actuel incorrect.', code: 'WRONG_PASSWORD' });
      return true;
    }
    const newHash = await hashPassword(newPassword);
    await updatePasswordHash(session.user.id, newHash);
    // B9 : révoque TOUTES les sessions (une session attaquant ne doit pas survivre).
    revokeAuthSessionsForUser(session.user.id);
    deleteRealtimeSessionsForUser(session.user.id);
    res.setHeader('Set-Cookie', serializeAuthCookie('', 0));
    respondJson(res, 200, { ok: true });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'DELETE' && pathname === '/api/auth/me') {
  if (!rateLimitGuard(res, getClientIp(req), 'auth')) { return true; }
  const token = readBearerToken(req);
  const session = token ? getAuthSession(token, { skipRotation: true }) : null;
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try {
    const body = await parseRequestBody(req);
    if (body?.confirmForfeit !== true) {
      respondJson(res, 400, { ok: false, error: 'Confirme la perte du solde restant pour supprimer ton compte.', code: 'CONFIRM_REQUIRED' });
      return true;
    }
    const { forfeitedCash } = await deleteUserAccount(session.user.id);
    // Clear HttpOnly cookie (all sessions already revoked)
    res.setHeader('Set-Cookie', serializeAuthCookie('', 0));
    respondJson(res, 200, {
      ok: true,
      message: forfeitedCash > 0
        ? `Compte supprimé. Solde restant de ${forfeitedCash} ZC abandonné.`
        : 'Compte supprimé définitivement.',
    });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

  return false;
};
