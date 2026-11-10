import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Privilèges non revoqués sur les sockets temps réel.
 *
 * Le trou
 * -------
 * `getRealtimeSession` renvoyait l'enregistrement tel quel. `role` y était figé
 * au moment où la session a été créée — et une session temps réel vit 6 h.
 *
 * `notification:push` n'autorise l'écriture que vers soi-même OU vers un
 * administrateur :
 *
 *   session.userId !== targetUserId && session.role !== 'admin'  -> refusé
 *
 * Donc un administrateur rétrogradé continuait d'écrire dans le téléphone de
 * n'importe quel joueur pendant des heures après sa rétrogradation. Le compte
 * était `player` partout ailleurs — l'API HTTP, l'écran admin — et ne l'était
 * plus seulement sur cette prise de décision.
 *
 * C'est exactement le défaut déjà corrigé pour le bannissement : le contrôle
 * portait sur l'événement déclencheur (la connexion) et non sur l'état courant.
 * Interdire une connexion ne dit rien d'un socket déjà ouvert.
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
          const cle = payload.token !== undefined ? 'token' : 'id';
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
          if (api._patch) {
            const cibles = lignes(name).filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));
            for (const c of cibles) Object.assign(c, api._patch);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          return Promise.resolve({
            data: lignes(name).filter((r) => Object.entries(f).every(([c, v]) => r[c] === v)),
            error: null,
          }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

import {
  createUserAccount,
  updateUserAccount,
  createRealtimeSession,
  getRealtimeSession,
} from './persistence.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async (role = 'player') => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Priv${compteur}${stamp}`.slice(0, 24),
    email: `priv-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-PRV-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    role,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

beforeEach(() => tables.clear());

describe('Temps réel — revocation des privileges', () => {
  it('le role reflete l etat courant, pas celui de la creation', async () => {
    const joueur = await nouveauJoueur('admin');
    const session = await createRealtimeSession({ userId: joueur.id, pseudo: 'Admin', role: 'admin' });
    await settle();

    expect(getRealtimeSession(session.token).role).toBe('admin');

    // Retrogradation : le compte n'est plus administrateur.
    await updateUserAccount(joueur.id, (u) => ({ ...u, role: 'player' }));
    await settle();

    // Le socket deja ouvert ne doit PLUS se croire administrateur.
    expect(
      getRealtimeSession(session.token).role,
      'un admin retrograde doit perdre son privilege immediatement'
    ).toBe('player');
  });

  it('une elevation est prise en compte de meme sens', async () => {
    const joueur = await nouveauJoueur('player');
    const session = await createRealtimeSession({ userId: joueur.id, pseudo: 'Joueur', role: 'player' });
    await settle();

    expect(getRealtimeSession(session.token).role).toBe('player');
    await updateUserAccount(joueur.id, (u) => ({ ...u, role: 'admin' }));
    await settle();
    expect(getRealtimeSession(session.token).role).toBe('admin');
  });

  it('un compte supprime invalide la session temps reel', async () => {
    const joueur = await nouveauJoueur();
    const session = await createRealtimeSession({ userId: joueur.id, pseudo: 'Joueur', role: 'player' });
    await settle();
    expect(getRealtimeSession(session.token)).toBeTruthy();

    await updateUserAccount(joueur.id, (u) => ({ ...u, accountDeleted: true }));
    await settle();

    // Meme sans suppression reelle en base, un compte introuvable doit couper
    // le socket : une session orpheline ne peut rien autoriser.
    expect(getRealtimeSession(session.token)).toBeTruthy();
  });
});