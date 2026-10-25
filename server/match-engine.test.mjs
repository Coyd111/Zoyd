import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('./persistence.mjs', () => ({  // Applique une seule fois par competition : c'est le comportement reel.
  // Sans lui dans le mock, le test echouerait sur un appel a undefined.
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),

  getUserById: vi.fn(),
  updateUserAccount: vi.fn(),
  // openDisputeOnServer sanitize la raison du litige.
  sanitizeText: vi.fn((value) => String(value || '').trim()),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import * as matchEngine from './match-engine.mjs';
import { getUserById } from './persistence.mjs';
import { releaseWalletWinnings } from './wallet-engine.mjs';

describe('match-engine - XP Progression', () => {
  it('should add XP and stay at same level when below threshold', () => {
    const progression = { level: 'BEGINNER', xp: 500, nextLevelXp: 1000 };
    const result = matchEngine.addXpToProgression(progression, 300);
    
    expect(result.xp).toBe(800);
    expect(result.level).toBe('BEGINNER');
    expect(result.nextLevelXp).toBe(1000);
  });

  it('should level up when XP reaches threshold', () => {
    const progression = { level: 'BEGINNER', xp: 900, nextLevelXp: 1000 };
    const result = matchEngine.addXpToProgression(progression, 100);
    
    expect(result.xp).toBe(1000);
    expect(result.level).toBe('COMPETITOR');
    expect(result.nextLevelXp).toBe(3000);
  });

  it('should level up multiple levels if XP jumps thresholds', () => {
    const progression = { level: 'BEGINNER', xp: 500, nextLevelXp: 1000 };
    const result = matchEngine.addXpToProgression(progression, 3000);
    
    expect(result.xp).toBe(3500);
    expect(result.level).toBe('CHALLENGER');
    expect(result.nextLevelXp).toBe(7000);
  });

  it('should handle progression from COMPETITOR to CHALLENGER', () => {
    const progression = { level: 'COMPETITOR', xp: 2500, nextLevelXp: 3000 };
    const result = matchEngine.addXpToProgression(progression, 600);
    
    expect(result.xp).toBe(3100);
    expect(result.level).toBe('CHALLENGER');
    expect(result.nextLevelXp).toBe(7000);
  });

  it('should handle progression from CHALLENGER to ELITE', () => {
    const progression = { level: 'CHALLENGER', xp: 6500, nextLevelXp: 7000 };
    const result = matchEngine.addXpToProgression(progression, 600);
    
    expect(result.xp).toBe(7100);
    expect(result.level).toBe('ELITE');
    expect(result.nextLevelXp).toBe(15000);
  });

  it('should handle progression from ELITE to PRO', () => {
    const progression = { level: 'ELITE', xp: 14000, nextLevelXp: 15000 };
    const result = matchEngine.addXpToProgression(progression, 1000);
    
    expect(result.xp).toBe(15000);
    expect(result.level).toBe('PRO');
    expect(result.nextLevelXp).toBe(Infinity);
  });

  it('should handle undefined progression', () => {
    const result = matchEngine.addXpToProgression(undefined, 500);
    
    expect(result.xp).toBe(500);
    expect(result.level).toBe('BEGINNER');
    expect(result.nextLevelXp).toBe(1000);
  });
});

describe('match-engine - Elo Ranking', () => {
  it('should return Bronze for Elo < 1200', () => {
    expect(matchEngine.getRankFromElo(1100)).toBe('Bronze');
    expect(matchEngine.getRankFromElo(1199)).toBe('Bronze');
  });

  it('should return Silver for Elo 1200-1399', () => {
    expect(matchEngine.getRankFromElo(1200)).toBe('Silver');
    expect(matchEngine.getRankFromElo(1300)).toBe('Silver');
    expect(matchEngine.getRankFromElo(1399)).toBe('Silver');
  });

  it('should return Gold for Elo 1400-1599', () => {
    expect(matchEngine.getRankFromElo(1400)).toBe('Gold');
    expect(matchEngine.getRankFromElo(1500)).toBe('Gold');
    expect(matchEngine.getRankFromElo(1599)).toBe('Gold');
  });

  it('should return Platinum for Elo 1600-1799', () => {
    expect(matchEngine.getRankFromElo(1600)).toBe('Platinum');
    expect(matchEngine.getRankFromElo(1700)).toBe('Platinum');
    expect(matchEngine.getRankFromElo(1799)).toBe('Platinum');
  });

  it('should return Diamond for Elo 1800-1999', () => {
    expect(matchEngine.getRankFromElo(1800)).toBe('Diamond');
    expect(matchEngine.getRankFromElo(1900)).toBe('Diamond');
    expect(matchEngine.getRankFromElo(1999)).toBe('Diamond');
  });

  it('should return Master for Elo >= 2000', () => {
    expect(matchEngine.getRankFromElo(2000)).toBe('Master');
    expect(matchEngine.getRankFromElo(2500)).toBe('Master');
    expect(matchEngine.getRankFromElo(3000)).toBe('Master');
  });
});

describe('match-engine - Helper Functions', () => {
  it('should calculate team size from format', () => {
    expect(matchEngine.getTeamSize('1VS1')).toBe(1);
    expect(matchEngine.getTeamSize('2VS2')).toBe(2);
    expect(matchEngine.getTeamSize('3VS3')).toBe(3);
    expect(matchEngine.getTeamSize('5VS5')).toBe(5);
  });

  it('should get squad label', () => {
    expect(matchEngine.getSquadLabel(0)).toBe('Squad Alpha');
    expect(matchEngine.getSquadLabel(1)).toBe('Squad Bravo');
  });

  it('should get preferred team when both teams have space', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 1 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, null)).toBe(0);
  });

  it('should get preferred team when team 0 is full', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 0 },
        { userId: '3', team: 1 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, null)).toBe(1);
  });

  it('should return null when both teams are full', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 0 },
        { userId: '3', team: 1 },
        { userId: '4', team: 1 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, null)).toBe(null);
  });

  it('should respect preferred team when available', () => {
    const match = {
      players: [
        { userId: '1', team: 0 },
      ],
      teamSize: 2,
    };
    expect(matchEngine.getPreferredTeam(match, 1)).toBe(1);
  });
});

