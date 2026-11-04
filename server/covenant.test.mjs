import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

/**
 * POST /api/auth/covenant — le serment d'intégrité (F1..F10).
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Le serment est un rite d'entree scelle une fois par compte. Trois risques
 * propres à cette route, tous deja mordus ailleurs dans ce depot :
 *   1. La DATE — si le client pouvait la proposer, un rejeu repousserait
 *      l'acceptation et un compte « scelle hier » pourrait l'etre demain.
 *      Ici, seul `applyCovenantAccepted` date (getNow serveur), et un rejeu
 *      repond `already` SANS reecrire.
 *   2. L'ORDRE des ecritures — le signalement F7 part AVANT le sceau. Si le
 *      refus d'ecriture du signal scellait quand meme le serment, le rejeu
 *      tomberait sur `already` et le signalement serait perdu pour toujours.
 *      Le test verifie l'ordre brute des upserts captures.
 *   3. L'ANONYMAT du signal — `reporter_id` reste NULL : la promesse rendue
 *      a l'ecran (« ton pseudo n'apparaît nulle part ») est tenue par le
 *      schema, pas par un commentaire.
 *
 * Reponses oui/non des fenetres : jamais envoyees, jamais stockees. Le test
 * les cherche quand meme dans le payload du compte — au cas ou quelqu'un
 * « ameliore » le client plus tard.
 *
 * Harness : meme forme que auth-anti-enumeration.test.mjs (requetes reelles
 * via `handleAuthRoutes`, supabase fausse, sessions resolues par un faux
 * `getAuthenticatedAppSession`).
 */

const tables = new Map();
const lignes = (nom) => {
  if (!tables.has(nom)) tables.set(nom, []);
  return tables.get(nom);
};

/** Ordre global des upserts (nom de table) : la cle du test d'ordre. */
let ordresEcriture = [];

/** Bascule de panne : nxt upsert de `user_reports` est refuse. */
let refuserUserReports = false;

let colonnesUsers = ['id', 'payload', 'updated_at', 'revision', 'pseudo_key', 'email_key', 'phone_key', 'game_id_key', 'role', 'password_hash', 'created_at'];

/** Convoi nul : la livraison reelle n'a rien a faire ici. */
vi.mock('./code-delivery.mjs', () => ({
  deliverAuthCode: vi.fn(async () => ({ delivered: false, channel: 'aucune' })),
}));

/** Session resolue par le faux `getAuthenticatedAppSession`. */
let sessionCourante = null;

vi.mock('./http-utils.mjs', async (importOriginal) => {
  const reel = await importOriginal();
  return {
    ...reel,
    getAuthenticatedAppSession: vi.fn(() => sessionCourante),
  };
});

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
          if (name === 'user_reports' && refuserUserReports) {
            return Promise.resolve({ error: { message: 'panne simulee' } });
          }
          if (name === 'app_users' && Object.keys(payload).some((k) => !colonnesUsers.includes(k))) {
            return Promise.resolve({ error: { message: 'column does not exist' } });
          }
          const liste = lignes(name);
          const cle = payload.id !== undefined ? 'id' : 'token';
          const i = liste.findIndex((r) => r[cle] === payload[cle]);
          if (i >= 0) liste[i] = { ...liste[i], ...payload };
          else liste.push({ ...payload });
          ordresEcriture.push(name);
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
            // Le chemin OCC (update conditionnel) est aussi une ECRITURE ; le
            // test d'ordre doit le voir, sinon le sceau serait invisible.
            if (cibles.length > 0) ordresEcriture.push(name);
            return Promise.resolve({ error: null, data: cibles.map((c) => ({ id: c.id })) }).then(resoudre);
          }
          return Promise.resolve({ data: cibles, error: null }).then(resoudre);
        },
      };
      return api;
    },
  },
}));

const { handleAuthRoutes } = await import('./routes/auth.mjs');
const { createUserAccount, getUserById, COVENANT_VERSION } = await import('./persistence.mjs');

