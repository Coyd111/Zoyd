import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Les privileges d'un socket deja ouvert doivent etre REVOCABLES.
 *
 * Le trou
 * -------
 * `getRealtimeSession` relit bien le role courant (le test
 * `realtime-privilege-revocation.test.mjs` le verifie). Mais le handler
 * socket `notification:push` n'utilisait pas cette fonction : il lisait
 * `session.role`, la variable de la CONNEXION, figee pour toute la duree
 * de la session temps reel (6 h).
 *
 * Concretement : un administrateur retrograde continuait d ecrire dans le
 * telephone de n importe quel joueur pendant des heures apres sa
 * retrogradation - un vecteur de phishing deguise en notification
 * officielle. Le compte etait `player` partout ailleurs (API HTTP, ecran
 * admin) : il ne l etait plus que sur cette decision.
 *
 * C est le meme defaut que celui corrige pour le bannissement : le
 * controle portait sur l evenement declencheur (la connexion) et non sur
 * l etat courant. Interdire une connexion ne dit rien d un socket deja
 * ouvert.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Le handler socket relit le role (`resolveRealtimeRole`), et n utilise
 *    plus le role fige.
 * 2. `resolveRealtimeRole` rend bien l ETAT COURANT, et ne rend aucun
 *    privilege quand la session ou le compte ne sont plus valides.
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
  deleteUserAccount,
} from './persistence.mjs';
import { resolveRealtimeRole } from './http-utils.mjs';

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;

const nouveauJoueur = async (role = 'player') => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Sock${compteur}${stamp}`.slice(0, 24),
    email: `sock-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-SOCK-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    role,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

beforeEach(() => tables.clear());

describe('Temps réel — le role du socket est rejoue a chaque usage', () => {
  it('le handler notification:push relit le role, il n utilise pas le role fige', () => {
    const source = readFileSync(resolve('server/realtime-server.mjs'), 'utf8');
    const debut = source.indexOf("socket.on('notification:push'");
    expect(debut, 'le handler notification:push doit exister').toBeGreaterThan(-1);
    const bloc = source.slice(debut, debut + 2500);

    // Le role doit etre RELU.
    expect(
      bloc,
      'le handler doit relire le role via resolveRealtimeRole',
    ).toContain('resolveRealtimeRole');
    // Et il ne doit PAS se fier au role fige de la connexion. On cherche
    // l USAGE (`session.role` suivi d une comparaison), pas la mention
    // litterale : le commentaire du correctif la cite.
    expect(
      bloc,
      'le handler ne doit pas comparer session.role (fige a la connexion)',
    ).not.toMatch(/session\.role\s*[!=]==?/);
  });

  it('resolveRealtimeRole rend l etat courant, pas celui de la creation', async () => {
    const joueur = await nouveauJoueur('admin');
    const session = await createRealtimeSession({ userId: joueur.id, pseudo: 'Admin', role: 'admin' });
    await settle();

    expect(resolveRealtimeRole(session.token, joueur.id)).toBe('admin');

    // Retrogradation : le socket deja ouvert ne doit PLUS se croire admin.
    await updateUserAccount(joueur.id, (u) => ({ ...u, role: 'player' }));
    await settle();

    expect(
      resolveRealtimeRole(session.token, joueur.id),
      'un admin retrograde doit perdre son privilege immediatement',
    ).toBe('player');
  });

  it('un compte supprime ne rend aucun privilege', async () => {
    // La suppression REELLE retire la ligne : c est elle qui doit couper
    // la session temps reel (et donc tout privilege).
    const joueur = await nouveauJoueur('player');
    const session = await createRealtimeSession({ userId: joueur.id, pseudo: 'Joueur', role: 'player' });
    await settle();

    expect(resolveRealtimeRole(session.token, joueur.id)).toBe('player');

    await deleteUserAccount(joueur.id);
    await settle();

    expect(
      resolveRealtimeRole(session.token, joueur.id),
      'un compte supprime ne peut rien autoriser',
    ).toBeNull();
  });
});
