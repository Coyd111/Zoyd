import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./persistence.mjs', () => ({  // Applique une seule fois par competition : c'est le comportement reel.
  // Sans lui dans le mock, le test echouerait sur un appel a undefined.
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),

  getUserById: vi.fn(),
  getUserByExactPseudo: vi.fn(),
  updateUserAccount: vi.fn(),
  // P5 C2 (audit-3) : slot du sanitizeur — le moteur l importe dorenavant
  // (notes de creation + notes de duel). Meme contrat que les autres tests :
  // trim pur, le borneage reste porte par le moteur.
  sanitizeText: vi.fn((value) => String(value || '').trim()),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: async (_id, fn) => fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
  // Copie de la vraie implementation : le contrat de classification fait
  // partie du comportement teste, un stub le rendrait invisible.
  isUnrecoverableRefundError: (error) => error?.code === 'USER_NOT_FOUND' || error?.code === 'USER_DELETED',
}));

import * as tournamentEngine from './tournament-engine.mjs';
import { getUserById, updateUserAccount } from './persistence.mjs';
import {
  lockEntryFee,
  refundLockedEntry,
  releaseWalletWinnings,
  settleMatchLossWallet,
} from './wallet-engine.mjs';

const mockAdmin = { id: 'admin-1', pseudo: 'Admin', role: 'admin', wallet: {} };
const mockPlayer = { id: 'player-1', pseudo: 'ShadowX', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
const mockPlayer2 = { id: 'player-2', pseudo: 'Ghost', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
const mockPlayer3 = { id: 'player-3', pseudo: 'Blaze', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
const mockPlayer4 = { id: 'player-4', pseudo: 'Storm', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };

const makeEntry = (userId, pseudo, seed = 1) => ({
  id: `ENTRY-${seed}`,
  seed,
  squadName: pseudo,
  captainId: userId,
  captainPseudo: pseudo,
  teamSize: 1,
  members: [{ userId, pseudo, isCaptain: true }],
  checkedIn: false,
  joinedAt: new Date().toISOString(),
  wins: 0,
  losses: 0,
});

describe('tournament-engine - normalizeTournamentCollection', () => {
  it('should sort by updatedAt descending', () => {
    const t1 = { id: 'T-1', updatedAt: '2026-01-01T00:00:00Z' };
    const t2 = { id: 'T-2', updatedAt: '2026-01-02T00:00:00Z' };
    const result = tournamentEngine.normalizeTournamentCollection([t1, t2]);
    expect(result[0].id).toBe('T-2');
    expect(result[1].id).toBe('T-1');
  });

  it('should handle empty input', () => {
    expect(tournamentEngine.normalizeTournamentCollection([])).toEqual([]);
    expect(tournamentEngine.normalizeTournamentCollection(null)).toEqual([]);
  });

  it('should normalize entries and matches', () => {
    const result = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-1',
      entries: [{ id: 'E1', seed: 1 }],
      matches: [{ id: 'M1' }],
    }]);
    expect(result[0].entries).toHaveLength(1);
    expect(result[0].matches).toHaveLength(1);
  });
});

describe('tournament-engine - createTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should create tournament', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      format: '1VS1',
      maxEntries: 8,
      entryFee: 100,
    });
    expect(result.tournament).toBeDefined();
    expect(result.tournament.name).toBe('Test Cup');
    expect(result.tournament.status).toBe('recruiting');
    expect(result.tournaments).toHaveLength(1);
  });

  it('should set default rules', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
    });
    expect(result.tournament.rules.scoreTarget).toBe(7);
    expect(result.tournament.rules.bestOf).toBe(1);
    expect(result.tournament.rules.mode).toBe('S&D');
    expect(result.tournament.rules.mapPool).toEqual(['Raid', 'Standoff', 'Crash']);
  });

  // Harmonisation du 02/11/2026 (P1 : MJ_WEAPON_OPTIONS) : le defaut de
  // creation est la premiere classe du referentiel partage avec les
  // matchs, PLUS l'ancienne chaine "Toutes armes selon reglement".
  it('defaut armes = premiere classe du referentiel partage (Toutes permises)', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
    });
    expect(result.tournament.rules.weaponRestrictions).toBe('Toutes permises');
  });

  it('conserve une classe d armes explicite du createur', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { weaponRestrictions: 'Snipers uniquement' },
    });
    expect(result.tournament.rules.weaponRestrictions).toBe('Snipers uniquement');
  });

  // Les valeurs faites avant l'harmonisation restent affichees telles
  // quelles : la normalisation (chargement depot) ne fabrique rien, un
  // champ absent garde le defaut historique.
  it('normalisation : un vieux tournoi sans champ garde le defaut legacy', () => {
    const [legacy] = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-LEGACY',
      name: 'Ancienne coupe',
      format: '1VS1',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      entries: [],
      arbiters: [],
      matches: [],
    }]);
    expect(legacy.rules.weaponRestrictions).toBe('Toutes armes selon reglement');
  });

  // P5 02/11/2026 (audit-4) : alternance des picks BO3+ (voir
  // competition.ts MJ_PICKS_ALTERNANCE_BRACKET). Contrat affiche porte
  // par les rules du tournoi : le moteur stocke tel quel - la garde BO3+
  // est une affaire d'UI (checkbox masquee) et d'affichage (BracketSidebar).
  it('P5 : BO3 + picksAlternate stocke true dans les rules', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { bestOf: 3, picksAlternate: true },
    });
    expect(result.tournament.rules.bestOf).toBe(3);
    expect(result.tournament.rules.picksAlternate).toBe(true);
  });

  it('P5 : BO3 sans champ picksAlternate stocke false', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { bestOf: 3 },
    });
    expect(result.tournament.rules.picksAlternate).toBe(false);
  });

  it('P5 : un vieux tournoi sans champ garde le defaut legacy (false)', () => {
    const [legacy] = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-P5-LEGACY',
      name: 'Ancienne coupe',
      format: '1VS1',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      entries: [],
      arbiters: [],
      matches: [],
    }]);
    expect(legacy.rules.picksAlternate).toBe(false);
  });

  it('P5 : valeur explicite false reste false', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { bestOf: 5, picksAlternate: false },
    });
    expect(result.tournament.rules.picksAlternate).toBe(false);
  });

  it('P5 : un BO1 + picksAlternate true passe sans reinterpretation moteur', () => {
    const created = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { bestOf: 1, picksAlternate: true },
    });
    expect(created.tournament.rules.bestOf).toBe(1);
    expect(created.tournament.rules.picksAlternate).toBe(true);
    // La garde BO3+ n'existe PAS au moteur : ce tournoi ne montrera pas
    // le contrat (affichage BracketSidebar), mais l'enregistrement porte
    // la valeur saisie (aucune regle inventee par le moteur).
  });

  // audit-5 (B-4) : un tournoi cree avec entryFee 0 ou absent (defaut :909)
  // restait CREATABLE mais impossible a INSCRIRE : lockEntryFee rejette un
  // montant nul (INVALID_AMOUNT, wallet-engine.mjs:368-370). Arbitrage
  // audit-5 : un tournoi se paye — la creation exige un tarif strictement
  // positif (l'UI ne propose jamais 0 : ENTRY_OPTIONS 50..1000).
  it('refuse la creation gratuite (entryFee 0 ou absent ou negatif)', () => {
    expect(() => tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup', format: '1VS1', entryFee: 0,
    })).toThrow(/strictement positif/);
    expect(() => tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup', format: '1VS1',
    })).toThrow(/strictement positif/);
    expect(() => tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup', format: '1VS1', entryFee: -5,
    })).toThrow(/strictement positif/);
  });

  it('should reserve creator as arbiter by default', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      maxEntries: 12,
      entryFee: 100,
    });
    const hasArbiter = result.tournament.arbiters.some(
      (s) => s.userId === 'admin-1'
    );
    expect(hasArbiter).toBe(true);
  });

  it('should not reserve creator when explicitly disabled', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      maxEntries: 12,
      entryFee: 100,
      reserveCreatorAsArbiter: false,
    });
    const hasArbiter = result.tournament.arbiters.some(
      (s) => s.userId === 'admin-1'
    );
    expect(hasArbiter).toBe(false);
  });

  it('should reject if user not found', () => {
    getUserById.mockReturnValue(null);
    expect(() =>
      tournamentEngine.createTournamentOnServer([], { id: 'ghost' }, { name: 'Test' })
    ).toThrow();
  });
});