const MOT_DE_PASSE = 'MotDePasse!Solide2026';
const settle = () => new Promise((r) => setTimeout(r, 30));

let compteur = 0;
let ipCompteur = 0;

const nouveauCompte = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  return await createUserAccount({
    pseudo: `Serment${compteur}${stamp}`.slice(0, 24),
    email: `covenant-${compteur}-${stamp}@test.local`,
    phone: `+2250701${String(Date.now() % 1000000).padStart(6, '0')}`,
    gameId: `CO-COV-${compteur}-${stamp}`,
    password: MOT_DE_PASSE,
    acceptAdult: true,
    acceptTerms: true,
  });
};

/** Requete POST reelle (flux Readable) a IP unique : le quota n'est jamais cogne. */
const appelerCovenant = async (body) => {
  ipCompteur += 1;
  const ip = `10.78.${Math.floor(ipCompteur / 250) % 250}.${ipCompteur % 250}`;
  const req = new Readable({ read() {} });
  req.method = 'POST';
  req.url = '/api/auth/covenant';
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
  await handleAuthRoutes({ req, res, pathname: '/api/auth/covenant', io: null });
  return { status: res.statusCode, body: JSON.parse(res.corpsBrut || '{}') };
};

const ouvrirSession = (joueur) => {
  sessionCourante = { user: { id: joueur.id, pseudo: joueur.pseudo, role: 'player' } };
};

const compterUpserts = (nom) => ordresEcriture.filter((t) => t === nom).length;

beforeEach(() => {
  tables.clear();
  ordresEcriture = [];
  refuserUserReports = false;
  sessionCourante = null;
  settle();
});

describe('POST /api/auth/covenant — la porte', () => {
  it('refuse sans session (401 AUTH_REQUIRED)', async () => {
    const rep = await appelerCovenant({ version: COVENANT_VERSION });
    expect(rep.status).toBe(401);
    expect(rep.body.code).toBe('AUTH_REQUIRED');
  });
});

