import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le reglement BR interrompu doit etre REPRIS.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `settleBrLobbyOnServer` ecrit `settling` AVANT les versements, et marque
 * chaque joueur verse (`player.settled`). Le mecanisme de reprise existait
 * donc deja : un salon `settling` est accepte, et les joueurs deja payes sont
 * sautes.
 *
 * Mais PERSONNE ne rappelait la fonction. Un arret de processus au milieu
 * d'un reglement laissait le salon bloque pour toujours : prime jamais versee,
 * salon ni `live` ni `regle` — invisible des deux cotes.
 *
 * Meme famille que V1, V2 et V6 : un mecanisme ecrit, teste, jamais relie.
 *
 * Le test couvre les deux moities :
 * - le MECANISME (ici) : la reprise verse-t-elle ce qui manque ?
 * - le CABLE : un test separe appelle le JOB du cron, parce qu un mecanisme
 *   correct et jamais appele est un morceau de code mort.
 */

const versements = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(async (userId, matchId, raison) => {
    versements.push({ kind: 'refund', userId, matchId, raison });
  }),
  releaseWalletWinnings: vi.fn(async (userId, amount, matchId, type) => {
    versements.push({ kind: 'winnings', userId, amount, matchId, type });
  }),
  settleMatchLossWallet: vi.fn(async (userId, matchId, raison) => {
    versements.push({ kind: 'forfeit', userId, matchId, raison });
  }),
}));

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn((id) => ({
    id,
    pseudo: id,
    role: 'admin',
    trustScore: 100,
    stats: {},
    progression: {},
    wallet: { cashBalance: 0, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
}));

import { countPendingBrSettlements, retryPendingBrSettlements, BR_DEFAULT_PAYOUT } from './br-engine.mjs';

const lobbyInterrompu = (surcharge = {}) => ({
  id: 'BR-1',
  name: 'Salon test',
  status: 'settling',
  mode: 'solo',
  map: 'isolated',
  entryFee: 50,
  pot: 200,
  arbiterId: 'admin-1',
  rankingMode: 'survie_kills',
  payout: { ...BR_DEFAULT_PAYOUT },
  players: [
    { userId: 'p1', pseudo: 'P1', teamId: 'T-1', joinedAt: '2026-01-01T00:00:00Z', checkedIn: true, alive: false, placement: 1, kills: 12, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
    { userId: 'p2', pseudo: 'P2', teamId: 'T-2', joinedAt: '2026-01-01T00:00:00Z', checkedIn: true, alive: false, placement: 2, kills: 7, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
    { userId: 'p3', pseudo: 'P3', teamId: 'T-3', joinedAt: '2026-01-01T00:00:00Z', checkedIn: true, alive: false, placement: 3, kills: 3, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
  ],
  teams: [],
  disputes: [],
  ...surcharge,
});

beforeEach(() => { versements.length = 0; vi.clearAllMocks(); });

describe('Reprise des reglements BR interrompus', () => {
  it('compte les salons interrompus', () => {
    expect(countPendingBrSettlements([
      lobbyInterrompu(),
      lobbyInterrompu({ id: 'BR-2', status: 'finished' }),
      lobbyInterrompu({ id: 'BR-3', status: 'live' }),
    ])).toBe(1);
  });

  it('verse les primes qui restaient dues', async () => {
    const res = await retryPendingBrSettlements([lobbyInterrompu()], {
      getActor: (lobby) => ({ id: lobby.arbiterId, role: 'admin' }),
    });

    // Les primes sont versees : le joueur 1er et le 2e.
    const primes = versements.filter((v) => v.kind === 'winnings');
    expect(primes.length).toBeGreaterThan(0);
    expect(res.retried).toBe(1);
    expect(res.remaining).toBe(0);
  });

  it('NE REPAIE PAS un joueur deja verse', async () => {
    // Le drapeau `settled` est la preuve que le joueur a deja touche sa
    // prime. Sans lui, la reprise le crediterait une seconde fois.
    const lobby = lobbyInterrompu();
    lobby.players[0].settled = true; // deja paye avant l interruption

    await retryPendingBrSettlements([lobby], {
      getActor: (l) => ({ id: l.arbiterId, role: 'admin' }),
    });

    const primes = versements.filter((v) => v.kind === 'winnings');
    // Le joueur 1er ne doit pas etre re-paye.
    expect(primes.some((v) => v.userId === 'p1')).toBe(false);
    // Les autres, si.
    expect(primes.length).toBeGreaterThan(0);
  });

  it('ignore un salon qui n est pas interrompu', async () => {
    const res = await retryPendingBrSettlements([
      lobbyInterrompu({ id: 'BR-OK', status: 'finished' }),
      lobbyInterrompu({ id: 'BR-LIVE', status: 'live' }),
    ], {
      getActor: (l) => ({ id: l.arbiterId, role: 'admin' }),
    });

    expect(versements).toHaveLength(0);
    expect(res.retried).toBe(0);
    expect(res.remaining).toBe(0);
  });

  it('conserve le salon et le signale quand l arbitre est introuvable', async () => {
    // Une dette qu on ne voit pas est une dette qu on ne rembourse pas : on
    // garde la trace, on n efface rien.
    const res = await retryPendingBrSettlements([lobbyInterrompu()], {
      getActor: () => null,
    });

    expect(versements).toHaveLength(0);
    expect(res.retried).toBe(0);
    expect(res.remaining).toBe(1);
    expect(res.lobbies[0].status).toBe('settling');
  });
});
