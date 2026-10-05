import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn(),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((value) => String(value || '').trim()),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
}));

import * as brEngine from './br-engine.mjs';
import { getUserById } from './persistence.mjs';
import { lockEntryFee, refundLockedEntry, releaseWalletWinnings, settleMatchLossWallet } from './wallet-engine.mjs';

const admin = { id: 'admin-1', pseudo: 'Admin', role: 'admin', wallet: {} };
const player = (id) => ({ id, pseudo: id.toUpperCase(), role: 'player', wallet: {} });

/** Date dans 24h-48h, conforme a la fenetre de programmation. */
const inWindow = () => new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();

const defaultPayout = { first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08, arbiterRate: 0.03 };

const createLobby = (overrides = {}) => {
  const { lobby } = brEngine.createBrLobbyOnServer([], admin, {
    name: 'Salon test',
    mode: 'solo',
    map: 'isolated',
    entryFee: 50,
    scheduledAt: inWindow(),
    rankingMode: 'survie_kills',
    payout: defaultPayout,
    ...overrides,
  });
  return lobby;
};

describe('br-engine - catalogue', () => {
  it('expose les 4 maps BR COD Mobile en vigueur, sans Alcatraz', () => {
    // Alcatraz a ete REMPLACE par Rebirth Island le 22/04/2026 : le remettre
    // dans la liste proposerait une map qui n'existe plus en jeu.
    expect(brEngine.BR_MAP_IDS).toEqual(['isolated', 'blackout', 'krai', 'rebirth_island']);
    expect(brEngine.BR_MAP_IDS).not.toContain('alcatraz');
  });

  it('plafonne Rebirth Island a 40 joueurs (format compact)', () => {
    expect(brEngine.BR_MAPS.rebirth_island.maxPlayers).toBe(40);
    expect(brEngine.BR_MAPS.rebirth_island.vehicles).toBe(false);
  });

  it('plafonne solo/duo/squad a 100/50/25', () => {
    expect(brEngine.BR_MODES.solo.maxPlayers).toBe(100);
    expect(brEngine.BR_MODES.duo.maxPlayers).toBe(50);
    expect(brEngine.BR_MODES.squad.maxPlayers).toBe(25);
  });

  it('plafonne la commission arbitre a 5%', () => {
    expect(brEngine.BR_ARBITER_MAX_RATE).toBe(0.05);
  });
});

describe('br-engine - validateBrPayout', () => {
  it('accepte une repartition qui somme a 100%', () => {
    expect(() => brEngine.validateBrPayout(defaultPayout)).not.toThrow();
  });

  it('refuse une repartition qui ne somme pas a 100% (argent cree ou perdu)', () => {
    expect(() => brEngine.validateBrPayout({ ...defaultPayout, second: 0.30 }))
      .toThrow(/100/);
    expect(() => brEngine.validateBrPayout({ ...defaultPayout, second: 0.10 }))
      .toThrow(/100/);
  });

  it('refuse un arbitre au-dela de 5%', () => {
    expect(() => brEngine.validateBrPayout({
      first: 0.4, second: 0.22, third: 0.15, fourth: 0.1, fifth: 0.08, arbiterRate: 0.06,
    })).toThrow(/5/);
  });

  it('accepte exactement 5% pour l\'arbitre', () => {
    expect(() => brEngine.validateBrPayout({
      first: 0.4, second: 0.22, third: 0.15, fourth: 0.1, fifth: 0.08, arbiterRate: 0.05,
    })).not.toThrow();
  });

  it('refuse des parts croissantes (5e paye plus que le 1er)', () => {
    expect(() => brEngine.validateBrPayout({
      first: 0.1, second: 0.15, third: 0.2, fourth: 0.25, fifth: 0.27, arbiterRate: 0.03,
    })).toThrow(/decroissantes/);
  });

  it('refuse une part negative', () => {
    expect(() => brEngine.validateBrPayout({ ...defaultPayout, third: -0.1 }))
      .toThrow(/Repartition invalide/);
  });
});