describe('tournament-engine - registerForTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should register player for tournament', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format: '1VS1',
      entries: [],
      arbiters: [],
    }])[0];

    const result = await tournamentEngine.registerForTournamentOnServer(
      [tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' }
    );
    expect(result.tournament.entries).toHaveLength(1);
    expect(result.tournament.entries[0].captainId).toBe('player-1');
    expect(lockEntryFee).toHaveBeenCalled();
  });

  it('should reject if tournament not found', async () => {
    await expect(
      tournamentEngine.registerForTournamentOnServer([], mockPlayer, 'T-NOPE', { pseudo: 'X' })
    ).rejects.toThrow();
  });

  it('should reject if tournament is full', async () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeEntry(`p-${i}`, `P${i}`, i + 1));
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [],
    }])[0];

    await expect(
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' })
    ).rejects.toThrow();
  });

  it('should reject if already registered', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [],
    }])[0];

    await expect(
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' })
    ).rejects.toThrow();
  });

  it('should reject if not recruiting', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      status: 'live',
      entries: [],
      arbiters: [],
    }])[0];

    await expect(
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'X' })
    ).rejects.toThrow();
  });

  it('should reject if player is arbiter', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 50,
      status: 'recruiting',
      format: '1VS1',
      entries: [],
      arbiters: [{ userId: 'player-1', pseudo: 'ShadowX', slot: 1 }],
    }])[0];

    await expect(
      tournamentEngine.registerForTournamentOnServer([tournament], mockPlayer, 'T-TEST', { pseudo: 'ShadowX' })
    ).rejects.toThrow();
  });
});

describe('tournament-engine - leaveTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should remove entry and refund', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [],
    }])[0];

    const result = await tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST');
    expect(result.tournament.entries).toHaveLength(0);
    expect(refundLockedEntry).toHaveBeenCalledWith('player-1', 'T-TEST', expect.any(String));
  });

  it('should reject if not registered', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      status: 'recruiting',
      entries: [],
      arbiters: [],
    }])[0];

    await expect(
      tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).rejects.toThrow();
  });

  it('retrait individuel : un coequipier part et recupere SON propre pass (squad survivante)', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '2VS2',
      entries: [{
        id: 'ENTRY-1',
        captainId: 'other-player',
        captainPseudo: 'Boss',
        members: [
          { userId: 'other-player', pseudo: 'Boss', isCaptain: true },
          { userId: 'player-1', pseudo: 'ShadowX', isCaptain: false },
        ],
        seed: 1,
      }],
      arbiters: [],
    }])[0];

    const result = await tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST');
    // Seul le pass du partant est rembourse - jamais celui du capitaine.
    expect(refundLockedEntry).toHaveBeenCalledWith('player-1', 'T-TEST', expect.any(String));
    expect(refundLockedEntry).toHaveBeenCalledTimes(1);
    const entry = result.tournament.entries[0];
    // La squad survit (1 membre sur 2) : elle sera balayee au lancement si
    // personne ne complete le roster.
    expect(entry.captainId).toBe('other-player');
    expect(entry.members).toHaveLength(1);
    expect(entry.members[0].userId).toBe('other-player');
    expect(entry.members[0].isCaptain).toBe(true);
  });

  it('capitaine departant : le premier membre restant prend le relais (transfer auto)', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '2VS2',
      entries: [{
        id: 'ENTRY-1',
        captainId: 'player-1',
        captainPseudo: 'ShadowX',
        members: [
          { userId: 'player-1', pseudo: 'ShadowX', isCaptain: true },
          { userId: 'player-3', pseudo: 'Blaze', isCaptain: false },
        ],
        seed: 1,
      }],
      arbiters: [],
    }])[0];

    const result = await tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST');
    expect(refundLockedEntry).toHaveBeenCalledWith('player-1', 'T-TEST', expect.any(String));
    const entry = result.tournament.entries[0];
    expect(entry.captainId).toBe('player-3');
    expect(entry.captainPseudo).toBe('Blaze');
    expect(entry.members.map((member) => member.isCaptain)).toEqual([true]);
  });

  it('squad videe : la place est liberee et le tournoi reseede', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1), makeEntry('player-3', 'Blaze', 2)],
      arbiters: [],
    }])[0];

    const result = await tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST');
    expect(result.tournament.entries).toHaveLength(1);
    expect(result.tournament.entries[0].seed).toBe(1);
    expect(result.tournament.entries[0].captainId).toBe('player-3');
  });

  it('should reject if tournament already started', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      status: 'live',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [],
    }])[0];

    await expect(
      tournamentEngine.leaveTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).rejects.toThrow();
  });
});

describe('tournament-engine - startTournamentOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should start tournament and build bracket', async () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
    ];
    const arbiterUser = { id: 'arbiter-1', pseudo: 'Ref', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
    getUserById.mockReturnValue(arbiterUser);
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'arbiter-1', pseudo: 'Ref', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    const result = await tournamentEngine.startTournamentOnServer([tournament], arbiterUser, 'T-TEST');
    expect(result.tournament.status).toBe('live');
    expect(result.tournament.matches.length).toBeGreaterThan(0);
  });

  it('should reject if not enough entries', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('p1', 'P1', 1)],
      arbiters: [{ userId: 'arbiter-1', pseudo: 'Ref', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    await expect(
      tournamentEngine.startTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).rejects.toThrow();
  });

  it('should reject if arbiters not assigned', async () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
    ];
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: null, slot: 1 }],
    }])[0];

    await expect(
      tournamentEngine.startTournamentOnServer([tournament], mockPlayer, 'T-TEST')
    ).rejects.toThrow();
  });
});

describe('tournament-engine - assignTournamentArbiterOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  it('should assign arbiter to empty slot', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      arbiters: [{ userId: null, slot: 1 }],
    }])[0];

    const result = tournamentEngine.assignTournamentArbiterOnServer([tournament], mockPlayer, 'T-TEST');
    expect(result.tournament.arbiters[0].userId).toBe('player-1');
  });

  it('should reject if player is already registered as entry', () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries: [makeEntry('player-1', 'ShadowX', 1)],
      arbiters: [{ userId: null, slot: 1 }],
    }])[0];

    expect(() =>
      tournamentEngine.assignTournamentArbiterOnServer([tournament], mockPlayer, 'T-TEST')
    ).toThrow();
  });
});

