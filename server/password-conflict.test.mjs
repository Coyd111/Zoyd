import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Un changement de mot de passe ne doit jamais se perdre en silence.
 *
 * Le scénario
 * -----------
 * Trois chemins d'écriture de `app_users` n'avaient pas de rejeu : en cas de
 * conflit, l'écriture etait simplement PERDUE, avec un log ERROR. Pour un
 * portefeuille, perdre une écriture est deja grave. Pour un mot de passe,
 * c'est le pire cas conceivable :
 *
 *   1. l'utilisateur change son mot de passe ;
 *   2. une autre instance ecrit entre-temps -> conflit ;
 *   3. l'ecriture est jetee, l'ancien hash reste en base ;
 *   4. le client affiche « mot de passe modifie ».
 *
 * L'utilisateur a fait la bonne gesture et croit etre protege. L'ancien mot de
 * passe, lui, reste valable jusqu'au prochain redemarrage du serveur — moment ou
 * le cache est recharge et ou ce qu il croyait avoir change ressuscite.
 *
 * Le correctif a deux moities, et il faut les deux :
 *   - le rejeu repart du payload FRAIS et n'y applique que l'intention de
 *     l'operation (le nouveau hash), sans jamais reecrire notre copie perimee ;
 *   - en cas d'echec final, le client est PREVENU au lieu de recevoir un succes.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

let colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

/** Declenche une ecriture concurrente juste apres notre lecture de revision. */
let sabotageApresLecture = false;

/** Patches app_users capturees (audit-3 P2 C1 : le profil ne porte pas le hash). */
const patchesUsers = [];

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
        update: (patch) => { api._patch = patch; if (name === 'app_users') patchesUsers.push(patch); return api; },
        delete: () => { api._suppression = true; return api; },
        insert: (payload) => Promise.resolve({ error: null }),
        eq: (c, v) => {
          f[c] = v;
          // L'instance concurrente agit entre notre lecture et notre ecriture :
          // c'est exactement la fenetre que l'OCC doit fermer.
          if (c === 'revision' && sabotageApresLecture) {
            sabotageApresLecture = false;
            const cible = lignes('app_users').find((r) => Object.entries(f).every(([k, x]) => k === 'revision' || r[k] === x));
            if (cible) {
              cible.revision = Number(cible.revision || 0) + 1;
              cible.payload = { ...cible.payload, pseudo: `${cible.payload.pseudo} (autre instance)` };
            }
          }
          return api;
        },
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
  updatePasswordHash,
  setOccSupportePourTest,
} from './persistence.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const NOUVEAU = 'AutreMotDePasse!2027';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Mdp${compteur}${stamp}`.slice(0, 24),
    email: `mdp-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-MDP-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

const hashEnBase = (userId) => enBase(userId)?.password_hash;
const enBase = (userId) => lignes('app_users').find((r) => r.id === userId);

beforeEach(() => {
  tables.clear();
  colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];
  sabotageApresLecture = false;
  setOccSupportePourTest(true);
});

describe('Conflit sur changement de mot de passe', () => {
  it('le nouveau hash survit a une ecriture concurrente', async () => {
    const joueur = await nouveauJoueur();
    const avant = hashEnBase(joueur.id);
    expect(avant).toBeTruthy();

    // Une autre instance ecrit entre notre lecture de revision et notre ecriture.
    sabotageApresLecture = true;
    await updatePasswordHash(joueur.id, NOUVEAU);
    await settle();

    expect(hashEnBase(joueur.id), 'le nouveau hash doit etre en base').toBeTruthy();
    expect(hashEnBase(joueur.id), 'le hash doit avoir change').not.toBe(avant);
  });

  it('le rejeu ne reecrit pas notre copie perimee', async () => {
    const joueur = await nouveauJoueur();

    sabotageApresLecture = true;
    await updatePasswordHash(joueur.id, NOUVEAU);
    await settle();

    // L'ecriture concurrente avait renomme le pseudo. Le rejeu part de l'etat
    // frais : il ne doit pas ecraser ce changement par notre copie d'avant.
    const payload = enBase(joueur.id)?.payload;
    expect(
      String(payload?.pseudo || ''),
      'notre copie perimee ne doit pas avoir ecrase l autre instance'
    ).toContain('autre instance');
  });

  it('un echec d ecriture previent le client au lieu de lui mentir', async () => {
    const joueur = await nouveauJoueur();

    // Colonne `revision` absente ET ecriture refusee par la base : le repli
    // echoue, et l'echec doit REMONTER.
    //
    // C'est le point de ce test. Avant, l'echec etait journalise puis ignore :
    // l'operation rendait un succes au client alors que le mot de passe n'avait
    // pas change. Un utilisateur qui lit « mot de passe modifie » cesse de
    // reutiliser son ancien mot de passe — et il reste valable.
    colonnesUsers = colonnesUsers.filter((c) => c !== 'revision');
    setOccSupportePourTest(true);

    await expect(
      updatePasswordHash(joueur.id, NOUVEAU)
    ).rejects.toMatchObject({ code: 'SERVER_BUSY' });
  });

  it('le hash en base reste inchange quand l ecriture est refusee', async () => {
    const joueur = await nouveauJoueur();
    const avant = hashEnBase(joueur.id);

    colonnesUsers = colonnesUsers.filter((c) => c !== 'revision');
    setOccSupportePourTest(true);
    await expect(updatePasswordHash(joueur.id, NOUVEAU)).rejects.toBeTruthy();
    await settle();

    // Le client a ete prevenu ; la base n'a pas change. L'echec est coherent
    // des deux cotes : pas de divergence silencieuse.
    expect(hashEnBase(joueur.id)).toBe(avant);
  });
});

describe('Le patch de profil ne porte jamais password_hash (P2 C1, audit-3)', () => {
  it('la ligne initiale et le rejeu omettent la colonne', async () => {
    const joueur = await nouveauJoueur();
    patchesUsers.length = 0;
    await updateUserAccount(joueur.id, (u) => {
      u.bio = 'profil sans toucher au mot de passe';
      return u;
    });
    await settle();
    expect(patchesUsers.length).toBeGreaterThan(0);
    for (const patch of patchesUsers) {
      expect(patch, 'aucun patch de profil ne doit porter le hash').not.toHaveProperty('password_hash');
    }
  });

  it("un profil rejoue apres conflit ne ressuscite pas le mot de passe change en base", async () => {
    const joueur = await nouveauJoueur();
    const hashInitial = hashEnBase(joueur.id);
    expect(hashInitial).toBeTruthy();

    // L'instance B a change le mot de passe : la base porte desormais son
    // hash. Notre copie memoire (instance A) garde l'ancien — c'est la course.
    const ligneB = enBase(joueur.id);
    ligneB.password_hash = 'hash-instance-B';
    ligneB.revision = Number(ligneB.revision || 0) + 1;

    // L'instance A ecrit un profil : son premier update rate la revision
    // (conflit), le callback rejoue sur l'etat frais. Avant le fix, ce rejeu
    // portait le hash de la memoire de A (ancien) et ressuscitait le mot de
    // passe remplace en base.
    sabotageApresLecture = true;
    await updateUserAccount(joueur.id, (u) => {
      u.bio = 'ecrit par la vieille instance';
      return u;
    });
    await settle();

    expect(hashEnBase(joueur.id), 'le hash pose par B doit rester').toBe('hash-instance-B');
  });
});