describe('br-engine - createBrLobbyOnServer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cree un salon programme avec les valeurs par defaut', () => {
    const lobby = createLobby();
    expect(lobby.status).toBe('scheduled');
    expect(lobby.mode).toBe('solo');
    expect(lobby.map).toBe('isolated');
    expect(lobby.maxPlayers).toBe(100);
    expect(lobby.entryFee).toBe(50);
    expect(lobby.players).toEqual([]);
  });

  it('refuse un non-admin', () => {
    expect(() => brEngine.createBrLobbyOnServer([], player('p1'), {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: inWindow(), payout: defaultPayout,
    })).toThrow(/administrateur/);
  });

  it('refuse une map inconnue', () => {
    expect(() => createLobby({ map: 'alcatraz' })).toThrow(/Map invalide/);
  });

  it('refuse un mode inconnu', () => {
    expect(() => createLobby({ mode: 'pluriel' })).toThrow(/Mode invalide/);
  });

  it('refuse une programmation a moins de 24h', () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(() => createLobby({ scheduledAt: soon })).toThrow(/24 h/);
  });

  it('refuse une programmation a plus de 48h', () => {
    const late = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    expect(() => createLobby({ scheduledAt: late })).toThrow(/48 h/);
  });

  it('accepte une programmation dans la fenetre 24h-48h', () => {
    expect(() => createLobby({ scheduledAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString() })).not.toThrow();
    expect(() => createLobby({ scheduledAt: new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString() })).not.toThrow();
  });

  it('applique le plafond min(mode, map) : Rebirth Island + squad = 25', () => {
    const lobby = createLobby({ map: 'rebirth_island', mode: 'squad' });
    expect(lobby.maxPlayers).toBe(25);
  });
});

