import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const query = {
        eq: vi.fn(() => query), lt: vi.fn(() => query), in: vi.fn(() => query),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => query), update: vi.fn(() => query),
        select: vi.fn(() => query),
        range: vi.fn(() => Promise.resolve({ data: [], error: null })),
        then: (onOk) => Promise.resolve({ data: [], error: null }).then(onOk),
      };
      return query;
    }),
  },
}));

import * as persistence from './persistence.mjs';

const PASSWORD = 'MotDePasse!Solide2026';

let stamp = 0;
const makeIdent = () => {
  stamp += 1;
  const unique = `${Date.now() % 1_000_000}${stamp}`;
  return {
    pseudo: `Diffu${unique}`,
    email: `diffu-${unique}@test.local`,
    phone: `+22507${unique.slice(-8).padStart(8, '0')}`,
    gameId: `CO-DIF-${unique}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
    acceptedAt: new Date().toISOString(),
  };
};

/**
 * Le serveur emettait le portefeuille a personne.
 *
 * Consequence : un joueur qui retirait dans un onglet laissait tous les autres
 * onglets afficher l'ancien solde jusqu'au rechargement complet. Les onglets se
 * contredisaient donc affichage contre affichage, sans qu'aucun serveur ne soit
 * en cause.
 *
 * On verifie que TOUTE mutation de solde converge vers le listener, et qu'elle
 * y porte le portefeuille ENTIER : diffuser le seul `cashBalance` manquerait les
 * mises en séquestre, les cagnottes gelées et les gains en attente, qui
 * changent l'ecran sans jamais réécrire le total.
 */
describe('diffusion temps reel du portefeuille', () => {
  let received;

  beforeEach(() => {
    received = [];
    persistence.onWalletUpdated((userId, wallet) => received.push({ userId, wallet }));
  });

  it('diffuse apres une mutation de solde', async () => {
    const user = await persistence.createUserAccount(makeIdent());
    received.length = 0;

    await persistence.updateWalletSnapshot(user.id, (wallet) => {
      wallet.cashBalance = 500;
      return wallet;
    });

    expect(received).toHaveLength(1);
    expect(received[0].userId).toBe(user.id);
    expect(received[0].wallet.cashBalance).toBe(500);
  });

  it('diffuse le portefeuille entier, pas seulement le cash', async () => {
    const user = await persistence.createUserAccount(makeIdent());
    received.length = 0;

    await persistence.updateWalletSnapshot(user.id, (wallet) => {
      wallet.cashBalance = 100;
      // Une entree en sequestre (frais de retrait) ne touche pas au cash mais
      // change ce que le joueur voit : `lockedBalance` doit suivre.
      wallet.lockedBalance = 12;
      wallet.pendingWinnings = 30;
      return wallet;
    });

    const { wallet } = received[0];
    expect(wallet.lockedBalance).toBe(12);
    expect(wallet.pendingWinnings).toBe(30);
  });

  it('ne diffuse que le compte concerne', async () => {
    const a = await persistence.createUserAccount(makeIdent());
    const b = await persistence.createUserAccount(makeIdent());
    received.length = 0;

    await persistence.updateWalletSnapshot(a.id, (wallet) => ({ ...wallet, cashBalance: 42 }));

    expect(received).toHaveLength(1);
    expect(received[0].userId).toBe(a.id);
    expect(received[0].userId).not.toBe(b.id);
  });

  it('n emet rien quand aucun listener n est branche', async () => {
    const user = await persistence.createUserAccount(makeIdent());
    persistence.onWalletUpdated(null);

    // Une mutation doit aboutir MEME sans diffuseur : l'argent est ecrit, seul
    // l'affichage decale. Une exception ici casserait les retraits.
    await expect(
      persistence.updateWalletSnapshot(user.id, (wallet) => ({ ...wallet, cashBalance: 7 })),
    ).resolves.toBeTruthy();

    const apres = persistence.getUserById(user.id);
    expect(apres.walletBalance).toBe(7);
  });

  it('un listener qui leve ne fait pas echouer la mutation', async () => {
    const user = await persistence.createUserAccount(makeIdent());
    persistence.onWalletUpdated(() => {
      throw new Error('socket casse');
    });

    await expect(
      persistence.updateWalletSnapshot(user.id, (wallet) => ({ ...wallet, cashBalance: 99 })),
    ).resolves.toBeTruthy();

    expect(persistence.getUserById(user.id).walletBalance).toBe(99);
    persistence.onWalletUpdated(null);
  });
});