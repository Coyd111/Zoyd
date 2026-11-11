import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La repartition des gains doit etre la MEME a chaque essai.
 *
 * Un reglement interrompu (panne d'ecriture sur le wallet d'un joueur) est
 * REJOUE : le joueur deja paye est ignore par la garde d'idempotence du
 * portefeuille, le joueur impaye est servi. Les parts ne doivent pas bouger
 * entre les deux essais — sinon le total distribue ne vaut plus le pot, et un
 * joueur perd sa part d'arrondi.
 *
 * CE QUE L AUDIT ANNONCAIT, ET CE QUE LE CODE FAIT
 * ------------------------------------------------
 * L audit annoncait une repartition mal RECALCULEE au rejeu : le joueur deja
 * paye n etant plus ajoute a `paidWinners`, les suivants toucheraient
 * `firstWinnerShare` au lieu de `sharePerWinner`.
 *
 * La verification montre que NON : `paidWinners.add()` est appele AVANT le
 * versement (match-engine.mjs), donc le Set est reconstruit dans le MEME
 * ordre a chaque essai — le premier gagnant absorbe toujours l arrondi, que
 * son versement ait reussi ou echoue. Ce test verrouille donc ce
 * comportement, et documente pourquoi le raisonnement de l audit ne se
 * verifie pas.
 *
 * Les montants sont choisis pour que les parts ne tombent pas juste :
 * trois mises de 5.105 -> pot 15.32, commission 2 % (0.31), donc 15.01 a
 * repartir entre deux gagnants : 7.51 chacun ne tombe pas juste, le
 * premier gagneur absorbe l arrondi (7.50) et l autre touche 7.51.
 */

const h = vi.hoisted(() => ({
  comptes: new Map(),
  // Ids pour lesquels l'ecriture du gain echoue.
  echecs: new Set(),
  // Versements reellement effectues : userId -> [{ amount, cle }]
  versements: new Map(),
  // Cles d idempotence deja posees, PAR PORTEFEUILLE (le vrai portefeuille
  // porte la cle dans ses propres `winningsKeys` : le verrou d un joueur ne
  // bloque donc pas celui d un autre).
  cles: new Set(),
}));

const creerCompte = (id) => ({
  id,
  pseudo: `Pse-${id}`,
  role: 'player',
  wallet: {
    zCoins: 0,
    cashBalance: 0,
    bonusBalance: 0,
    lockedBalance: 0,
    lockedEntries: {},
    transactions: [],
    winningsKeys: [],
  },
  stats: { wins: 0, losses: 0, draws: 0, elo: 1200, totalEarnings: 0 },
  progression: { level: 'BEGINNER', xp: 0 },
  trustScore: 100,
});

vi.mock('./persistence.mjs', () => ({
  DEFAULT_TRUST_SCORE: 100,
  getUserById: vi.fn((id) => {
    const compte = h.comptes.get(id);
    return compte ? JSON.parse(JSON.stringify(compte)) : null;
  }),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
  applyUserSettlementOnce: vi.fn(async (userId, _cle, updater) => {
    const compte = h.comptes.get(userId);
    if (!compte) throw new Error('compte introuvable');
    h.comptes.set(userId, updater(compte));
  }),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(async (userId, amount, matchId, type = 'prize_win') => {
    if (h.echecs.has(userId)) throw new Error('PANNE_PORTFEUILLE');
    const cle = `${userId}|${type}:${matchId}`;
    if (h.cles.has(cle)) return { dejaVerse: true };
    h.cles.add(cle);
    if (!h.versements.has(userId)) h.versements.set(userId, []);
    h.versements.get(userId).push({ amount, cle });
  }),
  settleMatchLossWallet: vi.fn(async (userId) => {
    if (h.echecs.has(userId)) throw new Error('PANNE_PORTFEUILLE');
  }),
}));

import * as moteur from './match-engine.mjs';

const ID = 'M-REPART';

