import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La base de calcul doit être l'instant relu en base, pas la copie locale.
 *
 * Le trou que l'OCC ne fermait pas
 * -------------------------------
 * L'OCC compare une revision lue avant l'ecriture. Il ferme la FENETRE — deux
 * ecritures qui se chevauchent. Il ne fermait pas la PERIMPTION.
 *
 *   A ecrit                      -> revision 6 en base, debit + cle "K"
 *   B demarre ensuite
 *     lit la revision 6          -> a jour, le CAS PASSERA
 *     calcule depuis sa memoire  -> anterieure a A
 *
 * Aucune conflict n'est detectable, parce qu'il n'y en a pas : B n'a pas perdu
 * une course, il a demarre apres. Le CAS passe, et le payload ecrit par A
 * disparait.
 *
 * Sur de l'argent, la suite est concrete. `trackWithdrawalKey` n'ecrit qu'en
 * memoire ; si B ecrase le payload de A, la cle d'idempotence ET le debit de A
 * disparaissent. Un rejeu du meme retrait avec la meme cle passe alors le
 * controle et declenche un SECOND versement FedaPay.
 *
 * Ce test reproduit exactement cette sequence : il n'y a aucun conflit a
 * detecter, et le resultat doit quand meme etre correct.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

const colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      const api = {
        select: () => api,
        upsert: (payload) => {
          if (name === 'app_users' && Object.keys(payload).some((k) => !colonnesUsers.includes(k))) {
            return Promise.resolve({ error: { message: 'column does not exist' } });
          }
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
            if (name === 'app_users' && Object.keys(api._patch).some((k) => !colonnesUsers.includes(k))) {
              return Promise.resolve({ error: { message: 'column does not exist' } }).then(resoudre);
            }
            // Condition CAS : aucune ligne si la revision n'est plus celle la.
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
  setOccSupportePourTest,
} from './persistence.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Base${compteur}${stamp}`.slice(0, 24),
    email: `base-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-BAS-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

const enBase = (userId) => lignes('app_users').find((r) => r.id === userId);
const soldeEnBase = (userId) => Number(enBase(userId)?.payload?.wallet?.cashBalance ?? -1);
const clesEnBase = (userId) => (enBase(userId)?.payload?.wallet?.transactions || []).map((t) => t?.metadata?.idempotencyKey).filter(Boolean);

beforeEach(() => {
  tables.clear();
  setOccSupportePourTest(true);
});

describe('Base de calcul — adoption du payload le plus recent', () => {
  it('une mutation ne peut pas ecraser un ecrit anterieur', async () => {
    const joueur = await nouveauJoueur();
    await updateUserAccount(joueur.id, (u) => {
      u.wallet = { ...(u.wallet || {}), cashBalance: 1000 };
      return u;
    });
    await settle();
    expect(soldeEnBase(joueur.id)).toBe(1000);

    // Instance A : retire 800 et enregistre sa cle d'idempotence.
    await updateUserAccount(joueur.id, (u) => {
      u.wallet = {
        ...u.wallet,
        cashBalance: u.wallet.cashBalance - 800,
        transactions: [...(u.wallet.transactions || []), { type: 'withdraw', amount: -800, status: 'completed', metadata: { idempotencyKey: 'K-1' } }],
      };
      return u;
    });
    await settle();
    expect(soldeEnBase(joueur.id), 'A a ecrit').toBe(200);
    expect(clesEnBase(joueur.id)).toContain('K-1');

    // On simule l'instance B : sa copie memoire est ANTERIEURE a A. C'est le
    // point — la memoire est forcee a l'ancien etat, comme si B n'avait pas
    // rechargé depuis le deploiement de A.
    const { forceUserCache } = await import('./persistence.mjs');
    const ancien = { ...enBase(joueur.id).payload };
    ancien.wallet = { ...ancien.wallet, cashBalance: 1000, transactions: [] };
    forceUserCache(joueur.id, ancien);

    // B ecrit ensuite : aucun conflit n'est detectable, et c'est bien le cas.
    await updateUserAccount(joueur.id, (u) => {
      u.wallet = { ...u.wallet, cashBalance: u.wallet.cashBalance + 500 };
      return u;
    });
    await settle();

    expect(
      soldeEnBase(joueur.id),
      'A (1000 - 800) puis B (+500) : les deux mouvements doivent se cumuler'
    ).toBe(700);
  });

  it('la cle d idempotence de A survit a l ecriture de B', async () => {
    // C est le test qui vaut de l argent : sans lui, un rejeu du retrait de A
    // passerait le controle et provoquerait un second versement.
    const joueur = await nouveauJoueur();
await updateUserAccount(joueur.id, (u) => {
        u.wallet = {
          ...(u.wallet || {}),
          cashBalance: 1000,
          // La cle doit etre portee par l'HISTORIQUE, pas par un champ
          // `withdrawalKeys` : la cle en memoire (`memoryWithdrawalKeys`) n'est
          // pas serialisee, et `normalizeWalletSnapshot` ne conserve que les
          // champs qu'il liste. Le repli d'idempotence apres redemarrage lit
          // bien `transactions[].metadata.idempotencyKey`.
          transactions: [{ type: 'withdraw', amount: 0, status: 'completed', metadata: { idempotencyKey: 'K-A' } }],
        };
        return u;
      });
    await settle();

    const { forceUserCache } = await import('./persistence.mjs');
    const ancien = { ...enBase(joueur.id).payload };
    ancien.wallet = { ...ancien.wallet, cashBalance: 1000, transactions: [] };
    forceUserCache(joueur.id, ancien);

    await updateUserAccount(joueur.id, (u) => {
      u.wallet = { ...u.wallet, cashBalance: u.wallet.cashBalance + 10 };
      return u;
    });
    await settle();

    expect(
      clesEnBase(joueur.id),
      'la cle de A ne doit pas disparaitre : un second versement serait possible'
    ).toContain('K-A');
  });
});