/**
 * server/state-helpers.mjs - Persistance et diffusion des collections d'etat
 * (matchs, tournois, ligues, salons BR) et sanitisation pour la diffusion.
 *
 * Point de jonction entre les moteurs (qui calculent) et la couche de
 * persistance (qui stocke) + le socket (qui diffuse).
 *
 * INVARIANT : la sanitisation sert DEUX sorties - la reponse HTTP ET la
 *   diffusion socket. Un champ retire ici ne doit pas etre re-expose par un
 *   autre chemin.
 * INVARIANT : les identifiants internes (userId des joueurs, de l'arbitre,
 *   `captainId`) ne sont JAMAIS diffuses : ils sont remplaces par le
 *   booleen `isMe`.
 * INVARIANT : `isMe` est calcule PAR DESTINATAIRE : matchs et tournois sont
 *   emis socket par socket, jamais par un `io.emit` global.
 * INVARIANT : `roomPassword`, `roomName`, `screenshots` et
 *   `result.confirmedByTeams` sont retires de la diffusion ; le second est
 *   remplace par le booleen `hasConfirmed`.
 * INVARIANT : les gains projetes sont calcules par le serveur
 *   (`getProjectedPayouts`) : le client ne recalcule jamais le pot.
 * INVARIANT : la collection est remplacee EN BLOC (`replaceStateCollection`) :
 *   une liste partielle supprimerait en base les entites absentes.
 *   EXCEPTION : `brLobbies` est ecrit PAR ENTITE (`upsertStateEntity` dans
 *   `saveBrLobbies`) : le remplacement en bloc ecrasait les actions
 *   concurrentes d'autres salons, et supprimait un salon cree depuis
 *   l'instantane — passes bloques sans issue (C1/C2).
 * PIEGE : `Array.map` passe (element, index, tableau) : ecrire
 *   `map(sanitizeMatchForBroadcast)` passerait l'INDEX comme `viewerId` et
 *   `isMe` serait toujours faux, sans lever la moindre erreur.
 * PIEGE : le pseudo affiche suit le compte tant que le match est dans les
 *   statuts `LIVE_IDENTITY_STATUSES` ; apres la soumission du resultat il est
 *   FIGE (le joueur ne peut pas renommer apres une defaite).
 * PIEGE : le roster public BR ne doit contenir ni `userId`, ni `killedBy`,
 *   ni `arbiterId`, ni `creatorId`, ni `teams[].key` : l'UI n'a besoin que du
 *   booleen `isArbiter`.
 * PIEGE : `saveBrLobbies` diffuse la vue SANITISEE : diffuser l'etat brut
 *   rendrait la sanitisation HTTP sans effet.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import { syncMatchChatChannels, buildMatchChatChannel, broadcastChatChannel } from './chat-helpers.mjs';
import { broadcastStateSnapshot } from './push-notifications.mjs';
import { replaceStateCollection, upsertStateEntity, getStateCollection, getStateEntity, getUserById } from './persistence.mjs';
import { normalizeTournamentCollection } from './tournament-engine.mjs';
import { getPublicMatchesForUser, getProjectedPayouts } from './match-engine.mjs';
import { normalizeLeagueCollection } from './league-engine.mjs';
import { normalizeBrLobbyCollection, normalizeBrLobby } from './br-engine.mjs';
import { getServerWallet } from './wallet-engine.mjs';

/**
 * Persist matches to state storage, sync chat channels, sanitize for broadcast, and push snapshot.
 * Now broadcasts only the changed match delta instead of full collection.
 * @param {object} io - Socket.IO server instance
 * @param {Array} matches - The matches to persist
 * @param {object|null} [changedMatch=null] - Optional match that changed, used for delta broadcast
 * @returns {Promise<Array>} The stored matches
 */
const saveMatches = async (io, matches, changedMatch = null) => {
  syncMatchChatChannels(matches);
  await replaceStateCollection('matches', matches);
  // Broadcast only the changed match delta instead of full collection
  if (changedMatch) {
    broadcastMatchesToSessions(io, [changedMatch]);
    broadcastChatChannel(io, buildMatchChatChannel(changedMatch));
  } else {
    broadcastMatchesToSessions(io, getStateCollection('matches'));
  }
  return getStateCollection('matches');
};

