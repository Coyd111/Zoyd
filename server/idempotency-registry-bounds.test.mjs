import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Registres d'idempotence bornes (concurrence).
 *
 * Les deux registres (`memoryWithdrawalKeys`, `memoryWinningsKeys`) sont des
 * `Map` : une entree par JOUEUR. Le nombre de cles par joueur etait borne
 * (500), mais le nombre de JOUEURS suivis ne l'etait pas : la Map
 * grossissait lineairement avec la base, sans jamais purger.
 *
 * Consequence concrete : Render garde le processus en vie, la RAM non. Une
 * entree vaut jusqu'a 500 cles (~20 ko), donc 5 000 joueurs suivis
 * representent ~100 mo de cles en memoire — pour une information qui existe
 * DEJA dans le portefeuille de chaque joueur.
 *
 * Le second piege est plus grave : l'eviction des cles d'un joueur tres actif
 * evictait la plus ANCIENNE, sans distinction. Une cle dont le PAIEMENT EST
 * EN ATTENTE pouvait donc disparaitre — et c'est precisement elle qui
 * empeche un rejeu de declencher un SECOND transfert Mobile Money pendant que
 * le premier est en suspens.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Le nombre de joueurs suivis est borne.
 * 2. L'eviction d'un joueur ne PERD PAS sa protection : la cle est relue
 *    depuis le portefeuille (source de verite).
 * 3. Une cle de paiement EN ATTENTE n'est jamais evincee.
 * 4. Une cle en attente reste bloquee meme si l'index memoire l'a oubliee
 *    (la file `payoutsEnAttente` n'est pas tronquee : elle fait foi).
 */

// ─── Faux client Supabase ────────────────────────────────────────────────────
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
  hasActiveWithdrawalKey,
  getUserById,
  getIdempotencyRegistrySizesForTests,
} from './persistence.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  return createUserAccount({
    pseudo: `Cle${compteur}${stamp}`.slice(0, 24),
    email: `cle-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-CLE-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
};

beforeEach(() => {
  tables.clear();
  getIdempotencyRegistrySizesForTests()?.reset?.();
});

describe('Registres d idempotence — nombre de joueurs borne', () => {
  it('le registre ne suit pas un nombre illimite de joueurs', async () => {
    // 60 joueurs, chacun avec une cle : le registre doit rester SOUS son
    // plafond de joueurs suivis. Sans plafond, la Map grossirait avec la
    // base et ne serait jamais purgee.
    for (let i = 0; i < 60; i += 1) {
      const joueur = await nouveauJoueur();
      trackWithdrawalKey(joueur.id, `K-${i}`);
    }

    const tailles = getIdempotencyRegistrySizesForTests();
    expect(tailles.withdrawalUsers, 'le nombre de joueurs suivis doit rester borne').toBeLessThanOrEqual(tailles.maxUsers);
    expect(tailles.withdrawalUsers).toBeGreaterThan(0);
  });

  it('l eviction d un joueur ne PERD PAS sa protection', async () => {
    const joueur = await nouveauJoueur();
    trackWithdrawalKey(joueur.id, 'K-CONSERVEE');
    await updateUserAccount(joueur.id, (u) => u);
    await settle();

    // On force l'eviction du cache du joueur (le registre est un CACHE
    // devant le portefeuille) : la cle doit etre relue depuis le portefeuille.
    getIdempotencyRegistrySizesForTests().evictAll?.();

    expect(
      hasActiveWithdrawalKey(joueur.id, 'K-CONSERVEE', []),
      'la cle doit survivre a l eviction du cache memoire',
    ).toBe(true);
  });
});

describe('Registres d idempotence — une cle en attente n est jamais evincee', () => {
  it('la cle d un paiement en attente reste bloquee meme apres eviction', async () => {
    const joueur = await nouveauJoueur();

    // Le joueur a un retrait dont le PAIEMENT EST EN ATTENTE : c'est le cas
    // le plus dangereux (FedaPay a pu envoyer l'argent sans que la reponse
    // arrive). Un rejeu declencherait un SECOND transfert.
    await updateUserAccount(joueur.id, (u) => ({
      ...u,
      wallet: {
        ...u.wallet,
        payoutsEnAttente: [{
          payoutId: 'PAYOUT-1',
          txId: 'TX-1',
          idempotencyKey: 'K-EN-ATTENTE',
          since: new Date().toISOString(),
        }],
      },
    }));
    await settle();

    trackWithdrawalKey(joueur.id, 'K-EN-ATTENTE');

    // On simule l'oubli de l'index memoire (le cas le plus defavorable :
    // redemarrage, ou eviction par le plafond de cles).
    getIdempotencyRegistrySizesForTests().evictAll?.();

    expect(
      hasActiveWithdrawalKey(joueur.id, 'K-EN-ATTENTE', []),
      'un retrait dont le paiement est en attente doit rester bloque : sinon un rejeu paie deux fois',
    ).toBe(true);
  });

  it('le plafond de cles n evince pas une cle en attente', async () => {
    const joueur = await nouveauJoueur();

    // Un retrait en attente, plus une cle ordinaire.
    await updateUserAccount(joueur.id, (u) => ({
      ...u,
      wallet: {
        ...u.wallet,
        payoutsEnAttente: [{
          payoutId: 'PAYOUT-2',
          txId: 'TX-2',
          idempotencyKey: 'K-PIEGE',
          since: new Date().toISOString(),
        }],
      },
    }));
    await settle();

    // On remplit l'index au-dela du plafond avec des cles ordinaires : la
    // cle en attente doit SURVIVRE a la purge.
    trackWithdrawalKey(joueur.id, 'K-PIEGE');
    for (let i = 0; i < 600; i += 1) {
      trackWithdrawalKey(joueur.id, `K-REMPLISSAGE-${i}`);
    }

    expect(
      hasActiveWithdrawalKey(joueur.id, 'K-PIEGE', []),
      'la cle du paiement en attente ne doit jamais etre evincee pour gagner de la place',
    ).toBe(true);
  });
});
