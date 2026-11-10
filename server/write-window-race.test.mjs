import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La base du calcul et la condition de l'écriture doivent viser le MÊME instant.
 *
 * Pourquoi ce cas est distinct du précédent
 * ------------------------------------------
 * `stale-base-write.test.mjs` couvre la PÉRIMPTION : l'instance B démarre après
 * A, lit une révision à jour, et calculait pourtant depuis une copie mémoire
 * plus ancienne. Corrigé par l'adoption du payload relu.
 *
 * Ici c'est la FENÊTRE, entre deux lectures de la même mutation :
 *
 *   B relit le payload            -> révision 6, base = état 6
 *   A écrit                       -> révision 7 en base
 *   B relait la révision          -> 7   <-- le trou
 *   B ecrit sous la condition 7   -> passe, avec un patch calculé sur l'état 6
 *
 * Relire la révision après coup n'est pas neutre : ça déplace la condition vers
 * un instant où la base ne correspond plus. L'écrasement passe, et le CAS ne
 *(signale rien, puisqu'il n'y a pas d'erreur à mapper.
 *
 * Le correctif impose la révision déjà lue pour construire le patch : base et
 * condition désignent le même instant, donc l'écriture concurrente est détectée.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

const colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

/** Declenche une ecriture etrangere au moment precis de la lecture de revision. */
let sabotageALaLectureDeRevision = false;
let lecturesDeRevision = 0;

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      let payloadChoisi = null;
      const api = {
        select: (cols) => {
          // `id,revision` : c'est la lecture de revision de ecrireUserRow.
          payloadChoisi = String(cols);
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
          if (api._suppression) {
            const liste = lignes(name);
            const cibles = liste.filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
            for (const c of cibles) liste.splice(liste.indexOf(c), 1);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          if (payloadChoisi && payloadChoisi.includes('revision') && !payloadChoisi.includes('payload')) {
            lecturesDeRevision += 1;
          }
          // L'ecriture etrangere arrive ENTRE la base relue et la lecture de
          // revision : c'est exactement la fenetre qu'on veut fermer.
          if (sabotageALaLectureDeRevision && lecturesDeRevision === 1) {
            sabotageALaLectureDeRevision = false;
            lecturesDeRevision = 0;
            const cible = lignes('app_users')[0];
            if (cible) {
              cible.revision = Number(cible.revision || 0) + 1;
              cible.payload = {
                ...cible.payload,
                wallet: { ...cible.payload.wallet, transactions: [{ type: 'deposit', amount: 42, status: 'completed', metadata: { idempotencyKey: 'K-A' } }] },
              };
            }
          }
          if (api._patch) {
            if (name === 'app_users' && Object.keys(api._patch).some((k) => !colonnesUsers.includes(k))) {
              return Promise.resolve({ error: { message: 'column does not exist' } }).then(resoudre);
            }
            const cibles = lignes('app_users').filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
            for (const c of cibles) Object.assign(c, api._patch);
            return Promise.resolve({ error: null, data: cibles.map((c) => ({ id: c.id })) }).then(resoudre);
          }
          return Promise.resolve({
            data: lignes('app_users').filter((r) => Object.entries(f).every(([c, v]) => r[c] === v)),
            error: null,
          }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

import { createUserAccount, updateUserAccount, setOccSupportePourTest } from './persistence.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Fen${compteur}${stamp}`.slice(0, 24),
    email: `fen-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-FEN-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

const enBase = (userId) => lignes('app_users').find((r) => r.id === userId);
const clesEnBase = (userId) => (enBase(userId)?.payload?.wallet?.transactions || []).map((t) => t?.metadata?.idempotencyKey).filter(Boolean);
const soldeEnBase = (userId) => Number(enBase(userId)?.payload?.wallet?.cashBalance ?? -1);

beforeEach(() => {
  tables.clear();
  sabotageALaLectureDeRevision = false;
  lecturesDeRevision = 0;
  setOccSupportePourTest(true);
});

describe('Fenetre entre la base relue et la condition d ecriture', () => {
  it('une ecriture survenue entre les deux lectures ne disparait pas', async () => {
    const joueur = await nouveauJoueur();
    await updateUserAccount(joueur.id, (u) => {
      u.wallet = { ...(u.wallet || {}), cashBalance: 1000 };
      return u;
    });
    await settle();

    // Une autre instance ecrit pendant que B prepare la sienne.
    sabotageALaLectureDeRevision = true;
    await updateUserAccount(joueur.id, (u) => {
      u.wallet = { ...u.wallet, cashBalance: u.wallet.cashBalance + 500 };
      return u;
    });
    await settle();

    expect(
      clesEnBase(joueur.id),
      "l'ecriture survenue dans la fenetre doit survivre : sinon la cle d'idempotence disparait"
    ).toContain('K-A');
    expect(soldeEnBase(joueur.id), 'et le solde doit cumuler les deux mouvements').toBe(1500);
  });
});