describe('tournament-engine - submitTournamentMatchResultOnServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('should record match result and advance winner', async () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
    ];
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      status: 'live',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString(), matchesHandled: 0 }],
      matches: [
        {
          id: 'TM-1',
          bracketType: 'main',
          round: 0,
          position: 0,
          entryAId: 'ENTRY-P1-1',
          entryBId: 'ENTRY-P2-2',
          status: 'ready',
          roomName: 'room1',
          roomPassword: 'pass1',
          arbiterSlot: 1,
        },
      ],
    }])[0];

    const matchId = tournament.matches[0].id;
    const result = await tournamentEngine.submitTournamentMatchResultOnServer(
      [tournament], mockAdmin, 'T-TEST', matchId,
      { winnerEntryId: 'ENTRY-P1-1', scoreA: 7, scoreB: 3 }
    );
    const match = result.tournament.matches.find((m) => m.id === matchId);
    expect(match.status).toBe('finished');
    expect(match.winnerEntryId).toBe('ENTRY-P1-1');
  });
});

describe('tournament-engine - pure helpers', () => {
  it('should build correct bracket for 4 entries (2 rounds)', async () => {
    const entries = [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
    ];
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 4,
      minEntries: 4,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    const result = await tournamentEngine.startTournamentOnServer([tournament], mockAdmin, 'T-TEST');
    expect(result.tournament.mainRounds).toBe(2);
    expect(result.tournament.matches.filter((m) => m.bracketType === 'main')).toHaveLength(3);
  });

  it('should build correct bracket for 8 entries (3 rounds)', async () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeEntry(`p${i}`, `P${i}`, i + 1));
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-TEST',
      maxEntries: 8,
      minEntries: 8,
      status: 'recruiting',
      format: '1VS1',
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

    const result = await tournamentEngine.startTournamentOnServer([tournament], mockAdmin, 'T-TEST');
    expect(result.tournament.mainRounds).toBe(3);
    expect(result.tournament.matches.filter((m) => m.bracketType === 'main')).toHaveLength(7);
  });
});

