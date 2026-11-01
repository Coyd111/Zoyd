import { describe, it, expect, vi } from 'vitest';

/**
 * INVARIANT match.mjs:22-23 — « le corps de la requete est lu HORS du mutex :
 * le verrou doit couvrir la mutation, pas le parsing. »
 *
 * Le chemin create le respecte (routes/match.mjs:88-95) ; les routes
 * schedule/room/result/disputes/evidence avaient le parse SOUS le verrou.
 * Un corps qui arrive au goutte a goutte (ou un client qui ne l'envoie jamais,
 * cas d'un 1 Mo lent ou coupé) retenait le verrou GLOBAL des matchs pendant
 * TOUTE la lecture : les check-in/ready/launch/confirm concurrents de TOUS
 * les autres matchs du processus attendaient derriere un stream que rien ne
 * borne.
 *
 * Le test est comportemental : A (POST /result) present un stream qui NE
 * PRODUIT JAMAIS de chunk — parseRequestBody attend pour toujours. B (POST
 * /check-in) doit obtenir sa reponse pendant que A parse encore. Sous le bug,
 * B est retenu par le mutex ; il ne repond pas dans la limite du race.
 *
 * Le mutex vit a l'echelle du MODULE (mutex.mjs) : ce fichier ne contient
 * donc qu'UN seul test — la requete A reste pendante apres lui.
 *
 * Harnais : persistence REELLE (createAuthSession), supabase simule,
 * moteurs simules via state/match-engine mocks.
 */

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

vi.mock('./state-helpers.mjs', () => ({
  saveMatches: vi.fn(async () => {}),
  buildMatchActionPayload: vi.fn((match) => ({ ok: true, id: match?.id })),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {}),
  notifyAllAdmins: vi.fn(async () => {}),
}));

vi.mock('./match-engine.mjs', () => ({
  createMatchOnServer: vi.fn(),
  joinMatchOnServer: vi.fn(),
  assignArbiterOnServer: vi.fn(),
  checkInMatchOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-MUT' } })),
  toggleReadyOnServer: vi.fn(),
  scheduleMatchOnServer: vi.fn(),
  setRoomDetailsOnServer: vi.fn(),
  launchMatchOnServer: vi.fn(),
  submitMatchResultOnServer: vi.fn(),
  confirmMatchResultOnServer: vi.fn(),
  openDisputeOnServer: vi.fn(),
  addEvidenceToDisputeOnServer: vi.fn(),
  escalateDisputeOnServer: vi.fn(),
}));

import { checkInMatchOnServer } from './match-engine.mjs';
import { createUserAccount, createAuthSession } from './persistence.mjs';
import { handleMatchRoutes } from './routes/match.mjs';

const settle = () => new Promise((r) => setTimeout(r, 10));

let compteur = 0;
const nouveauCompte = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const compte = await createUserAccount({
    pseudo: `Mutex${compteur}${stamp}`.slice(0, 26),
    email: `mutex-${compteur}-${stamp}@test.local`,
    phone: `+2250702${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-MUT-${compteur}-${stamp}`,
    password: 'MotDePasseSolide2026!',
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  const session = await createAuthSession(compte.id);
  return { compte, token: session.token };
};

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end() { this.ended = true; },
  json() { this.ended = true; },
});

// `parseRequestBody` itere sur la requete comme sur un flux (cf.
// withdrawal-double-payout.test.mjs) : la req factice doit etre ITERABLE.
// Version COURANTE : un seul chunk (le corps arrive entier).
const reqPour = (token, url, body = null, method = 'POST') => ({
  method, url,
  socket: { remoteAddress: '10.7.7.7' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {
    if (body) {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
  },
  on() {}, removeListener() {}, destroy() {},
});

// Version LENTE : le stream ne produit JAMAIS de chunk. Attention : un
// generator sans yield se TERMINERAIT de suite (la boucle du parse sortirait
// et renverrait `{}`) ; on pend sur une promesse jamais resolue — ce qui est
// exactement l'etat d'un client fugue qui n'aura jamais fini d'envoyer son
// corps de 1 Mo.
const reqSansCorps = (token, url, method = 'POST') => ({
  method, url,
  socket: { remoteAddress: '10.7.7.7' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {
    yield await new Promise(() => {}); // jamais resolue : le parse pend
  },
  on() {}, removeListener() {}, destroy() {},
});

describe('le parse du resultat reste HORS du mutex global', () => {
  it('un check-in concurrent repond pendant que la requete resultat attend son corps', async () => {
    const { token } = await nouveauCompte();

    // A — un joueur soumet un resultat dont le corps n'arrive jamais.
    // (joueur ordinaire : le garde 2FA mixte ne s'applique qu'aux admins)
    const resA = resFactice();
    const attenteA = handleMatchRoutes({
      req: reqSansCorps(token, '/api/matches/M-MUT/result'),
      res: resA,
      pathname: '/api/matches/M-MUT/result',
      io: null,
    });
    attenteA.catch(() => {}); // parse pend, aucune reponse : pas de rejet attendu

    // laisser A s'installer (prendre le verrou [bug] ou entrer dans le parse [fix])
    await new Promise((r) => setTimeout(r, 50));

    // B — pendant ce temps, un check-in (route SANS corps) doit passer.
    const resB = resFactice();
    const attenteB = handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-MUT/check-in', {}),
      res: resB,
      pathname: '/api/matches/M-MUT/check-in',
      io: null,
    }).then(() => resB);

    const gagnant = await Promise.race([
      attenteB,
      new Promise((r) => setTimeout(() => r(null), 500)),
    ]);

    // Sous le bug, B est retenu par le mutex du parse de A : null.
    expect(gagnant, 'le check-in concurrent doit repondre pendant que la requete resultat parse son corps').not.toBeNull();
    expect(gagnant.statusCode).toBe(200);
    expect(checkInMatchOnServer).toHaveBeenCalledTimes(1);
  });
});
