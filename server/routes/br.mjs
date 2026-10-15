import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  parseRequestBody,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import { requireAdmin2fa } from '../admin-totp.mjs';
import { withBrLobbyMutex } from '../mutex.mjs';
import {
  BR_MAPS,
  BR_MAP_IDS,
  BR_MODES,
  BR_MODE_IDS,
  BR_RANKING_MODES,
  BR_RANKING_MODE_IDS,
  BR_PRIZED_PLACES,
  BR_ARBITER_MAX_RATE,
  createBrLobbyOnServer,
  joinBrLobbyOnServer,
  leaveBrLobbyOnServer,
  checkInBrLobbyOnServer,
  startBrLobbyOnServer,
  eliminateBrPlayerOnServer,
  settleBrLobbyOnServer,
  computeBrPayouts,
  computeBrRanking,
} from '../br-engine.mjs';
import {
  getStoredBrLobbies,
  saveBrLobbies,
  toPublicBrLobby,
  toPublicBrRanking,
  saveMatches,
  buildMatchActionPayload,
} from '../state-helpers.mjs';
import { getStateCollection, getUserById } from '../persistence.mjs';
import { formatZcForNotification } from '../utils.mjs';
import { deliverNotification } from '../push-notifications.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('br-routes');

export const handleBrRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/br/config') {
  respondJson(res, 200, {
    ok: true,
    maps: BR_MAPS,
    mapIds: BR_MAP_IDS,
    modes: BR_MODES,
    modeIds: BR_MODE_IDS,
    rankingModes: BR_RANKING_MODES,
    rankingModeIds: BR_RANKING_MODE_IDS,
    prizedPlaces: BR_PRIZED_PLACES,
    arbiterMaxRate: BR_ARBITER_MAX_RATE,
  }, req);
  return true;
}

if (req.method === 'GET' && pathname === '/api/br/lobbies') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const lobbies = getStoredBrLobbies();
  // Les joueurs sont visibles (pseudo, presence) mais jamais les userId :
  // le BR affiche le roster, comme un lobby de jeu.
  const session = getAuthenticatedAppSession(req);
  const viewerId = session?.user?.id;
  const sanitized = lobbies.map((lobby) => toPublicBrLobby(lobby, {
    isArbiter: Boolean(viewerId && lobby.arbiterId === viewerId),
  }));
  respondJson(res, 200, { ok: true, lobbies: sanitized }, req);
  return true;
}

