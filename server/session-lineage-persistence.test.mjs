import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * La filiation de session doit survivre au redemarrage.
 *
 * Ce que le code promettait, et ce qu'il faisait :
 *
 * - `absoluteExpiresAt` (plafond de 30 jours de la famille) etait calcule puis
 *   RANGE EN RAM : au redemarrage il disparaissait, et la rotation suivante
 *   repartait de 30 jours neuf. Le plafond reculait de 30 jours par deploiement.
 * - `supersedes` (ligne mere -> fils) egalement. Consequence de SECURITE : apres
 *   un deploiement, un logout fait avec le jeton fils — le cas normal, puisque
 *   la rotation fait du fils le jeton courant — ne supprimait que le fils. La
 *   mere demeurait valable jusqu'a sa propre expiration : un cookie vole
 *   survivait au logout de la victime.
 *
 * Le pire : un commentaire affirmait que la borne « survit a un redemarrage »
 * parce qu'elle serait « stockee dans expires_at ». C'etait faux, et ca suffisait
 * a arreter quiconque aurait cherche pourquoi la chaine ne remontait plus.
 *
 * Ces tests simulent un vrai redemarrage : la memoire est jetee et rechargee
 * depuis le faux Supabase, qui ne repond qu'avec ce qui a reellement ete ecrit.
 */

const tables = new Map();
const rows = (name) => {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name);
};

// Colonnes reellement presentes en base. La migration peut ne pas avoir ete
// appliquee : ce cas est teste, et il doit degrader proprement sans casser.
let colonnesAuth = ['token', 'user_id', 'issued_at', 'expires_at', 'absolute_expires_at', 'supersedes'];

const filtre = (liste, f) => liste.filter((r) => Object.entries(f).every(([c, v]) => r[c] === v));

const colonneAbsente = (name, cles) =>
  name === 'auth_sessions' && Object.keys(cles).some((k) => !colonnesAuth.includes(k));

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: (name) => {
      const f = {};
      // Une seule chaine : `fetchAllRows` enchaine select().order().range() et
      // les loaders applicatifs select().eq(). Un objet par methode casse des
      // que l'un des deux chemins demande.
      const run = () => ({ data: filtre(rows(name), f), error: null });
      const api = {
        select: (cols) => {
          const demandees = String(cols).split(',').map((c) => c.trim());
          if (name === 'auth_sessions' && demandees.some((c) => c !== '*' && !colonnesAuth.includes(c))) {
            api._colonneManquante = true;
            return api;
          }
          return api;
        },
        upsert: (payload) => {
          if (colonneAbsente(name, payload)) {
            return Promise.resolve({ error: { message: 'column does not exist' } });
          }
          const liste = rows(name);
          const cle = payload.token !== undefined ? 'token' : 'id';
          const i = liste.findIndex((r) => r[cle] === payload[cle]);
          if (i >= 0) liste[i] = { ...liste[i], ...payload };
          else liste.push({ ...payload });
          return Promise.resolve({ error: null });
        },
        update: (patch) => {
          api._patch = patch;
          return api;
        },
        delete: () => {
          api._suppression = true;
          return api;
        },
        // ── Constructeurs de chaine ──
        eq: (c, v) => { f[c] = v; return api; },
        order: () => api,
        limit: () => api,
        range: () => api,
        // ── Point de resolution ──
        then: (resoudre) => {
          if (api._colonneManquante) {
            return Promise.resolve({ data: null, error: { message: 'column does not exist' } }).then(resoudre);
          }
          if (api._suppression) {
            const liste = rows(name);
            const cibles = filtre(liste, f);
            for (const c of cibles) liste.splice(liste.indexOf(c), 1);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          if (api._patch) {
            if (colonneAbsente(name, api._patch)) {
              return Promise.resolve({ error: { message: 'column does not exist' } }).then(resoudre);
            }
            const cibles = filtre(rows(name), f);
            for (const c of cibles) Object.assign(c, api._patch);
            return Promise.resolve({ error: null, data: cibles }).then(resoudre);
          }
          return Promise.resolve(run()).then(resoudre);
        },
      };
      return api;
    },
  },
}));

