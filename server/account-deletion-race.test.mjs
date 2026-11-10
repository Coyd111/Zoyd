import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Une suppression de compte ne doit jamais être annulée par une écriture.
 *
 * Le trou
 * -------
 * Toutes les mutations de portefeuille convergent dans `ecrireUserRow`. Quand la
 * ligne `app_users` était absente, ce helper faisait un `upsert` — donc un
 * INSERT. Or « ligne absente » a deux causes très différentes :
 *
 *   - le compte n'a jamais existé (creation) ;
 *   - le compte vient d'être SUPPRIME par un administrateur.
 *
 * La seconde se heurte à la première : un upsert réinsère la ligne. Concrètement,
 * une suppression d'admin (un tricheur) qui perd la course contre un retrait en
 * cours ressusciterait le compte — avec son solde — et le bannissement qui venait
 * d'être posé.
 *
 * Le site de suppression signalait DÉJÀ ce risque (« ressusciter au prochain
 * démarrage, solde compris ») : il était juste limité au rechargement, pas à
 * l'écriture concurrente que l'OCC rend possible.
 *
 * Le défaut est donc inversé : par défaut, une ligne absente est une
 * suppression en cours et l'écriture est refusée. Seule la création déclare
 * explicitement le contraire.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

let colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      const api = {
        select: (cols) => {
          const demandees = String(cols).split(',').map((c) => c.trim()).filter((c) => c !== '*');
          if (name === 'app_users' && demandees.some((c) => !colonnesUsers.includes(c))) {
            api._colonneManquante = true;
          }
          return api;
        },
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
          if (api._colonneManquante) {
            return Promise.resolve({ data: null, error: { message: 'column does not exist' } }).then(resoudre);
          }
          const cibles = lignes(name).filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
          if (api._suppression) {
            for (const c of cibles) lignes(name).splice(lignes(name).indexOf(c), 1);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          if (api._patch) {
            if (name === 'app_users' && Object.keys(api._patch).some((k) => !colonnesUsers.includes(k))) {
              return Promise.resolve({ error: { message: 'column does not exist' } }).then(resoudre);
            }
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
    pseudo: `Sup${compteur}${stamp}`.slice(0, 24),
    email: `sup-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-SUP-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

const enBase = (userId) => lignes('app_users').find((r) => r.id === userId);

beforeEach(() => {
  tables.clear();
  colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];
  setOccSupportePourTest(true);
});

describe('Suppression concurrente — pas de resurrection', () => {
  it('une mutation ne reinere pas une ligne supprimee', async () => {
    const joueur = await nouveauJoueur();
    expect(enBase(joueur.id), 'le compte doit exister au depart').toBeTruthy();

    // L admin supprime le compte entre deux mutations.
    const i = lignes('app_users').findIndex((r) => r.id === joueur.id);
    lignes('app_users').splice(i, 1);

    // La mutation suivante (ici : un credit) ne doit pas le recreer.
    await expect(
      updateUserAccount(joueur.id, (u) => {
        u.wallet = { ...(u.wallet || {}), cashBalance: 999_999 };
        return u;
      })
    ).rejects.toMatchObject({ code: 'SERVER_BUSY' });

    expect(enBase(joueur.id), 'le compte ne doit surtout pas ressusciter').toBeFalsy();
  });

  it('la creation, elle, declare explicitement son statut', async () => {
    // Seule la creation a le droit de inserer une ligne absente. Si elle
    //otheait ce droit, le test precedent necaught plus rien.
    await nouveauJoueur();
    const avant = lignes('app_users').length;
    const autre = await nouveauJoueur();
    expect(lignes('app_users').length).toBe(avant + 1);
    expect(enBase(autre.id)).toBeTruthy();
  });
});