// Pot 15.32, commission 0.31, payout 15.01 : le premier gagnant prend
// 7.50 (il absorbe l arrondi), le second 7.51.
const PREMIERE_PART = 7.5;
const PART_EGALE = 7.51;
const PAYOUT = 15.01;
const COMMISSION = 0.31;

const matchARepartir = () => {
  for (const id of ['u1', 'u2', 'u3', 'arb', 'admin']) {
    h.comptes.set(id, creerCompte(id));
  }
  h.comptes.set('admin', { ...creerCompte('admin'), role: 'admin' });
  for (const id of ['u1', 'u2', 'u3']) {
    h.comptes.get(id).wallet.lockedEntries[ID] = { amount: 5.105 };
    h.comptes.get(id).wallet.lockedBalance = 5.105;
  }
  return {
    id: ID,
    status: 'disputed',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    players: [
      { userId: 'u1', team: 0, pseudo: 'Pse-u1' },
      { userId: 'u2', team: 0, pseudo: 'Pse-u2' },
      { userId: 'u3', team: 1, pseudo: 'Pse-u3' },
    ],
    arbiter: { userId: 'arb', assignedAt: '2026-01-01T00:00:00Z' },
    confirmationDeadline: null,
    result: {
      winnerTeam: 0,
      payoutDistributed: 'pending',
      confirmedByTeams: ['u1', 'u2', 'u3'],
      submittedAt: '2026-01-01T00:00:00Z',
    },
    disputes: [{ id: 'd1', status: 'resolved', openedAt: '2026-01-01T00:00:00Z' }],
  };
};

const partsDe = (userId) => (h.versements.get(userId) || []).map((v) => v.amount);
const totalGagnants = () => {
  const somme = [...partsDe('u1'), ...partsDe('u2')].reduce((a, b) => a + b, 0);
  return Math.round(somme * 100) / 100;
};

beforeEach(() => {
  h.comptes.clear();
  h.echecs.clear();
  h.versements.clear();
  h.cles.clear();
});

describe('repartition des gains — le rejeu doit servir les MEMES parts', () => {
  it('un reglement interrompu puis rejoue distribue exactement le pot', async () => {
    const match = matchARepartir();

    // ─── Essai 1 : le paiement du premier gagnant ECHOUE ───────────────────
    h.echecs.add('u1');
    const premier = await moteur.settlePendingMatchResult([match], ID);
    expect(premier.success, 'le reglement est incomplet').toBe(false);
    expect(premier.match.result.payoutDistributed).toBe('pending');

    // u2 a ete paye (sa part egale), u1 non.
    expect(partsDe('u2')).toEqual([PART_EGALE]);
    expect(partsDe('u1'), 'u1 n a pas ete paye').toEqual([]);

    // ─── Essai 2 : la panne disparait, le reglement est REJOUE ──────────────
    h.echecs.clear();
    const second = await moteur.settlePendingMatchResult(premier.matches, ID);
    expect(second.success, 'le rejeu doit completer le reglement').toBe(true);

    // u1 recoit SA part (celle du premier gagnant : il absorbe l arrondi),
    // u2 n est PAS paye une seconde fois.
    expect(partsDe('u1')).toEqual([PREMIERE_PART]);
    expect(partsDe('u2')).toEqual([PART_EGALE]);
    expect(partsDe('u2').length, 'u2 ne doit pas etre paye deux fois').toBe(1);

    // Le total distribue aux gagnants vaut exactement le pot (commission
    // d'arbitre deduits) : aucun centime perdu, aucun centime cree.
    expect(totalGagnants()).toBe(PAYOUT);
  });

  it('sans interruption, la repartition est la meme', async () => {
    const match = matchARepartir();
    const resultat = await moteur.settlePendingMatchResult([match], ID);
    expect(resultat.success).toBe(true);
    expect(partsDe('u1')).toEqual([PREMIERE_PART]);
    expect(partsDe('u2')).toEqual([PART_EGALE]);
    expect(totalGagnants()).toBe(PAYOUT);
    // La commission d'arbitre est prelevee SUR le pot (2 %), pas en plus.
    expect(partsDe('arb')).toEqual([COMMISSION]);
  });
});
