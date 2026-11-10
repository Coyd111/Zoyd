import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Les dates legales (18+ / CGU) ne peuvent pas etre forgees par le client
 * (audit-5, passe A : FAIBLE A-5).
 *
 * La whitelist d'inscription acceptait `acceptedAt` (auth.mjs, REGISTER_FIELDS)
 * et persistence l'ecrivait tel quel : `adultAt: input.acceptedAt || createdAt`
 * — la trace de conformite 18+/CGU etait datee PAR LE CLIENT, sans validation
 * de format ni de bornage. Cote serveur, le moment de l'inscription est la
 * seule date probante : `adultAt`/`termsAt` sont desormais posees a
 * `createdAt`, quelle que soit la valeur postee.
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
          if (name === 'app_users' && demandees.some((c) => !colonnesUsers.includes(c))) api._colonneManquante = true;
          return api;
        },
        upsert: (payload) => {
          if (name === 'app_users' && Object.keys(payload).some((k) => !colonnesUsers.includes(k))) {
            return Promise.resolve({ error: { message: 'column does not exist' } });
          }
          const liste = lignes(name);
          const i = liste.findIndex((r) => r.id === payload.id);
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

const { createUserAccount } = await import('./persistence.mjs');

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
let compteur = 0;

// Une date future, volontairement absurde : si le serveur la recopiait, le
// test la verrait en base.
const DATE_FORGEE = '2999-12-31T23:59:59.000Z';

beforeEach(() => {
  tables.clear();
  colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];
});

describe('A-5 : les dates legales sont posees par le serveur', () => {
  it('acceptedAt du client est IGNORE : adultAt et termsAt valent createdAt', async () => {
    compteur += 1;
    const stamp = `${Date.now()}`.slice(-9);
    const u = await createUserAccount({
      pseudo: `Legal${compteur}${stamp}`.slice(0, 24),
      email: `legal-${compteur}-${stamp}@test.local`,
      phone: `+2250702${String(Date.now() % 1000000).padStart(6, '0')}`,
      gameId: `CO-LE-${compteur}-${stamp}`,
      password: MOT_DE_PASSE,
      acceptAdult: true,
      acceptTerms: true,
      // La date forgee par le client, jamais repere avant ce correctif :
      acceptedAt: DATE_FORGEE,
    });

    const ligne = lignes('app_users').find((r) => r.id === u.id);
    expect(ligne, 'le compte doit etre ecrit en base').toBeTruthy();
    const payload = ligne.payload;

    expect(payload.legal.adultAt, 'la date d acceptation 18+ est la date serveur').toBe(payload.dateJoined);
    expect(payload.legal.termsAt, 'la date d acceptation CGU est la date serveur').toBe(payload.dateJoined);
    expect(payload.legal.adultAt, 'la date forgee ne doit pas transiter').not.toBe(DATE_FORGEE);
  });
});
