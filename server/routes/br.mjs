/**
 * server/routes/br.mjs - Domaine BATTLE ROYALE : configuration, liste des
 * salons, creation, actions de salon (join / leave / checkin / start /
 * eliminate / finish), detail, vue arbitre.
 *
 * Renvoie `true` des qu'il a ecrit la reponse, `false` sinon.
 *
 * Ordre des gardes : session (401 `AUTH_REQUIRED`) -> rate limit (`default`,
 * `admin` pour `finish`) -> `withBrLobbyMutex(lobbyId)` -> RE-LECTURE du
 * snapshot DANS le verrou -> moteur (liste restreinte au salon cible) ->
 * `saveBrLobbies` DANS LE MEME VERROU -> reponse. L'action `finish` ajoute
 * `require2faIfAdmin` : la session admin doit montrer une 2FA fraiche, le
 * joueur arbitre (volontariat A7) passe sans code.
 *
 * INVARIANT : le snapshot est RELU A L'INTERIEUR du verrou : dehors, la
 *   seconde requete travaillerait encore sur l'instantane de la premiere (les
 *   deux versaient la cagnotte deux fois sur `finish`).
 * INVARIANT : l'ECRITURE est DANS le verrou aussi (C1) : le verrou couvre le
 *   cycle COMPLET lire -> calculer -> ecrire, sinon l'ecriture ecrasait celle
 *   de l'action concurrente qui venait de finir.
 * INVARIANT : `saveBrLobbies` persiste PAR ENTITE (C2) : deux verrous
 *   par-salon pris en parallele ne s'ecrasent plus mutuellement, et une
 *   entite absente de l'instantane n'est jamais supprimee.
 * INVARIANT : le verrou est PAR SALON : deux salons distincts se reglent en
 *   parallele, c'est le fonctionnement normal.
 * INVARIANT : `join` et `leave` restent sur le quota `default` et non
 *   `wallet` : mutualiser le quota des retraits rendait le produit inutilisable
 *   (inscrire puis se desinscrire epuisait le quota avant de pouvoir retirer
 *   ses gains).
 * INVARIANT : `finish` exige la 2FA d'une session ADMIN EN PLUS de l'autorite
 *   de l'arbitre du salon (`require2faIfAdmin`, patron S1/S3) : l'arbitre
 *   joueur (volontariat A7) passe sans code, l'admin paie un TOTP frais.
 * INVARIANT : le reglement persiste sa progression apres chaque versement
 *   (`onProgress` -> `saveBrLobbies`) : un arret de processus laisse un salon
 *   reprenable, pas un double credit.
 * INVARIANT : seule la vue `/arbiter` rend les `userId` ; toutes les autres
 *   routes repassent par `toPublicBrLobby`.
 * PIEGE : le groupe de rate limit `match` utilise par `POST /api/br/lobbies`
 *   n'est PAS dans `RATE_LIMIT_CONFIG` : il retombe silencieusement sur
 *   `default`.
 * PIEGE : le createur du salon est l'ARBITRE : il ne paie aucun pass et ne
 *   figure pas dans le roster.
 * PIEGE : les reponses des actions renvoient la vue PUBLIQUE du salon : les
 *   `userId` n'y sont jamais.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  parseRequestBody,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import { require2faIfAdmin } from '../admin-totp.mjs';
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
  // `finish` est reserve a l'arbitre du salon (voie volontariat A7) et tire
  // de l'argent : group `admin`, le quota le plus genereux.
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
  //
  // C1 (audit-2) — L'ECRITURE EST TOUJOURS DANS LE MEME VERROU. `474dcfa` avait
  // deplace le calcul dans `withBrLobbyMutex` mais laisse `saveBrLobbies` apres
  // la fermeture du callback : deux inscriptions simultanees reappliquaient
  // chacune SON instantane — la seconde ecrivait par-dessus la premiere, et le
  // joueur deja inscrit disparaissait de la collection persistee. Son pass,
  // deja bloque dans `lockedEntries`, devenait irretrouvable. Le verrou couvre
  // donc le cycle COMPLET lire -> calculer -> ecrire.
  try {
    const outcome = await withBrLobbyMutex(lobbyId, async () => {
      // LA LISTE EST RESTREINTE AU SALON CIBLE : le clone du moteur et le
      // diff d'ecriture ne portent que la cible. Un salon voisin, verrouillable
      // en parallele sous son propre verrou, ne peut plus etre ecrase par une
      // copie perimee emportee dans l'instantane de la collection entiere.
      const cible = getStoredBrLobbies().find((l) => l.id === lobbyId);
      const cibleOuRien = cible ? [cible] : [];
      let result;

      if (action === 'join') {
        result = await joinBrLobbyOnServer(cibleOuRien, actor, lobbyId);
      } else if (action === 'leave') {
        result = await leaveBrLobbyOnServer(cibleOuRien, actor, lobbyId);
      } else if (action === 'checkin') {
        result = checkInBrLobbyOnServer(cibleOuRien, actor, lobbyId);
      } else if (action === 'start') {
        result = startBrLobbyOnServer(cibleOuRien, actor, lobbyId);
      } else if (action === 'eliminate') {
        const body = await parseRequestBody(req);
        if (!body.userId || typeof body.userId !== 'string') {
          respondJson(res, 400, { ok: false, error: 'userId du joueur elimine requis.', code: 'INVALID_JSON' }, req);
          return { aborted: true };
        }
        result = eliminateBrPlayerOnServer(cibleOuRien, actor, lobbyId, body.userId, {
          killerUserId: typeof body.killerUserId === 'string' ? body.killerUserId : null,
          assists: Number(body.assists) || 0,
        });
      } else {
        // `finish` distribue la cagnotte. L'autorite est l'ARBITRE du salon
        // (verifie dans le moteur), pas un role : dans ce modele l'arbitre est
        // le seul a avoir vu la partie. A7 (audit-2) : depuis le volontariat,
        // l'arbitre est un joueur — la 2FA ne porte que sur une session ADMIN
        // (require2faIfAdmin, patron S1/S3). Le joueur arbitre finit sans
        // code ; le garde moteur `requireLobbyArbiter` reste la vraie garde.
        if (!require2faIfAdmin(req, res)) return { aborted: true };

        // Le reglement persiste sa progression a chaque versement. Si le
        // processus meurt au milieu, le salon est deja marque `settling` et les
        // joueurs deja payes le sont dans l'etat : un nouvel essai les saute au
        // lieu de les payer une seconde fois.
        result = await settleBrLobbyOnServer(cibleOuRien, actor, lobbyId, {
          onProgress: (progress) => saveBrLobbies(io, progress),
        });
      }

      // L'ecriture EST le verrou : elle part AVANT de le relacher. Dehors, une
      // action concurrente sur le meme salon persistait la sienne par-dessus
      // (C1) ; l'ecriture par entite rend aussi les autres salons epargnes (C2).
      await saveBrLobbies(io, result.lobbies);

      if (action !== 'finish') return { outcome: result };

      // Notification aux gagants.
      for (const prize of result.payouts || []) {
        await deliverNotification(io, prize.userId, {
          title: `BR - ${prize.placement}e place`,
          body: `${formatZcForNotification(prize.amount)} gagnes sur ${result.lobby.name} (${prize.kills} kills).`,
          url: '/br',
          tag: `br-prize-${result.lobby.id}-${prize.userId}`,
          type: 'wallet_update',
          requireInteraction: false,
        }).catch(() => { /* l'argent est verse, la notification est secondaire */ });
      }
      return { outcome: result };
    });

    if (outcome.aborted) return true;
    const result = outcome.outcome;
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
