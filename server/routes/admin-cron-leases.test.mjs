import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La route `/api/admin/cron-leases` — historique durable des baux de cron.
 *
 * Pourquoi ce test APPELLE la route, plutot que d en lire la source
 * ------------------------------------------------------------------
 * La route expose l'identite des instances (topologie du deploiement) et
 * l'historique des prises de bail. Elle doit donc etre :
 *   - inaccessible sans session (401) ;
 *   - inaccessible a un joueur non admin (403 ADMIN_REQUIRED) ;
 *   - inaccessible a un admin dont la 2FA n est pas verifiee (403
 *     2FA_REQUIRED) ;
 *   - accessible a un admin 2FA verifiee (200) ;
 *   - en LECTURE SEULE (POST doit tomber en 404).
 *
 * Le harnais utilise la PERSISTANCE REELLE (`createAuthSession`,
 * `markAdmin2faVerified`) : la session et la verification 2FA passent par
 * le vrai code, pas par un mock. Une garde verifiee ainsi ne peut pas
 * diverger du comportement reel.
 */

// ─── Faux client Supabase ────────────────────────────────────────────────────
//
// Le client doit repondre a DEUX formes d'appel :
//   - `.eq(col, val).limit(1)` puis ATTENTE de la promesse finale
//     (c'est `rechargerUserRow`, appele par `updateUserAccount`) ;
//   - `.select(...)` seul, ou `.select(...).range(...)`.
//
// D ou le soin : un mock qui fait `.eq()` renvoyer une promesse casse
// `.eq().limit()` (« .limit is not a function ») ; un mock qui le renvoie
// comme chaine casse l ATTENTE finale (« data is undefined »). Les deux
// echouent sur un symptome qui ne parle pas de la route testee.
//
// On tient donc une table en memoire, et la chaine de requete accumule
// les filtres.
const lignesAppUsers = [];
const lignesAudit = [];

vi.mock('../supabase.mjs', () => ({
  supabase: {
    from: vi.fn((nom) => {
      const filtres = {};
      let resultat = null;

      const appliquer = () => {
        if (nom === 'app_users') {
          return lignesAppUsers.filter((l) => Object.entries(filtres).every(([k, v]) => l[k] === v));
        }
        if (nom === 'cron_lease_audit') return lignesAudit.filter(() => true);
        return [];
      };

      const q = {
        select: vi.fn(() => q),
        upsert: vi.fn((data) => {
          if (nom === 'app_users') {
            const i = lignesAppUsers.findIndex((l) => l.id === data.id);
            if (i >= 0) lignesAppUsers[i] = { ...lignesAppUsers[i], ...data };
            else lignesAppUsers.push({ ...data });
          }
          return Promise.resolve({ data, error: null });
        }),
        insert: vi.fn((data) => Promise.resolve({ data, error: null })),
        update: vi.fn((patch) => {
          if (nom === 'app_users') {
            const cible = lignesAppUsers.find((l) => l.id === (filtres.id || patch.id));
            if (cible) Object.assign(cible, patch);
          }
          // Meme contrainte que `.eq()` : le code enchaine
          // `.update(...).eq(...)`, donc il faut une CHAINE ici.
          return q;
        }),
        delete: vi.fn(() => q),
        eq: vi.fn((col, val) => { filtres[col] = val; return q; }),
        in: vi.fn(() => q),
        gte: vi.fn((col, val) => { filtres[col] = val; return q; }),
        lt: vi.fn((col, val) => { filtres[col] = val; return q; }),
        order: vi.fn(() => q),
        range: vi.fn(() => q),
        limit: vi.fn(() => q),
        single: vi.fn(() => Promise.resolve({ data: appliquer()[0] || null, error: null })),
        then: (onOk) => {
          if (!resultat) {
            resultat = Promise.resolve({ data: appliquer(), error: null });
          }
          return resultat.then(onOk);
        },
      };
      return q;
    }),
  },
}));

vi.mock('../push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {}),
  notifyAllAdmins: vi.fn(async () => {}),
  broadcastStateSnapshot: vi.fn(),
}));

vi.mock('../state-helpers.mjs', () => ({
  saveMatches: vi.fn(async () => {}),
  buildMatchActionPayload: vi.fn((m) => ({ ok: true, id: m?.id })),
}));

vi.mock('../wallet-engine.mjs', () => ({
  refundLockedEntry: vi.fn(),
}));

import {
  createUserAccount,
  updateUserAccount,
  createAuthSession,
  markAdmin2faVerified,
} from '../persistence.mjs';
import { adminTotpSecrets } from '../admin-totp.mjs';
import { handleAdminRoutes } from './admin.mjs';

