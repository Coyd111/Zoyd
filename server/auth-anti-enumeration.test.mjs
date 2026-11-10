import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

/**
 * Anti-enumeration et preuve de possession sur les routes d'activation
 * residuelle (audit-5, passe A : FAIBLE A-1 et A-3).
 *
 * A-1 : `POST /api/auth/resend-code` laissait remonter `USER_NOT_FOUND`
 * (persistence.mjs, resendActivationCode) : un email inconnu, un email de
 * compte actif et un email de compte inactif recevaient trois reponses
 * distinctes — un oracle d'enumeration gratuit, alors que `forgot-password`
 * est durci sur ce point depuis P13 C14 (reponse IDENTIQUE que le compte
 * existe ou non).
 *
 * A-3 : `POST /api/auth/activation-email` changeait l'email d'un compte
 * inactif sur la foi du SEUL ancien email. Chaine d'exploitation : le code
 * d'activation repart sur le NOUVEL email (maitrise par l'attaquant) →
 * activation sans mot de passe → reset du mot de passe via forgot-password.
 * La possession du compte n'est jamais prouvee. La route exige desormais le
 * mot de passe actuel (meme invariant que le changement d'email du profil,
 * auth.mjs l.20-21), et les erreurs « compte inconnu / deja actif / mauvais
 * mot de passe » repondent de la meme facon (P13 C14).
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

let colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

/** Convoi nul : la livraison reelle n'a pas de raison d'etres touchee ici. */
vi.mock('./code-delivery.mjs', () => ({
  deliverAuthCode: vi.fn(async () => ({ delivered: false, channel: 'aucune' })),
}));

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

// `postUnauthenticated` (front) lit `data.ok` : les reponses generiques
// conservent { ok: true, found: true } pour rester dans le type
// RecoveryResponse, exactement comme forgot-password.
process.env.NODE_ENV = 'production';
delete process.env.ALLOW_DEBUG_CODES;

const { handleAuthRoutes } = await import('./routes/auth.mjs');
const { createUserAccount, updateUserAccount, getUserById } = await import('./persistence.mjs');

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));
let compteur = 0;
let accelIp = 0;

const nouveauCompte = async ({ inactif = false } = {}) => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const u = await createUserAccount({
    pseudo: `AnEnum${compteur}${stamp}`.slice(0, 24),
    email: `anti-enum-${compteur}-${stamp}@test.local`,
    phone: `+2250701${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-AE-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
  if (inactif) {
    await updateUserAccount(u.id, (user) => ({ ...user, isActive: false }));
    await settle();
  }
  return u;
};

/** Requete POST reelle (flux Readable) a IP unique : le quota n'est jamais cogne. */
const appelerRoute = async (pathname, body) => {
  accelIp += 1;
  const ip = `10.77.${Math.floor(accelIp / 250) % 250}.${accelIp % 250}`;
  const req = new Readable({ read() {} });
  req.method = 'POST';
  req.url = pathname;
  req.headers = {};
  req.socket = { remoteAddress: ip };
  req.push(Buffer.from(JSON.stringify(body)));
  req.push(null);
  const res = {
    statusCode: 0,
    corpsBrut: undefined,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code) { this.statusCode = code; },
    end(donnees) { this.corpsBrut = donnees; },
  };
  await handleAuthRoutes({ req, res, pathname, io: null });
  return { status: res.statusCode, body: JSON.parse(res.corpsBrut || '{}') };
};

beforeEach(() => {
  tables.clear();
  colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];
});

describe('A-1 : POST /api/auth/resend-code sans oracle d enumeration', () => {
  it('un email inconnu recoit EXACTEMENT la reponse d un compte inactif connu', async () => {
    const joueur = await nouveauCompte({ inactif: true });
    await settle();

    const inconnu = await appelerRoute('/api/auth/resend-code', { email: `inconnu-${Date.now()}@test.local` });
    const connu = await appelerRoute('/api/auth/resend-code', { email: joueur.email });

    expect(connu.status, 'le compte legitime reste servi').toBe(200);
    expect(inconnu.status, 'meme statut que le cas existant (P13 C14)').toBe(connu.status);
    expect(inconnu.body, 'meme corps : aucune indication de presence').toEqual(connu.body);
    // Sans ALLOW_DEBUG_CODES, aucun code ne fuite dans le corps.
    expect(connu.body.activationCode).toBeUndefined();
  });

  it('un compte deja actif recoit la meme reponse generique que l inconnu', async () => {
    const joueur = await nouveauCompte();
    await settle();

    const actif = await appelerRoute('/api/auth/resend-code', { email: joueur.email });
    const inconnu = await appelerRoute('/api/auth/resend-code', { email: `inconnu-${Date.now()}@test.local` });

    expect(inconnu.body).toEqual(actif.body);
    expect(inconnu.status).toBe(actif.status);
  });
});

describe('A-3 : POST /api/auth/activation-email exige la preuve de possession', () => {
  it('refuse sans mot de passe (400 MISSING_FIELDS)', async () => {
    const joueur = await nouveauCompte({ inactif: true });
    await settle();

    const reponse = await appelerRoute('/api/auth/activation-email', {
      oldEmail: joueur.email,
      newEmail: `corrige-${Date.now()}@test.local`,
    });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MISSING_FIELDS');
  });

  it('un mot de passe incorrect repond EXACTEMENT comme un compte inconnu', async () => {
    const joueur = await nouveauCompte({ inactif: true });
    await settle();

    const mauvais = await appelerRoute('/api/auth/activation-email', {
      oldEmail: joueur.email,
      newEmail: `corrige-${Date.now()}@test.local`,
      password: 'CeNestPasLeBonMotDePasse!2026',
    });
    const inconnu = await appelerRoute('/api/auth/activation-email', {
      oldEmail: `inconnu-${Date.now()}@test.local`,
      newEmail: `corrige-${Date.now()}@test.local`,
      password: 'PeuImporteIci!2026',
    });

    expect(mauvais.status, 'la sonde ne doit rien apprendre').toBe(inconnu.status);
    expect(mauvais.body).toEqual(inconnu.body);
  });

  it('le mot de passe correct conserve le service : email change en memoire', async () => {
    const joueur = await nouveauCompte({ inactif: true });
    await settle();
    const nouvelEmail = `corrige-${Date.now()}-${compteur}@test.local`;

    const reponse = await appelerRoute('/api/auth/activation-email', {
      oldEmail: joueur.email,
      newEmail: nouvelEmail,
      password: MOT_DE_PASSE,
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body.ok).toBe(true);
    const proprietaire = getUserById(joueur.id);
    expect(proprietaire.email, 'le service produit reste integre').toBe(nouvelEmail);
  });

  it('un doublon sur le NOUVEL email reste explicite (DUPLICATE_EMAIL, 409)', async () => {
    const joueur = await nouveauCompte({ inactif: true });
    const occupant = await nouveauCompte();
    await settle();

    const reponse = await appelerRoute('/api/auth/activation-email', {
      oldEmail: joueur.email,
      newEmail: occupant.email,
      password: MOT_DE_PASSE,
    });

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('DUPLICATE_EMAIL');
  });
});
