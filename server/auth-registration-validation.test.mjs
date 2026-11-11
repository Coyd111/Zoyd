import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

/**
 * L inscription doit valider les champs de profil, comme la mise a jour.
 *
 * La liste blanche de l inscription laissait passer `levelCODM`, `rankMJ`,
 * `rankBR`, `controllerType` et `device` SANS validation : un joueur
 * pouvait s attribuer un rang frauduleux (segmentation du matchmaking,
 * `trustScoreMin`) ou un niveau impossible. Les regles existaient — pour
 * `PATCH /api/auth/me` — mais n etaient pas appliquees a l ENTREE : le
 * compte etait CREE avec des valeurs invalides, que le PATCH aurait
 * refusees ensuite.
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

const colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

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
        insert: () => Promise.resolve({ error: null }),
        eq: (c, v) => { f[c] = v; return api; },
        in: () => api,
        limit: () => api,
        order: () => api,
        range: () => api,
        then: (resoudre) => {
          if (api._suppression) {
            for (const c of lignes(name).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v))) {
              lignes(name).splice(lignes(name).indexOf(c), 1);
            }
            return Promise.resolve({ error: null, data: [] }).then(resoudre);
          }
          if (api._patch) {
            const cibles = lignes(name).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
            for (const c of cibles) Object.assign(c, api._patch);
            return Promise.resolve({ error: null, data: cibles.map((c) => ({ id: c.id })) }).then(resoudre);
          }
          const cibles = lignes(name).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
          return Promise.resolve({ error: null, data: cibles }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

process.env.NODE_ENV = 'production';
delete process.env.ALLOW_DEBUG_CODES;

const { handleAuthRoutes } = await import('./routes/auth.mjs');

let compteurIp = 0;

/** Requete POST reelle (flux Readable) a IP unique : le quota n'est jamais cogne. */
const appelerRoute = async (pathname, body) => {
  compteurIp += 1;
  const ip = `10.78.${Math.floor(compteurIp / 250) % 250}.${compteurIp % 250}`;
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

const stamp = () => `${Date.now()}`.slice(-9);

const inscriptionValide = (extras = {}) => ({
  pseudo: `Reg${stamp()}`.slice(0, 24),
  email: `reg-${stamp()}@test.local`,
  phone: `+2250702${String(Date.now() % 1000000).padStart(6, '0')}`,
  gameId: `CO-REG-${stamp()}`,
  password: 'MotDePasse!Solide2026',
  acceptAdult: true,
  acceptTerms: true,
  ...extras,
});

beforeEach(() => {
  tables.clear();
});

describe('inscription — les champs de profil sont valides', () => {
  it('une inscription valide est acceptee', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide());
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('un rang MJ invalide est refuse, et AUCUN compte n est cree', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({ rankMJ: 'GrandMaster' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
    expect(lignes('app_users')).toHaveLength(0);
  });

  it('un rang BR invalide est refuse', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({ rankBR: 'Legendary999' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
  });

  it('un niveau CODM hors bornes est refuse', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({ levelCODM: 999999 }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
  });

  it('un niveau CODM non numerique est refuse', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({ levelCODM: '150' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
  });

  it('un appareil inconnu est refuse', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({ device: 'lampe' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
  });

  it('un controleur inconnu est refuse', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({ controllerType: 'godmode' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENUM');
  });

  it('les valeurs LEGITIMES passent', async () => {
    const res = await appelerRoute('/api/auth/register', inscriptionValide({
      rankMJ: 'Elite',
      rankBR: 'Veteran',
      levelCODM: 250,
      device: 'phone',
      controllerType: 'touch',
    }));
    expect(res.status).toBe(201);
  });
});