describe('br-engine - joinBrLobbyOnServer', () => {
  let lobby;
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(player('p1'));
    lobby = createLobby();
  });

  it('bloque le pass et inscrit le joueur', async () => {
    const { lobby: next } = await brEngine.joinBrLobbyOnServer([lobby], player('p1'), lobby.id);
    expect(lockEntryFee).toHaveBeenCalledWith('p1', 50, lobby.id);
    expect(next.players).toHaveLength(1);
    expect(next.players[0].checkedIn).toBe(false);
    expect(next.players[0].alive).toBe(true);
    expect(next.pot).toBe(50);
  });

  it('refuse une double inscription', async () => {
    const { lobbies } = await brEngine.joinBrLobbyOnServer([lobby], player('p1'), lobby.id);
    await expect(brEngine.joinBrLobbyOnServer(lobbies, player('p1'), lobby.id))
      .rejects.toThrow(/deja inscrit/);
  });

  it('refuse un salon plein', async () => {
    // Squad sur Rebirth Island = 25 max : on remplit avec 25 joueurs distincts.
    let lobbies = [createLobby({ mode: 'squad', map: 'rebirth_island' })];
    const target = lobbies[0];
    for (let i = 0; i < target.maxPlayers; i++) {
      getUserById.mockReturnValue(player(`p${i}`));
      const res = await brEngine.joinBrLobbyOnServer(lobbies, player(`p${i}`), target.id);
      lobbies = res.lobbies;
    }
    getUserById.mockReturnValue(player('overflow'));
    await expect(brEngine.joinBrLobbyOnServer(lobbies, player('overflow'), target.id))
      .rejects.toThrow(/complet/);
  });

  it('refuse un salon termine', async () => {
    const finished = { ...lobby, status: 'finished' };
    await expect(brEngine.joinBrLobbyOnServer([finished], player('p1'), lobby.id))
      .rejects.toThrow(/plus d'inscriptions/);
  });

  // Regression : en solo (teamSize 1), la `squadKey` par defaut etait le
  // pseudo. Le 2e joueur rejoignait donc l'equipe du createur, deja complete,
  // et recevait TEAM_FULL : un salon solo ne pouvait ACCEPTER aucun joueur
  // apres son createur.
  it('solo : chaque joueur a sa propre equipe (teamSize 1)', async () => {
    let lobbies = [lobby];
    for (const id of ['p1', 'p2', 'p3']) {
      getUserById.mockReturnValue(player(id));
      const res = await brEngine.joinBrLobbyOnServer(lobbies, player(id), lobby.id);
      lobbies = res.lobbies;
    }
    const result = lobbies[0];
    expect(result.players).toHaveLength(3);
    // 3 joueurs => 3 equipes distinctes en solo.
    expect(result.teams).toHaveLength(3);
    expect(new Set(result.teams.map((t) => t.key)).size).toBe(3);
  });

  it('squad : les joueurs partageant une squadKey rejoignent la meme equipe', async () => {
    const squadLobby = createLobby({ mode: 'squad' });
    const withSquad = (id, key) => ({ ...player(id), squadKey: key });
    let lobbies = [squadLobby];
    for (const id of ['a', 'b', 'c']) {
      getUserById.mockReturnValue(withSquad(id, 'ALPHA'));
      const res = await brEngine.joinBrLobbyOnServer(lobbies, withSquad(id, 'ALPHA'), squadLobby.id);
      lobbies = res.lobbies;
    }
    const result = lobbies[0];
    expect(result.players).toHaveLength(3);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].members).toHaveLength(3);
  });

  it('squad : refuse une 5e personne dans la meme equipe (teamSize 4)', async () => {
    const squadLobby = createLobby({ mode: 'squad' });
    const withSquad = (id) => ({ ...player(id), squadKey: 'ALPHA' });
    let lobbies = [squadLobby];
    for (const id of ['a', 'b', 'c', 'd']) {
      getUserById.mockReturnValue(withSquad(id));
      const res = await brEngine.joinBrLobbyOnServer(lobbies, withSquad(id), squadLobby.id);
      lobbies = res.lobbies;
    }
    getUserById.mockReturnValue(withSquad('e'));
    await expect(brEngine.joinBrLobbyOnServer(lobbies, withSquad('e'), squadLobby.id))
      .rejects.toThrow(/complete/);
  });
});

describe('br-engine - leaveBrLobbyOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(player('p1'));
  });

  it('rembourse AVANT le debut de la partie', async () => {
    const lobby = createLobby();
    const { lobbies } = await brEngine.joinBrLobbyOnServer([lobby], player('p1'), lobby.id);
    const res = await brEngine.leaveBrLobbyOnServer(lobbies, player('p1'), lobby.id);
    expect(refundLockedEntry).toHaveBeenCalled();
    expect(res.lobby.players).toHaveLength(0);
    expect(res.lobby.pot).toBe(0);
  });

  it('NE rembourse PAS apres le debut : le pass finance les presents', async () => {
    // C'est la regle commerciale centrale du BR : un absent penalise ceux
    // qui sont venus. Rembourser viderait la cagnotte.
    const lobby = { ...createLobby(), status: 'live' };
    const withPlayer = {
      ...lobby,
      players: [{ userId: 'p1', pseudo: 'P1', teamId: 'T1', joinedAt: lobby.createdAt, checkedIn: true, alive: true, kills: 0 }],
      teams: [{ id: 'T1', key: 'P1', members: ['p1'] }],
      pot: 50,
    };
    await expect(brEngine.leaveBrLobbyOnServer([withPlayer], player('p1'), lobby.id))
      .rejects.toThrow(/plus rembourse/);
    expect(refundLockedEntry).not.toHaveBeenCalled();
  });
});