const settle = () => new Promise((r) => setTimeout(r, 10));

let compteur = 0;
const nouveauCompte = async (role = 'player') => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const compte = await createUserAccount({
    pseudo: `Bail${compteur}${stamp}`.slice(0, 26),
    email: `bail-${compteur}-${stamp}@test.local`,
    phone: `+2250702${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-BAIL-${compteur}-${stamp}`,
    password: 'MotDePasseSolide2026!',
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  if (role === 'admin') {
    // Le role doit etre eleve AVANT la creation de session : le user
    // embarque dans la session est un instantane.
    await updateUserAccount(compte.id, (u) => ({ ...u, role: 'admin' }));
    await settle();
  }
  const session = await createAuthSession(compte.id);
  return { compte, token: session.token, id: compte.id };
};

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false, corps: null,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end(charge) {
    this.ended = true;
    if (typeof charge === 'string') {
      try { this.corps = JSON.parse(charge); } catch { this.corps = null; }
    }
  },
  json(charge) { this.ended = true; this.corps = charge; },
});

const reqPour = (token, url, method = 'GET') => ({
  method, url,
  socket: { remoteAddress: '10.9.9.9' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {},
  on() {}, removeListener() {}, destroy() {},
});

const appeler = async (token, methode = 'GET', pathname = '/api/admin/cron-leases') => {
  const res = resFactice();
  const req = reqPour(token, `http://localhost${pathname}`, methode);
  await handleAdminRoutes({ req, res, pathname, io: null });
  return { status: res.statusCode, corps: res.corps };
};

beforeEach(() => {
  lignesAppUsers.length = 0;
  lignesAudit.length = 0;
  vi.clearAllMocks();
});

describe('Route admin des bails — les gardes', () => {
  it('refuse un appel sans session (401)', async () => {
    const { status, corps } = await appeler(null);
    expect(status).toBe(401);
    expect(corps.error).toContain('Session');
  });

  it('refuse un joueur non admin (403 ADMIN_REQUIRED)', async () => {
    const joueur = await nouveauCompte('player');
    const { status, corps } = await appeler(joueur.token);
    expect(status).toBe(403);
    expect(corps.code).toBe('ADMIN_REQUIRED');
  });

  it('refuse un admin dont la 2FA n est pas verifiee (403 2FA_REQUIRED)', async () => {
    // Le cas le plus courant : la verification 2FA expire apres 5 min.
    const admin = await nouveauCompte('admin');
    // La 2FA doit etre ACTIVE sur le compte (sinon le message est different :
    // « Active la 2FA dans Parametres > Securite »).
    adminTotpSecrets.set(admin.id, { enabled: true, secret: 'JBSWY3DPEHPK3PXP' });

    const { status, corps } = await appeler(admin.token);
    expect(status).toBe(403);
    // Le code 2FA_REQUIRED est OBLIGATOIRE : sans lui, l appelant ne peut
    // pas distinguer un refus d autorisation d une session expiree, et il
    // deconnecte le joueur.
    expect(corps.code).toBe('2FA_REQUIRED');
    expect(corps.requires2fa).toBe(true);
  });

  it('accede a un admin dont la 2FA est verifiee (200)', async () => {
    const admin = await nouveauCompte('admin');
    adminTotpSecrets.set(admin.id, { enabled: true, secret: 'JBSWY3DPEHPK3PXP' });
    await markAdmin2faVerified(admin.token);
    await settle();

    const { status, corps } = await appeler(admin.token);
    expect(status).toBe(200);
    expect(corps.ok).toBe(true);
    // La reponse porte l etat de la protection ET l historique.
    expect(corps).toHaveProperty('evenements');
    expect(corps).toHaveProperty('refuses');
    expect(corps).toHaveProperty('degrades');
  });
});

describe('Route admin des bails — lecture seule', () => {
  it('une ecriture (POST) est refusee (405), sans rien ecrire', async () => {
    const admin = await nouveauCompte('admin');
    adminTotpSecrets.set(admin.id, { enabled: true, secret: 'JBSWY3DPEHPK3PXP' });
    await markAdmin2faVerified(admin.token);
    await settle();

    const { status, corps } = await appeler(admin.token, 'POST');

    // 405 explicite : la route refuse l ecriture elle-meme. Sans cette
    // garde, elle laissait TOMBER la requete sans repondre — et l appelant
    // recevait un 200 au corps vide, c est a dire « reussi ».
    expect(status).toBe(405);
    expect(corps.code).toBe('METHOD_NOT_ALLOWED');
    // Et surtout : aucun evenement n a ete ecrit.
    expect(corps).not.toHaveProperty('evenements');
  });
});