describe('tournament-engine - annulation et remboursement des passes', () => {
  const makeTournament = () => ({
    id: 'T-STALE',
    name: 'Open Benin',
    format: '1VS1',
    teamSize: 1,
    entryFee: 100,
    status: 'recruiting',
    entries: [makeEntry('player-1', 'ShadowX', 1), makeEntry('player-2', 'Ghost', 2)],
    arbiters: [],
    arbitersNeeded: 1,
    matches: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('rembourse tous les participants quand tout reussit', async () => {
    refundLockedEntry.mockResolvedValue({ cashBalance: 100 });
    const result = await tournamentEngine.cancelStaleTournamentOnServer([makeTournament()], 'T-STALE');
    expect(refundLockedEntry).toHaveBeenCalledTimes(2);
    expect(result.refunded).toBe(2);
    expect(result.tournament.entries).toHaveLength(0);
    expect(result.tournament.pendingRefunds).toEqual([]);
  });

  it('conserve la dette et la rejoue quand un refund echoue', async () => {
    // Le bug historique : l'erreur etait loguee puis `entries = []`
    // detruisait la preuve => entryFee bloques a jamais.
    // Erreur TRANSITORE : c'est celle-la qui doit etre rejouee.
    const transient = Object.assign(new Error('Base indisponible'), { code: 'SUPABASE_DOWN' });
    refundLockedEntry
      .mockResolvedValueOnce({ cashBalance: 100 })
      .mockRejectedValueOnce(transient);

    const cancelled = await tournamentEngine.cancelStaleTournamentOnServer([makeTournament()], 'T-STALE');
    expect(cancelled.refunded).toBe(1);
    expect(cancelled.pendingRefunds).toBe(1);
    expect(cancelled.tournament.entries.map((e) => e.captainId)).toEqual(['player-2']);
    expect(cancelled.tournament.pendingRefunds[0].userId).toBe('player-2');

    // Le retry rejoue le refund rate.
    refundLockedEntry.mockResolvedValue({ cashBalance: 100 });
    const retried = await tournamentEngine.retryPendingTournamentRefunds([cancelled.tournament]);
    expect(retried.retried).toBe(1);
    expect(retried.remaining).toBe(0);
    expect(retried.tournaments[0].pendingRefunds).toEqual([]);
    expect(retried.tournaments[0].entries).toHaveLength(0);
  });

  it('clot la dette sans la rejouer quand le compte a ete supprime', async () => {
    // `USER_NOT_FOUND` ne se resoudra jamais : il n'y a plus de portefeuille a
    // crediter. Le garder en `pendingRefunds` le rejouait toutes les 6 h,
    // pour toujours, et noyait les echecs recuperables sous une boucle de WARN
    // identiques — ceux-la seuls meritent une alerte.
    const deleted = Object.assign(new Error('Compte joueur introuvable'), { code: 'USER_NOT_FOUND' });
    refundLockedEntry
      .mockResolvedValueOnce({ cashBalance: 100 })
      .mockRejectedValueOnce(deleted);

    const cancelled = await tournamentEngine.cancelStaleTournamentOnServer([makeTournament()], 'T-STALE');
    expect(cancelled.refunded).toBe(1);
    expect(cancelled.pendingRefunds).toBe(0);
    expect(cancelled.uncollectableRefunds).toBe(1);
    // Trace conservee : la dette est close, pas oubliee (cle PAR MEMBRE).
    expect(cancelled.tournament.uncollectableRefunds[0].userId).toBe('player-2');
    expect(cancelled.tournament.uncollectableRefunds[0].reason).toBe('ACCOUNT_DELETED');

    // Un second passage ne doit plus rien rejouer : c'est tout l'objet.
    refundLockedEntry.mockClear();
    const retried = await tournamentEngine.retryPendingTournamentRefunds([cancelled.tournament]);
    expect(refundLockedEntry).not.toHaveBeenCalled();
    expect(retried.retried).toBe(0);
    expect(retried.remaining).toBe(0);
    expect(retried.abandoned).toBe(0);
  });

  it('clot une dette deja en attente quand le compte disparait entre-temps', async () => {
    // Cas observe en production : le joueur etait present a l'annulation, puis
    // a supprime son compte avant la reprise 6 h plus tard.
    const deleted = Object.assign(new Error('Compte joueur introuvable'), { code: 'USER_NOT_FOUND' });
    refundLockedEntry.mockRejectedValue(deleted);

    const cancelled = await tournamentEngine.cancelStaleTournamentOnServer([makeTournament()], 'T-STALE');
    expect(cancelled.pendingRefunds).toBe(0);

    // Depart propre : une dette enregistree pour une erreur TRANSITORE, dont
    // le joueur a disparu depuis. La reprise doit la cloturer sans boucle.
    const makePending = () => tournamentEngine.normalizeTournamentCollection([{
      ...makeTournament(),
      status: 'cancelled',
      cancelReason: 'Annule : pas assez d\'inscriptions',
      pendingRefunds: [
        { captainId: 'player-1', entryId: 'ENTRY-1', lastError: 'Base indisponible' },
        { captainId: 'player-2', entryId: 'ENTRY-2', lastError: 'Base indisponible' },
      ],
    }]);
    const fresh = makePending();
    expect(fresh[0].pendingRefunds).toHaveLength(2);
    expect(tournamentEngine.countUncollectableTournamentRefunds([fresh])).toBe(0);

    refundLockedEntry.mockImplementation(async (captainId) => {
      if (captainId === 'player-2') throw Object.assign(new Error('Compte joueur introuvable'), { code: 'USER_NOT_FOUND' });
      return { cashBalance: 100 };
    });
    const retried = await tournamentEngine.retryPendingTournamentRefunds(fresh);
    expect(retried.retried).toBe(1);
    expect(retried.remaining).toBe(0);
    expect(retried.abandoned).toBe(1);
    expect(retried.tournaments[0].uncollectableRefunds).toHaveLength(1);
    expect(retried.tournaments[0].uncollectableRefunds[0].userId).toBe('player-2');
    expect(tournamentEngine.countUncollectableTournamentRefunds(retried.tournaments)).toBe(1);

    // Un troisieme passage ne refait rien : c'est tout l'objet de la correction.
    refundLockedEntry.mockClear();
    const again = await tournamentEngine.retryPendingTournamentRefunds(retried.tournaments);
    expect(refundLockedEntry).not.toHaveBeenCalled();
    expect(again.remaining).toBe(0);
    expect(again.abandoned).toBe(0);
  });

  it('garde la dette si le retry echoue encore', async () => {
    const stillDown = Object.assign(new Error('toujours indisponible'), { code: 'SUPABASE_DOWN' });
    refundLockedEntry.mockRejectedValue(stillDown);
    const cancelled = await tournamentEngine.cancelStaleTournamentOnServer([makeTournament()], 'T-STALE');
    expect(cancelled.pendingRefunds).toBe(2);

    const retried = await tournamentEngine.retryPendingTournamentRefunds([cancelled.tournament]);
    expect(retried.retried).toBe(0);
    expect(retried.remaining).toBe(2);
    expect(tournamentEngine.countPendingTournamentRefunds(retried.tournaments)).toBe(2);
  });

  it('preserve pendingRefunds apres normalisation (redemarrage)', () => {
    const normalized = tournamentEngine.normalizeTournamentCollection([{
      ...makeTournament(),
      status: 'cancelled',
      pendingRefunds: [{ captainId: 'player-2', entryId: 'ENTRY-2', lastError: 'X' }],
    }]);
    expect(normalized[0].pendingRefunds).toHaveLength(1);
    expect(normalized[0].pendingRefunds[0].captainId).toBe('player-2');
  });
});

describe('tournament-engine - squads libres : creation OUVERTE ou PRIVEE (2026-11-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockPlayer);
  });

  const makeTeamTournament = (entries = [], format = '2VS2') =>
    tournamentEngine.normalizeTournamentCollection([{
      id: 'T-SQUAD',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format,
      entries,
      arbiters: [],
    }])[0];

  it('le capitaine pose SEUL SON pass : reglement individuel, jamais x teamSize', async () => {
    lockEntryFee.mockResolvedValue({});
    const tournament = makeTeamTournament();
    const result = await tournamentEngine.registerForTournamentOnServer(
      [tournament], mockPlayer, 'T-SQUAD', { pseudo: 'ShadowX', squadName: 'Alpha' }
    );
    // LE contrat : entryFee, PAS entryFee x teamSize.
    expect(lockEntryFee).toHaveBeenCalledWith('player-1', 100, 'T-SQUAD');
    expect(result.tournament.entries).toHaveLength(1);
    const entry = result.tournament.entries[0];
    // La squad nait incomplete : 1 membre sur 2, ouverte par defaut.
    expect(entry.members).toHaveLength(1);
    expect(entry.members[0].isCaptain).toBe(true);
    expect(entry.access).toBe('open');
    expect(entry.invitedPseudos).toEqual([]);
  });

  it('squad PRIVEE : une liste d invites est acceptee et stockee', async () => {
    lockEntryFee.mockResolvedValue({});
    const tournament = makeTeamTournament();
    const result = await tournamentEngine.registerForTournamentOnServer(
      [tournament], mockPlayer, 'T-SQUAD', { pseudo: 'ShadowX', squadName: 'Alpha', access: 'private', invitedPseudos: ['Ghost'] }
    );
    expect(result.tournament.entries[0].access).toBe('private');
    expect(result.tournament.entries[0].invitedPseudos).toEqual(['Ghost']);
  });

  it('squad ouverte avec une liste d invites : refuse (nonsens)', async () => {
    const tournament = makeTeamTournament();
    await expect(
      tournamentEngine.registerForTournamentOnServer(
        [tournament], mockPlayer, 'T-SQUAD',
        { pseudo: 'ShadowX', squadName: 'Alpha', invitedPseudos: ['Ghost'] }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
  });

  it('invite de la squad privee = le capitaine lui-meme : refuse', async () => {
    const tournament = makeTeamTournament();
    await expect(
      tournamentEngine.registerForTournamentOnServer(
        [tournament], mockPlayer, 'T-SQUAD',
        { pseudo: 'ShadowX', squadName: 'Alpha', access: 'private', invitedPseudos: ['ShadowX'] }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
  });

  it('squad PRIVEE sans AUCUN pseudo invite : refuse (place verrouillee pour personne)', async () => {
    const tournament = makeTeamTournament();
    await expect(
      tournamentEngine.registerForTournamentOnServer(
        [tournament], mockPlayer, 'T-SQUAD',
        { pseudo: 'ShadowX', squadName: 'Alpha', access: 'private' }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
  });

  it('pseudo invite duplique dans la liste : refuse', async () => {
    const tournament = makeTeamTournament();
    await expect(
      tournamentEngine.registerForTournamentOnServer(
        [tournament], mockPlayer, 'T-SQUAD',
        { pseudo: 'ShadowX', squadName: 'Alpha', access: 'private', invitedPseudos: ['Ghost', 'Ghost'] }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION' });
  });
});

describe('tournament-engine - squads libres : joinTournamentOnServer (2026-11-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resolution PAR ID : requireActorUser repart de getUserById(actor.id),
    // un mockReturnValue unique ferait de TOUT appelant le joueur player-1
    // (donc ALREADY_JOINED sur chaque join).
    getUserById.mockImplementation((id) => ({
      'player-1': mockPlayer,
      'player-2': mockPlayer2,
      'player-3': mockPlayer3,
    }[id] || null));
  });

  const makeTeamTournament = (entries = []) =>
    tournamentEngine.normalizeTournamentCollection([{
      id: 'T-SQUAD',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format: '2VS2',
      entries,
      arbiters: [],
    }])[0];

  const makeSquadEntry = (captainId, captainPseudo, seed = 1, extra = {}) => ({
    id: `ENTRY-${seed}`,
    seed,
    squadName: `Squad-${seed}`,
    captainId,
    captainPseudo,
    teamSize: 2,
    members: [{ userId: captainId, pseudo: captainPseudo, isCaptain: true }],
    checkedIn: false,
    joinedAt: new Date().toISOString(),
    wins: 0,
    losses: 0,
    ...extra,
  });

  it('rejoindre une squad OUVERTE verrouille SON PROPRE pass (fee, pas x teamSize)', async () => {
    lockEntryFee.mockResolvedValue({});
    const tournament = makeTeamTournament([makeSquadEntry('player-1', 'ShadowX')]);
    const result = await tournamentEngine.joinTournamentOnServer([tournament], mockPlayer2, 'T-SQUAD', 'ENTRY-1');
    expect(lockEntryFee).toHaveBeenCalledWith('player-2', 100, 'T-SQUAD');
    const entry = result.tournament.entries[0];
    expect(entry.members).toHaveLength(2);
    expect(entry.members[1]).toMatchObject({ userId: 'player-2', pseudo: 'Ghost', isCaptain: false });
  });

  it('squad deja complete : refuse (SQUAD_FULL)', async () => {
    const tournament = makeTeamTournament([{
      ...makeSquadEntry('player-1', 'ShadowX'),
      members: [
        { userId: 'player-1', pseudo: 'ShadowX', isCaptain: true },
        { userId: 'player-3', pseudo: 'Blaze', isCaptain: false },
      ],
    }]);
    await expect(
      tournamentEngine.joinTournamentOnServer([tournament], mockPlayer2, 'T-SQUAD', 'ENTRY-1')
    ).rejects.toMatchObject({ code: 'SQUAD_FULL' });
  });

  it('squad PRIVEE sans invitation : refuse (FORBIDDEN)', async () => {
    const tournament = makeTeamTournament([
      makeSquadEntry('player-1', 'ShadowX', 1, { access: 'private', invitedPseudos: ['Blaze'] }),
    ]);
    await expect(
      tournamentEngine.joinTournamentOnServer([tournament], mockPlayer2, 'T-SQUAD', 'ENTRY-1')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('squad PRIVEE, pseudo invite : accepte', async () => {
    lockEntryFee.mockResolvedValue({});
    const tournament = makeTeamTournament([
      makeSquadEntry('player-1', 'ShadowX', 1, { access: 'private', invitedPseudos: ['Ghost'] }),
    ]);
    const result = await tournamentEngine.joinTournamentOnServer([tournament], mockPlayer2, 'T-SQUAD', 'ENTRY-1');
    expect(result.tournament.entries[0].members).toHaveLength(2);
  });

  it('deja inscrit dans une autre squad : refuse (ALREADY_JOINED)', async () => {
    lockEntryFee.mockResolvedValue({});
    const tournament = makeTeamTournament([
      makeSquadEntry('player-3', 'Blaze', 1),
      makeSquadEntry('player-1', 'ShadowX', 2),
    ]);
    await expect(
      tournamentEngine.joinTournamentOnServer([tournament], mockPlayer3, 'T-SQUAD', 'ENTRY-2')
    ).rejects.toMatchObject({ code: 'ALREADY_JOINED' });
    // Aucun debit prive : le garde value AVANT tout verrouillage.
    expect(lockEntryFee).not.toHaveBeenCalled();
  });

  it('arbitre du tournoi : refuse (ROLE_CONFLICT)', async () => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-SQUAD',
      maxEntries: 8,
      entryFee: 100,
      status: 'recruiting',
      format: '2VS2',
      entries: [makeSquadEntry('player-1', 'ShadowX', 1)],
      arbiters: [{ userId: 'player-2', pseudo: 'Ghost', slot: 1 }],
    }])[0];
    await expect(
      tournamentEngine.joinTournamentOnServer([tournament], mockPlayer2, 'T-SQUAD', 'ENTRY-1')
    ).rejects.toMatchObject({ code: 'ROLE_CONFLICT' });
  });

  it('squad inconnue : refuse (SQUAD_NOT_FOUND)', async () => {
    const tournament = makeTeamTournament([makeSquadEntry('player-1', 'ShadowX')]);
    await expect(
      tournamentEngine.joinTournamentOnServer([tournament], mockPlayer2, 'T-SQUAD', 'ENTRY-999')
    ).rejects.toMatchObject({ code: 'SQUAD_NOT_FOUND' });
  });
});

describe('tournament-engine - reglement : parts EGALES par membre (2026-11-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Two real accounts + un fantome legacy ; la resolution est explosee par id.
    getUserById.mockImplementation((id) => ({
      'player-1': mockPlayer,
      'player-2': mockPlayer2,
      'player-3': mockPlayer3,
    }[id] || null));
  });

  const makeCompleted = (entries) => ({
    id: 'T-WIN',
    name: 'Cup',
    format: '2VS2',
    teamSize: 2,
    entryFee: 100,
    status: 'completed',
    entries,
    // Pas d'arbitre dans ce fixture : ces tests ne regardent que l'argent des
    // MEMBRES (parts egales, pass consomme, dettes par membre). La commission
    // arbitre du reglement est couverte par la suite de reglement historique.
    arbiters: [],
    arbitersNeeded: 1,
    // 2 entrees x 100 x teamSize 2 = 400 ; arbitre 5% = 20 ; playerPool 380
    payout: { grossPool: 400, playerPool: 380, arbiterPool: 20, first: 190, second: 114, third: 76 },
    matches: [],
  });

  const member = (userId, pseudo, index) => ({ userId, pseudo, isCaptain: index === 0 });

  it('podium 1 : 2 membres partagent en parts egales (95 / 95)', async () => {
    releaseWalletWinnings.mockResolvedValue({});
    settleMatchLossWallet.mockResolvedValue({});
    const tournament = makeCompleted([{
      id: 'ENTRY-1', seed: 1, squadName: 'Alpha', captainId: 'player-1', teamSize: 2,
      members: [member('player-1', 'ShadowX', 0), member('player-2', 'Ghost', 1)],
      finalPlacement: 1,
    }]);
    await tournamentEngine.applyTournamentSettlement(tournament);
    // LE contrat : chaque membre recoit SA part directement.
    expect(releaseWalletWinnings).toHaveBeenCalledWith('player-1', 95, 'T-WIN', 'prize_win', expect.any(String));
    expect(releaseWalletWinnings).toHaveBeenCalledWith('player-2', 95, 'T-WIN', 'prize_win', expect.any(String));
    // Le pass de CHACUN est consomme, pas seulement celui du capitaine.
    expect(settleMatchLossWallet).not.toHaveBeenCalled();
    expect(tournament.pendingPayouts).toEqual([]);
  });

  it('membre fantome legacy : sa part remonte au capitaine (190 pour lui seul)', async () => {
    releaseWalletWinnings.mockResolvedValue({});
    settleMatchLossWallet.mockResolvedValue({});
    const tournament = makeCompleted([{
      id: 'ENTRY-1', seed: 1, squadName: 'Alpha', captainId: 'player-1', teamSize: 2,
      members: [member('player-1', 'ShadowX', 0), member('ENTRY-1-M2', 'Fantome', 1)],
      finalPlacement: 1,
    }]);
    await tournamentEngine.applyTournamentSettlement(tournament);
    expect(releaseWalletWinnings).toHaveBeenCalledWith('player-1', 190, 'T-WIN', 'prize_win', expect.any(String));
    expect(releaseWalletWinnings).toHaveBeenCalledTimes(1);
    // Aucun debit fantome.
    expect(releaseWalletWinnings.mock.calls.every((call) => call[0] === 'player-1')).toBe(true);
  });

  it('versement en echec : dette PAR MEMBRE (userId) et pas au capitaine', async () => {
    releaseWalletWinnings.mockRejectedValue(Object.assign(new Error('Base down'), { code: 'SUPABASE_DOWN' }));
    settleMatchLossWallet.mockResolvedValue({});
    const tournament = makeCompleted([{
      id: 'ENTRY-1', seed: 1, squadName: 'Alpha', captainId: 'player-1', teamSize: 2,
      members: [member('player-1', 'ShadowX', 0), member('player-2', 'Ghost', 1)],
      finalPlacement: 1,
    }]);
    await tournamentEngine.applyTournamentSettlement(tournament);
    expect(tournament.pendingPayouts).toHaveLength(2);
    expect(tournament.pendingPayouts.map((item) => item.userId).sort()).toEqual(['player-1', 'player-2']);
    expect(tournament.pendingPayouts.every((item) => item.amount === 95)).toBe(true);
  });

  it('hors podium : le pass de CHAQUE membre est consomme (forfait par membre)', async () => {
    releaseWalletWinnings.mockResolvedValue({});
    settleMatchLossWallet.mockResolvedValue({});
    const tournament = makeCompleted([{
      id: 'ENTRY-2', seed: 2, squadName: 'Beta', captainId: 'player-3', teamSize: 2,
      members: [member('player-3', 'Blaze', 0), member('player-2', 'Ghost', 1)],
      finalPlacement: undefined,
    }]);
    await tournamentEngine.applyTournamentSettlement(tournament);
    expect(settleMatchLossWallet).toHaveBeenCalledWith('player-3', 'T-WIN', expect.any(String));
    expect(settleMatchLossWallet).toHaveBeenCalledWith('player-2', 'T-WIN', expect.any(String));
    expect(settleMatchLossWallet).toHaveBeenCalledTimes(2);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
    expect(tournament.pendingPayouts).toEqual([]);
  });

  it('annulation d un tournoi en equipe : CHAQUE participant recupere son pass', async () => {
    refundLockedEntry.mockResolvedValue({ cashBalance: 100 });
    const makeSquadCancelled = () => ({
      id: 'T-SQUADS',
      name: 'Cup',
      format: '2VS2',
      teamSize: 2,
      entryFee: 100,
      status: 'recruiting',
      entries: [
        {
          id: 'ENTRY-1', seed: 1, squadName: 'Alpha', captainId: 'player-1', teamSize: 2,
          members: [member('player-1', 'ShadowX', 0), member('player-2', 'Ghost', 1)],
        },
        {
          id: 'ENTRY-2', seed: 2, squadName: 'Beta', captainId: 'player-3', teamSize: 2,
          members: [member('player-3', 'Blaze', 0), member('player-6', 'Storm', 1)],
        },
      ],
      arbiters: [],
      arbitersNeeded: 1,
      matches: [],
    });
    const result = await tournamentEngine.cancelStaleTournamentOnServer([makeSquadCancelled()], 'T-SQUADS');
    // 4 participants, 4 portefeuilles rembourses.
    expect(refundLockedEntry).toHaveBeenCalledTimes(4);
    expect(refundLockedEntry.mock.calls.map((call) => call[0])).toEqual(['player-1', 'player-2', 'player-3', 'player-6']);
    expect(result.refunded).toBe(4);
    expect(result.tournament.entries).toHaveLength(0);
  });
});

