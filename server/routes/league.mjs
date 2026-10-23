/**
 * server/routes/league.mjs - Domaine LIGUE BR : liste et detail des saisons,
 * creation, inscription, retrait, lancement des qualifications et des
 * journees, resultats, finale, classement, reglages, reassignment,
 * remboursement d'un pass, paiements.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : session (401 `AUTH_REQUIRED`) -> rate limit ->
 * `withLeagueMutex` -> lecture du corps -> moteur -> `saveLeagues` ->
 * reponse. Les routes qui deplacent de l'argent ajoutent `requireAdmin2fa`
 * (remboursement d'un pass, lecture des paiements, chaines resultats/
 * avance-to-final/final-results de la ligue - audit-2 S2).
 *
 * INVARIANT : la liste ET le detail exigent une session : une saison expose
 *   le `userId` de chaque joueur inscrit (le modele `isMe` complet n'est pas
 *   encore en place, l'identifiant est donc retire a la main).
 * INVARIANT : la compensation du pass quand la persistence echoue est
 *   faite ICI, et pas seulement dans le moteur : le moteur a deja rendu la
 *   main quand `saveLeagues` echoue, et le balayeur ne parcourt que
 *   `registeredPlayers` - le joueur absent de la liste perdait ses ZC.
 * INVARIANT : le remboursement d'un pass et la lecture des paiements exigent
 *   la 2FA : ce sont des operations financieres.
 * INVARIANT : toute mutation est sous `withLeagueMutex`, et le
 *   remboursement d'un pass passe aussi par `withWalletMutex`.
 * PIEGE : `name` et `format` sont OPTIONNELS a la creation : le front
 *   appelle sans argument et le moteur genere un nom par defaut.
 * PIEGE : les resultats de la finale sont le moment ou l'argent part
 *   (`submitLeagueFinalResultsOnServer`) : c'est la seule route qui clot la
 *   saison.
 * PIEGE : le classement est un GET sans session : il n'expose que le
 *   classement, pas les identifiants.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  paginate,
  parseQueryParams,
  parseRequestBody,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import { withLeagueMutex, withWalletMutex } from '../mutex.mjs';
import { refundLockedEntry } from '../wallet-engine.mjs';
import {
  createLeagueSeasonOnServer,
  startLeagueQualificationOnServer,
  startLeagueDayOnServer,
  submitLeagueDayResultsOnServer,
  advanceToFinalOnServer,
  submitLeagueFinalResultsOnServer,
  getLeagueLeaderboard,
  updateLeagueSettingsOnServer,
  joinLeagueSeasonOnServer,
  leaveLeagueSeasonOnServer,
  reassignPlayerOnServer,
  refundLeaguePlayerOnServer,
  getLeaguePayments,
} from '../league-engine.mjs';
import { saveLeagues, getStoredLeagues, buildLeagueActionPayload } from '../state-helpers.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { requireAdmin2fa } from '../admin-totp.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('league-routes');

export const handleLeagueRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/leagues') {
  // Session obligatoire.
  //
  // La page `/br-league` est deja derriere `AppLayout`, qui redirige vers
  // la connexion : aucun visiteur anonyme ne peut la consulter. En revanche
  // la reponse renvoyait la saison EN CLAIR, avec le `userId` de chaque
  // joueur inscrit. L'anonymat ne servait donc a rien sinon a livrer a
  // tout internet la liste des-inscriptions d'une ligue (une carte sociale
  // de tes adversaires, pseudo -> identifiant de compte).
  // Le modele `isMe` complet est prevu plus tard ; exiger une session
  // ferme desormais l'exposition anonyme sans toucher au client.
  if (!getAuthenticatedAppSession(req)) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const { limit, offset } = parseQueryParams(req.url);
    const all = getStoredLeagues();
    const { items, hasMore } = paginate(all, { limit, offset });
    const seasons = items.map((s) => {
      const { members, ...safe } = s;
      if (Array.isArray(members)) {
        safe.members = members.map(({ playerId, ...rest }) => rest);
      }
      return safe;
    });
    respondJson(res, 200, { ok: true, seasons, total: all.length, hasMore }, req);
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des ligues.', code: 'LOAD_ERROR' });
  }
  return true;
}

const leagueGetOne = pathname.match(/^\/api\/leagues\/([^/]+)$/);
if (req.method === 'GET' && leagueGetOne) {
  // Meme garde que la liste : une saison isolee ne doit pas devenir un
  // raccourci pour sortir les userId quand la liste est fermee.
  if (!getAuthenticatedAppSession(req)) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const seasons = getStoredLeagues();
    const season = seasons.find((s) => s.id === leagueGetOne[1]);
    if (!season) {
      respondJson(res, 404, { ok: false, error: 'Ligue introuvable.', code: 'LEAGUE_NOT_FOUND' });
      return true;
    }
    respondJson(res, 200, { ok: true, season });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement de la ligue.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'POST' && pathname === '/api/leagues') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const body = await parseRequestBody(req);
    // `name` et `format` sont OPTIONNELS : la route les exigeait (>= 3
    // caractères) alors que le front appelle sans argument -> body {} ->
    // 400 a chaque clic, donc la BR League etait impossible a creer. Le
    // moteur genere un nom par defaut (`Cycle N`).
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 3)) {
      respondJson(res, 400, { ok: false, error: 'Nom de la ligue invalide (3-100 caractères).', code: 'INVALID_LEAGUE_NAME' });
      return true;
    }
    if (body.name !== undefined && body.name.length > 100) {
      respondJson(res, 400, { ok: false, error: 'Nom de la ligue trop long (max 100 caractères).', code: 'INVALID_LEAGUE_NAME' });
      return true;
    }
    if (body.format !== undefined && typeof body.format !== 'string') {
      respondJson(res, 400, { ok: false, error: 'Format invalide.', code: 'INVALID_FORMAT' });
      return true;
    }
    if (body.teamSize !== undefined && (typeof body.teamSize !== 'number' || body.teamSize < 1 || body.teamSize > 5)) {
      respondJson(res, 400, { ok: false, error: 'teamSize doit être entre 1 et 5.', code: 'INVALID_TEAM_SIZE' });
      return true;
    }
    const outcome = createLeagueSeasonOnServer(getStoredLeagues(), session.user, body);
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 201, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueJoin = pathname.match(/^\/api\/leagues\/([^/]+)\/join$/);
if (req.method === 'POST' && leagueJoin) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const seasonId = leagueJoin[1];
    const outcome = await joinLeagueSeasonOnServer(getStoredLeagues(), session.user, seasonId);

    // La compensation du pass vit ICI, pas seulement dans le moteur.
    //
    // Le vrai scenario de verrou orphelin n'est pas une exception interne au
    // moteur : c'est `saveLeagues` qui echoue juste APRÈS, une fois le pass
    // bloque et l inscrit pousse. Le moteur a deja rendu sa main, donc son
    // `catch` ne voyait rien : les ZC restaient bloques chez un joueur absent
    // de la liste persistee. Le sweeper ne parcourt que `registeredPlayers`,
    // et `lockEntryFee` renvoyant `ALREADY_LOCKED`, ce joueur ne pouvait plus
    // se reinscrire — ses ZC etaient perdus a jamais.
    try {
      await saveLeagues(io, outcome.seasons);
    } catch (saveError) {
      await withWalletMutex(session.user.id, async () => {
        await refundLockedEntry(session.user.id, seasonId, 'Inscription ligue non enregistree');
      }).catch((remboursementError) => {
        log.error('Restitution du pass après échec de sauvegarde impossible', {
          seasonId,
          userId: session.user.id,
          error: String(remboursementError?.message || remboursementError),
        });
      });
      throw saveError;
    }

    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueLeave = pathname.match(/^\/api\/leagues\/([^/]+)\/leave$/);
if (req.method === 'POST' && leagueLeave) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const outcome = await leaveLeagueSeasonOnServer(getStoredLeagues(), session.user, leagueLeave[1]);
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueStartQualification = pathname.match(/^\/api\/leagues\/([^/]+)\/start-qualification$/);
if (req.method === 'POST' && leagueStartQualification) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const outcome = startLeagueQualificationOnServer(getStoredLeagues(), session.user, leagueStartQualification[1]);
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueStartDay = pathname.match(/^\/api\/leagues\/([^/]+)\/days\/([^/]+)\/start$/);
if (req.method === 'POST' && leagueStartDay) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const outcome = startLeagueDayOnServer(getStoredLeagues(), session.user, leagueStartDay[1], leagueStartDay[2]);
    await saveLeagues(io, outcome.seasons);

    const season = outcome.season;
    const participantIds = (season.registeredPlayers || []).map(p => p.userId);
    for (const uid of participantIds) {
      deliverNotification(io, uid, {
        type: 'league_day_started',
        title: 'Journee BR Lancee',
        body: `La journee ${leagueStartDay[2]} de la ligue "${season.name}" est en cours !`,
        url: `/br-league/${season.id}`,
        requireInteraction: false
      }).catch(err => log.error('Notification delivery failed', err));
    }

    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueDayResults = pathname.match(/^\/api\/leagues\/([^/]+)\/days\/([^/]+)\/results$/);
if (req.method === 'POST' && leagueDayResults) {
  // Ecrire le classement de qualification est la premiere marche de la
  // chaine qui finit par debtor les portefeuilles : la chaine exige le role
  // admin (dans le moteur), elle exige donc aussi la 2FA (audit-2 S2).
  const session = requireAdmin2fa(req, res);
  if (!session) { return true; }
  try { await withLeagueMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = submitLeagueDayResultsOnServer(
      getStoredLeagues(),
      session.user,
      leagueDayResults[1],
      leagueDayResults[2],
      body.results
    );
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueAdvanceToFinal = pathname.match(/^\/api\/leagues\/([^/]+)\/advance-to-final$/);
if (req.method === 'POST' && leagueAdvanceToFinal) {
  // Designe les finalistes : deuxieme marche de la chaine admin qui verse
  // la cagnotte (audit-2 S2). Le role admin est verifie dans le moteur, la
  // 2FA l'est ici, sur le meme modele que refund/payments.
  const session = requireAdmin2fa(req, res);
  if (!session) { return true; }
  try { await withLeagueMutex(async () => {
    const outcome = advanceToFinalOnServer(getStoredLeagues(), session.user, leagueAdvanceToFinal[1]);
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueFinalResults = pathname.match(/^\/api\/leagues\/([^/]+)\/final-results$/);
if (req.method === 'POST' && leagueFinalResults) {
  // Cette route VERSE LA CAGNOTTE (60 / 25 / 15 % + pertes) : role admin
  // verifie dans le moteur, 2FA verifiee ici. Un remboursement ponctuel
  // (refund/:userId) exigeait la 2FA : un versement complet ne peut pas
  // couter moins (audit-2 S2).
  const session = requireAdmin2fa(req, res);
  if (!session) { return true; }
  try { await withLeagueMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = submitLeagueFinalResultsOnServer(
      getStoredLeagues(),
      session.user,
      leagueFinalResults[1],
      body.results
    );
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueLeaderboard = pathname.match(/^\/api\/leagues\/([^/]+)\/leaderboard$/);
if (req.method === 'GET' && leagueLeaderboard) {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const standings = getLeagueLeaderboard(getStoredLeagues(), leagueLeaderboard[1]);
    respondJson(res, 200, { ok: true, standings });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueUpdateSettings = pathname.match(/^\/api\/leagues\/([^/]+)$/);
if (req.method === 'PATCH' && leagueUpdateSettings) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = updateLeagueSettingsOnServer(getStoredLeagues(), session.user, leagueUpdateSettings[1], body);
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueReassign = pathname.match(/^\/api\/leagues\/([^/]+)\/reassign$/);
if (req.method === 'POST' && leagueReassign) {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' });
    return true;
  }
  try { await withLeagueMutex(async () => {
    const body = await parseRequestBody(req);
    const outcome = reassignPlayerOnServer(
      getStoredLeagues(),
      session.user,
      leagueReassign[1],
      body.userId,
      body.fromDay,
      body.toDay
    );
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leagueRefund = pathname.match(/^\/api\/leagues\/([^/]+)\/refund\/([^/]+)$/);
if (req.method === 'POST' && leagueRefund) {
  // Cette route DEPLACE DE L'ARGENT (remboursement d'un pass de ligue).
  // Elle n'exigeait que le rôle admin, alors que la lecture de la liste des
  // paiements exigeait la 2FA : un compte admin compromis suffisait a
  // vider les portefeuilles. Aligne sur les autres operations financieres.
  const session = requireAdmin2fa(req, res);
  if (!session) { return true; }
  try { await withLeagueMutex(async () => {
    const outcome = await refundLeaguePlayerOnServer(
      getStoredLeagues(),
      session.user,
      leagueRefund[1],
      leagueRefund[2]
    );
    await saveLeagues(io, outcome.seasons);
    respondJson(res, 200, buildLeagueActionPayload(outcome.season, session.user.id));
  }); } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const leaguePayments = pathname.match(/^\/api\/leagues\/([^/]+)\/payments$/);
if (req.method === 'GET' && leaguePayments) {
  if (!rateLimitGuard(res, getClientIp(req), 'admin')) { return true; }
  const session = requireAdmin2fa(req, res);
  if (!session) { return true; }
  try {
    const payments = getLeaguePayments(getStoredLeagues(), leaguePayments[1]);
    respondJson(res, 200, { ok: true, payments });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

  return false;
};