describe('br-engine - startBrLobbyOnServer', () => {
  const lobbyWith = (count, checkedInCount) => {
    const lobby = createLobby();
    return {
      ...lobby,
      scheduledAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      players: Array.from({ length: count }, (_, i) => ({
        userId: `p${i}`, pseudo: `P${i}`, teamId: `T${i}`,
        joinedAt: lobby.createdAt, checkedIn: i < checkedInCount,
        alive: true, placement: null, kills: 0, absent: false,
      })),
      teams: Array.from({ length: count }, (_, i) => ({ id: `T${i}`, key: `P${i}`, members: [`p${i}`] })),
      pot: count * 50,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue({ wallet: { lockedEntries: {} } });
  });

  it('demarre avec les presents et marque absents les autres', () => {
    const lobby = lobbyWith(10, 7);
    // 7 presents x 50 = 350 bloques ; les 3 absents sont aussi bloques (penalite)
    getUserById.mockImplementation((id) => ({
      wallet: { lockedEntries: { [lobby.id]: { amount: 50 } } },
    }));
    const { lobby: next } = brEngine.startBrLobbyOnServer([lobby], admin, lobby.id);
    expect(next.status).toBe('live');
    expect(next.players.filter((p) => !p.absent)).toHaveLength(7);
    expect(next.players.filter((p) => p.absent)).toHaveLength(3);
    expect(next.players.filter((p) => p.absent).every((p) => p.alive === false)).toBe(true);
  });

  it('refuse de demarrer sans aucun present', () => {
    const lobby = lobbyWith(10, 0);
    expect(() => brEngine.startBrLobbyOnServer([lobby], admin, lobby.id)).toThrow(/Aucun joueur present/);
  });

  it('refuse de demarrer avec moins de 5 presents (podium incomplet)', () => {
    const lobby = lobbyWith(10, 3);
    expect(() => brEngine.startBrLobbyOnServer([lobby], admin, lobby.id)).toThrow(/au moins 5/);
  });

  it('refuse un demarrage plus de 10 min avant l\'heure programmee', () => {
    const lobby = createLobby();
    lobby.scheduledAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    lobby.players = Array.from({ length: 6 }, (_, i) => ({
      userId: `p${i}`, pseudo: `P${i}`, teamId: `T${i}`,
      joinedAt: lobby.createdAt, checkedIn: true, alive: true, kills: 0, absent: false,
    }));
    getUserById.mockReturnValue({ wallet: { lockedEntries: { [lobby.id]: { amount: 50 } } } });
    expect(() => brEngine.startBrLobbyOnServer([lobby], admin, lobby.id)).toThrow(/10 min/);
  });

  it('recalcule la cagnotte depuis les reservations wallet reelles', () => {
    // 10 inscrits mais seuls 350 bloques en wallet : la cagnotte vaut 350,
    // pas 500. Sans ca, ZOYD redistribuerait de l'argent non encaisse.
    const lobby = lobbyWith(10, 10);
    getUserById.mockImplementation((id) => ({
      wallet: { lockedEntries: { [lobby.id]: { amount: Number(id.slice(1)) < 7 ? 50 : 0 } } },
    }));
    const { lobby: next } = brEngine.startBrLobbyOnServer([lobby], admin, lobby.id);
    expect(next.pot).toBe(350);
    expect(next.prizePool).toBe(350 * 0.97);
  });
});