describe('tournament-engine - squads libres : depart, squad incomplete balayee (2026-11-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resolution PAR ID (voir la suite join) : l'arbitre qui lance doit se
    // resoudre a lui-meme, pas au joueur player-1.
    getUserById.mockImplementation((id) => ({
      'player-1': mockPlayer,
      'player-2': mockPlayer2,
      'player-3': mockPlayer3,
      'player-4': mockPlayer4,
      'arb-1': { id: 'arb-1', pseudo: 'Ref', role: 'player', wallet: {}, device: 'open', controllerType: 'open' },
    }[id] || null));
  });

  const makeTeamTournament = (entries) =>
    tournamentEngine.normalizeTournamentCollection([{
      id: 'T-LIVE',
      maxEntries: 8,
      minEntries: 2,
      entryFee: 100,
      status: 'recruiting',
      format: '2VS2',
      entries,
      arbiters: [{ userId: 'arb-1', slot: 1, assignedAt: new Date().toISOString() }],
    }])[0];

  const arbiter = { id: 'arb-1', pseudo: 'Ref', role: 'player', wallet: {}, device: 'open', controllerType: 'open' };
  const squadMember = (userId, pseudo, index) => ({ userId, pseudo, isCaptain: index === 0 });

  it('squad incomplette au lancement : chaque membre recupere son pass, bracket sans elle', async () => {
    refundLockedEntry.mockResolvedValue({ cashBalance: 100 });
    const tournament = makeTeamTournament([
      {
        id: 'ENTRY-1', seed: 1, squadName: 'Alpha', captainId: 'player-1', teamSize: 2,
        members: [squadMember('player-1', 'ShadowX', 0), squadMember('player-2', 'Ghost', 1)],
      },
      // Beta incomplette : 1 seul membre sur 2.
      {
        id: 'ENTRY-2', seed: 2, squadName: 'Beta', captainId: 'player-3', teamSize: 2,
        members: [squadMember('player-3', 'Blaze', 0)],
      },
      {
        id: 'ENTRY-3', seed: 3, squadName: 'Gamma', captainId: 'player-4', teamSize: 2,
        members: [squadMember('player-4', 'Storm', 0), squadMember('player-6', 'Rex', 1)],
      },
    ]);

    const result = await tournamentEngine.startTournamentOnServer([tournament], arbiter, 'T-LIVE');
    // Uniquement le membre de Beta recupere son pass.
    expect(refundLockedEntry).toHaveBeenCalledTimes(1);
    expect(refundLockedEntry).toHaveBeenCalledWith('player-3', 'T-LIVE', expect.any(String));
    // Le bracket se joue avec les squads completes uniquement, reseeds propres.
    expect(result.tournament.entries).toHaveLength(2);
    expect(result.tournament.entries.map((entry) => entry.seed)).toEqual([1, 2]);
    expect(result.tournament.status).toBe('live');
    expect(result.tournament.pendingRefunds).toEqual([]);
  });

  it('pas assez de squads completees : refus AVANT tout refund (rien ne bouge)', async () => {
    const tournament = makeTeamTournament([
      {
        id: 'ENTRY-1', seed: 1, squadName: 'Alpha', captainId: 'player-1', teamSize: 2,
        members: [squadMember('player-1', 'ShadowX', 0)],
      },
      {
        id: 'ENTRY-2', seed: 2, squadName: 'Beta', captainId: 'player-3', teamSize: 2,
        members: [squadMember('player-3', 'Blaze', 0)],
      },
    ]);
    await expect(
      tournamentEngine.startTournamentOnServer([tournament], arbiter, 'T-LIVE')
    ).rejects.toMatchObject({ code: 'MATCH_NOT_READY' });
    // GARDE AVAL : aucune dette, aucun refund, aucune mutation.
    expect(refundLockedEntry).not.toHaveBeenCalled();
    expect(tournament.entries).toHaveLength(2);
  });
});

