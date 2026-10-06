import { getUserById } from './persistence.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  settleMatchLossWallet,
} from './wallet-engine.mjs';
import { withWalletMutex } from './mutex.mjs';
import { makeError, getNow, roundAmount } from './utils.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// ZOYD Battle Royale — salon unique, un seul match.
//
// Distinct de la BR League (5 jours, top 40) et du MJ (1v1→5v5, 2 equipes).
// Ici : 40 a 100 joueurs dans UN lobby, une seule partie qui va jusqu'au
// dernier survivant, et un classement par le rang de survie ET/ou les kills.
//
// Regle economique centrale, demandee explicitement :
// le pass est paye A L'INSCRIPTION et n'est JAMAIS rembourse. Un joueur
// inscrit qui ne se presente pas penalise ceux qui sont venus, donc sa part
// reste dans la cagnotte. C'est l'inverse d'un remboursement, qui viderait la
// cagnotte et punirait les presents.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps BR COD Mobile en vigueur (verifie le 04/10/2026).
 *
 * Alcatraz a RETIRE : remplace par Rebirth Island le 22/04/2026 (Season 4).
 * Ne pas le remettre dans la liste, il n'existe plus en jeu.
 *
 * - Rebirth Island : compacte, rapide, SANS vehicule (heritage Alcatraz).
 * - Isolated / Blackout / Krai : grandes cartes avec vehicules.
 * Le nombre de joueurs est propre a la map : les grandes tournent a 100, la
 * compacte a 40 (format historique d'Alcatraz).
 */
export const BR_MAPS = {
  isolated: { id: 'isolated', label: 'Isolated', maxPlayers: 100, vehicles: true },
  blackout: { id: 'blackout', label: 'Blackout', maxPlayers: 100, vehicles: true },
  krai: { id: 'krai', label: 'Krai', maxPlayers: 100, vehicles: true },
  rebirth_island: { id: 'rebirth_island', label: 'Rebirth Island', maxPlayers: 40, vehicles: false },
};
export const BR_MAP_IDS = Object.keys(BR_MAPS);

/**
 * Modes : solo / duo / squad. `teamSize` = joueurs par equipe.
 * `maxPlayers` = plafond ABSOLU du salon. Pour les petites teams on garde le
 * plafond demande (solo 100, duo 50, squad 25) : au-dela, la partie devient
 * ingérable et le top 5 ne couvre plus que 5% de la cagnotte.
 */
export const BR_MODES = {
  solo: { id: 'solo', label: 'Solo', teamSize: 1, maxPlayers: 100 },
  duo: { id: 'duo', label: 'Duo', teamSize: 2, maxPlayers: 50 },
  squad: { id: 'squad', label: 'Squad', teamSize: 4, maxPlayers: 25 },
};
export const BR_MODE_IDS = Object.keys(BR_MODES);

/** Variantes de classement final, choisies par le createur du salon. */
export const BR_RANKING_MODES = {
  /** Ordre d'elimination pur : le dernier vivant est 1er. */
  survie: { id: 'survie', label: 'Survie seule' },
  /** Score type Score Z de la league : survie ponderee + kills. */
  survie_kills: { id: 'survie_kills', label: 'Survie + kills' },
  /** Nombre de kills uniquement (la survie ne compte pas). */
  kills: { id: 'kills', label: 'Kills uniquement' },
};
export const BR_RANKING_MODE_IDS = Object.keys(BR_RANKING_MODES);

/**
 * Repartition par defaut d'un salon. SOMME EXACTEMENT 100 %
 * (40 + 22 + 13 + 12 + 8 + 5). Exportee pour que le formulaire admin
 * propose exactement la meme chose : les deux defauts avaient derive
 * (15/3 ici, 13/5 la-bas), donc l'admin voyait une repartition que le
 * serveur ne proposerait jamais.
 */
export const BR_DEFAULT_PAYOUT = Object.freeze({
  first: 0.4, second: 0.22, third: 0.13, fourth: 0.12, fifth: 0.08, arbiterRate: 0.05,
});

/** Combien de joueurs sont payes. Le reste repart dans la cagnotte (absents). */
export const BR_PRIZED_PLACES = 5;

/** L'arbitre ne peut jamais prendre plus de 5% de la cagnotte. */
export const BR_ARBITER_MAX_RATE = 0.05;

/** Fenetre de programmation : 24h a 48h a l'avance. */
export const BR_MIN_DELAY_MS = 24 * 60 * 60 * 1000;
export const BR_MAX_DELAY_MS = 48 * 60 * 60 * 1000;

/** Part de survie dans le score `survie_kills` (le reste va aux kills). */
const SURVIVAL_WEIGHT = 0.7;
const KILL_WEIGHT = 0.3;

const BR_ENTRY_FEE_MIN = 10;
const BR_ENTRY_FEE_MAX = 500;

const getNowMs = () => Date.now();

const cloneLobbies = (lobbies) => (Array.isArray(lobbies) ? lobbies : []).map((l) => structuredClone(l));
const findLobby = (lobbies, lobbyId) => (lobbies || []).find((l) => l.id === lobbyId);

/** Contrainte serveur sur le `maxPlayers` : min(mode, map). */
const resolveMaxPlayers = (mode, mapId) => {
  const modeCfg = BR_MODES[mode];
  const mapCfg = BR_MAPS[mapId];
  return Math.min(modeCfg.maxPlayers, mapCfg.maxPlayers);
};

/**
 * Normalise un lobby et comble les champs absents.
 * Important : `payout` est conserve explicitement, sinon un rechargement
 * depuis Supabase ferait retomber la repartition a zero.
 */
export const normalizeBrLobby = (lobby) => {
  const mode = BR_MODES[lobby?.mode] ? lobby.mode : 'solo';
  const mapId = BR_MAPS[lobby?.map] ? lobby.map : 'isolated';
  const maxPlayers = resolveMaxPlayers(mode, mapId);
  const players = Array.isArray(lobby?.players) ? lobby.players : [];
  return {
    ...lobby,
    id: lobby?.id || `BR-${Date.now().toString(36).toUpperCase()}`,
    name: String(lobby?.name || `Salon BR ${mapId}`).trim().slice(0, 100),
    mode,
    map: mapId,
    maxPlayers,
    entryFee: roundAmount(Number(lobby?.entryFee) || 0),
    rankingMode: BR_RANKING_MODES[lobby?.rankingMode] ? lobby.rankingMode : 'survie_kills',
    payout: {
      first: Number(lobby?.payout?.first ?? BR_DEFAULT_PAYOUT.first),
      second: Number(lobby?.payout?.second ?? BR_DEFAULT_PAYOUT.second),
      third: Number(lobby?.payout?.third ?? BR_DEFAULT_PAYOUT.third),
      fourth: Number(lobby?.payout?.fourth ?? BR_DEFAULT_PAYOUT.fourth),
      fifth: Number(lobby?.payout?.fifth ?? BR_DEFAULT_PAYOUT.fifth),
      arbiterRate: Number(lobby?.payout?.arbiterRate ?? BR_DEFAULT_PAYOUT.arbiterRate),
    },
    status: lobby?.status || 'scheduled',
    scheduledAt: lobby?.scheduledAt || null,
    startedAt: lobby?.startedAt || null,
    finishedAt: lobby?.finishedAt || null,
    players,
    teams: Array.isArray(lobby?.teams) ? lobby.teams : [],
    pot: roundAmount(Number(lobby?.pot) || 0),
    prizePool: roundAmount(Number(lobby?.prizePool) || 0),
    notes: String(lobby?.notes || '').slice(0, 500),
    creatorId: lobby?.creatorId || null,
    createdAt: lobby?.createdAt || getNow(),
    updatedAt: lobby?.updatedAt || getNow(),
  };
};

export const normalizeBrLobbyCollection = (lobbies) =>
  (Array.isArray(lobbies) ? lobbies : []).map(normalizeBrLobby);

/**
 * Valide la repartition de la cagnotte.
 *
 * Le serveur refuse une repartition qui ne somme pas a 100% : une cagnotte mal
 * repartie est soit duilet cree (somme < 100), soit de l'argent cree de nulle
 * part (somme > 100). L'arbitre est plafonne a 5%.
 */
export const validateBrPayout = (payout) => {
  const first = Number(payout?.first);
  const second = Number(payout?.second);
  const third = Number(payout?.third);
  const fourth = Number(payout?.fourth);
  const fifth = Number(payout?.fifth);
  const arbiterRate = Number(payout?.arbiterRate);

  const fields = { first, second, third, fourth, fifth, arbiterRate };
  for (const [name, value] of Object.entries(fields)) {
    if (!Number.isFinite(value) || value < 0) {
      throw makeError('INVALID_PAYOUT', `Repartition invalide : ${name}.`);
    }
  }
  if (arbiterRate > BR_ARBITER_MAX_RATE + 1e-9) {
    throw makeError(
      'INVALID_PAYOUT',
      `Commission arbitre plafonnee a ${BR_ARBITER_MAX_RATE * 100} %.`,
    );
  }
  const total = first + second + third + fourth + fifth + arbiterRate;
  if (Math.abs(total - 1) > 1e-6) {
    throw makeError(
      'INVALID_PAYOUT',
      `La repartition doit sommer a 100 % (recu : ${Math.round(total * 1000) / 10} %).`,
    );
  }
  // Les places doivent etre decroissantes : payer plus le 5e que le 1er
  // pousserait le joueur a vouloir etre 5e.
  if (!(first >= second && second >= third && third >= fourth && fourth >= fifth)) {
    throw makeError('INVALID_PAYOUT', 'Les parts doivent etre decroissantes du 1er au 5e.');
  }
  return { first, second, third, fourth, fifth, arbiterRate };
};

/**
 * Cree un salon BR programme.
 *
 * La date doit etre dans 24h-48h : assez pour que les joueurs se preparent,
 * pas assez pour qu'un salon reste indefiniment en attente. Le MDC de
 * verification est applique ici, pas seulement dans le front.
 */
export const createBrLobbyOnServer = (lobbies, actor, input = {}) => {
  const actorUser = actor?.user || actor;
  if (!actorUser || actorUser.role !== 'admin') {
    throw makeError('FORBIDDEN', 'Seul un administrateur peut creer un salon BR.');
  }

  const mode = String(input.mode || '').trim();
  if (!BR_MODES[mode]) {
    throw makeError('INVALID_MODE', `Mode invalide (attendu : ${BR_MODE_IDS.join(', ')}).`);
  }
  const map = String(input.map || '').trim();
  if (!BR_MAPS[map]) {
    throw makeError('INVALID_MAP', `Map invalide (attendu : ${BR_MAP_IDS.join(', ')}).`);
  }

  const entryFee = roundAmount(Number(input.entryFee));
  if (!Number.isFinite(entryFee) || entryFee < BR_ENTRY_FEE_MIN || entryFee > BR_ENTRY_FEE_MAX) {
    throw makeError(
      'INVALID_ENTRY_FEE',
      `Le pass doit etre entre ${BR_ENTRY_FEE_MIN} et ${BR_ENTRY_FEE_MAX} ZC.`,
    );
  }

  const scheduledAtMs = Date.parse(input.scheduledAt || '');
  if (!Number.isFinite(scheduledAtMs)) {
    throw makeError('INVALID_DATE', 'Date de debut invalide.');
  }
  const delay = scheduledAtMs - getNowMs();
  if (delay < BR_MIN_DELAY_MS) {
    throw makeError(
      'INVALID_DATE',
      'Le salon doit etre programme au moins 24 h a l avance.',
    );
  }
  if (delay > BR_MAX_DELAY_MS) {
    throw makeError(
      'INVALID_DATE',
      'Le salon doit etre programme dans les 48 h (au-dela, les joueurs ne peuvent pas se preparer).',
    );
  }

  const rankingMode = String(input.rankingMode || 'survie_kills');
  if (!BR_RANKING_MODES[rankingMode]) {
    throw makeError(
      'INVALID_RANKING_MODE',
      `Mode de classement invalide (attendu : ${BR_RANKING_MODE_IDS.join(', ')}).`,
    );
  }

  const payout = validateBrPayout(input.payout || {});

  // L'arbitre est designe A LA CREATION, pas apres : sinon un joueur inscrit
  // pourrait s'auto-designer arbitre via POST /arbiter et saisir lui-meme
  // ses eliminations. Il doit etre inscrit au salon.
  const arbiterId = typeof input.arbiterId === 'string' && input.arbiterId.trim()
    ? input.arbiterId.trim()
    : actorUser.id;
  const arbiter = getUserById(arbiterId);
  if (!arbiter || arbiter.role !== 'admin') {
    throw makeError(
      'INVALID_ARBITER',
      'L\'arbitre doit etre un administrateur existant et inscrit au salon.',
    );
  }

  const now = getNow();
  const lobby = normalizeBrLobby({
    id: `BR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')}`,
    name: input.name,
    creatorId: actorUser.id,
    creatorPseudo: actorUser.pseudo,
    arbiterId,
    arbiterPseudo: arbiter.pseudo,
    mode,
    map,
    maxPlayers: resolveMaxPlayers(mode, map),
    entryFee,
    rankingMode,
    payout,
    status: 'scheduled',
    scheduledAt: new Date(scheduledAtMs).toISOString(),
    // L'arbitre (createur par defaut) n'est PAS un joueur : il ne paie aucun
    // pass et ne figure pas dans `players`. Le roster ne contient donc que des
    // joueurs payants, et la cagnotte ne peut pas etre decalee par l'organisateur.
    players: [],
    teams: [],
    pot: 0,
    prizePool: 0,
    notes: String(input.notes || ''),
    createdAt: now,
    updatedAt: now,
  });

  return { lobby, lobbies: [...cloneLobbies(lobbies), lobby] };
};

const requireLobbyJoinable = (lobby) => {
  if (lobby.status !== 'scheduled') {
    throw makeError('LOBBY_CLOSED', 'Ce salon n\'accepte plus d\'inscriptions.');
  }
};

/**
 * Inscrit un joueur et BLOQUE son pass.
 *
 * Le pass est debite maintenant et n'est plus rembourse : c'est la regle
 * commerciale du BR (absent = penalite pour les presents).
 */
export const joinBrLobbyOnServer = async (lobbies, actor, lobbyId) => {
  const actorUser = actor?.user || actor;
  if (!actorUser) throw makeError('AUTH_REQUIRED', 'Session joueur requise.');

  const nextLobbies = cloneLobbies(lobbies);
  const lobby = findLobby(nextLobbies, lobbyId);
  if (!lobby) throw makeError('LOBBY_NOT_FOUND', 'Salon introuvable.');
  requireLobbyJoinable(lobby);

  // Le createur n'est pas auto-inscrit par `createBrLobbyOnServer` : c'est
  // l'appelant (la route) qui l'inscrit via cette fonction, comme tout le
  // monde, pour que son pass soit reellement bloque.
  if (lobby.players.some((p) => p.userId === actorUser.id)) {
    throw makeError('ALREADY_JOINED', 'Tu es deja inscrit dans ce salon.');
  }
  if (lobby.players.length >= lobby.maxPlayers) {
    throw makeError('LOBBY_FULL', `Salon complet (${lobby.maxPlayers} joueurs max).`);
  }

  // `lockEntryFee` est idempotent : si le joueur avait deja bloque ce pass,
  // il ne serait pas debite deux fois.
  await withWalletMutex(actorUser.id, async () => {
    await lockEntryFee(actorUser.id, lobby.entryFee, lobby.id);
  });

  // equipes : solo = 1 joueur par equipe, duo/squad = regroupement par
  // `squadKey` (le joueur peut fournir son pseudo d'equipe).
  const teamSize = BR_MODES[lobby.mode].teamSize;
  // En SOLO, chaque joueur est sa propre equipe. Sans ce cas, la `squadKey`
  // par defaut (le pseudo) faisait Rejoindre le 2e joueur dans l'equipe du
  // createur, qui est deja complete (teamSize 1) => tout le monde rec_Refused
  // TEAM_FULL et le salon solo devenait impossible a remplir.
  const squadKey = teamSize === 1
    ? `solo-${actorUser.id}`
    : String(actorUser.squadKey || actorUser.pseudo || actorUser.id).trim();
  let team = lobby.teams.find((t) => t.key === squadKey);
  if (!team) {
    team = { id: `T-${Date.now().toString(36).toUpperCase()}`, key: squadKey, members: [] };
    lobby.teams.push(team);
  }
  if (team.members.length >= teamSize) {
    throw makeError('TEAM_FULL', `Ton equipe est complete (${teamSize} joueur(s) max).`);
  }
  team.members.push(actorUser.id);

  lobby.players.push({
    userId: actorUser.id,
    pseudo: actorUser.pseudo,
    teamId: team.id,
    joinedAt: getNow(),
    checkedIn: false,
    // En vie jusqu'a elimination. `placement` est inversee a l'elimination :
    // le dernier elimine est 1er.
    alive: true,
    placement: null,
    kills: 0,
    eliminatedAt: null,
    absent: false,
    settled: false,
    winnings: 0,
  });

  lobby.pot = roundAmount(lobby.pot + lobby.entryFee);
  lobby.updatedAt = getNow();

  return { lobby, lobbies: nextLobbies };
};

/**
 * Desinscription AVANT le debut : seul cas ou le pass est rembourse.
 * Apres le debut, le joueur est marque absent et perd son pass (penalite).
 */
export const leaveBrLobbyOnServer = async (lobbies, actor, lobbyId) => {
  const actorUser = actor?.user || actor;
  if (!actorUser) throw makeError('AUTH_REQUIRED', 'Session joueur requise.');

  const nextLobbies = cloneLobbies(lobbies);
  const lobby = findLobby(nextLobbies, lobbyId);
  if (!lobby) throw makeError('LOBBY_NOT_FOUND', 'Salon introuvable.');

  const index = lobby.players.findIndex((p) => p.userId === actorUser.id);
  if (index === -1) throw makeError('NOT_JOINED', 'Tu n\'es pas inscrit dans ce salon.');

  if (lobby.status !== 'scheduled') {
    throw makeError(
      'LOBBY_CLOSED',
      'La partie a commence : le pass n\'est plus rembourse (il finance la cagnotte des presents).',
    );
  }

  const [removed] = lobby.players.splice(index, 1);
  lobby.teams = lobby.teams
    .map((t) => ({ ...t, members: t.members.filter((m) => m !== actorUser.id) }))
    .filter((t) => t.members.length > 0);

  lobby.pot = roundAmount(Math.max(0, lobby.pot - lobby.entryFee));
  lobby.updatedAt = getNow();

  // Seule la desinscription AVANT le coup d'envoi rembourse.
  await withWalletMutex(actorUser.id, async () => {
    await refundLockedEntry(actorUser.id, lobby.id, `Desinscription salon BR ${removed.pseudo}`);
  });

  return { lobby, lobbies: nextLobbies };
};

/** Pointage de presence : le joueur confirme qu'il est pret a jouer. */
export const checkInBrLobbyOnServer = (lobbies, actor, lobbyId) => {
  const actorUser = actor?.user || actor;
  if (!actorUser) throw makeError('AUTH_REQUIRED', 'Session joueur requise.');

  const nextLobbies = cloneLobbies(lobbies);
  const lobby = findLobby(nextLobbies, lobbyId);
  if (!lobby) throw makeError('LOBBY_NOT_FOUND', 'Salon introuvable.');
  if (lobby.status === 'finished') throw makeError('LOBBY_CLOSED', 'Partie terminee.');

  const player = lobby.players.find((p) => p.userId === actorUser.id);
  if (!player) throw makeError('NOT_JOINED', 'Tu n\'es pas inscrit dans ce salon.');
  if (player.checkedIn) throw makeError('ALREADY_CHECKED_IN', 'Tu as deja confirme ta presence.');

  player.checkedIn = true;
  player.checkedInAt = getNow();
  lobby.updatedAt = getNow();
  return { lobby, lobbies: nextLobbies };
};

/**
 * Lance la partie.
 *
 * Seuls les joueurs PRESENTS (check-in) entrent en jeu. Les absents sont
 * marques `absent` : leur pass reste bloque (c'est la penalite) et ils
 * n'entrent pas dans le classement.
 *
 * Un salon sans presence ne demarre pas : il n'y aurait personne pour jouer et
 * la cagnotte resterait bloquee indefiniment.
 */
export const startBrLobbyOnServer = (lobbies, actor, lobbyId, { nowMs = getNowMs() } = {}) => {
  const actorUser = actor?.user || actor;
  if (!actorUser) throw makeError('AUTH_REQUIRED', 'Session joueur requise.');

  const nextLobbies = cloneLobbies(lobbies);
  const lobby = findLobby(nextLobbies, lobbyId);
  if (!lobby) throw makeError('LOBBY_NOT_FOUND', 'Salon introuvable.');
  if (lobby.status === 'live') throw makeError('ALREADY_LIVE', 'Partie deja en cours.');
  if (lobby.status === 'finished') throw makeError('LOBBY_CLOSED', 'Partie terminee.');

  // Le lancement declenche la perte des absents (leur pass est consomme) :
  // seuls l'arbitre et le createur peuvent le faire, pas un inscrit lambda.
  const isArbiter = lobby.arbiterId && lobby.arbiterId === actorUser.id;
  const isCreator = lobby.creatorId === actorUser.id;
  if (!isArbiter && !isCreator) {
    throw makeError(
      'FORBIDDEN',
      'Seul l\'organisateur ou l\'arbitre peut lancer la partie.',
    );
  }

  // Fenetre de programmation : pas de lancement anticipatif force.
  if (lobby.scheduledAt && nowMs < Date.parse(lobby.scheduledAt) - 10 * 60 * 1000) {
    throw makeError(
      'TOO_EARLY',
      'Le salon ne peut pas demarrer plus de 10 min avant l\'heure programmee.',
    );
  }

  const present = lobby.players.filter((p) => p.checkedIn);
  if (present.length === 0) {
    throw makeError('NO_PRESENT', 'Aucun joueur present : la partie ne peut pas demarrer.');
  }
  if (present.length < BR_PRIZED_PLACES) {
    throw makeError(
      'NOT_ENOUGH_PLAYERS',
      `Il faut au moins ${BR_PRIZED_PLACES} joueurs presents pour demarrer la partie.`,
    );
  }

  for (const player of lobby.players) {
    if (!player.checkedIn) {
      player.absent = true;
      player.alive = false;
      player.eliminatedAt = getNow();
    }
  }

  lobby.status = 'live';
  lobby.startedAt = getNow();
  lobby.updatedAt = lobby.startedAt;

  // Cagnotte reelle = somme des reservations wallet effectivement bloquees.
  // Source de verite = le wallet, comme pour les matchs.
  let lockedPot = 0;
  for (const player of lobby.players) {
    const user = getUserById(player.userId);
    lockedPot += Number(user?.wallet?.lockedEntries?.[lobby.id]?.amount || 0);
  }
  lobby.pot = roundAmount(lockedPot);
  lobby.prizePool = roundAmount(
    lobby.pot * (1 - lobby.payout.arbiterRate),
  );
  lobby.updatedAt = getNow();

  return { lobby, lobbies: nextLobbies };
};

/**
 * L'acteur DOIT etre l'arbitre designe du salon.
 *
 * Securite critique : sans ce controle, n'importe quel joueur inscrit
 * pouvait appeler `eliminate` et s'attribuer des kills (donc un classement
 * favorable et une part de cagnotte). Le modele met est le meme que le MJ :
 * celui qui n'est pas dans la partie saisit les resultats, personne d'autre.
 */
const requireLobbyArbiter = (lobby, actorUser) => {
  if (!lobby.arbiterId) {
    throw makeError(
      'ARBITER_REQUIRED',
      'Aucun arbitre designe pour ce salon : la saisie des resultats est impossible.',
    );
  }
  if (lobby.arbiterId !== actorUser.id) {
    throw makeError(
      'FORBIDDEN',
      'Seul l\'arbitre de ce salon peut saisir les resultats ou le regler.',
    );
  }
};

/**
 * Enregistre une elimination.
 *
 * `kills` est porte par l'elimine, `assists` par le joueur credited. On
 * refuse toute elimination d'un joueur deja mort et on refuse les kills
 * d'un joueur absent (il ne joue pas, il ne peut pas tuer).
 */
export const eliminateBrPlayerOnServer = (
  lobbies,
  actor,
  lobbyId,
  eliminatedUserId,
  { killerUserId = null, assists = 0 } = {},
) => {
  const actorUser = actor?.user || actor;
  if (!actorUser) throw makeError('AUTH_REQUIRED', 'Session joueur requise.');

  const nextLobbies = cloneLobbies(lobbies);
  const lobby = findLobby(nextLobbies, lobbyId);
  if (!lobby) throw makeError('LOBBY_NOT_FOUND', 'Salon introuvable.');
  if (lobby.status !== 'live') throw makeError('LOBBY_NOT_LIVE', 'La partie n\'est pas en cours.');
  // AVANT toute mutation : un joueur non-arbitre ne doit rien pouvoir changer.
  requireLobbyArbiter(lobby, actorUser);

  const eliminated = lobby.players.find((p) => p.userId === eliminatedUserId);
  if (!eliminated) throw makeError('PLAYER_NOT_FOUND', 'Joueur introuvable dans ce salon.');
  if (!eliminated.alive) throw makeError('ALREADY_ELIMINATED', 'Ce joueur est deja elimine.');

  const livePlayers = lobby.players.filter((p) => p.alive);
  if (livePlayers.length <= 1) {
    throw makeError('ALREADY_FINISHED', 'Il ne reste qu\'un joueur : la partie est terminee.');
  }

  eliminated.alive = false;
  eliminated.eliminatedAt = getNow();
  // Convention BR : 1 = vainqueur (dernier survivant), N = premiere elimination.
  // `livePlayers.length` est le nombre de survivants AVANT cette elimination :
  // elimine en premier dans un salon de 5, il termine donc 5e. Le survivant
  // final n'est jamais elimine, il garde placement 1.
  eliminated.placement = livePlayers.length;

  const safeAssists = Math.max(0, Math.min(Number(assists) || 0, 10));

  if (killerUserId) {
    const killer = lobby.players.find((p) => p.userId === killerUserId);
    if (!killer) throw makeError('PLAYER_NOT_FOUND', 'Tueur introuvable dans ce salon.');
    if (killer.absent) {
      throw makeError('PLAYER_ABSENT', 'Un joueur absent ne peut pas eliminer.');
    }
    if (!killer.alive) {
      throw makeError('PLAYER_DEAD', 'Un joueur elimine ne peut pas eliminer.');
    }
    killer.kills = (killer.kills || 0) + 1;
    eliminated.killedBy = killerUserId;
    killer.assists = (killer.assists || 0) + safeAssists;
  } else {
    eliminated.killedBy = null;
  }

  lobby.updatedAt = getNow();
  return { lobby, lobbies: nextLobbies };
};

/**
 * Calcule le classement final selon la variante choisie.
 * Fonction PURE (aucun acces wallet) : testable isolement.
 *
 * - `survie`        : rang de survie, les kills n'entrent pas.
 * - `survie_kills`  : score = 0.7 * survie normalisee + 0.3 * kills normalises.
 * - `kills`         : kills d'abord, la survie ne sert qu'a departager.
 */
export const computeBrRanking = (lobby) => {
  // L'arbitre n'est PAS un concurrent : il supervise, il ne joue pas. Le
  // laisser dans le classement lui donnerait une place payee sur le top 5
  // (et le prochain joueur verrait sa part amputee).
  const contenders = lobby.players.filter((p) => !p.absent && p.userId !== lobby.arbiterId);
  const maxPlacement = Math.max(1, ...contenders.map((p) => p.placement || 0));
  const maxKills = Math.max(0, ...contenders.map((p) => p.kills || 0));

  // `placement` suit la convention BR : 1 = vainqueur (dernier survivant).
  // On inverse donc pour obtenir un score « plus haut = mieux » :
  // 1er -> 1.0, dernier -> faible.
  const survivalScore = (player) => {
    const placement = player.placement || maxPlacement;
    return (maxPlacement + 1 - placement) / maxPlacement;
  };
  const killsScore = (player) => (maxKills > 0 ? (player.kills || 0) / maxKills : 0);

  const scoreOf = (player) => {
    switch (lobby.rankingMode) {
      case 'survie':
        return survivalScore(player);
      case 'kills':
        return killsScore(player);
      case 'survie_kills':
      default:
        return SURVIVAL_WEIGHT * survivalScore(player) + KILL_WEIGHT * killsScore(player);
    }
  };

  return [...contenders]
    .map((player) => ({ ...player, score: scoreOf(player) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Departages : le plus survivant d'abord (placement 1 avant 2), puis les
      // kills, puis le pseudo pour un ordre stable.
      const aPlace = a.placement || Number.MAX_SAFE_INTEGER;
      const bPlace = b.placement || Number.MAX_SAFE_INTEGER;
      if (aPlace !== bPlace) return aPlace - bPlace;
      if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
      return String(a.pseudo).localeCompare(String(b.pseudo));
    });
};

/**
 * Regle la partie et distribue la cagnotte.
 *
 * Ordre IMPORTANT, pour qu'aucun doublon ne soit possible meme si le process
 * meurt au milieu :
 *  1. On marque le lobby `settling` AVANT tout versement. Un retry apres un
 *     crash voit `settling` et refuse de re-payer.
 *  2. Chaque joueur est verse avec `settled` positionne dans le lobby, donc un
 *     retry ne repaie pas un joueur deja servi.
 *  3. Les perdants sont debites de leur reservation (le pass disparait : c'est
 *     le prix de la participation, PAS un remboursement).
 *
 * L'arbitre est paye avec `releaseWalletWinnings` uniquement s'il a lui-meme
 * bloque un pass, sinon il n'a pas de reservation a liberer : on ne cree pas
 * de transaction fantaisiste.
 */
export const settleBrLobbyOnServer = async (lobbies, actor, lobbyId) => {
  const actorUser = actor?.user || actor;
  if (!actorUser) throw makeError('AUTH_REQUIRED', 'Session joueur requise.');

  const nextLobbies = cloneLobbies(lobbies);
  const lobby = findLobby(nextLobbies, lobbyId);
  if (!lobby) throw makeError('LOBBY_NOT_FOUND', 'Salon introuvable.');
  if (lobby.status === 'finished' || lobby.status === 'settling') {
    throw makeError('LOBBY_CLOSED', 'Partie deja reglee.');
  }
  if (lobby.status !== 'live') {
    throw makeError('LOBBY_NOT_LIVE', 'La partie n\'est pas en cours.');
  }
  // Le reglement verse la cagnotte : reserves a l'arbitre du salon.
  requireLobbyArbiter(lobby, actorUser);

  // 1. Verrou anti-doublon AVANT tout versement.
  lobby.status = 'settling';
  lobby.updatedAt = getNow();

  const alive = lobby.players.filter((p) => p.alive);
  const contenders = lobby.players.filter((p) => !p.absent && p.userId !== lobby.arbiterId);
  if (contenders.length === 0) {
    // Personne n'a joue : on rend tout, c'est le seul cas ou l'on rembourse.
    lobby.status = 'cancelled';
    lobby.finishedAt = getNow();
    for (const player of lobby.players) {
      await withWalletMutex(player.userId, async () => {
        await refundLockedEntry(player.userId, lobby.id, `Salon BR annule ${lobby.name}`);
      });
    }
    return { lobby, lobbies: nextLobbies, payouts: [], refunded: lobby.players.length };
  }

  // Le dernier vivant est le vainqueur (placement 1).
  if (alive.length > 0) {
    alive.sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo)));
    alive[0].placement = 1;
  }
  const withoutPlacement = contenders.filter((p) => !p.placement);
  if (withoutPlacement.length === 1) {
    // Filet de securite : un joueur non elimine alors que d'autres l'ont ete
    // est considere comme vainqueur.
    withoutPlacement[0].placement = 1;
  }

  const { payouts, arbiter } = computeBrPayouts(lobby);

  // 2. Versement des gains.
  for (const prize of payouts) {
    const player = lobby.players.find((p) => p.userId === prize.userId);
    if (!player || player.settled) continue;
    await withWalletMutex(prize.userId, async () => {
      await releaseWalletWinnings(
        prize.userId,
        prize.amount,
        lobby.id,
        'prize_win',
        `BR ${lobby.name} - ${prize.placement}e place (${prize.kills} kills)`,
      );
    });
    player.settled = true;
    player.winnings = prize.amount;
  }

