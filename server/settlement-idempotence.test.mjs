import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La garde d'idempotence des versements, et l'exclusion mutuelle par salon.
 *
 * Ces deux garanties-la sont en amont de tout le reste :
 *
 * - l'idempotence protege l'argent meme si un appelant rejoue par erreur,
 *   meme si l'etat du salon a ete perdu, meme apres un redemarrage ;
 * - le mutex protege l'etat du salon, pour que deux `finish` ne partent pas
 *   du meme instantane.
 *
 * Sans la premiere, les autres preuves de l'audit ne tiennent pas : un double
 * credit passait INVISIBLE, car `verifyDataIntegrity` compare
 * `lockedBalance` a la somme des reservations, pas le solde au journal.
 */

vi.mock('./persistence.mjs', () => ({
  getWalletSnapshot: vi.fn(),
  updateWalletSnapshot: vi.fn(),
}));

import { updateWalletSnapshot } from './persistence.mjs';
import { releaseWalletWinnings } from './wallet-engine.mjs';
import { withBrLobbyMutex } from './mutex.mjs';

/**
 * Un portefeuille PAR UTILISATEUR.
 *
 * Le mock doit respecter `userId` : sinon tous les joueurs partagent le meme
 * etat, et la garde d'idempotence — qui lit l'historique du portefeuille du
 * joueur — bloque a tort le deuxieme joueur. Un test qui echoue parce que son
 * double ne ressemble pas au serveur apprend a se mefier de lui-meme.
 */
const wallets = new Map();

const portefeuille = (userId, etat = walletVide()) => {
  wallets.set(userId, etat);
  updateWalletSnapshot.mockImplementation(async (uid, updater) => {
    const courant = wallets.get(uid);
    const next = updater(structuredClone(courant));
    Object.assign(courant, next);
    return { wallet: next };
  });
  return etat;
};

const walletVide = () => ({
  cashBalance: 0,
  bonusBalance: 0,
  lockedBalance: 0,
  pendingWinnings: 0,
  lockedEntries: {},
  transactions: [],
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Idempotence des versements', () => {
  it('un second versement identique ne credite RIEN', async () => {
    const etat = portefeuille('u1');
    etat.lockedEntries['BR-1'] = { amount: 50 };
    etat.lockedBalance = 50;

    await releaseWalletWinnings('u1', 400, 'BR-1', 'prize_win', 'Gain BR');
    const apresPremier = etat.cashBalance;
    await releaseWalletWinnings('u1', 400, 'BR-1', 'prize_win', 'Gain BR');

    expect(apresPremier).toBe(400);
    expect(etat.cashBalance, 'le solde ne doit pas bouger au second appel').toBe(400);
    expect(etat.transactions.filter((t) => t.type === 'prize_win')).toHaveLength(1);
  });

  it('la seconde tentative ne laisse ni trace ni reservation fantome', async () => {
    const etat = portefeuille('u1');
    etat.lockedEntries['BR-1'] = { amount: 50 };
    etat.lockedBalance = 50;

    await releaseWalletWinnings('u1', 400, 'BR-1', 'prize_win', 'Gain BR');
    await releaseWalletWinnings('u1', 400, 'BR-1', 'prize_win', 'Gain BR');

    // `lockedBalance` ne doit pas etre re-decremente, et l'historique ne doit
    // pas contain un second versement fantome : c'etait l'autre facon de
    // corrompre le portefeuille apres le double credit.
    expect(etat.lockedBalance).toBe(0);
    expect(Object.keys(etat.lockedEntries)).toHaveLength(0);
    expect(etat.transactions.filter((t) => t.type === 'prize_win')).toHaveLength(1);
  });

  it('un gain et une commission pour la MEME competition sont distincts', async () => {
    // L'arbitre touche sa part du pot ET peut avoir joue. Si les deux versements
    // partaient sur la meme cle, l'un des deux serait ecrase — un arbitre
    // joueur serait paye deux fois au lieu de gagner son gain puis sa
    // commission.
    const arb = portefeuille('arb');

    await releaseWalletWinnings('arb', 400, 'BR-1', 'prize_win', 'Gain BR');
    await releaseWalletWinnings('arb', 30, 'BR-1', 'arbitration_fee', 'Commission BR');

    expect(arb.cashBalance).toBe(430);
  });

  it('un joueur distinct sur la meme competition est bien paye', async () => {
    const u1 = portefeuille('u1');
    const u2 = portefeuille('u2');

    await releaseWalletWinnings('u1', 400, 'BR-1', 'prize_win', 'Gain BR');
    await releaseWalletWinnings('u2', 220, 'BR-1', 'prize_win', 'Gain BR');

    expect(u1.cashBalance).toBe(400);
    expect(u2.cashBalance).toBe(220);
  });

  it('une competition differente redonne le meme gain', async () => {
    // Garde anti-sur-corriger : la cle ne doit pas etre le seul `matchId`.
    const etat = portefeuille('u1');
    etat.lockedEntries['BR-1'] = { amount: 50 };
    etat.lockedEntries['BR-2'] = { amount: 50 };
    etat.lockedBalance = 100;

    await releaseWalletWinnings('u1', 400, 'BR-1', 'prize_win', 'Gain BR');
    await releaseWalletWinnings('u1', 500, 'BR-2', 'prize_win', 'Gain BR');

    expect(etat.cashBalance).toBe(900);
  });
});

describe('Exclusion mutuelle par salon BR', () => {
  it('deux actions sur le MEME salon ne se chevauchent jamais', async () => {
    const journal = [];
    let actives = 0;
    let maxi = 0;

    const action = (nom, delai) => async () => {
      actives += 1;
      maxi = Math.max(maxi, actives);
      journal.push(`${nom}:debut`);
      await new Promise((r) => setTimeout(r, delai));
      journal.push(`${nom}:fin`);
      actives -= 1;
    };

    await Promise.all([
      withBrLobbyMutex('BR-A', action('a', 20)),
      withBrLobbyMutex('BR-A', action('b', 20)),
    ]);

    expect(maxi, 'les deux actions ne doivent jamais se chevaucher').toBe(1);
    expect(journal).toEqual(['a:debut', 'a:fin', 'b:debut', 'b:fin']);
  });

  it('deux salons DIFFERENTS ne se bloquent pas mutuellement', async () => {
    const journal = [];
    let actives = 0;
    let maxi = 0;

    const action = (nom) => async () => {
      actives += 1;
      maxi = Math.max(maxi, actives);
      journal.push(`${nom}:debut`);
      await new Promise((r) => setTimeout(r, 10));
      journal.push(`${nom}:fin`);
      actives -= 1;
    };

    await Promise.all([
      withBrLobbyMutex('BR-A', action('a')),
      withBrLobbyMutex('BR-B', action('b')),
    ]);

    // Un verrou global aurait mis ce maximum a 1 et serialise tous les salons.
    expect(maxi).toBe(2);
  });

  it('le verrou est libere meme quand l action leve', async () => {
    await expect(withBrLobbyMutex('BR-A', async () => { throw new Error('boum'); }))
      .rejects.toThrow('boum');

    // Un verrou garde en cas d'exception rendrait le salon DEFINITIVEMENT
    // inaccessible : tous les `finish` suivants echoueraient.
    const reached = await withBrLobbyMutex('BR-A', async () => 'ok');
    expect(reached).toBe('ok');
  });
});