/**
 * server/match-exit.test.mjs — sortie volontaire (leave) et annulation du
 * createur (cancel self) + reprise de l annulation admin sur le rembourseur
 * partage.
 *
 * Contrat a prouver (docs/09 §6.1, docs/02 §4.4) :
 *   - pre-lancement, un joueur sort AVEC son pass (integral, aucun frais) ;
 *   - post-lancement, plus personne ne sort — les mises jouent ;
 *   - le createur annule TANT QUE personne ne s est joint (OPPONENTS_PRESENT
 *     sinon) : remboursement integral, match ferme ;
 *   - une annulation (admin) qui echoue sur UN SEUL portefeuille ne ferme
 *     pas le match — le sequestre ne disparait jamais des radars.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { comptes } = vi.hoisted(() => ({ comptes: new Map() }));

const compteParDefaut = (id) => ({
  id, pseudo: id, role: 'player', trustScore: 100,
  stats: {}, progression: {},
  wallet: { cashBalance: 0, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
});

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => comptes.get(id) || compteParDefaut(id)),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

const rembourses = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(async (userId, matchId, raison) => { rembourses.push({ userId, matchId, raison }); }),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import {
  leaveMatchOnServer,
  cancelMatchSelfOnServer,
  cancelMatchOnServer,
} from './match-engine.mjs';

const matchSquelette = (surcharge = {}) => ({
  id: 'M-1',
  status: 'full',
  format: '1VS1',
  teamSize: 1,
  maxPlayers: 2,
  entryFee: 50,
  createdAt: new Date().toISOString(),
  creatorId: 'createur',
  disputes: [],
  players: [
    { userId: 'createur', team: 0, isCaptain: true },
    { userId: 'p-2', team: 1, isCaptain: true },
  ],
  ...surcharge,
});

beforeEach(() => {
  rembourses.length = 0;
  comptes.clear();
  vi.clearAllMocks();
});

describe('Sortie volontaire d un joueur (leave)', () => {
  it('rembourse le pass integral et retire la place avant le lancement', async () => {
    const res = await leaveMatchOnServer([matchSquelette()], { id: 'p-2' }, 'M-1');

    expect(rembourses).toEqual([
      { userId: 'p-2', matchId: 'M-1', raison: 'Sortie volontaire du match M-1' },
    ]);
    expect(res.matches[0].players.map((player) => player.userId)).toEqual(['createur']);
  });

  it('redescend le statut du match en recruiting plus une place reouverte', async () => {
    const res = await leaveMatchOnServer([matchSquelette()], { id: 'p-2' }, 'M-1');

    expect(res.matches[0].status).toBe('recruiting');
  });

  it('transfere le capitanat au premier joueur restant du camp', async () => {
    const match = matchSquelette({
      format: '2VS2',
      teamSize: 2,
      maxPlayers: 4,
      players: [
        { userId: 'createur', team: 0, isCaptain: true },
        { userId: 'p-2', team: 0, isCaptain: false },
        { userId: 'p-3', team: 1, isCaptain: true },
        { userId: 'p-4', team: 1, isCaptain: false },
      ],
    });
    // Le CAPITAINE du camp Bravo part (pas le createur) : le premier restant
    // de son camp reprend le badge.
    const res = await leaveMatchOnServer([match], { id: 'p-3' }, 'M-1');

    const teamBravo = res.matches[0].players.filter((player) => player.team === 1);
    expect(teamBravo).toHaveLength(1);
    expect(teamBravo[0]).toMatchObject({ userId: 'p-4', isCaptain: true });
  });

  it('refuse le createur : sa sortie passe par une annulation du match', async () => {
    const match = matchSquelette({
      format: '2VS2',
      teamSize: 2,
      maxPlayers: 4,
      players: [
        { userId: 'createur', team: 0, isCaptain: true },
        { userId: 'p-2', team: 0, isCaptain: false },
        { userId: 'p-3', team: 1, isCaptain: true },
        { userId: 'p-4', team: 1, isCaptain: false },
      ],
    });

    await expect(leaveMatchOnServer([match], { id: 'createur' }, 'M-1')).rejects.toMatchObject({
      code: 'CREATOR_CANNOT_LEAVE',
    });
    expect(rembourses).toHaveLength(0);

    // Le COEQUIPIER part : le premier restant de son camp devient capitaine.
    const res = await leaveMatchOnServer([match], { id: 'p-2' }, 'M-1');
    const team0 = res.matches[0].players.filter((player) => player.team === 0);
    expect(team0).toHaveLength(1);
    expect(team0[0]).toMatchObject({ userId: 'createur', isCaptain: true });
  });

  it('refuse un joueur pas inscrit (NOT_IN_MATCH), sans remboursement', async () => {
    await expect(leaveMatchOnServer([matchSquelette()], { id: 'intrus' }, 'M-1')).rejects.toMatchObject({
      code: 'NOT_IN_MATCH',
    });
    expect(rembourses).toHaveLength(0);
  });

  it('refuse un match clos, sans aucun remboursement', async () => {
    await expect(
      leaveMatchOnServer([matchSquelette({ status: 'cancelled' })], { id: 'p-2' }, 'M-1')
    ).rejects.toMatchObject({ code: 'MATCH_CLOSED' });
    expect(rembourses).toHaveLength(0);
  });

  it('refuse un match lance (MATCH_LAUNCHED) : les mises jouent', async () => {
    const lance = matchSquelette({ startedAt: new Date().toISOString() });
    await expect(leaveMatchOnServer([lance], { id: 'p-2' }, 'M-1')).rejects.toMatchObject({
      code: 'MATCH_LAUNCHED',
    });
    expect(rembourses).toHaveLength(0);

    // Un resultat pose sans `startedAt` tombe sous la meme garde.
    const avecResultat = matchSquelette({ result: { payoutDistributed: true } });
    await expect(leaveMatchOnServer([avecResultat], { id: 'p-2' }, 'M-1')).rejects.toMatchObject({
      code: 'MATCH_LAUNCHED',
    });
    expect(rembourses).toHaveLength(0);
  });

  it('refuse un litige ouvert (MATCH_DISPUTED)', async () => {
    const litige = matchSquelette({ status: 'disputed', disputes: [{ status: 'under_review' }] });
    await expect(leaveMatchOnServer([litige], { id: 'p-2' }, 'M-1')).rejects.toMatchObject({
      code: 'MATCH_DISPUTED',
    });
    expect(rembourses).toHaveLength(0);
  });

  it('match introuvable : MATCH_NOT_FOUND', async () => {
    await expect(leaveMatchOnServer([matchSquelette()], { id: 'p-2' }, 'M-INEXISTANT')).rejects.toMatchObject({
      code: 'MATCH_NOT_FOUND',
    });
  });
});

describe('Annulation volontaire par le createur (cancel self)', () => {
  it('annule avec remboursement tant que personne ne s est joint', async () => {
    const match = matchSquelette({ status: 'recruiting', players: [{ userId: 'createur', team: 0, isCaptain: true }] });
    const res = await cancelMatchSelfOnServer([match], { id: 'createur' }, 'M-1');

    expect(rembourses).toEqual([
      { userId: 'createur', matchId: 'M-1', raison: 'Annulation volontaire du match M-1' },
    ]);
    expect(res.matches[0].status).toBe('cancelled');
    expect(res.matches[0].cancellationReason).toBe('CANCELLED_BY_CREATOR');
    expect(res.matches[0].finishedAt).toBeTruthy();
  });

  // ETENDUE (2026-11-09) : meme avec un adversaire, le createur peut
  // annuler pre-lancement — TOUS les passes sont rembourses.
  it('annule et rembourse TOUT le monde quand un adversaire a pose son pass', async () => {
    const res = await cancelMatchSelfOnServer([matchSquelette()], { id: 'createur' }, 'M-1');

    expect(rembourses).toEqual([
      { userId: 'createur', matchId: 'M-1', raison: 'Annulation volontaire du match M-1' },
      { userId: 'p-2', matchId: 'M-1', raison: 'Annulation volontaire du match M-1' },
    ]);
    expect(res.matches[0].status).toBe('cancelled');
  });

  it('refuse un match deja lance (MATCH_ALREADY_STARTED), sans remboursement', async () => {
    const lance = { ...matchSquelette(), startedAt: new Date().toISOString() };
    await expect(cancelMatchSelfOnServer([lance], { id: 'createur' }, 'M-1')).rejects.toMatchObject({
      code: 'MATCH_ALREADY_STARTED',
    });
    expect(rembourses).toHaveLength(0);
  });

  it('refuse un non-createur (FORBIDDEN), meme admin', async () => {
    comptes.set('admin', { ...compteParDefaut('admin'), role: 'admin' });

    const match = matchSquelette({ status: 'recruiting', players: [{ userId: 'createur', team: 0, isCaptain: true }] });
    await expect(cancelMatchSelfOnServer([match], { id: 'admin' }, 'M-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(rembourses).toHaveLength(0);
  });

  it('refuse un match deja solde (MATCH_CLOSED), sans remboursement', async () => {
    const match = matchSquelette({ status: 'recruiting', players: [{ userId: 'createur', team: 0, isCaptain: true }] });
    const solde = { ...match, result: { payoutDistributed: true } };
    await expect(cancelMatchSelfOnServer([solde], { id: 'createur' }, 'M-1')).rejects.toMatchObject({
      code: 'MATCH_CLOSED',
    });
    expect(rembourses).toHaveLength(0);
  });

  it('refuse un litige ouvert (MATCH_DISPUTED)', async () => {
    const match = matchSquelette({
      status: 'disputed',
      disputes: [{ status: 'open' }],
      players: [{ userId: 'createur', team: 0, isCaptain: true }],
    });
    await expect(cancelMatchSelfOnServer([match], { id: 'createur' }, 'M-1')).rejects.toMatchObject({
      code: 'MATCH_DISPUTED',
    });
    expect(rembourses).toHaveLength(0);
  });
});

describe('Annulation admin sur le rembourseur partage', () => {
  it('rembourse tout le monde et ferme le match (comportement conserve)', async () => {
    comptes.set('admin', { ...compteParDefaut('admin'), role: 'admin' });
    const res = await cancelMatchOnServer([matchSquelette()], { id: 'admin' }, 'M-1', 'Compte tricheur');

    expect(rembourses.map((r) => r.userId).sort()).toEqual(['createur', 'p-2']);
    expect(res.matches[0].status).toBe('cancelled');
  });

  it('NE CLOT PAS le match si un seul portefeuille echoue (REFUND_FAILED)', async () => {
    comptes.set('admin', { ...compteParDefaut('admin'), role: 'admin' });
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockImplementationOnce(async () => { throw new Error('SUPABASE_DOWN'); });

    await expect(
      cancelMatchOnServer([matchSquelette()], { id: 'admin' }, 'M-1')
    ).rejects.toMatchObject({ code: 'REFUND_FAILED' });

    // Statut intact : la remise au provenance du clone evite toute fuite.
    // Le joueur deja rembourse l a ete pour de vrai (idempotence : pas de
    // double-credit lors de la reprise).
    const reprise = await cancelMatchOnServer([matchSquelette()], { id: 'admin' }, 'M-1');
    expect(reprise.matches[0].status).toBe('cancelled');
  });
});
