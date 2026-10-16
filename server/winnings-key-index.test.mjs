import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Ces tests exercent la VRAIE logique de l'index : seul le client Supabase est
 * remplace.
 *
 * `ZOYD_DISABLE_SUPABASE` ne peut pas etre pose ici : les imports ESM sont
 * evaluates AVANT toute instruction du module, donc l'environnement serait
 * defini apres coup. Et un vrai client joignable fait echouer les ecritures, ce
 * qui declenche le rollback memoire de `updateUserAccount` et casse le test
 * pour une raison sans rapport.
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

/**
 * L'historique de transactions d'un portefeuille est plafonne a 200 entrees.
 *
 * La garde d'idempotence des gains lisait CE historique. Au-dela de 200
 * transactions, la cle du gain disparaissait et la garde redeviendrait
 * inopérante : un joueur tres actif pouvait se voir recredite un gain deja
 * verse — exactement le double versement que la garde existait pour empecher.
 *
 * Le projet avait deja identifie ce piege pour les RETRAITS, et construit un
 * index dedie pour y echapper. Ces tests verrouillent que les gains
 * beneficient du meme traitement.
 */

import {
  createUserAccount,
  updateWalletSnapshot,
  hasSettledWinningsKey,
  trackWinningsKey,
  hydrateWinningsKeys,
  getWalletSnapshot,
} from './persistence.mjs';
import { releaseWalletWinnings } from './wallet-engine.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
let compteur = 0;

const nouveauCompte = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  // 10 chiffres apres +225, format valide : `0700` + 6 chiffres. Un format
  // invente rendrait le test invalide pour une raison etrangere au sujet.
  const phone = `+2250700${String((Date.now() % 100000) + compteur * 13).padStart(6, '0').slice(-6)}`;
  return createUserAccount({
    pseudo: `CleGain${compteur}${stamp}`.slice(0, 28),
    email: `cle-gain-${compteur}-${stamp}@test.local`,
    phone,
    gameId: `CO-CLE-${compteur}-${stamp}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
};

/** Remplit l'historique de transactions du joueur, comme l'activite reelle le fait. */
const noyerLHistorique = async (userId, nombre) => {
  await updateWalletSnapshot(userId, (wallet) => ({
    ...wallet,
    transactions: [
      ...Array.from({ length: nombre }, (_, i) => ({
        id: `TX-BRUIT-${userId}-${i}`,
        type: 'chat',
        amount: 0,
        status: 'completed',
        timestamp: new Date().toISOString(),
      })),
      ...(Array.isArray(wallet.transactions) ? wallet.transactions : []),
    ].slice(0, 200),
  }));
};

beforeEach(() => {
  hydrateWinningsKeys();
});

describe("L'index des cles de gain ne depend pas de l'historique", () => {
  it('un gain reste bloque au-dela de 200 transactions', async () => {
    const user = await nouveauCompte();
    await releaseWalletWinnings(user.id, 400, 'BR-LIMITE', 'prize_win', 'Gain BR');
    expect(getWalletSnapshot(user.id).cashBalance).toBe(400);

    // Le joueur continue a jouer : son historique deborde.
    await noyerLHistorique(user.id, 250);
    expect(getWalletSnapshot(user.id).transactions).toHaveLength(200);

    // La cle du gain n'est plus dans l'historique...
    const cle = 'prize_win:BR-LIMITE';
    const dansHistorique = getWalletSnapshot(user.id).transactions
      .some((tx) => `${tx.type}:${tx.matchId}` === cle);
    expect(dansHistorique, 'la cle a bien disparu des 200 dernieres').toBe(false);

    // ... mais le gain ne doit MALGRE TOUT pas etre recredite.
    await releaseWalletWinnings(user.id, 400, 'BR-LIMITE', 'prize_win', 'Gain BR');
    expect(
      getWalletSnapshot(user.id).cashBalance,
      'le solde ne doit pas bouger : le gain etait deja verse'
    ).toBe(400);
  });

  it('un gain et une commission distincts ne se bloquent pas entre eux', async () => {
    const user = await nouveauCompte();
    await releaseWalletWinnings(user.id, 400, 'BR-MIXTE', 'prize_win', 'Gain BR');
    await releaseWalletWinnings(user.id, 30, 'BR-MIXTE', 'arbitration_fee', 'Commission');
    expect(getWalletSnapshot(user.id).cashBalance).toBe(430);
  });

  it('l index se reconstruit apres redemarrage, dans la fenetre de l historique', async () => {
    const user = await nouveauCompte();
    await releaseWalletWinnings(user.id, 400, 'BR-HYDRAT', 'prize_win', 'Gain BR');

    // On simule un redemarrage : plus aucun index en memoire, seuls les
    // portefeuilles charges subsistent.
    hydrateWinningsKeys();

    expect(hasSettledWinningsKey(user.id, 'prize_win:BR-HYDRAT')).toBe(true);
    await releaseWalletWinnings(user.id, 400, 'BR-HYDRAT', 'prize_win', 'Gain BR');
    expect(getWalletSnapshot(user.id).cashBalance).toBe(400);
  });

  it('la cle survit a un redemarrage AU-DELA de 200 transactions', async () => {
    // C'etait la limite documentee : l'index se reconstruisait depuis
    // l'historique, plafonne a 200. Un gain sorti de cette fenetre devenait
    // inconnu apres redemarrage, et la garde d'idempotence redevenait
    // inopérante — donc recreditable.
    //
    // La cle vit desormais dans `wallet.winningsKeys`, donc dans le payload du
    // compte : ni plafonne, ni perdu.
    const user = await nouveauCompte();
    await releaseWalletWinnings(user.id, 400, 'BR-PERDU', 'prize_win', 'Gain BR');
    await noyerLHistorique(user.id, 250);

    // La transaction a disparu des 200 dernieres...
    const cleDansHistorique = getWalletSnapshot(user.id).transactions
      .some((tx) => `${tx.type}:${tx.matchId}` === 'prize_win:BR-PERDU');
    expect(cleDansHistorique, 'la transaction est bien sortie de la fenetre').toBe(false);

    // ... mais la cle, elle, a survecu au redemarrage.
    hydrateWinningsKeys();

    expect(
      hasSettledWinningsKey(user.id, 'prize_win:BR-PERDU', getWalletSnapshot(user.id)),
      'la cle doit survivre hors de l historique'
    ).toBe(true);

    await releaseWalletWinnings(user.id, 400, 'BR-PERDU', 'prize_win', 'Gain BR');
    expect(getWalletSnapshot(user.id).cashBalance, 'le gain ne doit pas etre recredite').toBe(400);
  });
});

describe("L'index des cles de gain reste borne", () => {
  it('un joueur tres actif ne fait pas croitre l index indefiniment', () => {
    // Sans borne, la Map memorialiserait un Set par joueur et le processus
    // grossirait sans limite. Une competition = une cle, donc 500 entrees
    // couvrent deja un tres long historique de gains.
    for (let i = 0; i < 1200; i += 1) {
      trackWinningsKey('u-lourd', `prize_win:BR-${i}`);
    }
    expect(hasSettledWinningsKey('u-lourd', 'prize_win:BR-0')).toBe(false);
    expect(hasSettledWinningsKey('u-lourd', 'prize_win:BR-1199')).toBe(true);
  });
});