describe('tournament-engine - C4 : tournoi live abandonne', () => {
  const makeTournament = () => ({
    id: 'T-VIEUX',
    name: 'Open Benin',
    format: '1VS1',
    teamSize: 1,
    entryFee: 100,
    status: 'live',
    startsAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    entries: [makeEntry('player-1', 'ShadowX'), makeEntry('player-2', 'Ghost')],
    arbiters: [{ userId: 'arb-1', slot: 1 }],
    arbitersNeeded: 1,
    matches: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('C4 - getExpiredTournamentIds repere un tournoi live vieux de trop', () => {
    // Grace par defaut 24 h : un bracket lance hier matin et jamais termine
    // est une dette, pas une competition en pause.
    const ids = tournamentEngine.getExpiredTournamentIds([makeTournament()]);
    expect(ids).toEqual(['T-VIEUX']);

    // Encore dans la grace : rien.
    const recent = { ...makeTournament(), startsAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() };
    expect(tournamentEngine.getExpiredTournamentIds([recent])).toEqual([]);

    // Un tournoi clos : jamais repris.
    const fini = { ...makeTournament(), status: 'completed' };
    expect(tournamentEngine.getExpiredTournamentIds([fini])).toEqual([]);
  });

  it('C4 - annule un tournoi live et rembourse toutes les entrees', async () => {
    refundLockedEntry.mockResolvedValue({ cashBalance: 100 });

    const outcome = await tournamentEngine.cancelStaleTournamentOnServer(
      [makeTournament()], 'T-VIEUX', 'Tournoi annule : bracket lance mais jamais termine.',
    );

    // Un tournoi live n'a verse AUCUN gain (le reglement final n'arrive pas
    // si le bracket n'arrive jamais) : rembourser tout est sans sur-paiement.
    expect(outcome.refunded).toBe(2);
    expect(outcome.tournament.status).toBe('cancelled');
    expect(outcome.tournament.cancelReason).toContain('bracket lance mais jamais termine');
    expect(outcome.tournament.entries).toHaveLength(0);
  });

  it('C4 - un tournoi termine n est pas annulable via ce sweep', async () => {
    const fini = { ...makeTournament(), status: 'completed' };
    await expect(
      tournamentEngine.cancelStaleTournamentOnServer([fini], 'T-VIEUX'),
    ).rejects.toMatchObject({ code: 'MATCH_CLOSED' });
  });
});

describe('tournament-engine - propagation des byes (audit-3 P5 C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  const getMatch = (tournament, key) =>
    tournament.matches.find((match) => match.id === `TM-${tournament.id}-${key}`);

  const play = async (tournament, key, winnerEntryId) => {
    const result = await tournamentEngine.submitTournamentMatchResultOnServer(
      [tournament],
      mockAdmin,
      tournament.id,
      `TM-${tournament.id}-${key}`,
      { winnerEntryId, scoreA: 7, scoreB: 3 }
    );
    return result.tournament;
  };

  const startBracket = async (tournamentId, entries, maxEntries, extra = {}) => {
    const tournament = tournamentEngine.normalizeTournamentCollection([{
      id: tournamentId,
      maxEntries,
      status: 'recruiting',
      format: '1VS1',
      entryFee: 100,
      entries,
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString() }],
      ...extra,
    }])[0];
    return (await tournamentEngine.startTournamentOnServer([tournament], mockAdmin, tournamentId)).tournament;
  };

  // Les appels de gains : (captainId, montant, tournoi, 'prize_win', libelle).
  const prizeWinCalls = () => releaseWalletWinnings.mock.calls.filter((call) => call[3] === 'prize_win');

  it('controle 4/4 : le bracket sans bye reste intact (4 soumissions, podium complet)', async () => {
    let tournament = await startBracket('T-CTL4', [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
    ], 4);

    tournament = await play(tournament, 'main:1:1', 'ENTRY-1');
    // Le bronze n a qu un perdant tant que M2 n est pas joue : il ATTEND.
    expect(getMatch(tournament, 'third_place:3:1').status).toBe('pending');

    tournament = await play(tournament, 'main:1:2', 'ENTRY-3');
    expect(getMatch(tournament, 'third_place:3:1').status).toBe('ready');

    tournament = await play(tournament, 'third_place:3:1', 'ENTRY-2');
    tournament = await play(tournament, 'main:2:1', 'ENTRY-1');

    expect(tournament.status).toBe('completed');
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-1').finalPlacement).toBe(1);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-3').finalPlacement).toBe(2);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-2').finalPlacement).toBe(3);
    expect(settleMatchLossWallet.mock.calls.map((call) => call[0])).toEqual(['p4']);
    expect(prizeWinCalls().map((call) => [call[0], call[1]])).toEqual([
      ['p1', 190],
      ['p2', 76],
      ['p3', 114],
    ]);
    expect(tournament.pendingPayouts).toEqual([]);
  });

  it('5/8 : le bye traverse tout le bracket - ENTRY-5 attend en finale, le bronze s auto-avance apres une seule vraie demi-finale', async () => {
    let tournament = await startBracket('T-BYE5', [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
      makeEntry('p5', 'P5', 5),
    ], 8);

    const byeMatch = getMatch(tournament, 'main:1:3');
    expect(byeMatch.status).toBe('finished');
    expect(byeMatch.winnerEntryId).toBe('ENTRY-5');
    expect(byeMatch.notes).toBe('Auto avance via bye');

    const semiB = getMatch(tournament, 'main:2:2');
    expect(semiB.entryAId).toBe('ENTRY-5');
    expect(semiB.status).toBe('finished'); // walkover : l adversaire du bye n existera jamais
    expect(semiB.winnerEntryId).toBe('ENTRY-5');

    const finale = getMatch(tournament, 'main:3:1');
    expect(finale.entryBId).toBe('ENTRY-5');
    expect(finale.status).toBe('pending'); // ATTEND : aucun champion auto-designe
    expect(tournament.status).toBe('live');

    tournament = await play(tournament, 'main:1:1', 'ENTRY-1');
    tournament = await play(tournament, 'main:1:2', 'ENTRY-3');
    tournament = await play(tournament, 'main:2:1', 'ENTRY-1');

    const bronze = getMatch(tournament, 'third_place:4:1');
    expect(bronze.status).toBe('finished'); // une seule vraie demi-finale jouable
    expect(bronze.winnerEntryId).toBe('ENTRY-3');
    expect(bronze.notes).toBe('Auto avance via bye');

    tournament = await play(tournament, 'main:3:1', 'ENTRY-1');

    expect(tournament.status).toBe('completed');
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-1').finalPlacement).toBe(1);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-5').finalPlacement).toBe(2);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-3').finalPlacement).toBe(3);
    expect(settleMatchLossWallet.mock.calls.map((call) => call[0])).toEqual(['p2', 'p4']);
    expect(prizeWinCalls().map((call) => [call[0], call[1]])).toEqual([
      ['p1', 237.5],
      ['p3', 95],
      ['p5', 142.5],
    ]);
    expect(tournament.pendingPayouts).toEqual([]);
  });

  it('7/8 : le bye du round 1 est place des le start - la demi-finale se joue (gel gueri)', async () => {
    let tournament = await startBracket('T-BYE7', [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
      makeEntry('p4', 'P4', 4),
      makeEntry('p5', 'P5', 5),
      makeEntry('p6', 'P6', 6),
      makeEntry('p7', 'P7', 7),
    ], 8);

    const byeMatch = getMatch(tournament, 'main:1:4');
    expect(byeMatch.status).toBe('finished');
    expect(byeMatch.winnerEntryId).toBe('ENTRY-7');

    const semiB = getMatch(tournament, 'main:2:2');
    expect(semiB.entryBId).toBe('ENTRY-7');
    expect(semiB.status).toBe('pending'); // un seul entrant tant que M3 n est pas joue

    tournament = await play(tournament, 'main:1:3', 'ENTRY-5');
    expect(getMatch(tournament, 'main:2:2').status).toBe('ready');

    tournament = await play(tournament, 'main:1:1', 'ENTRY-1');
    tournament = await play(tournament, 'main:1:2', 'ENTRY-3');
    tournament = await play(tournament, 'main:2:2', 'ENTRY-7');
    tournament = await play(tournament, 'main:2:1', 'ENTRY-1');
    tournament = await play(tournament, 'third_place:4:1', 'ENTRY-3');
    tournament = await play(tournament, 'main:3:1', 'ENTRY-1');

    expect(tournament.status).toBe('completed');
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-1').finalPlacement).toBe(1);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-7').finalPlacement).toBe(2);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-3').finalPlacement).toBe(3);
    expect(settleMatchLossWallet.mock.calls.map((call) => call[0])).toEqual(['p2', 'p4', 'p5', 'p6']);
  });

  it('3/4 : le bye envoie ENTRY-3 en finale (qui attend) et le bronze s auto-avance - podium complet, aucun pass consomme', async () => {
    let tournament = await startBracket('T-BYE3', [
      makeEntry('p1', 'P1', 1),
      makeEntry('p2', 'P2', 2),
      makeEntry('p3', 'P3', 3),
    ], 4, { minEntries: 3 });

    const finale = getMatch(tournament, 'main:2:1');
    expect(finale.entryBId).toBe('ENTRY-3'); // M2 (position paire) -> cote B
    expect(finale.status).toBe('pending');
    expect(tournament.status).toBe('live');

    tournament = await play(tournament, 'main:1:1', 'ENTRY-1');

    const bronze = getMatch(tournament, 'third_place:3:1');
    expect(bronze.status).toBe('finished'); // la demi-finale du bye ne produira jamais de perdant
    expect(bronze.winnerEntryId).toBe('ENTRY-2');
    expect(bronze.notes).toBe('Auto avance via bye');

    tournament = await play(tournament, 'main:2:1', 'ENTRY-1');

    expect(tournament.status).toBe('completed');
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-1').finalPlacement).toBe(1);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-3').finalPlacement).toBe(2);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-2').finalPlacement).toBe(3);
    expect(settleMatchLossWallet).not.toHaveBeenCalled();
    expect(prizeWinCalls().map((call) => [call[0], call[1]])).toEqual([
      ['p1', 142.5],
      ['p2', 57],
      ['p3', 85.5],
    ]);
    expect(tournament.pendingPayouts).toEqual([]);
  });

  it('reparation legacy : un tournoi live au bracket casse se guerit a la prochaine soumission', async () => {
    const legacyMatch = (bracketType, round, position, extra = {}) => ({
      id: `TM-T-LEG7-${bracketType}:${round}:${position}`,
      tournamentId: 'T-LEG7',
      bracketType,
      round,
      position,
      status: 'pending',
      arbiterSlot: 1,
      updatedAt: new Date().toISOString(),
      ...extra,
    });

    let tournament = tournamentEngine.normalizeTournamentCollection([{
      id: 'T-LEG7',
      name: 'Legacy',
      maxEntries: 8,
      status: 'live',
      format: '1VS1',
      entryFee: 100,
      mainRounds: 3,
      entries: [
        makeEntry('p1', 'P1', 1),
        makeEntry('p2', 'P2', 2),
        makeEntry('p3', 'P3', 3),
        makeEntry('p4', 'P4', 4),
        makeEntry('p5', 'P5', 5),
        makeEntry('p6', 'P6', 6),
        makeEntry('p7', 'P7', 7),
      ],
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString() }],
      matches: [
        legacyMatch('main', 1, 1, { entryAId: 'ENTRY-1', entryBId: 'ENTRY-2', status: 'ready' }),
        legacyMatch('main', 1, 2, { entryAId: 'ENTRY-3', entryBId: 'ENTRY-4', status: 'ready' }),
        legacyMatch('main', 1, 3, {
          entryAId: 'ENTRY-5', entryBId: 'ENTRY-6', status: 'finished',
          winnerEntryId: 'ENTRY-5', loserEntryId: 'ENTRY-6', scoreA: 7, scoreB: 3,
        }),
        // Le bye de M4 est fini mais son placement dans M6 a ete ECRASE
        // (l ancien bug) : M6 n a que son cote A, venu d une soumission reelle.
        legacyMatch('main', 1, 4, {
          entryAId: 'ENTRY-7', status: 'finished', winnerEntryId: 'ENTRY-7',
          loserEntryId: undefined, scoreA: 1, scoreB: 0, notes: 'Auto avance via bye',
        }),
        legacyMatch('main', 2, 1),
        legacyMatch('main', 2, 2, { entryAId: 'ENTRY-5' }),
        legacyMatch('main', 3, 1),
        legacyMatch('third_place', 4, 1),
      ],
    }])[0];

    expect(getMatch(tournament, 'main:2:2').entryBId).toBeUndefined();

    tournament = await play(tournament, 'main:1:1', 'ENTRY-1');

    const healed = getMatch(tournament, 'main:2:2');
    expect(healed.entryBId).toBe('ENTRY-7');
    expect(healed.status).toBe('ready');

    tournament = await play(tournament, 'main:1:2', 'ENTRY-3');
    tournament = await play(tournament, 'main:2:2', 'ENTRY-7');
    tournament = await play(tournament, 'main:2:1', 'ENTRY-1');
    tournament = await play(tournament, 'third_place:4:1', 'ENTRY-3');
    tournament = await play(tournament, 'main:3:1', 'ENTRY-1');

    expect(tournament.status).toBe('completed');
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-1').finalPlacement).toBe(1);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-7').finalPlacement).toBe(2);
    expect(tournament.entries.find((entry) => entry.id === 'ENTRY-3').finalPlacement).toBe(3);
  });
});