/**
 * Retrieve stored tournaments from state, normalized for consumption.
 * @returns {Array} Normalized tournament collection
 */
const getStoredTournaments = () => normalizeTournamentCollection(getStateCollection('tournaments'));

/**
 * Persist tournaments to state storage and push snapshot to clients.
 * @param {object} io - Socket.IO server instance
 * @param {Array} tournaments - The tournaments to persist
 * @returns {Promise<Array>} The stored tournaments
 */
const saveTournaments = async (io, tournaments, changedTournament = null) => {
  await replaceStateCollection('tournaments', tournaments);
  const targets = changedTournament ? [changedTournament] : getStateCollection('tournaments');
  // Par socket, comme pour les matchs : `isMe` est different par destinataire.
  for (const socket of io.sockets.sockets.values()) {
    const viewerId = socket.data?.session?.userId || null;
    socket.emit('state:tournaments', {
      items: targets.map((t) => sanitizeTournamentForBroadcast(t, viewerId)),
    });
  }
  return getStoredTournaments();
};

/**
 * Build a match action response payload containing the sanitized match, user, and wallet info.
 * @param {object} match - The match object
 * @param {string} userId - The user performing the action
 * @returns {{ ok: boolean, match: object, user: object|null, wallet: object }} Action payload
 */
const buildMatchActionPayload = (match, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    match: sanitizeMatchForBroadcast(match, userId),
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

/**
 * Diffuser les matchs en calculant `isMe` POUR CHAQUE socket.
 *
 * Un `io.emit` global ne peut pas porter un `isMe` different par destinataire.
 * On emet donc par socket : le nombre de sockets connectes est de l'ordre de
 * la grandeur du jeu, et un match ne change que quelques fois par minute.
 */
const broadcastMatchesToSessions = (io, matches) => {
  for (const socket of io.sockets.sockets.values()) {
    const viewerId = socket.data?.session?.userId || null;
    const viewer = viewerId ? getUserById(viewerId) : null;
    // Filtre par peripherie ET visibilite : un `io.emit` global poussait
    // aussi les matchs prives et ceux d'un autre appareil a tous les clients.
    const visible = getPublicMatchesForUser(matches, viewer);
    socket.emit('state:matches', {
      items: visible.map((match) => sanitizeMatchForBroadcast(match, viewerId)),
    });
  }
};

/**
 * Statuts pendant lesquels le pseudo affiche suit le compte en direct.
 *
 * La frontiere est posee sur la soumission du resultat : tant que le match
 * n'est pas fini, l'arbitre doit savoir qui a gagne sous le nom que le
 * joueur porte MAINTENANT. A partir de `awaiting_confirmation`, le resultat
 * est gele et l'appel sera tranche sur l'identite du moment du match : on ne
 * reecrit donc plus l'historique (un joueur ne peut pas renommer apres une
 * defaite pour la faire disparaitre, ni apres une victoire pour la revendiquer).
 */
const LIVE_IDENTITY_STATUSES = new Set([
  'recruiting', 'full', 'check_in', 'ready', 'in_progress',
]);

/**
 * Remove sensitive fields from a match before broadcasting.
 *
 * `userId` est retire (les UUID internes ne doivent pas fuiter), mais un
 * drapeau `isMe` est AJOUTE par joueur : sans lui le client ne peut pas
 * identifier son propre slot, donc `currentPlayer` restait `undefined` et les
 * boutons "Confirmer ma presence" / "Je suis pret" ne s'affichaient jamais.
 * `hasConfirmed` remplace l'acces a `result.confirmedByTeams`.
 *
 * Pour un match encore en cours, `pseudo` est relu sur le compte : le joueur
 * peut changer de pseudo (comme en jeu), et l'arbitre doit voir le nom
 * actuel. `gameId` l'accompagne comme repere STABLE — le pseudo est libre et
 * modifiable, le gameId ne l'est pas, et il est deja public (il figure dans
 * les payloads de profil public).
 *
 * @param {object} match - Match to sanitize
 * @param {string|null} viewerId - userId du destinataire (null = anonyme)
 * @returns {object} A shallow copy with sensitive fields stripped
 */
const sanitizeMatchForBroadcast = (match, viewerId = null) => {  const { roomPassword, roomName, screenshots, ...safe } = match;
  if (safe.arbiter) {
    const { roomPassword: _ap, roomName: _an, userId: arbiterUserId, ...safeArbiter } = safe.arbiter;
    safe.arbiter = { ...safeArbiter, isMe: Boolean(viewerId && arbiterUserId === viewerId) };
  }
  if (Array.isArray(safe.players)) {
    const confirmed = Array.isArray(safe.result?.confirmedByTeams) ? safe.result.confirmedByTeams : [];
    const liveIdentity = LIVE_IDENTITY_STATUSES.has(safe.status);
    safe.players = safe.players.map(({ userId, ...rest }) => {
      const account = liveIdentity ? getUserById(userId) : null;
      return {
        ...rest,
        // Le snapshot sert de repli : un joueur supprime entre-temps ne doit
        // pas faire disparaitre son nom de la liste.
        ...(account?.pseudo ? { pseudo: account.pseudo } : {}),
        gameId: account?.gameId || rest.gameId || null,
        isMe: Boolean(viewerId && userId === viewerId),
        hasConfirmed: confirmed.includes(userId),
      };
    });
  }
  // Partition calculee par le serveur (meme base que applyResultSettlement :
  // cagnotte reellement verrouillee). Evite au front de recalculer un
  // pourcentage arbitre et d'afficher un montant different du verse.
  safe.projectedPayouts = getProjectedPayouts(match);
  if (safe.submittedBy === 'system-no-show' || safe.submittedBy === 'admin-dashboard') {
    safe.submittedBy = null;
  }
  if (safe.result) {
    // `confirmedByTeams` est un tableau de userIds. Il sert uniquement au
    // calcul de `hasConfirmed` ci-dessus ; laissé dans le payload, il
    // livrait à chaque socket l'identifiant interne de tous les joueurs
    // ayant confirmé — exactement ce que le roster masque par ailleurs.
    const { screenshots: _rs, proofs: _rp, confirmedByTeams: _cb, ...safeResult } = safe.result;
    safe.result = safeResult;
  }
  return safe;
};

/**
 * Rediffuse les matchs EN COURS où figure ce joueur.
 *
 * Appelée après un changement de pseudo : sans ça, l'arbitre connecté verrait
 * l'ancien nom jusqu'au prochain mouvement de match (check-in, prêt, résultat),
 * alors que le joueur vient justement de se renommer. Même sémantique de delta
 * que `saveMatches` : le client fusionne, il ne remplace pas sa liste.
 *
 * @param {object} io - Socket.IO server instance
 * @param {string} userId - compte dont le pseudo a changé
 * @returns {number} nombre de matchs rediffusés
 */
const refreshLiveMatchIdentities = (io, userId) => {
  const affected = getStateCollection('matches').filter((match) => (
    LIVE_IDENTITY_STATUSES.has(match?.status)
    && Array.isArray(match?.players)
    && match.players.some((player) => player?.userId === userId)
  ));
  if (affected.length === 0) return 0;
  broadcastMatchesToSessions(io, affected);
  return affected.length;
};

/**
 * Sanitize a tournament: strip roomPassword from all embedded matches.
 * Also strip admin internal IDs from public view, including entry members and captains.
 * @param {object} tournament - The tournament to sanitize
 * @returns {object} A sanitized copy safe for public broadcast
 */
const sanitizeTournamentForBroadcast = (tournament, viewerId = null) => {
  const safe = { ...tournament };
  if (Array.isArray(safe.matches)) {
    safe.matches = safe.matches.map((match) => sanitizeMatchForBroadcast(match, viewerId));
  }
  if (Array.isArray(safe.arbiters)) {
    safe.arbiters = safe.arbiters.map(({ userId, ...rest }) => ({
      ...rest,
      isMe: Boolean(viewerId && userId === viewerId),
    }));
  }
  if (Array.isArray(safe.entries)) {
    safe.entries = safe.entries.map((entry) => {
      const sanitized = { ...entry };
      delete sanitized.captainId;
      if (Array.isArray(sanitized.members)) {
        // Comme pour les joueurs de match : `userId` retire, `isMe` ajoute,
        // sinon le client ne peut pas reconnaitre son propre slot d'equipe.
        sanitized.members = sanitized.members.map(({ userId, ...rest }) => ({
          ...rest,
          isMe: Boolean(viewerId && userId === viewerId),
        }));
      }
      return sanitized;
    });
  }
  return safe;
};

/**
 * Build a tournament action response payload containing the sanitized tournament, user, and wallet info.
 * The tournament is sanitized for broadcast (captainId/member userIds/room passwords stripped),
 * while `user`/`wallet` intentionally describe the caller's own record.
 * Caller-scoped helpers (`myEntryId`, `myArbiterSlot`, `openArbiterSlots`) let the client
 * restore the caller's own position without exposing other users' internal IDs.
 * @param {object} tournament - The tournament object (raw, pre-sanitization)
 * @param {string} userId - The user performing the action
 * @returns {{ ok: boolean, tournament: object, user: object|null, wallet: object, myEntryId: string|null, myArbiterSlot: number|null, openArbiterSlots: number }} Action payload
 */
const buildTournamentActionPayload = (tournament, userId) => {
  const user = getUserById(userId);
  const entries = Array.isArray(tournament?.entries) ? tournament.entries : [];
  const myEntry = entries.find(
    (entry) =>
      entry?.captainId === userId ||
      (Array.isArray(entry?.members) && entry.members.some((member) => member?.userId === userId))
  ) || null;
  const arbiters = Array.isArray(tournament?.arbiters) ? tournament.arbiters : [];
  const myArbiter = arbiters.find((arbiter) => arbiter?.userId === userId) || null;
  return {
    ok: true,
    tournament: sanitizeTournamentForBroadcast(tournament, userId),
    user,
    wallet: user?.wallet || getServerWallet(userId),
    myEntryId: myEntry?.id || null,
    myArbiterSlot: myArbiter?.slot || null,
    openArbiterSlots: arbiters.filter((arbiter) => !arbiter?.userId).length,
  };
};

/**
 * Retrieve stored leagues from state, normalized for consumption.
 * @returns {Array} Normalized league collection
 */
const getStoredLeagues = () => normalizeLeagueCollection(getStateCollection('leagues'));

/**
 * ─── Battle Royale : confidentialite ────────────────────────────────────
 *
 * Le roster public ne doit JAMAIS contenir d'identifiant joueur. `userId`
 * (et `killedBy`, qui en est un) sont retires, ainsi que `arbiterId` et
 * `creatorId` : sinon un joueur pouvait relier un pseudo a un compte.
 * `teams[].key` est retire aussi : il vaut `solo-<userId>`.
 *
 * L'UI n'a pas besoin de ces ids : elle recoit un booleen `isArbiter`, sur
 * le meme modele que `match.arbiter.isMe` du multijoueur.
 *
 * Seul `GET /api/br/lobbies/:id/arbiter` rend les `userId`, et uniquement a
 * l'arbitre designe : il doit choisir qui eliminer, et `eliminate` en exige un.
 *
 * Ces fonctions servent DEUX sorties : la reponse HTTP ET la diffusion
 * socket. C'etait le defaut avant : `saveBrLobbies` diffusait l'etat brut via
 * `io.emit`, donc la sanitisation HTTP ne protegeait rien.
 */
const toPublicBrPlayer = ({ userId, killedBy, ...rest }) => rest;

const toPublicBrLobby = (lobby, { isArbiter = false } = {}) => ({
  ...lobby,
  players: (lobby.players || []).map(toPublicBrPlayer),
  teams: (lobby.teams || []).map(({ members, key, ...rest }) => rest),
  arbiterId: undefined,
  creatorId: undefined,
  isArbiter,
});

const toPublicBrRanking = (rows) => (rows || []).map(toPublicBrPlayer);

/**
 * Retrieve stored BR lobbies, normalized.
 * @returns {Array} Normalized BR lobby collection
 */
const getStoredBrLobbies = () => normalizeBrLobbyCollection(getStateCollection('brLobbies'));

/**
 * Persist BR lobbies to state storage and push snapshot to clients.
 *
 * ECriture PAR ENTITE, pas en bloc. L'ancien chemin passait par
 * `replaceStateCollection` : la collection ENTIERE etait reecrite depuis un
 * instantane obtenu avant l'action concurrente — une presence cochee au
 * check-in, un salon cree entre-temps, disparaissaient de la liste ecrite, et
 * `replaceStateCollection` SUPPRIME les entites absentes de la liste : le salon
 * disparaissait, et les passes bloques n'avaient plus aucun chemin de sortie.
 * Voir C1/C2 dans docs/audit-2/03-concurrence.md.
 *
 * La comparaison se fait sur l'etat NORMALISE des deux cotes : le stockage brut
 * peut suivre une ancienne forme (champs absents), ce n'est pas une difference
 * utile et ne doit pas declencher d'ecriture.
 *
 * Aucun verrou ici : `saveBrLobbies` s'attend a etre appele DANS le verrou du
 * salon modifie (route d'action, cron). L'ecriture ne touche que les entites
 * presentes dans la liste, donc deux verrous par-salon distincts ne se
 * marchent pas sur les pieds.
 *
 * @param {object} io - Socket.IO server instance (sans diffusion si null)
 * @param {Array} lobbies - Lobbies a persister (delta : seuls les modifies sont ecrits)
 * @returns {Promise<Array>} The stored lobbies
 */
const saveBrLobbies = async (io, lobbies) => {
  const entrees = Array.isArray(lobbies) ? lobbies : [];
  for (const lobby of entrees) {
    if (!lobby || !lobby.id) continue;
    const courant = getStateEntity('brLobbies', lobby.id);
    if (courant && JSON.stringify(normalizeBrLobby(courant)) === JSON.stringify(normalizeBrLobby(lobby))) continue;
    await upsertStateEntity('brLobbies', lobby);
  }
  const stored = getStoredBrLobbies();
  if (io) broadcastStateSnapshot(io, 'brLobbies', stored.map((lobby) => toPublicBrLobby(lobby)));
  return stored;
};

/**
 * Persist leagues (seasons) to state storage and push snapshot to clients.
 * @param {object} io - Socket.IO server instance
 * @param {Array} seasons - The league seasons to persist
 * @returns {Promise<Array>} The stored leagues
 */
const saveLeagues = async (io, seasons) => {
  await replaceStateCollection('leagues', seasons);
  const storedLeagues = getStoredLeagues();
  broadcastStateSnapshot(io, 'leagues', storedLeagues);
  return storedLeagues;
};

/**
 * Build a league action response payload containing the season, user, and wallet info.
 * @param {object} season - The league season object
 * @param {string} userId - The user performing the action
 * @returns {{ ok: boolean, season: object, user: object|null, wallet: object }} Action payload
 */
const buildLeagueActionPayload = (season, userId) => {
  const user = getUserById(userId);
  return {
    ok: true,
    season,
    user,
    wallet: user?.wallet || getServerWallet(userId),
  };
};

export {
  saveMatches,
  broadcastMatchesToSessions,
  refreshLiveMatchIdentities,
  getStoredTournaments,
  saveTournaments,
  buildMatchActionPayload,
  sanitizeMatchForBroadcast,
  sanitizeTournamentForBroadcast,
  buildTournamentActionPayload,
  getStoredLeagues,
  saveLeagues,
  buildLeagueActionPayload,
  getStoredBrLobbies,
  saveBrLobbies,
  toPublicBrLobby,
  toPublicBrRanking,
};