if (req.method === 'POST' && pathname === '/api/br/lobbies') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'match')) { return true; }
  try {
    const body = await parseRequestBody(req);
    const created = createBrLobbyOnServer(
      getStoredBrLobbies(),
      { user: getUserById(session.user.id) || session.user },
      body,
    );
    // Le createur est l'ARBITRE du salon, pas un joueur : il ne paie aucun
    // pass et ne figure pas dans le roster. Avant, on l'auto-inscrivait et on
    // bloquait son pass — il devait donc avoir les moyens de payer pour creer
    // un salon, et sa presence conditionnait le demarrage. La cagnotte ne
    // contient plus que des joueurs payants, et le classement n'a plus a
    // exclure l'arbitre de la liste (il n'y est plus).
    await saveBrLobbies(io, created.lobbies);
    log.info('BR lobby created', { lobbyId: created.lobby.id, by: session.user.id });
    respondJson(res, 201, {
      ok: true,
      // L'appelant est l'arbitre : il peut donc recevoir la vue complete.
      lobby: toPublicBrLobby(created.lobby, { isArbiter: true }),
    }, req);
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const brLobbyAction = pathname.match(/^\/api\/br\/lobbies\/([^/]+)\/(join|leave|checkin|start|eliminate|finish)$/);
if (brLobbyAction && req.method === 'POST') {
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  const lobbyId = brLobbyAction[1];
  const action = brLobbyAction[2];
  const actor = { user: getUserById(session.user.id) || session.user };
  // `join`/`leave` touchent l'argent MAIS restent sur le quota general :
  // les mettre dans `wallet` (20 requetes / 10 min, partage avec les
  // depots/retraits) rendait le produit inutilisable — un joueur qui
  // s'inscrit puis se desinscrit de 3 salons epuisait le quota avant meme
  // de pouvoir retirer ses gains.
  // `finish` est reserve a l'arbitre et tire de l'argent : quota admin.
  const rateGroup = action === 'finish' ? 'admin' : 'default';
  if (!rateLimitGuard(res, getClientIp(req), rateGroup)) { return true; }

  // Toute action de salon est serialisee PAR SALON.
  //
  // `getStoredBrLobbies()` renvoie le meme instantane a deux requetes
  // simultanees. Les deux calculaient leur reponse dessus, et seule la derniere
  // ecriture survivait : sur `join`, le joueur evince avait paye son pass et
  // n'existait plus en base (reservation ni remboursee ni consommee). Sur
  // `finish`, les deux appels passaient le garde `settling` — teste sur le
  // clone, jamais persiste — et versaient la cagnotte deux fois.
  //
  // Le snapshot est donc relu DANS le verrou : sans cela, le second appel
  // partirait encore de l instantane d avant le premier.
  try {
    const outcome = await withBrLobbyMutex(lobbyId, async () => {
      const lobbies = getStoredBrLobbies();
      let status = 200;

      if (action === 'join') {
        return { outcome: await joinBrLobbyOnServer(lobbies, actor, lobbyId) };
      }
      if (action === 'leave') {
        return { outcome: await leaveBrLobbyOnServer(lobbies, actor, lobbyId) };
      }
      if (action === 'checkin') {
        return { outcome: checkInBrLobbyOnServer(lobbies, actor, lobbyId) };
      }
      if (action === 'start') {
        return { outcome: startBrLobbyOnServer(lobbies, actor, lobbyId) };
      }
      if (action === 'eliminate') {
        const body = await parseRequestBody(req);
        if (!body.userId || typeof body.userId !== 'string') {
          respondJson(res, 400, { ok: false, error: 'userId du joueur elimine requis.', code: 'INVALID_JSON' }, req);
          return { aborted: true };
        }
        return {
          outcome: eliminateBrPlayerOnServer(lobbies, actor, lobbyId, body.userId, {
            killerUserId: typeof body.killerUserId === 'string' ? body.killerUserId : null,
            assists: Number(body.assists) || 0,
          }),
        };
      }

      // `finish` distribue la cagnotte. L'autorite est l'ARBITRE du salon
      // (verifie dans le moteur), pas la 2FA admin : dans ce modele l'arbitre
      // est le seul a avoir vu la partie. La 2FA reste demandee en plus, car
      // de l'argent part.
      const adminSession = requireAdmin2fa(req, res);
      if (!adminSession) return { aborted: true };

      // Le reglement persiste sa progression a chaque versement. Si le
      // processus meurt au milieu, le salon est deja marque `settling` et les
      // joueurs deja payes le sont dans l'etat : un nouvel essai les saute au
      // lieu de les payer une seconde fois.
      const outcome = await settleBrLobbyOnServer(lobbies, actor, lobbyId, {
        onProgress: (progress) => saveBrLobbies(io, progress),
      });

      // Notification aux gagants.
      for (const prize of outcome.payouts || []) {
        await deliverNotification(io, prize.userId, {
          title: `BR - ${prize.placement}e place`,
          body: `${formatZcForNotification(prize.amount)} gagnes sur ${outcome.lobby.name} (${prize.kills} kills).`,
          url: '/br',
          tag: `br-prize-${outcome.lobby.id}-${prize.userId}`,
          type: 'wallet_update',
          requireInteraction: false,
        }).catch(() => { /* l'argent est verse, la notification est secondary */ });
      }
      return { outcome, status };
    });

    if (outcome.aborted) return true;
    const result = outcome.outcome;
    await saveBrLobbies(io, result.lobbies);
    // Meme pour l'arbitre : il repasserait par `/arbiter` s'il a besoin des
    // userId, et les reponses d'action restent publiques (un inscrit peut
    // appeler join/leave/checkin).
    respondJson(res, outcome.status || 200, {
      ok: true,
      lobby: toPublicBrLobby(result.lobby),
      payouts: toPublicBrRanking(result.payouts),
      arbiter: result.arbiter
        ? { userId: undefined, rate: result.arbiter.rate, amount: result.arbiter.amount }
        : null,
      refunded: result.refunded || 0,
    }, req);
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

const brLobbyDetail = pathname.match(/^\/api\/br\/lobbies\/([^/]+)$/);
if (brLobbyDetail && req.method === 'GET') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const lobby = getStoredBrLobbies().find((l) => l.id === brLobbyDetail[1]);
  if (!lobby) {
    respondJson(res, 404, { ok: false, error: 'Salon introuvable.', code: 'LOBBY_NOT_FOUND' }, req);
    return true;
  }
  const viewer = getAuthenticatedAppSession(req);
  const viewerId = viewer?.user?.id;
  const isArbiter = Boolean(viewerId && lobby.arbiterId === viewerId);
  const { payouts, arbiter } = computeBrPayouts(lobby);
  respondJson(res, 200, {
    ok: true,
    lobby: toPublicBrLobby(lobby, { isArbiter }),
    ranking: toPublicBrRanking(computeBrRanking(lobby).slice(0, BR_PRIZED_PLACES)),
    projectedPayouts: {
      payouts: toPublicBrRanking(payouts),
      arbiter: arbiter ? { userId: undefined, rate: arbiter.rate, amount: arbiter.amount } : null,
    },
  }, req);
  return true;
}

/**
 * Vue ARBITRE : la seule qui rend les `userId`.
 *
 * L'arbitre doit designer qui est elimine et par qui, et `eliminate` exige
 * des `userId`. Les identifiers ne sont donc pas devines ni reconstruits
 * depuis le roster public (qui les masque) : cette route est verifiee cote
 * serveur, et refuse tout autre lecteur.
 */
const brLobbyArbiterView = pathname.match(/^\/api\/br\/lobbies\/([^/]+)\/arbiter$/);
if (brLobbyArbiterView && req.method === 'GET') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const session = getAuthenticatedAppSession(req);
  if (!session) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  const lobby = getStoredBrLobbies().find((l) => l.id === brLobbyArbiterView[1]);
  if (!lobby) {
    respondJson(res, 404, { ok: false, error: 'Salon introuvable.', code: 'LOBBY_NOT_FOUND' }, req);
    return true;
  }
  const actorUser = getUserById(session.user.id) || session.user;
  // Meme autorite que `eliminate`/`finish` : l'arbitre designe, ou son
  // createur. Un inscrit lambda est refuse — c'est ce qui l'empechait de
  // s'attribuer des kills et donc une part de cagnotte.
  if (!lobby.arbiterId || (lobby.arbiterId !== actorUser.id && lobby.creatorId !== actorUser.id)) {
    respondJson(res, 403, {
      ok: false,
      error: 'Vue reservee a l\'arbitre du salon.',
      code: 'ARBITER_REQUIRED',
    }, req);
    return true;
  }
  const ranking = computeBrRanking(lobby);
  const { payouts, arbiter } = computeBrPayouts(lobby);
  const present = lobby.players.filter((p) => p.checkedIn && !p.absent);
  respondJson(res, 200, {
    ok: true,
    lobby: { ...lobby, isArbiter: true },
    ranking: ranking.slice(0, BR_PRIZED_PLACES),
    // Resume de fin de partie : combien de morts restent a saisir.
    summary: {
      total: lobby.players.length,
      present: present.length,
      alive: lobby.players.filter((p) => p.alive && !p.absent).length,
      eliminated: lobby.players.filter((p) => !p.alive && !p.absent).length,
      absent: lobby.players.filter((p) => p.absent).length,
      pot: lobby.pot,
    },
    projectedPayouts: { payouts, arbiter },
  }, req);
  return true;
}

  return false;
};
