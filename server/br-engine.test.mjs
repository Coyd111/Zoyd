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
import { lockEntryFee, refundLockedEntry } from './wallet-engine.mjs';

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