// 3. Commission arbitre, prelevee sur la cagnotte.
//
// L'arbitre n'est PAS joueur et n'a donc aucun pass bloque : exiger une
// reservation le payait ZERO (il ne pouvait plus jamais toucher sa part).
// Sa commission sort de la cagnotte, comme les gains, et `releaseWalletWinnings`
// credite directement en cash quand il n'y a pas de reservation.
//
// `arbiterSettled` (et non le flag du joueur) garantit l'idempotence : le
// reglement peut etre rejoue sans verser deux fois.
if (arbiter.userId && arbiter.amount > 0 && !lobby.arbiterSettled) {
  await withWalletMutex(arbiter.userId, async () => {
    await releaseWalletWinnings(
      arbiter.userId,
      arbiter.amount,
      lobby.id,
      'arbitration_fee',
      `Commission arbitrage BR ${lobby.name}`,
    );
  });
  lobby.arbiterSettled = true;
}

  // 4. Perdants et absents : le pass est consomme (penalite), pas rembourse.
  for (const player of lobby.players) {
    if (player.settled) continue;
    const isAbsent = player.absent;
    await withWalletMutex(player.userId, async () => {
      await settleMatchLossWallet(
        player.userId,
        lobby.id,
        isAbsent
          ? `Pass BR non Presents - ${lobby.name} (penalite)`
          : `BR ${lobby.name} - ${player.placement || '?'}e place`,
      );
    });
    player.settled = true;
  }

  lobby.status = 'finished';
  lobby.finishedAt = getNow();
  lobby.updatedAt = lobby.finishedAt;

  return { lobby, lobbies: nextLobbies, payouts, arbiter };
};