describe('br-engine - eliminateBrPlayerOnServer', () => {
  const liveLobby = () => ({
    ...createLobby(),
    status: 'live',
    players: Array.from({ length: 5 }, (_, i) => ({
      userId: `p${i}`, pseudo: `P${i}`, teamId: `T${i}`,
      joinedAt: '2026-01-01', checkedIn: true, alive: true, kills: 0, absent: false, placement: null,
    })),
    teams: [],
  });

  beforeEach(() => vi.clearAllMocks());

  it('attribue un rang de survie BR : le premier elimine termine dernier', () => {
    let lobby = liveLobby();
    // 5 joueurs en vie, P0 elimine en premier => il termine 5e.
    lobby = brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p0').lobby;
    expect(lobby.players.find((p) => p.userId === 'p0').placement).toBe(5);

    lobby = brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p1').lobby;
    expect(lobby.players.find((p) => p.userId === 'p1').placement).toBe(4);
  });

  it('credite un kill au tueur', () => {
    const lobby = liveLobby();
    const res = brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p0', { killerUserId: 'p1' });
    expect(res.lobby.players.find((p) => p.userId === 'p1').kills).toBe(1);
    expect(res.lobby.players.find((p) => p.userId === 'p0').killedBy).toBe('p1');
  });

  it('refuse de crediter des kills a un joueur absent', () => {
    const lobby = liveLobby();
    lobby.players[1].absent = true;
    lobby.players[1].alive = false;
    expect(() => brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p0', { killerUserId: 'p1' }))
      .toThrow(/absent/);
  });

  it('refuse de crediter des kills a un joueur deja elimine', () => {
    let lobby = liveLobby();
    lobby = brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p1').lobby;
    expect(() => brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p0', { killerUserId: 'p1' }))
      .toThrow(/elimine ne peut pas eliminer/);
  });

  it('refuse une double elimination', () => {
    let lobby = liveLobby();
    lobby = brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p0').lobby;
    expect(() => brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p0'))
      .toThrow(/deja elimine/);
  });

  it('refuse d\'eliminer le dernier survivant', () => {
    let lobby = liveLobby();
    for (const id of ['p0', 'p1', 'p2', 'p3']) {
      lobby = brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, id).lobby;
    }
    expect(() => brEngine.eliminateBrPlayerOnServer([lobby], admin, lobby.id, 'p4'))
      .toThrow(/terminee/);
  });
});

describe('br-engine - computeBrRanking (3 variantes)', () => {
  const lobbyWith = (rankingMode, players) => ({
    ...createLobby({ rankingMode }),
    players,
    teams: [],
  });

  it('survie seule : 1er = le plus survivant, les kills ne comptent pas', () => {
    const lobby = lobbyWith('survie', [
      { userId: 'a', pseudo: 'A', placement: 3, kills: 50, absent: false },
      { userId: 'b', pseudo: 'B', placement: 1, kills: 0, absent: false },
      { userId: 'c', pseudo: 'C', placement: 2, kills: 10, absent: false },
    ]);
    const ranking = brEngine.computeBrRanking(lobby);
    // b survit le plus longtemps (1er) malgre 0 kill : il passe devant.
    expect(ranking.map((p) => p.userId)).toEqual(['b', 'c', 'a']);
  });

  it('kills uniquement : classe par kills, la survie ne sert qu\'a departager', () => {
    const lobby = lobbyWith('kills', [
      { userId: 'a', pseudo: 'A', placement: 3, kills: 5, absent: false },
      { userId: 'b', pseudo: 'B', placement: 1, kills: 5, absent: false },
      { userId: 'c', pseudo: 'C', placement: 2, kills: 9, absent: false },
    ]);
    const ranking = brEngine.computeBrRanking(lobby);
    expect(ranking[0].userId).toBe('c');
    // 5 kills chacun : le plus survivant passe devant.
    expect(ranking[1].userId).toBe('b');
    expect(ranking[2].userId).toBe('a');
  });

  it('survie + kills : un score pondere 70/30', () => {
    const lobby = lobbyWith('survie_kills', [
      { userId: 'a', pseudo: 'A', placement: 1, kills: 0, absent: false },
      { userId: 'b', pseudo: 'B', placement: 3, kills: 10, absent: false },
    ]);
    const ranking = brEngine.computeBrRanking(lobby);
    // A : survie 1 * 0.7 = 0.7. B : survie 1/3*0.7 + kills 1*0.3 = 0.533.
    expect(ranking[0].userId).toBe('a');
    expect(ranking[1].score).toBeLessThan(ranking[0].score);
  });

  it('exclut les absents du classement', () => {
    const lobby = lobbyWith('survie', [
      { userId: 'a', pseudo: 'A', placement: 1, kills: 1, absent: false },
      { userId: 'absent', pseudo: 'X', placement: null, kills: 99, absent: true },
    ]);
    const ranking = brEngine.computeBrRanking(lobby);
    expect(ranking).toHaveLength(1);
    expect(ranking[0].userId).toBe('a');
  });
});

describe('br-engine - computeBrPayouts (argent)', () => {
  const finishedLobby = (pot, players, payout = defaultPayout) => ({
    ...createLobby({ payout }),
    status: 'finished',
    pot,
    players,
    teams: [],
  });

  const tenPlayers = (placements, kills) => placements.map((placement, i) => ({
    userId: `p${i}`, pseudo: `P${i}`, placement, kills: kills[i], absent: false, alive: false,
  }));

  it('repartit 100% de la cagnotte au centime pres', () => {
    // Pot qui ne tombe pas juste : 333.33
    const lobby = finishedLobby(333.33, tenPlayers([1, 2, 3, 4, 5, 6, 7], [9, 8, 7, 6, 5, 4, 3]));
    const { payouts, arbiter, winnersPool } = brEngine.computeBrPayouts(lobby);

    const total = payouts.reduce((sum, p) => sum + p.amount, 0) + arbiter.amount;
    expect(total).toBeCloseTo(333.33, 2);

    // 3% pour l'arbitre, 97% pour les 5 premiers.
    expect(arbiter.amount).toBe(10);            // 333.33 * 0.03 = 10.00
    expect(winnersPool).toBe(323.33);
    expect(payouts).toHaveLength(5);
    expect(payouts[0].placement).toBe(1);
    expect(payouts[4].placement).toBe(5);
  });

  it('ne verse rien au-dela du top 5', () => {
    const lobby = finishedLobby(1000, tenPlayers([1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]));
    const { payouts } = brEngine.computeBrPayouts(lobby);
    expect(payouts).toHaveLength(5);
    expect(payouts.find((p) => p.userId === 'p5')).toBeUndefined();
  });

  it('donne plus au 1er qu\'au 5e', () => {
    const lobby = finishedLobby(1000, tenPlayers([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1]));
    const { payouts } = brEngine.computeBrPayouts(lobby);
    for (let i = 1; i < payouts.length; i++) {
      expect(payouts[i - 1].amount).toBeGreaterThan(payouts[i].amount);
    }
  });

  it('verse la commission arbitre en plus des gains', () => {
    const lobby = finishedLobby(2000, tenPlayers([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1]));
    const { arbiter } = brEngine.computeBrPayouts(lobby);
    expect(arbiter.amount).toBe(60); // 2000 * 3%
  });

  it('respecte un arbitre a 5% (plafond)', () => {
    const payout = { first: 0.4, second: 0.22, third: 0.15, fourth: 0.1, fifth: 0.08, arbiterRate: 0.05 };
    const lobby = finishedLobby(1000, tenPlayers([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1]), payout);
    const { arbiter, winnersPool } = brEngine.computeBrPayouts(lobby);
    expect(arbiter.amount).toBe(50);
    expect(winnersPool).toBe(950);
  });

  it('gere une cagnotte avec moins de 5 joueurs', () => {
    const lobby = finishedLobby(300, tenPlayers([1, 2, 3], [3, 2, 1]));
    const { payouts } = brEngine.computeBrPayouts(lobby);
    expect(payouts).toHaveLength(3);
    const total = payouts.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBeCloseTo(291, 2); // 300 - 9 (arbitre)
  });

  it('paye le classement kills meme si la survie est inverse', () => {
    // Le joueur le plus survivant n'a 0 kill : en mode kills il ne gagne rien.
    const lobby = finishedLobby(1000, [
      { userId: 'survivant', pseudo: 'S', placement: 1, kills: 0, absent: false },
      { userId: 'slasher', pseudo: 'X', placement: 6, kills: 12, absent: false },
      { userId: 'p2', pseudo: 'B', placement: 2, kills: 1, absent: false },
      { userId: 'p3', pseudo: 'C', placement: 3, kills: 1, absent: false },
      { userId: 'p4', pseudo: 'D', placement: 4, kills: 1, absent: false },
      { userId: 'p5', pseudo: 'E', placement: 5, kills: 1, absent: false },
    ].map((p, i) => ({ ...p, teamId: `T${i}`, alive: false })), { ...defaultPayout });
    lobby.rankingMode = 'kills';
    const { payouts } = brEngine.computeBrPayouts(lobby);
    expect(payouts[0].userId).toBe('slasher');
  });
});

describe('br-engine - settleBrLobbyOnServer (reglement)', () => {
  /** Salon pret a etre regle : 7 joueurs, tous presents, pot bloque. */
  const liveLobby = (overrides = {}) => {
    // `createLobby` refuse une date passee (fenetre 24-48h) : on cree un salon
    // valide puis on force `scheduledAt` dans le passe pour etre en `live`.
    const lobby = { ...createLobby(), scheduledAt: new Date(Date.now() - 3600_000).toISOString() };
    return {
      ...lobby,
      status: 'live',
      pot: 350,
      payout: defaultPayout,
      ...overrides,
      players: Array.from({ length: 7 }, (_, i) => ({
        userId: `p${i}`, pseudo: `P${i}`, teamId: `T${i}`,
        joinedAt: lobby.createdAt, checkedIn: true, alive: i < 4,
        placement: i < 4 ? [4, 5, 6, 7][i] : null,
        kills: i, absent: false, settled: false, winnings: 0,
      })),
      teams: [],
    };
  };

  /** Les réservations wallet doivent etre indexees par l'ID DU SALON teste. */
  const mockLockedEntry = (lobbyId, amount = 50) => {
    getUserById.mockImplementation(() => ({ wallet: { lockedEntries: { [lobbyId]: { amount } } } }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verse les gains du top 5 et consomme le pass des autres', async () => {
    const lobby = liveLobby();
    mockLockedEntry(lobby.id);
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);

    expect(res.lobby.status).toBe('finished');
    // 3 gains (4 survivants elimines + le vainqueur) sur 7 joueurs : top 5 recus,
    // les 2 derniers elimines recoivent juste la perte de leur pass.
    const winners = res.payouts.length;
    expect(winners).toBe(5);
    expect(releaseWalletWinnings).toHaveBeenCalledTimes(5);
    // Les 2 non-gagnants ont leur pass consomme.
    expect(settleMatchLossWallet).toHaveBeenCalledTimes(2);
  });

  it('couvre le vainqueur meme s\'il n\'a jamais ete elimine', async () => {
    const lobby = liveLobby();
    mockLockedEntry(lobby.id);
    // 4 elimines + 3 encore alive : le reglement doit en choisir un vainqueur.
    lobby.players[4].alive = true;
    lobby.players[5].alive = true;
    lobby.players[6].alive = true;
    lobby.players[4].placement = null;
    lobby.players[5].placement = null;
    lobby.players[6].placement = null;
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    const placements = res.payouts.map((p) => p.placement);
    expect(placements).toContain(1);
    expect(new Set(res.payouts.map((p) => p.userId)).size).toBe(5);
  });

  it('marque le salon en settling AVANT de payer (anti-doublon apres crash)', async () => {
    const lobby = liveLobby();
    mockLockedEntry(lobby.id);
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    expect(res.lobby.status).toBe('finished');

    // Relancer le reglement doit echouer : pas de second versement.
    await expect(
      brEngine.settleBrLobbyOnServer(res.lobbies, admin, lobby.id),
    ).rejects.toThrow(/deja reglee/);
  });

  it('ne paie pas un joueur deja servi (retry partiel)', async () => {
    const lobby = liveLobby();
    mockLockedEntry(lobby.id);
    lobby.players[0].settled = true;
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    // p0 est deja marque : on ne le repaie pas.
    const p0Calls = releaseWalletWinnings.mock.calls.filter((c) => c[0] === 'p0');
    expect(p0Calls).toHaveLength(0);
  });

  it('consomme le pass des absents (penalite, pas remboursement)', async () => {
    const lobby = liveLobby();
    mockLockedEntry(lobby.id);
    lobby.players[6].checkedIn = false;
    lobby.players[6].absent = true;
    lobby.players[6].alive = false;
    lobby.players[6].placement = null;
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);

    const absent = res.lobby.players.find((p) => p.userId === 'p6');
    expect(absent.settled).toBe(true);
    // Son pass est consomme, PAS rembourse.
    const refundCalls = refundLockedEntry.mock.calls.filter((c) => c[0] === 'p6');
    expect(refundCalls).toHaveLength(0);
    const lossCalls = settleMatchLossWallet.mock.calls.filter((c) => c[0] === 'p6');
    expect(lossCalls).toHaveLength(1);
  });

  it('rembourse tout si personne n\'a joue (seul cas de remboursement)', async () => {
    const lobby = liveLobby();
    mockLockedEntry(lobby.id);
    for (const p of lobby.players) { p.absent = true; p.alive = false; }
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    expect(res.lobby.status).toBe('cancelled');
    expect(refundLockedEntry).toHaveBeenCalledTimes(7);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('refuse de regler une partie non lancee', async () => {
    const lobby = { ...liveLobby(), status: 'scheduled' };
    mockLockedEntry(lobby.id);
    await expect(brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id))
      .rejects.toThrow(/n'est pas en cours/);
  });

  it('paye la commission arbitre en plus des gains', async () => {
    // L'arbitre DOIT etre un joueur distinct des concurrents : si on l'ajoute
    // comme joueur encore vivant, il est couramment designe vainqueur et paye
    // comme 1er (135.8 au lieu de la commission de 10.5). On le declare donc
    // comme arbiter du salon, elimine, pour isoler la commission.
    const lobby = liveLobby({ arbiterId: 'arbiter-1' });
    mockLockedEntry(lobby.id);
    lobby.players.push({
      userId: 'arbiter-1', pseudo: 'ARB', teamId: 'T-ARB', joinedAt: lobby.createdAt,
      checkedIn: true, alive: false, placement: 7, kills: 0, absent: false, settled: false, winnings: 0,
    });
    const res = await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);

    expect(res.arbiter.userId).toBe('arbiter-1');
    const arbiterCalls = releaseWalletWinnings.mock.calls.filter((c) => c[0] === 'arbiter-1');
    // Une seule fois, et c'est la commission : 3% de 350 = 10.5.
    expect(arbiterCalls).toHaveLength(1);
    expect(arbiterCalls[0][1]).toBe(10.5);
    expect(arbiterCalls[0][3]).toBe('arbitration_fee');
  });

  it('ne paie PAS de commission si l\'arbitre n\'a pas de pass bloque', async () => {
    const lobby = liveLobby({ arbiterId: 'ghost' });
    // `getUserById` ne renvoie aucune reservation pour l'arbitre fantome.
    getUserById.mockImplementation((id) => (
      id === 'ghost' ? { wallet: { lockedEntries: {} } }
        : { wallet: { lockedEntries: { [lobby.id]: { amount: 50 } } } }
    ));
    lobby.players.push({
      userId: 'ghost', pseudo: 'G', teamId: 'T-G', joinedAt: lobby.createdAt,
      checkedIn: true, alive: false, placement: 7, kills: 0, absent: false, settled: false, winnings: 0,
    });
    await brEngine.settleBrLobbyOnServer([lobby], admin, lobby.id);
    const ghostCalls = releaseWalletWinnings.mock.calls.filter((c) => c[0] === 'ghost');
    expect(ghostCalls).toHaveLength(0);
  });
});
