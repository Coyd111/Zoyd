import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le verrou orphelin, au bon endroit.
 *
 * Le pass est bloque par le moteur, puis persiste par `saveLeagues` DANS LA
 * ROUTE. C'est la que la perte se produit : si la sauvegarde echoue apres coup,
 * le moteur a deja rendu sa main et son `catch` ne voit rien. Les ZC restent
 * bloques chez un joueur absent de la liste persistee — le sweeper ne parcourt
 * que `registeredPlayers`, et `lockEntryFee` renvoyant `ALREADY_LOCKED`, ce
 * joueur ne pouvait meme plus se reinscrire.
 *
 * On echoue donc REELLEMENT la sauvegarde, et on verifie que le pass revient.
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

// La sauvegarde echoue systématiquement : c'est la fenetre testee.
//
// Elle est declaree DANS la factory : vi.mock est hoisse avant les
// instructions du module, donc une constante exterieure serait encore
// dans sa zone temporelle morte ici.
// Saison d inscription, exposee au mock par reference.
const SAISON = {
  id: 'LS-ORPHELIN', name: 'Ligue test', cycleNumber: 1, status: 'registering',
  entryFee: 50, maxPlayers: 100, registeredPlayers: [], schedule: {},
  payout: { gross: 0, first: 0, second: 0, third: 0 },
};

vi.mock('./state-helpers.mjs', () => ({
  saveLeagues: vi.fn(async () => { throw new Error('SUPABASE_DOWN'); }),
  getStoredLeagues: vi.fn(() => [SAISON]),
  buildLeagueActionPayload: vi.fn((season) => ({ ok: true, id: season?.id })),
}));

vi.mock('./push-notifications.mjs', () => ({ deliverNotification: vi.fn(async () => {}) }));

import { saveLeagues } from './state-helpers.mjs';
import { createUserAccount, getUserById, createAuthSession } from './persistence.mjs';
import { depositToWallet } from './wallet-engine.mjs';
import { handleLeagueRoutes } from './routes/league.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
const settle = () => new Promise((r) => setTimeout(r, 10));

let compteur = 0;
const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const joueur = await createUserAccount({
    pseudo: `Orph${compteur}${stamp}`.slice(0, 26),
    email: `orphelin-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-ORPH-${compteur}-${stamp}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  await depositToWallet(joueur.id, 500, 'test');
  await settle();
  const session = await createAuthSession(joueur.id);
  return { joueur, token: session.token };
};

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end() { this.ended = true; },
  json() { this.ended = true; },
});

const reqPour = (token) => ({
  method: 'POST',
  url: '/api/leagues/LS-ORPHELIN/join',
  socket: { remoteAddress: '10.7.7.7' },
  headers: { authorization: `Bearer ${token}` },
  on() {}, removeListener() {},
});

beforeEach(() => {
  vi.clearAllMocks();
  saveLeagues.mockImplementation(async () => { throw new Error('SUPABASE_DOWN'); });
});

describe('Verrou orphelin : le pass est rendu si la sauvegarde echoue', () => {
  it('la route rend le pass bloque', async () => {
    const { joueur, token } = await nouveauJoueur();
    const cashAvant = getUserById(joueur.id).wallet.cashBalance;

    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token), res, pathname: '/api/leagues/LS-ORPHELIN/join', io: null,
    });

    expect(saveLeagues, 'la sauvegarde doit avoir ete tentee').toHaveBeenCalled();
    expect(res.statusCode, 'la route doit repondre une erreur').not.toBe(200);

    // C'est LE point : le pass ne doit pas rester bloque.
    expect(getUserById(joueur.id).wallet.lockedBalance, 'aucun ZC ne doit rester bloque').toBe(0);
    expect(getUserById(joueur.id).wallet.cashBalance, 'le pass doit revenir en cash').toBe(cashAvant);
    expect(getUserById(joueur.id).wallet.lockedEntries['LS-ORPHELIN'],
      'aucune reservation ne doit rester orpheline').toBeUndefined();
  });

  it('sans restitution, le joueur ne pourrait plus se reinscrire', async () => {
    // TÃƒ©moin : la reservation supprimee est bien la condition pour que
    // `lockEntryFee` accepte une nouvelle inscription. Le test ci-dessus ne
    // prouve donc pas du vide.
    const { joueur, token } = await nouveauJoueur();
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token), res, pathname: '/api/leagues/LS-ORPHELIN/join', io: null,
    });

    const res2 = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token), res: res2, pathname: '/api/leagues/LS-ORPHELIN/join', io: null,
    });

    // La seconde tentative ne doit pas echouer en ALREADY_LOCKED : le pass a
    // ete rendu, donc `lockEntryFee` accepte de nouveau.
    // La sauvegarde echoue TOUJOURS, donc le statut 500 est attendu. Ce qui
    // compte : la reservation a ete RE-CREEE, donc lockEntryFee a accepte
    // l inscription. Sans restitution, il aurait refuse en ALREADY_LOCKED et
    // aucune reservation n existerait.
    // Deuxieme tentative : elle doit atteindre la sauvegarde, donc passer
    // le verrouillage. Sans restitution, lockEntryFee aurait refuse en
    // ALREADY_LOCKED et saveLeagues n aurait pas ete appele une 2e fois.
    expect(saveLeagues, 'la 2e inscription doit atteindre la sauvegarde').toHaveBeenCalledTimes(2);
    expect(getUserById(joueur.id).wallet.lockedBalance, 'et le pass est de nouveau rendu').toBe(0);
  });
});