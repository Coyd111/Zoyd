import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Rejeu des écritures non portefeuille : activation et email d'activation.
 *
 * Ces deux chemins perdaient leur écriture en cas de conflit, avec un simple log
 * ERROR. Le client recevait un succes alors que rien n'avait ete ecrit — pour un
 * joueur en cours d'inscription, cela se traduit par :
 *
 *   - il clique son lien d'activation, le compte reste inactif, sans message ;
 *   - il corrige son email, l'ancien email est detruit en memoire, et il ne
 *     peut plus finir son inscription.
 *
 * Le rejeu n'est pas du theatre : dans les deux cas l'intention est RECALCULABLE
 * sur un etat frais. Ce qui distingue les deux chemins, et qui decide de la
 * revalidation :
 *
 *   - l'ACTIVATION est MONOTONE. Elle ne fait que passer `isActive` a vrai.
 *     Rejouer ne peut pas ecraser un travail utile.
 *   - le CHANGEMENT D'EMAIL n'etait valide QUE sur un compte inactif. Si
 *     l'autre instance a active le compte entre-temps, changer son email
 *     retirerait au joueur l'acces a son propre compte : le predicat doit donc
 *     etre REVALIDE sur l'etat frais, pas suppose vrai.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

let colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

/** Ecriture concurrente declenchee juste apres notre lecture de revision. */
let sabotageApresLecture = null;

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      const api = {
        select: (cols) => {
          const demandees = String(cols).split(',').map((c) => c.trim()).filter((c) => c !== '*');
          if (name === 'app_users' && demandees.some((c) => !colonnesUsers.includes(c))) api._colonneManquante = true;
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
        eq: (c, v) => {
          f[c] = v;
          if (c === 'revision' && sabotageApresLecture) {
            const action = sabotageApresLecture;
            sabotageApresLecture = null;
            const cible = lignes('app_users').find((r) => r.id === action.userId);
            if (cible) {
              cible.revision = Number(cible.revision || 0) + 1;
              cible.payload = action.mutate(cible.payload);
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
  activateUserAccount,
  changeActivationEmail,
  setOccSupportePourTest,
} from './persistence.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Act${compteur}${stamp}`.slice(0, 24),
    email: `act-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-ACT-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  // `createUserAccount` FORCE `isActive: true` (persistence.mjs:1279) : aucun
  // compte inactif ne peut naitre par cette porte. On le desactive donc
  // explicitement, sinon les deux tests d'email passeraient pour la mauvaise
  // raison — le garde initial, et non le rejeu.
  await updateUserAccount(u.id, (user) => ({ ...user, isActive: false }));
  await settle();
  return u;
};

const enBase = (userId) => lignes('app_users').find((r) => r.id === userId);

beforeEach(() => {
  tables.clear();
  colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];
  sabotageApresLecture = null;
  setOccSupportePourTest(true);
});

describe('Rejeu — activation de compte', () => {
  it('l activation survit a une ecriture concurrente', async () => {
    const joueur = await nouveauJoueur();
    sabotageApresLecture = { userId: joueur.id, mutate: (p) => ({ ...p, pseudo: `${p.pseudo}!` }) };

    await activateUserAccount(joueur.id);
    await settle();

    expect(enBase(joueur.id).payload.isActive, 'le compte doit etre actif en base').toBe(true);
  });

  it('le rejeu conserve l horodatage pose par l autre instance', async () => {
    const joueur = await nouveauJoueur();
    // L'autre instance a deja active, avec SON horodatage.
    sabotageApresLecture = {
      userId: joueur.id,
      mutate: (p) => ({ ...p, isActive: true, activatedAt: '2020-01-01T00:00:00.000Z' }),
    };

    await activateUserAccount(joueur.id);
    await settle();

    expect(
      enBase(joueur.id).payload.activatedAt,
      'ecraser saignerait la trace de qui a active le compte'
    ).toBe('2020-01-01T00:00:00.000Z');
  });

  it('n ecrase pas le travail concurrent non lie a l activation', async () => {
    const joueur = await nouveauJoueur();
    sabotageApresLecture = { userId: joueur.id, mutate: (p) => ({ ...p, pseudo: `${p.pseudo}-concurrent` }) };

    await activateUserAccount(joueur.id);
    await settle();

    expect(enBase(joueur.id).payload.pseudo).toContain('-concurrent');
  });
});

describe('Rejeu — changement d email d activation', () => {
  it('applique le nouvel email sur l etat frais', async () => {
    const joueur = await nouveauJoueur();
    const avant = enBase(joueur.id).email_key;

    sabotageApresLecture = { userId: joueur.id, mutate: (p) => ({ ...p, pseudo: `${p.pseudo}-concurrent` }) };

    await changeActivationEmail(joueur.email, 'corrige@test.local');
    await settle();

    expect(enBase(joueur.id).email_key).not.toBe(avant);
  });

  it('REFUSE quand le compte a ete active entre-temps', async () => {
    // C'est le point qui distingue ce chemin de l'activation.
    //
    // Le garde `isActive !== false` portait sur notre copie perimee. Si l'autre
    // instance a active le compte, le joueur s'identifie desormais par cet
    // email : le modifier lui retirerait l'acces a son propre compte. Rejouer
    // sans revalider appliquerait une intention qui n'a plus de sens.
    const joueur = await nouveauJoueur();
    sabotageApresLecture = { userId: joueur.id, mutate: (p) => ({ ...p, isActive: true }) };

    await expect(
      changeActivationEmail(joueur.email, 'trop-tard@test.local')
    ).rejects.toMatchObject({ code: 'ACCOUNT_ALREADY_ACTIVE' });
  });
});