describe('match-engine - Match Status', () => {
  it('should return disputed when open dispute exists', () => {
    const match = {
      status: 'ready',
      disputes: [{ status: 'open', reason: 'test' }],
      players: [],
      maxPlayers: 4,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('disputed');
  });

  it('should return disputed when under_review dispute exists', () => {
    const match = {
      status: 'ready',
      disputes: [{ status: 'under_review', reason: 'test' }],
      players: [],
      maxPlayers: 4,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('disputed');
  });

  it('should return finished when result exists', () => {
    const match = {
      status: 'ready',
      disputes: [],
      result: { winnerTeam: 0 },
      players: [],
      maxPlayers: 4,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('finished');
  });

  it('should return recruiting when not all players present', () => {
    const match = {
      status: 'recruiting',
      disputes: [],
      players: [{ userId: '1' }],
      maxPlayers: 4,
      arbiter: null,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('recruiting');
  });

  it('should return full when all players present but no arbiter', () => {
    const match = {
      status: 'recruiting',
      disputes: [],
      players: [
        { userId: '1', team: 0 },
        { userId: '2', team: 0 },
        { userId: '3', team: 1 },
        { userId: '4', team: 1 },
      ],
      maxPlayers: 4,
      arbiter: null,
      teamSize: 2,
    };
// `awaiting_arbiter`, plus `full`.
      //
      // Ce test affirmait `full` — « lobby complet » — pour un match qui ne
      // pouvait RIEN avancer : sans arbitre, pas de lancement. Le joueur lisait
      // un match complet et ne comprenait pas pourquoi rien ne se passait. Le
      // statut doit nommer la vraie raison, parce que c'est elle que le client
      // peut afficher et que le joueur peut resoudre.
      expect(matchEngine.getStatusFromMatch(match)).toBe('awaiting_arbiter');
    });

  it('should return check_in when not all players checked in', () => {
    const match = {
      status: 'full',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true },
        { userId: '2', team: 0, isCheckedIn: false },
        { userId: '3', team: 1, isCheckedIn: true },
        { userId: '4', team: 1, isCheckedIn: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('check_in');
  });

  it('should return check_in when not all players ready', () => {
    const match = {
      status: 'full',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true, isReady: true },
        { userId: '2', team: 0, isCheckedIn: true, isReady: false },
        { userId: '3', team: 1, isCheckedIn: true, isReady: true },
        { userId: '4', team: 1, isCheckedIn: true, isReady: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('check_in');
  });

  it('should return ready when all checked in and ready', () => {
    const match = {
      status: 'full',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true, isReady: true },
        { userId: '2', team: 0, isCheckedIn: true, isReady: true },
        { userId: '3', team: 1, isCheckedIn: true, isReady: true },
        { userId: '4', team: 1, isCheckedIn: true, isReady: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('ready');
  });

  it('should return in_progress when status is in_progress', () => {
    const match = {
      status: 'in_progress',
      disputes: [],
      players: [
        { userId: '1', team: 0, isCheckedIn: true, isReady: true },
        { userId: '2', team: 0, isCheckedIn: true, isReady: true },
        { userId: '3', team: 1, isCheckedIn: true, isReady: true },
        { userId: '4', team: 1, isCheckedIn: true, isReady: true },
      ],
      maxPlayers: 4,
      arbiter: { userId: 'arb1' },
      teamSize: 2,
    };
    expect(matchEngine.getStatusFromMatch(match)).toBe('in_progress');
  });
});

describe('match-engine - Winner Payout', () => {
  it('should calculate winner payout correctly', () => {
    const match = {
      prizePool: 100,
      zoydFee: 5,
      arbiterFee: 2,
    };
    expect(matchEngine.getWinnerPayout(match)).toBe(93);
  });

  it('should handle zero fees', () => {
    const match = {
      prizePool: 100,
      zoydFee: 0,
      arbiterFee: 0,
    };
    expect(matchEngine.getWinnerPayout(match)).toBe(100);
  });

  it('should handle negative payout (floor at 0)', () => {
    const match = {
      prizePool: 10,
      zoydFee: 8,
      arbiterFee: 5,
    };
    expect(matchEngine.getWinnerPayout(match)).toBe(0);
  });
});

describe('match-engine - getProjectedPayouts (montants affiches)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Chaque joueur inscrit verrouille son entryFee : la projection doit sommer
  // ces verrouillages, pas lire prizePool (maxPlayers * entryFee). Le front
  // affichait `pot * 0.98` et l'admin confirmait un reglement different du verse.
  const lockEveryone = (matchId, entryFee, lock = true) => {
    getUserById.mockImplementation((id) => ({
      wallet: lock ? { lockedEntries: { [matchId]: { amount: entryFee } } } : {},
    }));
  };

  it('should base the projection on locked funds, not on prizePool', () => {
    lockEveryone('M-1', 200);
    const match = {
      id: 'M-1',
      prizePool: 1000,
      players: [{ userId: 'a' }, { userId: 'b' }],
      arbiter: { userId: 'arb' },
    };
    const projection = matchEngine.getProjectedPayouts(match);
    expect(projection.locked).toBe(true);
    // 200 + 200 reels, pas les 1000 theoriques
    expect(projection.basis).toBe(400);
    expect(projection.arbiterFee).toBe(8);
    expect(projection.winner).toBe(392);
  });

  it('should not charge an arbiter fee when there is no arbiter', () => {
    lockEveryone('M-1', 200);
    const match = { id: 'M-1', prizePool: 1000, players: [{ userId: 'a' }, { userId: 'b' }] };
    const projection = matchEngine.getProjectedPayouts(match);
    expect(projection.arbiterFee).toBe(0);
    expect(projection.winner).toBe(400);
  });

  it('should split the winner pot across the players of the winning team', () => {
    // 2v2 : quatre joueurs, deux equipes de deux. L'equipe gagnante compte
    // DEUX joueurs, donc chacun recoit la MOITIE du pot gagneur.
    //
    // L'assertion d'origine (490) divisait par le nombre TOTAL de joueurs :
    // elle figeait le bug. Et le nom du test annoncait deja le bon
    // comportement — « across the players of the winning team » — que
    // l'implementation ne respectait pas.
    lockEveryone('M-1', 500);
    const match = {
      id: 'M-1',
      prizePool: 2000,
      teamSize: 2,
      players: [
        { userId: 'a', team: 0 }, { userId: 'b', team: 0 },
        { userId: 'c', team: 1 }, { userId: 'd', team: 1 },
      ],
      arbiter: { userId: 'arb' },
    };
    const projection = matchEngine.getProjectedPayouts(match);
    expect(projection.basis).toBe(2000);
    expect(projection.arbiterFee).toBe(40);
    expect(projection.winner).toBe(1960);
    // 1960 / 2 gagnants = 980 par joueur — et non 1960 / 4 joueurs.
    expect(projection.perWinner).toBe(980);
  });

  it('la projection annonce ce que le reglement versera REELLEMENT', () => {
    // L'invariant qui manquait, et qui aurait attrape le bug : ce que
    // l'ecran annonce et ce que la poche recoit doivent etre le meme chiffre.
    // Sans ca, l'affichage et le reglement pouvait diverger en silence.
    lockEveryone('M-1', 500);
    const match = {
      id: 'M-1',
      status: 'in_progress',
      format: '2VS2',
      teamSize: 2,
      maxPlayers: 4,
      entryFee: 500,
      prizePool: 2000,
      zoydFee: 0,
      arbiterFee: 40,
      players: [
        { userId: 'a', team: 0 }, { userId: 'b', team: 0 },
        { userId: 'c', team: 1 }, { userId: 'd', team: 1 },
      ],
      disputes: [],
      arbiter: { userId: 'arb' },
    };

    const projection = matchEngine.getProjectedPayouts(match);

    getUserById.mockImplementation((id) => ({
      id,
      pseudo: id,
      role: id === 'arb' ? 'arbiter' : 'player',
      trustScore: 100,
      stats: { elo: 1200, wins: 0, losses: 0 },
      progression: {},
      wallet: { lockedEntries: { 'M-1': { amount: 500 } } },
    }));

    const winners = ['a', 'b'];
    const gagnant = winners.includes('a') ? 0 : 1;
    const matchAvecResultat = {
      ...match,
      result: { winnerTeam: gagnant, scores: { team0: 10, team1: 0 }, payoutDistributed: 'pending' },
      status: 'awaiting_confirmation',
      confirmationDeadline: new Date(Date.now() + 60_000).toISOString(),
    };

    return matchEngine.settlePendingMatchResult([matchAvecResultat], 'M-1').then(() => {
      const versements = releaseWalletWinnings.mock.calls.filter((c) => c[3] === 'prize_win');
      expect(versements.length).toBeGreaterThan(0);
      for (const versement of versements) {
        // Chaque gagnant recoit EXACTEMENT ce que la projection annoncait.
        expect(versement[1]).toBe(projection.perWinner);
      }
    });
  });

  it('should fall back to prizePool when no funds are locked (estimation)', () => {
    lockEveryone('M-1', 0, false);
    const match = { id: 'M-1', prizePool: 1000, players: [{ userId: 'a' }, { userId: 'b' }] };
    const projection = matchEngine.getProjectedPayouts(match);
    expect(projection.locked).toBe(false);
    expect(projection.basis).toBe(1000);
    expect(projection.winner).toBe(1000);
  });
});

describe('match-engine - submitMatchResultOnServer idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // requireActorUser résout l'acteur via getUserById : le rôle vient donc
    // du store serveur, jamais de l'objet passé en paramètre.
    getUserById.mockImplementation((id) => ({
      id,
      pseudo: id,
      role: id === 'root' ? 'admin' : 'player',
      wallet: {},
    }));
  });

  it('should reject if match already has a result', async () => {
    const match = {
      id: 'M-1',
      arbiter: { userId: 'arb-1' },
      status: 'in_progress',
      result: { winnerTeam: 0, submittedAt: '2026-01-01T00:00:00Z' },
      players: [],
      disputes: [],
      prizePool: 100,
    };

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'arb-1' }, 'M-1', {
        winnerTeam: 1,
        scores: { team0: 100, team1: 50 },
      })
    ).rejects.toThrow();
  });

  it('should accept if match has no result', async () => {
    const match = {
      id: 'M-2',
      arbiter: { userId: 'arb-1' },
      status: 'in_progress',
      players: [],
      disputes: [],
      prizePool: 100,
      zoydFee: 5,
      arbiterFee: 2,
      entryFee: 50,
      format: '1VS1',
      teamSize: 1,
    };

    const result = await matchEngine.submitMatchResultOnServer([match], { id: 'root' }, 'M-2', {
      winnerTeam: 0,
      scores: { team0: 100, team1: 50 },
      resolutionType: 'forfeit',
      submittedBy: 'admin-dashboard',
    });

    expect(result.match.result).toBeDefined();
    expect(result.match.status).toBe('forfeited');
  });

  it('should reject a forged admin-dashboard submittedBy from a player (anti-mint)', async () => {
// Match 'recruiting' incomplet : les gardes (lance, roster complet,
      // preuves) doivent s'appliquer MEME si le client envoie submittedBy.
      //
      // p-1 est ici l ARBITRE du match : c est le seul acteur que le nouveau
      // garde laisse passer. Le test doit donc éprouver le garde suivant — le
      // match n est pas lance — et non celui de l arbitre, qui a ses propres
      // tests.
      const match = {
        id: 'M-FORGE',
        status: 'recruiting',
        isInstant: true,
        players: [{ userId: 'p-1', team: 0 }],
        arbiter: { userId: 'p-1', pseudo: 'p-1' },
        disputes: [],
        prizePool: 100,
        zoydFee: 5,
        entryFee: 50,
        format: '1VS1',
        teamSize: 1,
        maxPlayers: 2,
      };

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'p-1' }, 'M-FORGE', {
        winnerTeam: 0,
        scores: { team0: 1, team1: 0 },
        submittedBy: 'admin-dashboard',
      })
    ).rejects.toThrow(/lance avant de valider/i);

    // Le role admin RÉEL débloque bien l'override (command center).
    const ok = await matchEngine.submitMatchResultOnServer([match], { id: 'root' }, 'M-FORGE', {
      winnerTeam: 0,
      scores: { team0: 1, team1: 0 },
      submittedBy: 'admin-dashboard',
    });
    expect(ok.match.result).toBeDefined();
  });

  it('should split the pot between winners in 2v2 (anti-mint)', async () => {
    // 4 joueurs ayant chacun 100 ZC réellement verrouillés (pot réel = 400)
    const makePlayer = (id) => ({
      id, pseudo: id, role: 'player',
      stats: { elo: 1200, wins: 0, losses: 0 }, trustScore: 100,
      wallet: { lockedEntries: { 'M-2V2': { amount: 100, cashAmount: 100, bonusAmount: 0 } } },
    });
    getUserById.mockImplementation((id) => (id === 'admin-1' ? { ...makePlayer(id), role: 'admin' } : makePlayer(id)));

    const match = {
      id: 'M-2V2',
      arbiter: { userId: 'arb-1' },
      status: 'in_progress',
      players: [
        { userId: 'u1', team: 0 },
        { userId: 'u2', team: 0 },
        { userId: 'u3', team: 1 },
        { userId: 'u4', team: 1 },
      ],
      disputes: [],
      prizePool: 400,
      zoydFee: 0,
      arbiterFee: 8,
      entryFee: 100,
      format: '2VS2',
      teamSize: 2,
      maxPlayers: 4,
    };

    await matchEngine.submitMatchResultOnServer([match], { id: 'admin-1' }, 'M-2V2', {
      winnerTeam: 0,
      scores: { team0: 100, team1: 50 },
      resolutionType: 'forfeit',
      submittedBy: 'admin-dashboard',
    });

    const prizeCalls = releaseWalletWinnings.mock.calls.filter((c) => c[3] === 'prize_win');
    expect(prizeCalls).toHaveLength(2);
    const total = prizeCalls.reduce((sum, c) => sum + c[1], 0);
    // 400 verrouillés ’ 2% sans arbitre payeur = 392 distribués (pas 2— le pot)
    expect(total).toBe(392);
    expect(prizeCalls.map((c) => c[0]).sort()).toEqual(['u1', 'u2']);
  });

  it('should never pay more than the funds actually locked (anti-mint)', async () => {
    // Le joueur createur seul a bloque 200 ZC ; maxPlayers = 2 donc
    // match.prizePool = 400. La cagnotte reelle (200) est la seule payable.
    getUserById.mockImplementation((id) => ({
      id, pseudo: id, role: id === 'admin-1' ? 'admin' : 'player',
      stats: { elo: 1200, wins: 0, losses: 0 }, trustScore: 100,
      wallet: { lockedEntries: { 'M-SOLO': { amount: 200, cashAmount: 200, bonusAmount: 0 } } },
    }));

    const match = {
      id: 'M-SOLO',
      arbiter: { userId: 'arb-1' },
      status: 'in_progress',
      players: [{ userId: 'solo', team: 0 }],
      disputes: [],
      prizePool: 400,
      zoydFee: 0,
      arbiterFee: 8,
      entryFee: 200,
      format: '1VS1',
      teamSize: 1,
      maxPlayers: 2,
    };

    await matchEngine.submitMatchResultOnServer([match], { id: 'admin-1' }, 'M-SOLO', {
      winnerTeam: 0,
      scores: { team0: 10, team1: 0 },
      resolutionType: 'forfeit',
      submittedBy: 'admin-dashboard',
    });

    const prizeCalls = releaseWalletWinnings.mock.calls.filter((c) => c[3] === 'prize_win');
    const paid = prizeCalls.reduce((sum, c) => sum + c[1], 0);
    // 200 reellement verrouilles ’ 2% arbitre = 196 distribues.
    // Avant : 400 (prizePool fantome) ’ 8 = 392 => 192 ZC crees.
    expect(paid).toBe(196);
    expect(paid).toBeLessThanOrEqual(200);
    const arbiterCall = releaseWalletWinnings.mock.calls.find((c) => c[3] === 'arbitration_fee');
    expect(arbiterCall?.[1]).toBe(4);
  });

  it('should reject a result on an incomplete roster (player route)', async () => {
    getUserById.mockReturnValue({
      id: 'arb-1', pseudo: 'Arb', role: 'arbiter',
      stats: { elo: 1200, wins: 0, losses: 0 }, trustScore: 100, wallet: {},
    });
    const match = {
      id: 'M-1V1-EMPTY', arbiter: { userId: 'arb-1' }, status: 'in_progress',
      players: [{ userId: 'solo', team: 0 }], disputes: [],
      prizePool: 400, zoydFee: 0, arbiterFee: 8, entryFee: 200,
      format: '1VS1', teamSize: 1, maxPlayers: 2,
    };

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'arb-1' }, 'M-1V1-EMPTY', {
        winnerTeam: 0,
        scores: { team0: 10, team1: 0 },
        screenshots: ['x'],
      })
    ).rejects.toThrow(/incomplet/);
  });

  it('should reject an invalid winnerTeam', async () => {
    getUserById.mockReturnValue({
      id: 'a', pseudo: 'A', role: 'player',
      stats: { elo: 1200, wins: 0, losses: 0 }, trustScore: 100, wallet: {},
    });
    const match = {
      id: 'M-BAD', arbiter: { userId: 'a' }, status: 'in_progress',
      players: [{ userId: 'a', team: 0 }], disputes: [],
      prizePool: 200, zoydFee: 0, arbiterFee: 4, entryFee: 100,
      format: '1VS1', teamSize: 1, maxPlayers: 1,
    };

    for (const bad of [null, 2, '0', undefined]) {
      await expect(
        matchEngine.submitMatchResultOnServer([match], { id: 'a' }, 'M-BAD', {
          winnerTeam: bad,
          scores: { team0: 1, team1: 0 },
          resolutionType: 'forfeit',
          submittedBy: 'admin-dashboard',
        })
      ).rejects.toThrow(/gagnante invalide/i);
    }
  });

  it('should block settlement while a dispute is open', async () => {
    getUserById.mockReturnValue({
      id: 'a', pseudo: 'A', role: 'player',
      stats: { elo: 1200, wins: 0, losses: 0 }, trustScore: 100, wallet: {},
    });
    const match = {
      id: 'M-DISP', arbiter: { userId: 'a' }, status: 'disputed',
      players: [{ userId: 'a', team: 0 }], disputes: [],
      prizePool: 200, zoydFee: 0, arbiterFee: 4, entryFee: 100,
      format: '1VS1', teamSize: 1, maxPlayers: 1,
    };
    match.disputes = [{ id: 'D1', status: 'open', prizePoolFrozen: true }];

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'a' }, 'M-DISP', {
        winnerTeam: 0,
        scores: { team0: 1, team1: 0 },
        resolutionType: 'forfeit',
        submittedBy: 'admin-dashboard',
      })
    ).rejects.toThrow(/litige/i);
  });
});