import {
  createAuthSession,
  getAuthSession,
  deleteAuthSession,
  forceReloadFromSupabase,
  createUserAccount,
} from './persistence.mjs';

const settle = () => new Promise((r) => setTimeout(r, 40));
const empreinte = (v) => crypto.createHash('sha256').update(v).digest('hex');

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
let compteur = 0;

const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `Lign${compteur}${stamp}`.slice(0, 24),
    email: `lignage-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-LIG-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return u;
};

// Un redemarrage : la memoire est jetee, la base est relue.
const redemarrer = async () => {
  await forceReloadFromSupabase();
  await settle();
};

// Fige l horloge puis la restaure : un wrapper empile laisserait ce fichier
// dans un etat indefini pour les tests suivants.
const NATIVE_NOW = Date.now;
const avecHorlogeAvancee = async (decalageMs, run) => {
  Date.now = () => NATIVE_NOW() + decalageMs;
  try { return await run(); } finally { Date.now = NATIVE_NOW; }
};

beforeEach(() => {
  tables.clear();
  colonnesAuth = ['token', 'user_id', 'issued_at', 'expires_at', 'absolute_expires_at', 'supersedes'];
});

describe('Filiation de session — cross-redemarrage', () => {
  it('ecrit la borne absolue en base, pas seulement en RAM', async () => {
    const joueur = await nouveauJoueur();
    await createAuthSession(joueur.id);
    await settle();

    expect(rows('auth_sessions')).toHaveLength(1);
    expect(rows('auth_sessions')[0].absolute_expires_at).toBeTruthy();
  });

  it('un logout apres redemarrage revoque aussi la mere', async () => {
    const joueur = await nouveauJoueur();
    const mere = await createAuthSession(joueur.id);
    await settle();
    const empreinteMere = empreinte(mere.token);

// La rotation se declenche sur l AGE de la session, pas sur son expiration :
// avancer l'horloge equivaut a une session creee il y a 31 min. Le nouveau
// jeton n'est PAS rendu dans l'objet session — il passe par `emitToken`,
// parce que le caller doit le poser dans le Set-Cookie.
const filer = [];
const session = await avecHorlogeAvancee(31 * 60 * 1000, () =>
  getAuthSession(mere.token, { emitToken: (t) => filer.push(t) })
);
await settle();
expect(filer, 'la rotation doit emettre un jeton fils').toHaveLength(1);
const jetonFils = filer[0];
expect(jetonFils).not.toBe(mere.token);
    expect(session).toBeTruthy();

    const stockees = rows('auth_sessions');
    expect(
      stockees.some((r) => r.supersedes === empreinteMere),
      'le fils doit pointer vers sa mere, en base'
    ).toBe(true);

    await redemarrer();

    await deleteAuthSession(jetonFils);
    await settle();

    // Le point central : la mere disparait elle aussi.
    expect(
      rows('auth_sessions').some((r) => r.token === empreinteMere),
      'la mere doit etre revoquee : sinon un cookie vole survit au logout'
    ).toBe(false);
  });

  it('sans les colonnes, rien ne casse et la filiation reste en RAM', async () => {
    // Migration non appliquee : l'ecriture doit echouer SILENCIEUSEMENT comme
    // avant, pas lever et surtout pas empecher la session d'exister.
    colonnesAuth = ['token', 'user_id', 'issued_at', 'expires_at'];
    const joueur = await nouveauJoueur();

    const session = await createAuthSession(joueur.id);
    await settle();
    expect(session.token, 'la session doit exister meme sans les colonnes').toBeTruthy();
    expect(await getAuthSession(session.token), 'et rester utilisable').toBeTruthy();
  });
});