describe('tournament-engine - P5 C2/C4 (audit-3) : notes et designation bornees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockReturnValue(mockAdmin);
  });

  it('C2 - creation : les rules.notes sont bornees a 300 caracteres', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { notes: `${'A'.repeat(350)}<script>alert(1)</script>` },
    });
    // Le moteur borne AVANT de sanitiser (patron des champs de salle), donc
    // la note resultante ne peut depasser 300 quoi que fasse la saisie.
    expect(result.tournament.rules.notes).toHaveLength(300);
  });

  it('C2 - creation : des notes vides retombent sur le defaut', () => {
    const result = tournamentEngine.createTournamentOnServer([], mockAdmin, {
      name: 'Test Cup',
      entryFee: 100,
      rules: { notes: '   ' },
    });
    expect(result.tournament.rules.notes).toBe('Pas de matchs entre 00h00 et 07h00.');
  });

  it('C2 - soumission : la note de duel est bornee a 300, une note vide ne s ecrit pas', async () => {
    const buildTournament = () => tournamentEngine.normalizeTournamentCollection([{
      id: 'T-NOTES',
      maxEntries: 4,
      status: 'live',
      format: '1VS1',
      entries: [makeEntry('p1', 'P1', 1), makeEntry('p2', 'P2', 2)],
      arbiters: [{ userId: 'admin-1', pseudo: 'Admin', slot: 1, assignedAt: new Date().toISOString(), matchesHandled: 0 }],
      matches: [
        {
          id: 'TM-1',
          bracketType: 'main',
          round: 0,
          position: 0,
          entryAId: 'ENTRY-P1-1',
          entryBId: 'ENTRY-P2-2',
          status: 'ready',
          roomName: 'room1',
          roomPassword: 'pass1',
          arbiterSlot: 1,
        },
      ],
    }])[0];

    const borne = await tournamentEngine.submitTournamentMatchResultOnServer(
      [buildTournament()], mockAdmin, 'T-NOTES', 'TM-1',
      { winnerEntryId: 'ENTRY-P1-1', scoreA: 7, scoreB: 3, notes: 'x'.repeat(400) }
    );
    // Le bracket s avance : une finale duale a remplace le match source.
    const noteTraitee = borne.tournament.matches.find((m) => m.id === 'TM-1').notes;
    expect(noteTraitee).toHaveLength(300);

    const vide = await tournamentEngine.submitTournamentMatchResultOnServer(
      [buildTournament()], mockAdmin, 'T-NOTES', 'TM-1',
      { winnerEntryId: 'ENTRY-P1-1', scoreA: 7, scoreB: 3, notes: '   ' }
    );
    expect(vide.tournament.matches.find((m) => m.id === 'TM-1').notes).toBeUndefined();
  });

  it('C4 - designation d arbitre refusee hors recrutement (cancelled et completed)', () => {
    const base = {
      id: 'T-C4',
      status: 'cancelled',
      format: '1VS1',
      maxEntries: 4,
      entries: [makeEntry('p1', 'P1', 1)],
      arbiters: [{ slot: 1, matchesHandled: 0 }],
    };
    const annule = tournamentEngine.normalizeTournamentCollection([base])[0];
    expect(() =>
      tournamentEngine.assignTournamentArbiterOnServer([annule], mockPlayer, 'T-C4')
    ).toThrow('recrutement');
    const termine = { ...annule, status: 'completed' };
    expect(() =>
      tournamentEngine.assignTournamentArbiterOnServer([termine], mockPlayer2, 'T-C4')
    ).toThrow('recrutement');
  });
});