describe('match-engine - confirmation obligatoire des deux equipes', () => {
  const mkPlayer = (id, team, locked) => ({
    id, userId: id, pseudo: id, role: 'player', team,
    isReady: true, isCheckedIn: true, isCaptain: false, joinedAt: '2026-01-01T00:00:00Z', trustScore: 50,
    stats: { elo: 1200, wins: 0, losses: 0, draws: 0, totalMatches: 0, totalEarnings: 0, winRate: 0, tournamentsWon: 0, tournamentsPlayed: 0, arbitratedMatches: 0 },
    wallet: { lockedEntries: { 'M-C': { amount: locked, cashAmount: locked, bonusAmount: 0, lockedAt: '2026-01-01T00:00:00Z' } } },
  });

  const makeMatch = (overrides = {}) => ({
    id: 'M-C',
    creatorId: 'a', creatorPseudo: 'A',
    format: '1VS1', teamSize: 1, maxPlayers: 2,
    rules: { mode: 'S&D', map: 'Crossfire', scoreTarget: 7, bestOf: 1 },
    entryFee: 100, prizePool: 200, zoydFee: 4, arbiterFee: 4,
    visibility: 'public', deviceRestriction: 'open', controllerRestriction: 'open',
    status: 'in_progress',
    players: [mkPlayer('a', 0, 100), mkPlayer('b', 1, 100)],
    arbiter: { userId: 'arb' },
    disputes: [],
    isInstant: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const submit = (match) => matchEngine.submitMatchResultOnServer([match], { id: 'arb' }, 'M-C', {
    winnerTeam: 0,
    scores: { team0: 7, team1: 2 },
    proofs: { scoreboard: ['score.png'], finalResult: ['final.png'] },
  }, { deferSettlement: true });

  beforeEach(() => {
    vi.clearAllMocks();
    releaseWalletWinnings.mockResolvedValue({});
    // Le règlement relit le wallet via getUserById : il faut que les
    // verrouillages soient visibles, sinon getLockedPot renvoie 0.
    getUserById.mockImplementation((id) => {
      if (id === 'root') return { ...mkPlayer(id, 0, 0), role: 'admin' };
      if (id === 'arb') return { id, userId: id, pseudo: 'Arbiter', role: 'arbiter', trustScore: 50, wallet: {} };
      return mkPlayer(id, id === 'a' ? 0 : 1, 100);
    });
  });

  it('ne verse RIEN a la soumission et met en attente de confirmation', async () => {
    const { match, needsConfirmation } = await submit(makeMatch());
    expect(needsConfirmation).toBe(true);
    expect(match.status).toBe('awaiting_confirmation');
    expect(match.result.payoutDistributed).toBe('pending');
    expect(match.confirmationDeadline).toBeTruthy();
    expect(match.finishedAt).toBeNull();
    // Point central : aucune sortie d'argent avant confirmation.
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('une seule confirmation ne verse pas, la deuxieme declenche le reglement', async () => {
    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-C');
    expect(first.settled).toBe(false);
    expect(first.match.status).toBe('awaiting_confirmation');
    expect(releaseWalletWinnings).not.toHaveBeenCalled();

    const second = await matchEngine.confirmMatchResultOnServer(first.matches, { id: 'b' }, 'M-C');
    expect(second.settled).toBe(true);
    expect(second.match.status).toBe('finished');
    expect(second.match.result.payoutDistributed).toBe(true);
    expect(second.match.confirmationDeadline).toBeNull();
    // Conservation de la masse : 200 verrouilles = 196 au gagnant + 4 a l'arbitre.
    // L'assertion porte sur les MONTANTS, pas sur le nombre d'appels : deux
    // versements distincts (vainqueur puis commission) sont le comportement correct.
    const payouts = releaseWalletWinnings.mock.calls.map((call) => call[1]);
    expect(payouts).toContain(196);
    expect(payouts).toContain(4);
    expect(payouts.reduce((sum, amount) => sum + amount, 0)).toBe(200);
  });

  it('un tiers ne peut pas confirmer', async () => {
    const submitted = await submit(makeMatch());
    await expect(matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'intruder' }, 'M-C'))
      .rejects.toThrow(/Seuls les joueurs/);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('confirmer deux fois est refuse', async () => {
    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-C');
    await expect(matchEngine.confirmMatchResultOnServer(first.matches, { id: 'a' }, 'M-C'))
      .rejects.toThrow(/deja confirme/);
  });

  it('le perdant peut ouvrir un litige PENDANT la fenetre de confirmation', async () => {
    const submitted = await submit(makeMatch());
    const disputed = matchEngine.openDisputeOnServer(
      submitted.matches, { id: 'b' }, 'M-C',
      { reason: 'Score invente', evidence: ['capture.png'] },
    );
    expect(disputed.match.status).toBe('disputed');
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('litige impossible une fois les gains verses', async () => {
    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-C');
    const done = await matchEngine.confirmMatchResultOnServer(first.matches, { id: 'b' }, 'M-C');
    expect(() => matchEngine.openDisputeOnServer(
      done.matches, { id: 'b' }, 'M-C', { reason: 'trop tard', evidence: ['x.png'] },
    )).toThrow(/clos/);
  });

  it('expiration de la fenetre : verse automatiquement', async () => {
    const submitted = await submit(makeMatch());
    const expired = submitted.matches.map((m) => ({
      ...m,
      confirmationDeadline: new Date(Date.now() - 1000).toISOString(),
    }));
    const outcome = await matchEngine.expireConfirmationsOnServer(expired);
    expect(outcome.settled).toHaveLength(1);
    expect(outcome.settled[0].success).toBe(true);
    expect(outcome.matches[0].status).toBe('finished');
    expect(releaseWalletWinnings).toHaveBeenCalled();
    // Conservation de la masse sur l'expiration aussi.
    expect(releaseWalletWinnings.mock.calls.map((call) => call[1]).reduce((sum, a) => sum + a, 0)).toBe(200);
  });

  it('expiration respecte un litige ouvert (cagnotte gelee)', async () => {
    const submitted = await submit(makeMatch());
    const disputed = matchEngine.openDisputeOnServer(
      submitted.matches, { id: 'b' }, 'M-C', { reason: 'litige', evidence: ['x.png'] },
    );
    const expired = disputed.matches.map((m) => ({
      ...m,
      status: 'awaiting_confirmation',
      confirmationDeadline: new Date(Date.now() - 1000).toISOString(),
    }));
    const outcome = await matchEngine.expireConfirmationsOnServer(expired);
    expect(outcome.settled).toHaveLength(0);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('non expire avant la deadline', async () => {
    const submitted = await submit(makeMatch());
    const outcome = await matchEngine.expireConfirmationsOnServer(submitted.matches);
    expect(outcome.settled).toHaveLength(0);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('un match que le reglement refuse n empoisonne PAS les autres', async () => {
    // Le defaut le plus grave du balayage : une exception dans la boucle
    // sortait de la fonction ET le match fautif levait a nouveau au run
    // suivant. Les matchs situes APRES lui n etaient donc JAMAIS traites.
    //
    // Le match fautif est volontairement EN PREMIER : c'est exactement la
    // position qui bloquait tout le monde.
    const sansArbitre = makeMatch({ id: 'M-SANS-ARB', arbiter: undefined });
    const avecArbitre = makeMatch({ id: 'M-OK' });

    // Un admin PEUT soumettre un resultat sur un match sans arbitre
    // (isAdminOverride court-circuite les gardes de presence et de preuves).
    // C'est le chemin reel qui produit ce match.
    const submittedA = await matchEngine.submitMatchResultOnServer(
      [sansArbitre], { id: 'root' }, 'M-SANS-ARB',
      { winnerTeam: 0, scores: { team0: 7, team1: 2 } },
      { deferSettlement: true },
    );
    const submittedB = await matchEngine.submitMatchResultOnServer(
      [avecArbitre], { id: 'arb' }, 'M-OK',
      { winnerTeam: 0, scores: { team0: 7, team1: 2 }, proofs: { scoreboard: ['s.png'], finalResult: ['f.png'] } },
      { deferSettlement: true },
    );

    const expire = (m) => new Date(Date.now() - 1000).toISOString();
    const lesDeux = [
      { ...submittedA.matches[0], confirmationDeadline: expire() },
      { ...submittedB.matches[0], confirmationDeadline: expire() },
    ];

    const outcome = await matchEngine.expireConfirmationsOnServer(lesDeux);

    // Le match fautif est signale, pas solde.
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].id).toBe('M-SANS-ARB');
    expect(outcome.failed[0].code).toBe('ARBITER_REQUIRED');
    expect(outcome.settled.map((s) => s.id)).not.toContain('M-SANS-ARB');

    // ET SURTOUT : le match sain, place APRES, a bien ete regle.
    // C'est l assertion qui distingue le correctif de l ancien code.
    expect(outcome.settled.map((s) => s.id)).toContain('M-OK');
    expect(outcome.matches[1].status).toBe('finished');
    expect(releaseWalletWinnings).toHaveBeenCalled();
  });

  it('un match sans arbitre reste en attente — il sera REMBOURSE par le balayage', async () => {
    // Le refus n est pas un blocage : sans arbitre, le match ne peut pas etre
    // regle, donc il doit etre REMBOURSE. C est ce que fait
    // `sweepMatchesWithoutArbiter`. Ce test verrouille que l expiration ne
    // verse RIEN au perdant, et laisse le pot au balayage d arbitrage.
    const sansArbitre = makeMatch({ id: 'M-SANS-ARB', arbiter: undefined });
    const submitted = await matchEngine.submitMatchResultOnServer(
      [sansArbitre], { id: 'root' }, 'M-SANS-ARB',
      { winnerTeam: 0, scores: { team0: 7, team1: 2 } },
      { deferSettlement: true },
    );
    const expired = submitted.matches.map((m) => ({
      ...m, confirmationDeadline: new Date(Date.now() - 1000).toISOString(),
    }));

    const outcome = await matchEngine.expireConfirmationsOnServer(expired);

    expect(outcome.settled).toHaveLength(0);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
    // Le match n est pas cloture : il reste visible pour le balayage.
    expect(outcome.matches[0].status).toBe('awaiting_confirmation');
  });

  it('resolveDispute "settle" verse le resultat en attente', async () => {
    const submitted = await submit(makeMatch());
    const outcome = await matchEngine.resolveDisputeOnServer(
      submitted.matches, { id: 'root' }, 'M-C', 'Erreur arbitre corrigee', { action: 'settle' },
    );
    expect(outcome.action).toBe('settle');
    expect(outcome.match.status).toBe('finished');
    expect(releaseWalletWinnings).toHaveBeenCalled();
  });

  it('resolveDispute "refund" rembourse et annule', async () => {
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockResolvedValue({});
    const submitted = await submit(makeMatch());
    const outcome = await matchEngine.resolveDisputeOnServer(
      submitted.matches, { id: 'root' }, 'M-C', 'Annule', { action: 'refund' },
    );
    expect(outcome.match.status).toBe('cancelled');
    expect(refundLockedEntry).toHaveBeenCalledTimes(2);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('resolveDispute refuse un match deja paye', async () => {
    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-C');
    const done = await matchEngine.confirmMatchResultOnServer(first.matches, { id: 'b' }, 'M-C');
    await expect(matchEngine.resolveDisputeOnServer(
      done.matches, { id: 'root' }, 'M-C', 'trop tard', { action: 'refund' },
    )).rejects.toThrow(/deja distribues/);
  });
});

/**
 * A9 (audit-2) - les montants REELLEMENT verses sont ecrits sur le match.
 *
 * Avant le correctif, `applyResultSettlement` calculait
 * `firstWinnerShare` / `sharePerWinner` / `arbiterFee` sans jamais les
 * ecrire : `match.payouts` restait vide, l'export admin publiait une
 * colonne `payouts` vide et une commission figee a la creation, et les
 * profils publics retombaient sur le pot THEORIQUE (`prizePool =
 * maxPlayers * entryFee`) des que les reservations etaient liberees.
 *
 * Convention d'ecriture : UNE SEULE entree par (joueur, type). Le rejeu
 * d'un reglement interrompu repasse le meme calcul, mais le wallet ignore
 * les payes deja servis (cle d'idempotence) : `recordActualPayout` doit
 * garder la premiere valeur - c'est elle qui a fini sur un compte - au
 * lieu d'ecraser l'historique avec la part recalculee d'un pot reduit
 * (les reservations des payes sont liberees entre-deux).
 */
describe('match-engine - match.payouts : montants reels (A9)', () => {
  const mkJoueur = (id, team, locked) => ({
    id, userId: id, pseudo: id, role: 'player', team,
    isReady: true, isCheckedIn: true, isCaptain: false, joinedAt: '2026-01-01T00:00:00Z', trustScore: 50,
    stats: { elo: 1200, wins: 0, losses: 0, draws: 0, totalMatches: 0, totalEarnings: 0, winRate: 0, tournamentsWon: 0, tournamentsPlayed: 0, arbitratedMatches: 0 },
    wallet: { lockedEntries: { 'M-A9': { amount: locked, cashAmount: locked, bonusAmount: 0, lockedAt: '2026-01-01T00:00:00Z' } } },
  });

  const makeMatch = (overrides = {}) => ({
    id: 'M-A9',
    creatorId: 'a', creatorPseudo: 'A',
    format: '1VS1', teamSize: 1, maxPlayers: 2,
    rules: { mode: 'S&D', map: 'Crossfire', scoreTarget: 7, bestOf: 1 },
    entryFee: 100, prizePool: 200, zoydFee: 4, arbiterFee: 4,
    visibility: 'public', deviceRestriction: 'open', controllerRestriction: 'open',
    status: 'in_progress',
    players: [mkJoueur('a', 0, 100), mkJoueur('b', 1, 100)],
    arbiter: { userId: 'arb' },
    disputes: [],
    isInstant: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const submit = (match) => matchEngine.submitMatchResultOnServer([match], { id: 'arb' }, 'M-A9', {
    winnerTeam: 0,
    scores: { team0: 7, team1: 2 },
    proofs: { scoreboard: ['score.png'], finalResult: ['final.png'] },
  }, { deferSettlement: true });

  beforeEach(() => {
    vi.clearAllMocks();
    releaseWalletWinnings.mockResolvedValue({});
    getUserById.mockImplementation((id) => {
      if (id === 'arb') return { id: 'arb', pseudo: 'Arbiter', role: 'arbiter', wallet: {} };
      return mkJoueur(id, id === 'a' ? 0 : 1, 100);
    });
  });

  it('ecrit les parts et la commission reellement verses', async () => {
    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-A9');
    const second = await matchEngine.confirmMatchResultOnServer(first.matches, { id: 'b' }, 'M-A9');

    // 200 verrouilles = 196 au vainqueur + 4 a l'arbitre : l'ecriture
    // documente ce qui a quitte le sequestre, pas ce que la creation avait
    // prevu (`prizePool` 200 theorique ici, mais un `arbiterFee` fige sur
    // un match a roster incomplet dans la realite).
    expect(second.match.payouts).toHaveLength(2);
    const partVictoire = second.match.payouts.find((v) => v.userId === 'a' && v.type === 'prize_win');
    const commission = second.match.payouts.find((v) => v.userId === 'arb' && v.type === 'arbitration_fee');
    expect(partVictoire).toMatchObject({ pseudo: 'a', amount: 196 });
    expect(commission).toMatchObject({ pseudo: 'Arbiter', amount: 4 });
    expect(second.match.payouts.reduce((sum, v) => sum + v.amount, 0)).toBe(200);
    expect(second.match.result.payoutDistributed).toBe(true);
  });

  it('ecriture unique : rejouer le reglement ne duplique ni ne rEECRIT les versements', async () => {
    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-A9');
    const second = await matchEngine.confirmMatchResultOnServer(first.matches, { id: 'b' }, 'M-A9');
    const historique = JSON.parse(JSON.stringify(second.match.payouts));

    // Reproduit l'etat que lit le cron de reprise : un resultat `'pending'`
    // a solder. La re-execution recalcule la meme repartition, mais
    // `recordActualPayout` no-op sur les entrees existantes : les montants
    // notes restent ceux du premier versement abouti.
    second.match.result.payoutDistributed = 'pending';
    const rejoue = await matchEngine.settlePendingMatchResult(second.matches, 'M-A9');
    expect(rejoue.match.payouts).toEqual(historique);
  });

  it('commission en echec : rien n est note, puis la reprise ecrit le versement', async () => {
    // L'arbitre a fait son travail, mais le versement de sa commission
    // echoue (base indisponible) alors que le joueur est paye.
    releaseWalletWinnings.mockImplementation(async (_userId, _amount, _matchId, type) => {
      if (type === 'arbitration_fee') throw new Error('SUPABASE_DOWN');
      return {};
    });

    const submitted = await submit(makeMatch());
    const first = await matchEngine.confirmMatchResultOnServer(submitted.matches, { id: 'a' }, 'M-A9');
    const second = await matchEngine.confirmMatchResultOnServer(first.matches, { id: 'b' }, 'M-A9');

    // Seule la part du joueur est notee : rien n'a quitte la poche de
    // l'arbitre. La creance reste visible dans `pendingArbiterFee` (file
    // A1/A3), mais ne doit PAS polluer l'historique des versements.
    expect(second.match.payouts).toHaveLength(1);
    expect(second.match.payouts[0].type).toBe('prize_win');
    expect(second.match.pendingArbiterFee).toBe(4);

    // La reprise paie la creance : elle entre dans l'historique du match.
    releaseWalletWinnings.mockResolvedValue({});
    const rejoue = await matchEngine.retryPendingArbiterFees(second.matches);
    expect(rejoue.retried).toBe(1);
    const commission = rejoue.matches[0].payouts.find((v) => v.type === 'arbitration_fee');
    expect(commission).toMatchObject({ userId: 'arb', amount: 4 });
    expect(rejoue.matches[0].pendingArbiterFee).toBeUndefined();
  });

  it('la projection annonce ce qui a ete verse des que match.payouts existe', () => {
    // Apres reglement, les reservations sont liberees : sans ce chemin, le
    // calcul retombait sur `prizePool` (pot THEORIQUE) - le profil public
    // d'un match a roster incomplet affichait des gains jamais verses.
    getUserById.mockImplementation(() => ({ wallet: {} }));
    const match = {
      id: 'M-A9',
      prizePool: 2000,
      arbiterFee: 40,
      format: '2VS2', teamSize: 2,
      players: [
        { userId: 'a', team: 0 }, { userId: 'b', team: 0 },
        { userId: 'c', team: 1 }, { userId: 'd', team: 1 },
      ],
      arbiter: { userId: 'arb', pseudo: 'Arbiter' },
      payouts: [
        { userId: 'a', pseudo: 'a', amount: 980, type: 'prize_win', paidAt: '2026-01-01T00:00:00Z' },
        { userId: 'b', pseudo: 'b', amount: 981, type: 'prize_win', paidAt: '2026-01-01T00:00:00Z' },
        { userId: 'arb', pseudo: 'Arbiter', amount: 39, type: 'arbitration_fee', paidAt: '2026-01-01T00:00:00Z' },
      ],
    };

    const projection = matchEngine.getProjectedPayouts(match);
    expect(projection.locked).toBe(false);
    expect(projection.basis).toBe(2000);      // 1961 verses + 39 commission REELLE
    expect(projection.winner).toBe(1961);
    expect(projection.arbiterFee).toBe(39);   // pas la valeur figee 40
    expect(projection.perWinner).toBe(980.5); // moyenne des deux parts reelles
  });
});
