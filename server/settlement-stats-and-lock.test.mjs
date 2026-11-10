import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Deux pertes qui ne passent pas par le portefeuille.
 *
 * 1. Verrou orphelin : `lockEntryFee` puis `registeredPlayers.push` puis
 *    `saveLeagues` etaient trois etapes sans filet. Un plantage entre les deux
 *    laissait les ZC bloques chez un joueur ABSENT de la liste. Le sweeper ne
 *    parcourt que `registeredPlayers`, et `lockEntryFee` renvoyant
 *    `ALREADY_LOCKED`, ce joueur ne pouvait plus se reinscrire : ses ZC etaient
 *    perdus a jamais.
 *
 * 2. Statistiques rejouees : l'argent avait sa garde d'idempotence, pas les
 *    statistiques. Un reglement rejoue recredite zero ZC mais remettait `wins`,
 *    `totalEarnings`, l'elo, `leaguesPlayed` et l'XP une seconde fois.
 *    Le portefeuille etait sur, le classement faux.
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
  createUserAccount,
  getUserById,
  applyUserSettlementOnce,
} from './persistence.mjs';
import { depositToWallet, releaseWalletWinnings } from './wallet-engine.mjs';
import { joinLeagueSeasonOnServer } from './league-engine.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
const settle = () => new Promise((r) => setTimeout(r, 10));

let compteur = 0;
const nouveauCompte = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const joueur = await createUserAccount({
    pseudo: `Idem${compteur}${stamp}`.slice(0, 26),
    email: `idem-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-IDEM-${compteur}-${stamp}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  // Le pass de ligue est bloque a l inscription : sans solde, l appel echoue
  // avant meme d'atteindre le code que l on veut tester.
  await depositToWallet(joueur.id, 500, 'test');
  await settle();
  return joueur;
};

const saisonEnInscription = () => ({
  id: 'LS-VERROU',
  name: 'Ligue test',
  cycleNumber: 1,
  status: 'registering',
  entryFee: 50,
  maxPlayers: 100,
  registeredPlayers: [],
  schedule: {},
  payout: { gross: 0, first: 0, second: 0, third: 0 },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Idempotence des statistiques', () => {
  it('un second règlement de la même compétition ne touche pas les stats', async () => {
    const user = await nouveauCompte();

    const appliquer = () => applyUserSettlementOnce(user.id, 'match:M-1:win', (u) => {
      u.stats = { ...u.stats, wins: Number(u.stats?.wins || 0) + 1, totalEarnings: Number(u.stats?.totalEarnings || 0) + 500 };
      u.progression = { ...u.progression, xp: Number(u.progression?.xp || 0) + 120 };
      return u;
    });

    await appliquer();
    const apresPremier = getUserById(user.id).stats.wins;

    // Rejeu du règlement : c'est ce que fait un admin qui resoumet après un
    // echec de persistance, ou la reprise d'un cron.
    await appliquer();

    const stats = getUserById(user.id).stats;
    expect(apresPremier).toBe(1);
    expect(stats.wins, 'le gain ne doit pas etre compte deux fois').toBe(1);
    expect(stats.totalEarnings).toBe(500);
  });

  it('une compétition différente est bien comptée', async () => {
    const user = await nouveauCompte();

    await applyUserSettlementOnce(user.id, 'match:M-1:win', (u) => {
      u.stats = { ...u.stats, wins: Number(u.stats?.wins || 0) + 1 };
      return u;
    });
    await applyUserSettlementOnce(user.id, 'match:M-2:win', (u) => {
      u.stats = { ...u.stats, wins: Number(u.stats?.wins || 0) + 1 };
      return u;
    });

    expect(getUserById(user.id).stats.wins).toBe(2);
  });

  it('la clé est bornee : un joueur tres actif ne grossit pas sans fin', async () => {
    const user = await nouveauCompte();
    for (let i = 0; i < 1200; i += 1) {
      await applyUserSettlementOnce(user.id, `match:M-${i}:win`, (u) => u);
    }
    // La liste est plafonnee : le joueur tres actif ne sature pas le payload.
    expect(Array.isArray(getUserById(user.id).settlementKeys)).toBe(true);
    expect(getUserById(user.id).settlementKeys.length).toBeLessThanOrEqual(500);
  });

  it('l argent reste protege par sa propre garde', async () => {
    // Temoin : le portefeuille etait deja sur avant ce correctif. Les
    // statistiques, non — c'est ce que les deux tests precedents prouvent.
    const user = await nouveauCompte();
    const avant = getUserById(user.id).wallet.cashBalance;

    await releaseWalletWinnings(user.id, 400, 'BR-IDEM', 'prize_win', 'Gain');
    const apresPremier = getUserById(user.id).wallet.cashBalance;
    await releaseWalletWinnings(user.id, 400, 'BR-IDEM', 'prize_win', 'Gain');

    expect(apresPremier - avant).toBe(400);
    expect(getUserById(user.id).wallet.cashBalance, 'le gain ne doit pas etre recredite').toBe(apresPremier);
  });
});
