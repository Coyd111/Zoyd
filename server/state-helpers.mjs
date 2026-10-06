import { syncMatchChatChannels, buildMatchChatChannel, broadcastChatChannel } from './chat-helpers.mjs';
import { broadcastStateSnapshot } from './push-notifications.mjs';
import { replaceStateCollection, getStateCollection, getUserById } from './persistence.mjs';
import { normalizeTournamentCollection } from './tournament-engine.mjs';
import { getPublicMatchesForUser, getProjectedPayouts } from './match-engine.mjs';
import { normalizeLeagueCollection } from './league-engine.mjs';
import { normalizeBrLobbyCollection } from './br-engine.mjs';
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
 * Remove sensitive fields from a match before broadcasting.
 *
 * `userId` est retire (les UUID internes ne doivent pas fuiter), mais un
 * drapeau `isMe` est AJOUTE par joueur : sans lui le client ne peut pas
 * identifier son propre slot, donc `currentPlayer` restait `undefined` et les
 * boutons "Confirmer ma presence" / "Je suis pret" ne s'affichaient jamais.
 * `hasConfirmed` remplace l'acces a `result.confirmedByTeams`.
 *
 * @param {object} match - Match to sanitize
 * @param {string|null} viewerId - userId du destinataire (null = anonyme)
 * @returns {object} A shallow copy with sensitive fields stripped
 */
const sanitizeMatchForBroadcast = (match, viewerId = null) => {
  const { roomPassword, roomName, screenshots, ...safe } = match;
  if (safe.arbiter) {
    const { roomPassword: _ap, roomName: _an, userId: arbiterUserId, ...safeArbiter } = safe.arbiter;
    safe.arbiter = { ...safeArbiter, isMe: Boolean(viewerId && arbiterUserId === viewerId) };
  }
  if (Array.isArray(safe.players)) {
    const confirmed = Array.isArray(safe.result?.confirmedByTeams) ? safe.result.confirmedByTeams : [];
    safe.players = safe.players.map(({ userId, ...rest }) => ({
      ...rest,
      isMe: Boolean(viewerId && userId === viewerId),
      hasConfirmed: confirmed.includes(userId),
    }));
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
 * Uses the shared `state_snapshots` table (kind column), so no migration needed.
 * @param {object} io - Socket.IO server instance
 * @param {Array} lobbies - The BR lobbies to persist
 * @returns {Promise<Array>} The stored lobbies
 */
const saveBrLobbies = async (io, lobbies) => {
  await replaceStateCollection('brLobbies', lobbies);
  const stored = getStoredBrLobbies();
  broadcastStateSnapshot(io, 'brLobbies', stored.map((lobby) => toPublicBrLobby(lobby)));
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
