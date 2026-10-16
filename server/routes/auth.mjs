import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import { isAnySupportedPhone, phoneFormatError } from '../payout-countries.mjs';
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
  assertStrongPassword,
  authenticateUserAccount,
  changeActivationEmail,
  checkProfileUniqueness,
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
  updatePasswordHash,
  updateUserAccount,
  verifyActivationCode,
  verifyUserPassword,
  getBlockingSanction,
  withRegistrationMutex,
} from '../persistence.mjs';
import { deliverAuthCode } from '../code-delivery.mjs';
import { createLogger } from '../logger.mjs';

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
      'acceptAdult', 'acceptTerms', 'acceptedAt',
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
    const { code } = resendActivationCode(email);
    const delivery = await deliverAuthCode({ to: email, code, purpose: 'activation-resend' });
    respondJson(res, 200, {
      ok: true,
      message: delivery.delivered
        ? 'Nouveau code envoye. Verifie ta boite de reception.'
        : "Nouveau code genere. L'envoi automatique n'est pas encore configure : contacte le support si tu ne le recois pas.",
      delivery: delivery.delivered ? 'sent' : 'pending-provider',
      ...(ALLOW_DEBUG_CODES && { activationCode: code }),
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
    if (!oldEmail || !newEmail) {
      respondJson(res, 400, { ok: false, error: 'Ancien et nouvel email requis.', code: 'MISSING_FIELDS' });
      return true;
    }
    const { code } = await changeActivationEmail(oldEmail, newEmail);
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
    // UX v1 : le front a besoin de savoir si le compte existe pour rester
    // sur l'étape 1 avec un message clair (choix produit assumé : cela
    // rend l'existence des comptes devinable, acceptable pour la v1).
    const result = requestPasswordReset(identifier);
    let delivery = { delivered: false };
    if (result.found) {
      delivery = await deliverAuthCode({ to: identifier, code: result.code, purpose: 'password-reset' });
    }
    respondJson(res, 200, {
      ok: true,
      found: result.found,
      message: result.found
        ? (delivery.delivered
          ? 'Code envoyé. Vérifie ta boîte de réception (et tes spams).'
          : "Code généré mais l'envoi automatique a échoué : réessaie dans un instant ou contacte le support.")
        : 'Aucun compte associé à cet identifiant.',
      ...(result.found && { delivery: delivery.delivered ? 'sent' : 'pending-provider' }),
      ...(result.found && ALLOW_DEBUG_CODES && { resetCode: result.code }),
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
            error: phoneFormatError(),
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