describe('POST /api/auth/covenant — le scellement', () => {
  it('scelle une seule fois : date serveur, version serveur, signal anonyme', async () => {
    const joueur = await nouveauCompte();
    await settle();
    ouvrirSession(joueur);

    // Le client ment sur tout ce qu'il peut : une version inconnue du corps
    // ne doit jamais devenir la version scellee.
    const rep = await appelerCovenant({
      version: '2001-01-01',
      report: { pseudo: 'Tricheur66', note: 'aim bot au BR' },
    });

    expect(rep.status).toBe(200);
    expect(rep.body.ok).toBe(true);
    expect(rep.body.already).toBe(false);
    expect(rep.body.signalRegistered).toBe(true);

    // Le user renvoye porte le sceau ; la version est celle du SERVEUR.
    expect(rep.body.user.covenant?.acceptedAt).toBeTruthy();
    expect(rep.body.user.covenant?.version).toBe(COVENANT_VERSION);
    expect(rep.body.user.covenant?.version).not.toBe('2001-01-01');

    // L'etat du compte : covenant, RIEN d'autre de nouveau.
    const compte = getUserById(joueur.id);
    expect(compte.covenant?.acceptedAt).toBeTruthy();
    expect(Object.keys(compte.covenant).sort()).toEqual(['acceptedAt', 'version']);
    // Reponses oui/non : ABSENTES du payload (ce n'est pas un interrogatoire).
    const serialiseCompte = JSON.stringify(compte.covenant);
    expect(serialiseCompte).not.toContain('ouinon');

    // La ligne de signalement : ANONYME par construction.
    const signalements = lignes('user_reports');
    expect(signalements).toHaveLength(1);
    const ligne = signalements[0];
    expect(ligne.reporter_id).toBeNull();
    expect(ligne.target_id).toBeNull();
    expect(ligne.reason).toBe('cheating');
    expect(ligne.severity).toBe('grave');
    expect(ligne.status).toBe('pending');
    expect(ligne.payload.targetPseudo).toBe('Tricheur66');
    expect(ligne.payload.reporterId ?? null).toBeNull();
    expect(ligne.payload.reporterPseudo).toBe('');
  });

  it('ORDRE D ECRITURE : le signal part AVANT le sceau', async () => {
    const joueur = await nouveauCompte();
    await settle();
    ouvrirSession(joueur);

    ordresEcriture = []; // apres la creation du compte
    const rep = await appelerCovenant({
      version: COVENANT_VERSION,
      report: { pseudo: 'SbireDuRang', note: '' },
    });
    expect(rep.status).toBe(200);

    const iSignal = ordresEcriture.indexOf('user_reports');
    const iSceau = ordresEcriture.indexOf('app_users');
    expect(iSignal).toBeGreaterThanOrEqual(0);
    expect(iSceau).toBeGreaterThan(iSignal);
  });

  it('rejeu : already sans rien reecrire ni repousser la date, signal IGNORE', async () => {
    const joueur = await nouveauCompte();
    await settle();
    ouvrirSession(joueur);

    const premier = await appelerCovenant({
      version: COVENANT_VERSION,
      report: { pseudo: 'Tricheur66' },
    });
    expect(premier.body.already).toBe(false);
    const dateScellee = getUserById(joueur.id).covenant.acceptedAt;
    const signauxAvant = compterUpserts('user_reports');
    const sceauxAvant = compterUpserts('app_users');

    const rejeu = await appelerCovenant({
      version: COVENANT_VERSION,
      report: { pseudo: 'PseudoDuRejeu' }, // un rejeu ne pose PAS de signal
    });
    expect(rejeu.status).toBe(200);
    expect(rejeu.body.already).toBe(true);
    expect(rejeu.body.signalRegistered).toBe(false);

    // Aucune nouvelle ecriture des deux cotes, date non repoussee.
    expect(compterUpserts('user_reports')).toBe(signauxAvant);
    expect(compterUpserts('app_users')).toBe(sceauxAvant);
    expect(getUserById(joueur.id).covenant.acceptedAt).toBe(dateScellee);
  });

  it('sans pseudo signale : serment scelle quand meme, table vierge', async () => {
    const joueur = await nouveauCompte();
    await settle();
    ouvrirSession(joueur);

    const rep = await appelerCovenant({ version: COVENANT_VERSION });
    expect(rep.status).toBe(200);
    expect(rep.body.signalRegistered).toBe(false);
    expect((lignes('user_reports'))).toHaveLength(0);
    expect(getUserById(joueur.id).covenant?.acceptedAt).toBeTruthy();
  });
});

describe('POST /api/auth/covenant — la panne du signal', () => {
  it('ecriture refusee : 503 ET serment NON scelle', async () => {
    const joueur = await nouveauCompte();
    await settle();
    ouvrirSession(joueur);

    refuserUserReports = true;
    const rep = await appelerCovenant({
      version: COVENANT_VERSION,
      report: { pseudo: 'SbireDuRang', note: 'wall' },
    });

    expect(rep.status).toBe(503);
    expect(rep.body.code).toBe('SERVER_BUSY');
    // Le sceau n'est PAS pose : le client repetera, le signal partira.
    expect(getUserById(joueur.id).covenant).toBeUndefined();
    expect(lignes('user_reports')).toHaveLength(0);
  });

  it('apres la panne, le rejeu scelle ET enregistre le signal', async () => {
    const joueur = await nouveauCompte();
    await settle();
    ouvrirSession(joueur);

    refuserUserReports = true;
    await appelerCovenant({ version: COVENANT_VERSION, report: { pseudo: 'SbireDuRang' } });
    refuserUserReports = false;

    const rep = await appelerCovenant({ version: COVENANT_VERSION, report: { pseudo: 'SbireDuRang' } });
    expect(rep.status).toBe(200);
    expect(rep.body.already).toBe(false);
    expect(rep.body.signalRegistered).toBe(true);
    expect(lignes('user_reports')).toHaveLength(1);
    expect(getUserById(joueur.id).covenant?.acceptedAt).toBeTruthy();
  });
});
