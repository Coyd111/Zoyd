/**
 * server/routes/match.mjs - Domaine MATCHS 1v1-5v5 : creation, inscription,
 * arbitrage, presence, pret, programmation, salle, lancement, resultat,
 * confirmation, litige, preuves, escalade.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : session (401 `AUTH_REQUIRED`) -> rate limit (`social`
 * pour les actions sociales) -> lecture du corps -> `withMatchMutex` (global)
 * -> `withWalletMutex` (par joueur) -> moteur -> `saveMatches` -> reponse.
 * Les resultats et places d'arbitre ajoutent `require2faIfAdmin` : une
 * session admin doit avoir une 2FA fraiche, un joueur arbitre passe sans
 * code (l'override admin ne doit pas couter moins que /api/admin/*).
 *
 * INVARIANT : le verrou GLOBAL est pris AVANT le verrou par portefeuille :
 *   l'ordre inverse ouvre la porte a un deadlock.
 * INVARIANT : le corps de la requete est lu HORS du mutex : le verrou doit
 *   couvrir la mutation, pas le parsing.
 * INVARIANT : le droit d'entree est arrondi a 2 decimales AVANT le calcul de
 *   la cagnotte : le pot est un produit, l'argent bloque une somme
 *   d'arrondis - au-dela de 2 decimales les deux divergent de quelques
 *   centimes et le reglement cree de la monnaie.
 * INVARIANT : le resultat est soumis avec `deferSettlement: true` : il est
 *   PERSISTE d'abord, l'argent est verse ensuite.
 * INVARIANT : le corps du resultat est filtre par une liste blanche
 *   (`winnerTeam`, `scores`, `proofs`, `screenshots`, `resolutionType`,
 *   `arbiterNotes`) : c'est du JSON client.
 * INVARIANT : toute mutation se termine par `saveMatches` (persistance ET
 *   diffusion) avant la reponse.
 * PIEGE : le `return true` place DANS le callback du mutex ne sort pas de la
 *   requete (cf. routes/wallet.mjs).
 * PIEGE : la route n'ecrit JAMAIS le statut elle-meme : il vient du moteur
 *   (`updateMatchSnapshot` le derive).
 * PIEGE : le `isMe` de la reponse vient de `buildMatchActionPayload` : le
 *   client ne le calcule pas.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import {
  getAuthenticatedAppSession,
  parseRequestBody,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import { roundAmount } from '../utils.mjs';
import { withMatchMutex, withWalletMutex } from '../mutex.mjs';
import {
  createMatchOnServer,
  joinMatchOnServer,
  assignArbiterOnServer,
  checkInMatchOnServer,
  toggleReadyOnServer,
  scheduleMatchOnServer,
  setRoomDetailsOnServer,
  launchMatchOnServer,
  submitMatchResultOnServer,
  confirmMatchResultOnServer,
  openDisputeOnServer,
  addEvidenceToDisputeOnServer,
  escalateDisputeOnServer,
} from '../match-engine.mjs';
import { getStateCollection } from '../persistence.mjs';
import { saveMatches, buildMatchActionPayload } from '../state-helpers.mjs';
import { deliverNotification, notifyAllAdmins } from '../push-notifications.mjs';
import { require2faIfAdmin } from '../admin-totp.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('match-routes');


export const handleMatchRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'POST' && pathname === '/api/matches') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }

  // Parsing hors lock : le mutex global ne doit couvrir que la mutation.
  let body;
  try {
    body = await parseRequestBody(req);
  } catch (error) {
    respondMappedError(res, error);
    return true;
  }
  try { await withMatchMutex(async () => {
    if (body.tournamentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tournamentId)) {
      respondJson(res, 400, { ok: false, error: 'tournamentId invalide.', code: 'INVALID_JSON' });
      return true;
    }
    // Formats 1VS1 à 5VS5 uniquement (garde serveur, cf. MAX_TEAM_SIZE).
    const formatMatch = /^(\d+)VS(\d+)$/i.exec(String(body.format || ''));
    const formatTeamSize = formatMatch ? Number(formatMatch[1]) : NaN;
    if (!formatMatch || formatMatch[1] !== formatMatch[2] || formatTeamSize < 1 || formatTeamSize > 5) {
      respondJson(res, 400, { ok: false, error: 'format invalide (de 1VS1 a 5VS5).', code: 'INVALID_FORMAT' });
      return true;
    }
    if (body.entryFee !== undefined && (typeof body.entryFee !== 'number' || !Number.isFinite(body.entryFee) || body.entryFee < 0)) {
      respondJson(res, 400, { ok: false, error: 'entryFee doit être un nombre positif.', code: 'INVALID_ENTRY_FEE' });
      return true;
    }
    // Le tarif est arrondi a 2 decimales AVANT tout calcul de pot.
    //
    // Meme raison que pour les tournois : le pot est un produit (entryFee x
    // joueurs), alors que l argent reellement bloque est une somme d arrondis.
    // Au-dela de 2 decimales, les deux divergent de quelques centimes et le
    // reglement cree ou detruit de la monnaie.
    const normalizedBody = body.entryFee === undefined
      ? body
      : { ...body, entryFee: roundAmount(body.entryFee) };

    const outcome = await withWalletMutex(session.user.id, async () =>
      createMatchOnServer(getStateCollection('matches'), session.user, normalizedBody)
    );
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 201, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchJoin = pathname.match(/^\/api\/matches\/([^/]+)\/join$/);
if (req.method === 'POST' && matchJoin) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }

  let body;
  try {
    body = await parseRequestBody(req);
  } catch (error) {
    respondMappedError(res, error);
    return true;
  }
  try { await withMatchMutex(async () => {
    const outcome = await withWalletMutex(session.user.id, async () =>
      joinMatchOnServer(getStateCollection('matches'), session.user, matchJoin[1], body.team)
    );
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchArbiter = pathname.match(/^\/api\/matches\/([^/]+)\/arbiter$/);
if (req.method === 'POST' && matchArbiter) {
  // La place d'arbitre ouvre le chemin normal "l'arbitre ecrit le resultat,
  // la cagnotte part a la confirmation" : sans garde, un admin dont le mot
  // de passe est compromis (pas le TOTP) s'attribue la place puis paie via
  // sa session admin. L'override admin passe donc par la meme fenetre 2FA
  // que les routes /api/admin/* (audit-2 S1).
  const session = require2faIfAdmin(req, res);
  if (!session) { return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }

  try { await withMatchMutex(async () => {
    const outcome = assignArbiterOnServer(getStateCollection('matches'), session.user, matchArbiter[1]);
    await saveMatches(io, outcome.matches, outcome.match);

    deliverNotification(io, session.user.id, {
      type: 'arbiter_assigned',
      title: 'Arbitre assigne',
      body: `Tu es arbitre du match "${outcome.match?.format || 'MJ'}" (${outcome.match?.id}).`,
      url: `/mj/match/${outcome.match?.id}`,
      requireInteraction: true
    }).catch(err => log.error('Notification delivery failed', err));

    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchCheckIn = pathname.match(/^\/api\/matches\/([^/]+)\/check-in$/);
if (req.method === 'POST' && matchCheckIn) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }

  try { await withMatchMutex(async () => {
    const outcome = checkInMatchOnServer(getStateCollection('matches'), session.user, matchCheckIn[1]);
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchReady = pathname.match(/^\/api\/matches\/([^/]+)\/ready$/);
if (req.method === 'POST' && matchReady) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }

  try { await withMatchMutex(async () => {
    const outcome = toggleReadyOnServer(getStateCollection('matches'), session.user, matchReady[1]);
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchSchedule = pathname.match(/^\/api\/matches\/([^/]+)\/schedule$/);
if (req.method === 'POST' && matchSchedule) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withMatchMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = scheduleMatchOnServer(getStateCollection('matches'), session.user, matchSchedule[1], body.scheduledAt);
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchRoom = pathname.match(/^\/api\/matches\/([^/]+)\/room$/);
if (req.method === 'POST' && matchRoom) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withMatchMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = setRoomDetailsOnServer(
      getStateCollection('matches'),
      session.user,
      matchRoom[1],
      body.roomName,
      body.roomPassword
    );
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchLaunch = pathname.match(/^\/api\/matches\/([^/]+)\/launch$/);
if (req.method === 'POST' && matchLaunch) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withMatchMutex(async () => {
    const outcome = launchMatchOnServer(getStateCollection('matches'), session.user, matchLaunch[1]);
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchResult = pathname.match(/^\/api\/matches\/([^/]+)\/result$/);
if (req.method === 'POST' && matchResult) {
  // L'override admin ecrivait le resultat sans TOTP : le texte de
  // expireConfirmationsOnServer dit meme que "l'admin peut ecrire un
  // resultat". C'est le contour le plus court de la 2FA : la route jumelle
  // /api/admin/matches/:id/award exige le code, le chemin joueur ne le
  // demandait pas (audit-2 S1).
  const session = require2faIfAdmin(req, res);
  if (!session) { return true; }

  try { await withMatchMutex(async () => {
    const body = await parseRequestBody(req);
    // On PERSISTE le résultat mais on NE VERSE PAS : le match passe en
    // 'awaiting_confirmation'. Les deux équipes doivent confirmer (ou la
    // fenêtre de 30 min expire via cron) avant que la cagnotte parte.
    // C'est la seule fenêtre où le perdant peut encore ouvrir un litige.
    //
    // Whitelist stricte : le body est du JSON client, on ne persiste que
    // les champs attendus (anti mass-assignment sur match.result).
    const outcome = await submitMatchResultOnServer(
      getStateCollection('matches'), session.user, matchResult[1], {
        winnerTeam: body.winnerTeam,
        scores: body.scores,
        proofs: body.proofs,
        screenshots: body.screenshots,
        resolutionType: body.resolutionType,
        arbiterNotes: body.arbiterNotes,
      }, { deferSettlement: true }
    );
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, {
      ...buildMatchActionPayload(outcome.match, session.user.id),
      awaitingConfirmation: true,
      confirmationDeadline: outcome.match.confirmationDeadline,
    });
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchConfirm = pathname.match(/^\/api\/matches\/([^/]+)\/confirm$/);
if (req.method === 'POST' && matchConfirm) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withMatchMutex(async () => {
    const outcome = await confirmMatchResultOnServer(getStateCollection('matches'), session.user, matchConfirm[1]);
    await saveMatches(io, outcome.matches, outcome.match);

    const match = outcome.match;
    // On prévient ceux qui n'ont pas encore confirmé (ils peuvent
    // contester tant que la fenêtre est ouverte).
    const pendingIds = outcome.waitingFor || [];
    for (const userId of pendingIds) {
      if (userId === session.user.id) continue;
      deliverNotification(io, userId, {
        type: 'match_result',
        title: 'Resultat a confirmer',
        body: `${session.user.pseudo} a confirme le resultat du match ${match.id}. Confirme-le ou ouvre un litige avant la fin du delai.`,
        url: `/mj/match/${match.id}`,
        requireInteraction: true
      }).catch(err => log.error('Notification delivery failed', err));
    }

    respondJson(res, 200, {
      ...buildMatchActionPayload(outcome.match, session.user.id),
      settled: outcome.settled,
      waitingFor: outcome.waitingFor,
    });
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchDisputes = pathname.match(/^\/api\/matches\/([^/]+)\/disputes$/);
if (req.method === 'POST' && matchDisputes) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withMatchMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = openDisputeOnServer(getStateCollection('matches'), session.user, matchDisputes[1], body);
    await saveMatches(io, outcome.matches, outcome.match);

    const match = outcome.match;
    const otherPlayerId = match.players?.find(p => p.userId !== session.user.id)?.userId;
    if (otherPlayerId) {
      deliverNotification(io, otherPlayerId, {
        type: 'dispute_opened',
        title: 'Litige ouvert',
        body: `${session.user.pseudo} a ouvert un litige sur un match.`,
        url: `/mj/match/${match.id}`,
        requireInteraction: true
      }).catch(err => log.error('Notification delivery failed', err));
    }

    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchDisputeEvidence = pathname.match(/^\/api\/matches\/([^/]+)\/dispute\/evidence$/);
if (req.method === 'POST' && matchDisputeEvidence) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withMatchMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = addEvidenceToDisputeOnServer(
      getStateCollection('matches'),
      session.user,
      matchDisputeEvidence[1],
      body.evidence
    );
    await saveMatches(io, outcome.matches, outcome.match);
    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const matchDisputeEscalate = pathname.match(/^\/api\/matches\/([^/]+)\/dispute\/escalate$/);
if (req.method === 'POST' && matchDisputeEscalate) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withMatchMutex(async () => {
    const outcome = escalateDisputeOnServer(
      getStateCollection('matches'),
      session.user,
      matchDisputeEscalate[1]
    );
    await saveMatches(io, outcome.matches, outcome.match);

    // Notify admins of escalation
    const match = outcome.match;
    notifyAllAdmins(io, {
      type: 'dispute_update',
      title: 'Litige escaladé',
      body: `Match ${match.id} — Litige escaladé au niveau admin par ${session.user.pseudo}.`,
      url: `/admin`,
      requireInteraction: true,
    }).catch(err => log.error('Notification delivery failed', err));

    respondJson(res, 200, buildMatchActionPayload(outcome.match, session.user.id));
  });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

  return false;
};
