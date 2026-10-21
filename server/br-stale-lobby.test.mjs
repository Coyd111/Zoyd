import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Un salon BR programme et JAMAIS lance doit etre annule et rembourse.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Un salon BR ne se lance que si l'arbitre (ou le createur) le lance, et
 * seulement si les joueurs se sont pointes. Sans balayage, un salon qui n'a
 * jamais demarre restait `scheduled` POUR TOUJOURS : les joueurs avaient paye
 * leur pass, et leur argent restait bloque.
 *
 * Aucun cron ne s'en occupait : le cron nettoie les matchs, les ligues et les
 * tournois, pas les salons BR. Et un salon BR n'a pas d'`expiresAt`, alors
 * qu'un match en a un (14 jours).
 *
 * Meme famille que V1 et V14 le dit dans les deux sens : un mecanisme de
 * remboursement dont la condition d'appel n'est jamais remplie.
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

import {
  BR_STALE_LOBBY_GRACE_MS,
  countStaleBrLobbies,
  getStaleBrLobbyIds,
  cancelStaleBrLobbyOnServer,
} from './br-engine.mjs';

const ilYA = (ms) => new Date(Date.now() - ms).toISOString();

const salonProgramme = (surcharge = {}) => ({
  id: 'BR-STALE',
  name: 'Salon jamais lance',
  status: 'scheduled',
  mode: 'solo',
  map: 'isolated',
  entryFee: 50,
  pot: 100,
  arbiterId: 'admin-1',
  rankingMode: 'survie_kills',
  scheduledAt: ilYA(BR_STALE_LOBBY_GRACE_MS + 60 * 60 * 1000),
  createdAt: ilYA(48 * 60 * 60 * 1000),
  updatedAt: ilYA(48 * 60 * 60 * 1000),
  players: [
    { userId: 'p1', pseudo: 'P1', teamId: 'T-1', joinedAt: ilYA(40 * 60 * 60 * 1000), checkedIn: false, alive: false, placement: null, kills: 0, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
    { userId: 'p2', pseudo: 'P2', teamId: 'T-2', joinedAt: ilYA(40 * 60 * 60 * 1000), checkedIn: false, alive: false, placement: null, kills: 0, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
  ],
  teams: [],
  disputes: [],
  ...surcharge,
});

beforeEach(() => { versements.length = 0; vi.clearAllMocks(); });

describe('Salons BR programmes et jamais lances', () => {
  it('identifie un salon dont l heure est depassee', () => {
    expect(getStaleBrLobbyIds([salonProgramme()])).toEqual(['BR-STALE']);
    expect(countStaleBrLobbies([salonProgramme()])).toBe(1);
  });

  it('laisse un salon encore dans sa fenetre', () => {
    // L heure approche : le salon peut encore demarrer. Il ne faut surtout pas
    // annuler un salon qui va se lancer dans une heure.
    const salon = salonProgramme({ scheduledAt: ilYA(30 * 60 * 1000) });
    expect(getStaleBrLobbyIds([salon])).toEqual([]);
  });

  it('ne touche pas un salon deja lance', () => {
    const salon = salonProgramme({ status: 'live' });
    expect(getStaleBrLobbyIds([salon])).toEqual([]);
  });

  it('rembourse chaque joueur et annule le salon', async () => {
    const res = await cancelStaleBrLobbyOnServer([salonProgramme()], 'BR-STALE');

    const rembourses = versements.filter((v) => v.kind === 'refund');
    expect(rembourses).toHaveLength(2);
    expect(res.cancelled).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.lobbies[0].status).toBe('cancelled');
    expect(res.lobbies[0].cancellationReason).toBe('NEVER_STARTED');
  });

  it('NE CLOT PAS le salon si un remboursement echoue', async () => {
    // Le cas le plus dangereux : clore un salon dont un joueur n'a pas ete
    // rembourse laisserait du sequestre sans trace, et le joueur verrait le
    // salon « annule » sans jamais avoir vu son argent.
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockImplementationOnce(async () => { throw new Error('SEQUESTRE INDISPONIBLE'); });

    const res = await cancelStaleBrLobbyOnServer([salonProgramme()], 'BR-STALE');

    expect(res.cancelled).toBe(false);
    expect(res.errors).toHaveLength(1);
    // Le salon reste `scheduled` : il sera repris au balayage suivant.
    expect(res.lobbies[0].status).toBe('scheduled');
  });

  it('ne rembourse pas deux fois un joueur deja rembourse', async () => {
    const salon = salonProgramme();
    salon.players[0].settled = true;

    const res = await cancelStaleBrLobbyOnServer([salon], 'BR-STALE');

    const rembourses = versements.filter((v) => v.kind === 'refund');
    expect(rembourses).toHaveLength(1);
    expect(rembourses[0].userId).toBe('p2');
    expect(res.cancelled).toBe(true);
  });
});
