import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Plafond de retraits cumule sur 24 h.
 *
 * La route ne borne que la TRANSACTION (5 000 000 ZC). Sans cumul, un joueur
 * pouvait enchainer les retraits jusqu a vider son solde : le seul frein etait
 * le rate limiter (20 requetes / 10 min par IP), contournable trivialement ─│
 * depuis plusieurs IP, ou simplement en attendant.
 *
 * Le cumul est lu dans l'historique du portefeuille plutot que dans un registre
 * separe : c'est la seule source deja persistee et rattachee au compte, donc
 * elle survit a un redemarrage.
 */

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

import {
  getWindowedWithdrawalTotal,
  withdrawFromWallet,
  depositToWallet,
  MAX_WITHDRAWAL_DAILY_ZC,
} from './wallet-engine.mjs';
import { createUserAccount, getUserById } from './persistence.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
const settle = () => new Promise((r) => setTimeout(r, 10));
const ilYA = (ms) => new Date(Date.now() - ms).toISOString();

let compteur = 0;
const nouveauCompte = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const joueur = await createUserAccount({
    pseudo: `Plafond${compteur}${stamp}`.slice(0, 24),
    email: `plafond-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-PLA-${compteur}-${stamp}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return joueur;
};

beforeEach(() => vi.clearAllMocks());

describe('Cumul des retraits sur 24 h', () => {
  it('additionne les retraits de la fenetre', () => {
    const wallet = {
      transactions: [
        { type: 'withdraw', amount: 1000, status: 'completed', timestamp: ilYA(60 * 60 * 1000) },
        { type: 'withdraw', amount: 500, status: 'completed', timestamp: ilYA(3 * 60 * 60 * 1000) },
      ],
    };
    expect(getWindowedWithdrawalTotal(wallet)).toBe(1500);
  });

  it('ignore ce qui sort de la fenetre', () => {
    const wallet = {
      transactions: [
        { type: 'withdraw', amount: 1000, status: 'completed', timestamp: ilYA(60 * 60 * 1000) },
        { type: 'withdraw', amount: 9999, status: 'completed', timestamp: ilYA(48 * 60 * 60 * 1000) },
      ],
    };
    expect(getWindowedWithdrawalTotal(wallet)).toBe(1000);
  });

  it('ignore les retraits echoues et les depots', () => {
    // Un retrait refuse n a pas sorti d argent : le compter viderait le
    // plafond du joueur pour rien.
    const wallet = {
      transactions: [
        { type: 'withdraw', amount: 1000, status: 'failed', timestamp: ilYA(60 * 60 * 1000) },
        { type: 'deposit', amount: 50000, status: 'completed', timestamp: ilYA(60 * 60 * 1000) },
        { type: 'withdraw', amount: 200, status: 'completed', timestamp: ilYA(60 * 60 * 1000) },
      ],
    };
    expect(getWindowedWithdrawalTotal(wallet)).toBe(200);
  });

  it('signale le solde insuffisant avant le plafond', async () => {
    // Un retrait trop gros declenche les DEUX conditions. Le solde doit gagner :
    // sinon le joueur lit « plafond 24 h atteint » alors qu il n a juste pas
    // l argent, ce qui est un message faux et une aide au depannage nulle.
    const user = await nouveauCompte();
    await depositToWallet(user.id, 60_000, 'test');
    await settle();

    await expect(
      withdrawFromWallet(user.id, 80_000, 'Moov Money', '+22997000000', { idempotencyKey: 'ord1' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    expect(getUserById(user.id).wallet.cashBalance, 'aucun debit').toBe(60_000);
  });

  it('refuse un retrait qui depasse le plafond cumule', async () => {
    const user = await nouveauCompte();
    await depositToWallet(user.id, 100_000, 'test');
    await settle();

    // Premier retrait : passe.
    await withdrawFromWallet(user.id, 30_000, 'Moov Money', '+22997000000', { idempotencyKey: 'p1' });
    // Second : le cumul depasse.
    await expect(
      withdrawFromWallet(user.id, 30_000, 'Moov Money', '+22997000000', { idempotencyKey: 'p2' })
    ).rejects.toMatchObject({ code: 'DAILY_WITHDRAWAL_LIMIT' });

    // Et le solde n a pas ete debit du second essai.
    expect(getUserById(user.id).wallet.cashBalance, 'le solde doit avoir ete debite du seul retrait passe').toBe(70_000);
  });

  it('laisse passer un retrait qui reste sous le plafond', async () => {
    const user = await nouveauCompte();
    await depositToWallet(user.id, 10_000, 'test');
    await settle();

    await expect(
      withdrawFromWallet(user.id, 1_000, 'Moov Money', '+22997000000', { idempotencyKey: 'ok1' })
    ).resolves.toBeTruthy();
  });
});