/**
 * Repartition de la cagnotte (fonction pure, testable).
 *
 * Le dernier beneficiaire absorbe l'arrondi : sans cela, la somme des parts
 * pouvait differer du pot de quelques centimes, et la cagnotte ne serait ni
 * videe ni creditee au centime pres.
 */
export const computeBrPayouts = (lobby) => {
  const ranking = computeBrRanking(lobby);
  const pot = roundAmount(lobby.pot || 0);
  const arbiterRate = lobby.payout.arbiterRate;
  const winnersPool = roundAmount(pot * (1 - arbiterRate));

  const shares = [lobby.payout.first, lobby.payout.second, lobby.payout.third, lobby.payout.fourth, lobby.payout.fifth];
  const results = [];
  let distributed = 0;
  let lastIndex = -1;
  for (let i = 0; i < BR_PRIZED_PLACES; i++) {
    if (ranking[i]) lastIndex = i;
  }

  for (let i = 0; i < BR_PRIZED_PLACES; i++) {
    const player = ranking[i];
    if (!player) break;
    const amount = i === lastIndex
      ? roundAmount(winnersPool - distributed)
      : roundAmount(winnersPool * shares[i]);
    distributed = roundAmount(distributed + amount);
    results.push({
      userId: player.userId,
      pseudo: player.pseudo,
      placement: i + 1,
      kills: player.kills || 0,
      survivedTo: player.placement || 0,
      score: player.score,
      amount,
      type: 'prize_win',
    });
  }

  return {
    ranking,
    payouts: results,
    arbiter: {
      userId: lobby.arbiterId || null,
      rate: arbiterRate,
      amount: roundAmount(pot * arbiterRate),
    },
    winnersPool,
    pot,
  };
};
