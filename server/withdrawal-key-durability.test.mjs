import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La clé d'idempotence d'un retrait doit survivre à l'historique.
 *
 * Le trou
 * -------
 * L'historique du portefeuille est plafonné à 200 entrées
 * (`wallet-engine.mjs:90`, `.slice(0, 200)`). L'index des clés de retrait
 * vivait dans une Map mémoire séparée — donc jamais persistée. Le seul filet
 * restant était le balayage de cet historique, lui-même plafonné.
 *
 * Au-delà de 200 transactions, la clé disparaissait des deux côtés :
 *
 *   `hasActiveWithdrawalKey` ne la trouvait plus → un rejeu du même retrait
 *   avec la même clé passait le contrôle → SECOND versement FedaPay, sans
 *   lien avec quoi que ce soit de rattestable.
 *
 * Le dépôt résout déjà ce problème pour les gains (`winningsKeys` +
 * `hydrateWinningsKeys`). Ici on vérifie que les retraits suivent le même
 * motif, et que la clé est bien PERSISTÉE.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      const api = {
        select: () => api,
        upsert: (payload) => {
          const liste = lignes(name);
          const cle = payload.id !== undefined ? 'id' : 'token';
          const i = liste.findIndex((r) => r[cle] === payload[cle]);
          if (i >= 0) liste[i] = { ...liste[i], ...payload };
          else liste.push({ ...payload });
          return Promise.resolve({ error: null });
        },
        update: (patch) => { api._patch = patch; return api; },
        delete: () => { api._suppression = true; return api; },
        insert: (payload) => Promise.resolve({ error: null }),
        eq: (c, v) => { f[c] = v; return api; },
        order: () => api,
        limit: () => api,
        range: () => api,
        then: (resoudre) => {
          const cibles = lignes(name).filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
          if (api._suppression) {
            for (const c of cibles) lignes(name).splice(lignes(name).indexOf(c), 1);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          if (api._patch) {
            for (const c of cibles) Object.assign(c, api._patch);
            return Promise.resolve({ error: null, data: cibles.map((c) => ({ id: c.id })) }).then(resoudre);
          }
          return Promise.resolve({ data: cibles, error: null }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

import {
  createUserAccount,
  updateUserAccount,
  trackWithdrawalKey,
  forgetWithdrawalKey,
  hasActiveWithdrawalKey,
hydrateWithdrawalKeys,
getUserById,
} from './persistence.mjs';
import { depositToWallet } from './wallet-engine.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Cle${compteur}${stamp}`.slice(0, 24),
    email: `cle-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-CLE-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

const enBase = (userId) => lignes('app_users').find((r) => r.id === userId);

beforeEach(() => tables.clear());

describe('Cle d idempotence de retrait — hors historique', () => {
  it('la cle est persistee dans le portefeuille', async () => {
    const joueur = await nouveauJoueur();
    trackWithdrawalKey(joueur.id, 'K-PERSISTEE');
    // La persistance se fait avec l'ecriture suivante (le debit).
    await updateUserAccount(joueur.id, (u) => u);
    await settle();

    expect(
      enBase(joueur.id).payload.wallet.withdrawalKeys,
      'la cle doit vivre dans le portefeuille, pas seulement en RAM'
    ).toContain('K-PERSISTEE');
  });

  it('survit a une fenetre de plus de 200 transactions', async () => {
    const joueur = await nouveauJoueur();
    trackWithdrawalKey(joueur.id, 'K-ANCIENNE');
    await updateUserAccount(joueur.id, (u) => {
      u.wallet = {
        ...u.wallet,
        transactions: [{ type: 'withdraw', amount: -500, status: 'completed', metadata: { idempotencyKey: 'K-ANCIENNE' } }],
      };
      return u;
    });
    await settle();
    expect(enBase(joueur.id).payload.wallet.transactions.length).toBe(1);

    // 250 transactions REELLEMENT ecrites par le moteur : c'est `withTransaction`
    // qui applique `.slice(0, 200)`. Injecter le tableau a la main contournerait
    // le plafond et ne prouverait rien.
    for (let i = 0; i < 250; i += 1) {
      await depositToWallet(joueur.id, 10, `remplissage ${i}`);
    }
    await settle();

    const wallet = getUserById(joueur.id).wallet;
    expect(wallet.transactions.length, 'la fenetre de 200 s applique').toBe(200);
    const horsFenetre = wallet.transactions.some((t) => t?.metadata?.idempotencyKey === 'K-ANCIENNE');
    expect(horsFenetre, 'le retrait doit etre sorti de la fenetre').toBe(false);

    // Le controle d'idempotence ne doit pourtant pas laisser passer un rejeu.
    expect(
      hasActiveWithdrawalKey(joueur.id, 'K-ANCIENNE', wallet.transactions),
      'sinon un second versement FedaPay est possible'
    ).toBe(true);
  });

  it('reconstitue l index apres redemarrage', async () => {
    const joueur = await nouveauJoueur();
    trackWithdrawalKey(joueur.id, 'K-AVEC-REDEMARRAGE');
    await updateUserAccount(joueur.id, (u) => u);
    await settle();

    // Simulation du redemarrage : plus aucun historique exploitable.
    await updateUserAccount(joueur.id, (u) => ({
      ...u,
      wallet: { ...u.wallet, transactions: [] },
    }));
    await settle();
    hydrateWithdrawalKeys();

    expect(
      hasActiveWithdrawalKey(joueur.id, 'K-AVEC-REDEMARRAGE', []),
      'le champ dedie doit suffire a reconstituer l index'
    ).toBe(true);
  });

  it('une cle brulee disparait bien du champ dedie', async () => {
    const joueur = await nouveauJoueur();
    trackWithdrawalKey(joueur.id, 'K-BRULEE');
    await updateUserAccount(joueur.id, (u) => u);
    await settle();
    expect(hasActiveWithdrawalKey(joueur.id, 'K-BRULEE', [])).toBe(true);

    forgetWithdrawalKey(joueur.id, 'K-BRULEE');
    await updateUserAccount(joueur.id, (u) => u);
    await settle();

    expect(
      hasActiveWithdrawalKey(joueur.id, 'K-BRULEE', []),
      'une cle brulee ne doit pas bloquer un retrait legitime'
    ).toBe(false);
  });
});