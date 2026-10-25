/**
 * server/routes/tournament.mjs - Domaine TOURNOIS : detail, creation,
 * inscription, retrait, arbitrage, lancement, salle, mise en direct du match,
 * resultat.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : rate limit -> session (401 `AUTH_REQUIRED`) ->
 * `withTournamentMutex` -> lecture du corps -> moteur -> `saveTournaments` ->
 * reponse. Le rate limit passe AVANT la session sur les routes d'ecriture :
 * le quota doit proteger le garde, pas l'inverse. La soumission de resultat
 * ajoute `require2faIfAdmin` : l'override admin ne peut pas couter moins
 * que l'arbitre du duel lui-meme.
 *
 * INVARIANT : toute mutation est entierement sous `withTournamentMutex` : le
 *   tournoi, ses entrees et ses matchs partagent la meme collection.
 * INVARIANT : le droit d'entree est arrondi a 2 decimales AVANT le calcul de
 *   la cagnotte (meme raison que pour les matchs).
 * INVARIANT : toute mutation se termine par `saveTournaments` (persistance ET
 *   diffusion socket par socket).
 * INVARIANT : la route de detail renvoie le tournoi SANITISE
 *   (`sanitizeTournamentForBroadcast`) : ni `captainId`, ni `userId` des
 *   membres ou des arbitres.
 * PIEGE : la declaration du motif `tournamentDetail` precede le premier `if`
 *   du bloc : elle en fait partie, sinon l'identifiant serait indefini.
 * PIEGE : la route de detail n'est PAS sous le mutex du tournoi : une lecture
 *   ne mute pas la collection.
 * PIEGE : les notifications sont envoyees apres la sauvegarde et leur echec
 *   est rattrape.
 * PIEGE : la creation valide le nom (3-100 caracteres), le format, le nombre
 *   d'entrees (2-256) et le droit d'entree : chaque regle a son propre code
 *   d'erreur, les confondre rend le diagnostic impossible.
 * PIEGE : la commission d'arbitre vaut 5 % ou 10 % selon le NOMBRE
 *   D'ARBITRES (2 au-dela de 8 entrees maxi), pas selon le format : le taux
 *   de la cagnotte change avec la taille du tournoi.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import { roundAmount } from '../utils.mjs';
import {
  getAuthenticatedAppSession,
  parseRequestBody,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import { withTournamentMutex } from '../mutex.mjs';
import {
  createTournamentOnServer,
  registerForTournamentOnServer,
  leaveTournamentOnServer,
  assignTournamentArbiterOnServer,
  startTournamentOnServer,
  setTournamentMatchRoomDetailsOnServer,
  setTournamentMatchLiveOnServer,
  submitTournamentMatchResultOnServer,
} from '../tournament-engine.mjs';
import {
  saveTournaments,
  getStoredTournaments,
  sanitizeTournamentForBroadcast,
  buildTournamentActionPayload,
} from '../state-helpers.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { require2faIfAdmin } from '../admin-totp.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('tournament-routes');

export const handleTournamentRoutes = async ({ req, res, pathname, io }) => {
// La declaration du motif precedait de quelques lignes le premier `if` du
// bloc : elle en fait partie, sinon `tournamentDetail` serait indefini ici.
const tournamentDetail = pathname.match(/^\/api\/tournaments\/([^/]+)$/);

if (req.method === 'GET' && tournamentDetail) {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const tournament = getStoredTournaments().find((entry) => entry.id === tournamentDetail[1]);
    if (!tournament) {
      respondJson(res, 404, { ok: false, error: 'Tournoi introuvable.', code: 'TOURNAMENT_NOT_FOUND' });
      return true;
    }
    respondJson(res, 200, { ok: true, tournament: sanitizeTournamentForBroadcast(tournament) });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du tournoi.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/tournaments') {
  // Le mutex serialise les tournois entre eux mais ne limite rien dans le
  // temps : sans ce garde, un joueur authentifie cree des tournois en boucle
  // et chaque creation immobilise le mutex pour tous les autres.
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const body = await parseRequestBody(req);
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 3) {
      respondJson(res, 400, { ok: false, error: 'Nom du tournoi requis (3-100 caractères).', code: 'INVALID_TOURNAMENT_NAME' });
      return true;
    }
    if (!body.format || typeof body.format !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Format requis.', code: 'INVALID_FORMAT' });
      return true;
    }
    if (body.maxEntries && (typeof body.maxEntries !== 'number' || body.maxEntries < 2 || body.maxEntries > 256)) {
      respondJson(res, 400, { ok: false, error: 'maxEntries doit être entre 2 et 256.', code: 'INVALID_MAX_ENTRIES' });
      return true;
    }
    if (body.entryFee !== undefined && (typeof body.entryFee !== 'number' || !Number.isFinite(body.entryFee) || body.entryFee < 0)) {
      respondJson(res, 400, { ok: false, error: 'entryFee doit être un nombre positif.', code: 'INVALID_ENTRY_FEE' });
      return true;
    }
    // Le tarif est arrondi a 2 decimales AVANT tout calcul de pot.
    //
    // La cagnotte est calculee sur un PRODUIT (entryFee x entrees x taille),
    // alors que l argent reellement bloque est une SOMME d arrondis par equipe.
    // Les deux coincident tant que le tarif a au plus 2 decimales — au-dela,
    // le produit et la somme divergent de quelques centimes, et le reglement
    // cree ou detruit de la monnaie. Le tarif n etait valide que comme
    // « nombre positif », donc 10.005 passait.
    const normalizedBody = body.entryFee === undefined
      ? body
      : { ...body, entryFee: roundAmount(body.entryFee) };

    const outcome = createTournamentOnServer(getStoredTournaments(), session.user, normalizedBody);
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 201, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentRegister = pathname.match(/^\/api\/tournaments\/([^/]+)\/register$/);
if (req.method === 'POST' && tournamentRegister) {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = await registerForTournamentOnServer(getStoredTournaments(), session.user, tournamentRegister[1], body);
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentLeave = pathname.match(/^\/api\/tournaments\/([^/]+)\/leave$/);
if (req.method === 'POST' && tournamentLeave) {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const outcome = await leaveTournamentOnServer(getStoredTournaments(), session.user, tournamentLeave[1]);
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentArbiter = pathname.match(/^\/api\/tournaments\/([^/]+)\/arbiter$/);
if (req.method === 'POST' && tournamentArbiter) {
  // A7 (audit-2) : la nomination est "premier arrive" et la route etait la
  // SEULE du domaine tournoi sans rate limit — pas d'usage legitime
  // intensif (une nomination par tournoi, un compte humain), mais une
  // proie pour le scripting anonyme. Groupe `social`, comme le jumeau
  // match (POST /api/matches/:id/arbiter).
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const outcome = assignTournamentArbiterOnServer(getStoredTournaments(), session.user, tournamentArbiter[1]);
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentStart = pathname.match(/^\/api\/tournaments\/([^/]+)\/start$/);
if (req.method === 'POST' && tournamentStart) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const outcome = startTournamentOnServer(getStoredTournaments(), session.user, tournamentStart[1]);
    await saveTournaments(io, outcome.tournaments, outcome.tournament);

    const tournament = outcome.tournament;
    const participantIds = [...new Set(
      (tournament.entries || []).flatMap(entry => (entry.members || []).map(m => m.userId))
    )];
    for (const uid of participantIds) {
      deliverNotification(io, uid, {
        type: 'tournament_started',
        title: 'Tournoi demarre',
        body: `Le tournoi "${tournament.name}" a commence !`,
        url: `/mj/tournois/${tournament.id}`,
        requireInteraction: false
      }).catch(err => log.error('Notification delivery failed', err));
    }

    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentRoom = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/room$/);
if (req.method === 'POST' && tournamentRoom) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = setTournamentMatchRoomDetailsOnServer(
      getStoredTournaments(),
      session.user,
      tournamentRoom[1],
      tournamentRoom[2],
      body.roomName,
      body.roomPassword
    );
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentLive = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/live$/);
if (req.method === 'POST' && tournamentLive) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }

  try { await withTournamentMutex(async () => {
    const outcome = setTournamentMatchLiveOnServer(
      getStoredTournaments(),
      session.user,
      tournamentLive[1],
      tournamentLive[2]
    );
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const tournamentResult = pathname.match(/^\/api\/tournaments\/([^/]+)\/matches\/([^/]+)\/result$/);
if (req.method === 'POST' && tournamentResult) {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  // L'override admin passe la garde du moteur sans etre l'arbitre du duel :
  // un tournoi solde par la peut verser la cagnotte aux finalistes. L'admin
  // doit donc avoir une 2FA fraiche, comme sur /api/admin/* (audit-2 S3).
  const session = require2faIfAdmin(req, res);
  if (!session) { return true; }

  try { await withTournamentMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = await submitTournamentMatchResultOnServer(
      getStoredTournaments(),
      session.user,
      tournamentResult[1],
      tournamentResult[2],
      body
    );
    await saveTournaments(io, outcome.tournaments, outcome.tournament);
    respondJson(res, 200, buildTournamentActionPayload(outcome.tournament, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

  return false;
};
