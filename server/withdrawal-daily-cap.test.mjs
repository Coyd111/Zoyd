import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Plafond de retraits cumule sur 24 h.
 *
 * La route ne borne que la TRANSACTION (5 000 000 ZC). Sans cumul, un joueur
 * pouvait enchainer les retraits jusqu a vider son solde : le seul frein etait
 * le rate limiter (20 requetes / 10 min par IP), contournable trivialement ─│
 * depuis plusieurs IP, ou simplement en attendant.
 *
 * Le cumul vit dans un registre dedie du portefeuille (`retraitCumul`,
 * P4 C2 audit-3) : non plafonne par l'activite du joueur — l'historique, lui,
 * est plafonne a 200 entrees et un bourrage y poussait les retraits hors de
 * la fenetre. Il vit DANS le portefeuille, donc persiste et survit a un
 * redemarrage ; l'historique reste lu en heritage pour les portefeuilles
 * anterieurs au registre.
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
import { createUserAccount, getUserById, tagWalletTransaction } from './persistence.mjs';

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

  it('lit le registre dedie et l historique heritage sans compter deux fois (P4 C2)', () => {
    // TX-A est dans les DEUX sources (retrait recent : registre + historique) :
    // sans dedoublonnage, il compterait 1400 au lieu de 1000. TX-B n est que
    // dans le registre, TX-C que dans l historique (portefeuille anterieur
    // au registre). Les deux sources se completent, elles ne s additionnent
    // pas en double.
    const wallet = {
      transactions: [
        { id: 'TX-A', type: 'withdraw', amount: -700, status: 'completed', timestamp: ilYA(60 * 60 * 1000) },
        { id: 'TX-C', type: 'withdraw', amount: -100, status: 'completed', timestamp: ilYA(45 * 60 * 1000) },
      ],
      retraitCumul: [
        { txId: 'TX-A', timestamp: ilYA(60 * 60 * 1000), amount: 700 },
        { txId: 'TX-B', timestamp: ilYA(30 * 60 * 1000), amount: 200 },
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

  it('le plafond survit au bourrage de l historique (registre dedie, P4 C2)', async () => {
    // L'historique est plafonne a 200 entrees. Avant le registre dedie, un
    // joueur le bourrait de transactions sans retrait (des depots de 1 ZC :
    // aucune garde sur leur frequence) pour pousser ses retraits hors de la
    // fenetre et remettre le cumul a zero — le plafond ne limitait plus rien.
    // Le registre `retraitCumul` n'est PAS plafonne : le premier retrait
    // reste consigne apres le bourrage.
    const user = await nouveauCompte();
    await depositToWallet(user.id, 100_000, 'test');
    await settle();

    await withdrawFromWallet(user.id, 30_000, 'Moov Money', '+22997000000', { idempotencyKey: 'b1' });

    // Bourrage : 200 ecritures generales, aucune n est un retrait.
    for (let i = 0; i < 200; i += 1) {
      await depositToWallet(user.id, 1, 'test');
    }
    await settle();

    await expect(
      withdrawFromWallet(user.id, 30_000, 'Moov Money', '+22997000000', { idempotencyKey: 'b2' })
    ).rejects.toMatchObject({ code: 'DAILY_WITHDRAWAL_LIMIT' });

    // Le registre raconte ce que la fenetre 200 a perdu.
    expect(getUserById(user.id).wallet.retraitCumul.some((e) => e?.amount === 30_000)).toBe(true);
  });

  it('un retrait refuse ne compte plus apres le tag d echec (registre purge, P4 C2)', async () => {
    // La remise FedaPay est refusee : le retrait est re-tagge failed ET
    // rembourse. L'entree correspondante sort du registre, sinon le cumul
    // resterait gonfle et bloquerait un joueur legitime.
    const user = await nouveauCompte();
    await depositToWallet(user.id, 100_000, 'test');
    await settle();

    await withdrawFromWallet(user.id, 30_000, 'Moov Money', '+22997000000', { idempotencyKey: 'f1' });

    const retrait = getUserById(user.id).wallet.transactions.find((t) => t?.type === 'withdraw');
    await tagWalletTransaction(user.id, retrait.id, { payoutStatus: 'failed', status: 'failed' });
    await settle();

    expect(getUserById(user.id).wallet.retraitCumul, 'l entree echouee sort du registre').toHaveLength(0);
    await expect(
      withdrawFromWallet(user.id, 30_000, 'Moov Money', '+22997000000', { idempotencyKey: 'f2' })
    ).resolves.toBeTruthy();
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