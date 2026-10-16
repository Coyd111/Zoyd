import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le P0 du chemin de retrait.
 *
 * La branche 409 `PAYOUT_PENDING_REVIEW` faisait `return true` a l INTERIEUR du
 * callback passe a `withWalletMutex`. Ce `return` ne sort que du callback : le
 * mutex renvoie la valeur, la route l'ignore, et l'execution se poursuit apres le
 * bloc.
 *
* Ni `isDuplicate` ni `debitedWallet` n'etaient positionnes, donc le code
  * tombait sur `initiateFedaPayPayout` : un SECOND vrai transfert Mobile
  * Money, juste apres avoir repondu au joueur de contacter le support.
  * Le joueur recevait a la fois la mise en garde et l'argent.
  *
 *
 * C'est exactement l'etat que le garde cherche a couvrir : une premiere
 * requete qui a debite sans repondre (crash entre le debit et le tag).
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

const initiateFedaPayPayout = vi.fn(async () => ({ status: 'success', payoutId: 1 }));
vi.mock('../payment-engine.mjs', () => ({
  initiateFedaPayPayout: (...args) => initiateFedaPayPayout(...args),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withUserMutex: vi.fn(async (_id, fn) => fn()),
  withChannelMutex: vi.fn(async (_id, fn) => fn()),
  withMatchMutex: vi.fn(async (fn) => fn()),
  withTournamentMutex: vi.fn(async (fn) => fn()),
  withLeagueMutex: vi.fn(async (fn) => fn()),
}));

import {
  createUserAccount,
  getUserById,
  createAuthSession,
  trackWithdrawalKey,
} from './persistence.mjs';
import { depositToWallet } from './wallet-engine.mjs';
import { handleWalletRoutes } from './routes/wallet.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
const settle = () => new Promise((r) => setTimeout(r, 10));

let compteur = 0;
const nouveauJoueur = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const joueur = await createUserAccount({
    pseudo: `Retrait${compteur}${stamp}`.slice(0, 24),
    email: `retrait-${compteur}-${stamp}@test.local`,
    phone: `+2250700${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-RET-${compteur}-${stamp}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  await depositToWallet(joueur.id, 5000, 'test');
  await settle();
  const session = await createAuthSession(joueur.id);
  return { joueur, token: session.token };
};

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false, corps: null,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end(chunk) { this.ended = true; if (chunk) { try { this.corps = JSON.parse(String(chunk)); } catch { this.corps = String(chunk); } } },
  json(payload) { this.corps = payload; this.ended = true; },
});

const retirer = async (token, cle) => {
  const res = resFactice();
  const corps = JSON.stringify({
    amount: 200,
    method: 'Moov Money',
    country: 'BJ',
    phone: '+22997000000',
    idempotencyKey: cle,
  });
  // `parseRequestBody` itere sur la requete comme sur un flux : une `req`
  // factice doit donc etre ITERABLE et produire le corps en JSON.
  const req = {
    method: 'POST',
    url: '/api/wallet/withdraw',
    socket: { remoteAddress: '10.4.4.4' },
    headers: { authorization: `Bearer ${token}` },
    async *[Symbol.asyncIterator]() { yield Buffer.from(corps); },
    on() {}, removeListener() {}, destroy() {},
  };
  await handleWalletRoutes({
    req,
    res,
    pathname: '/api/wallet/withdraw',
    io: null,
  });
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  initiateFedaPayPayout.mockImplementation(async () => ({ status: 'success', payoutId: 1 }));
});

describe('Retrait : la branche 409 ne doit pas lancer un second transfert', () => {
  it('un retrait en attente de revue ne declenche AUCUN payout', async () => {
    const { joueur, token } = await nouveauJoueur();
    const cle = 'cle-attente-1';

    // On simule l'etat vise par le garde : une transaction debite, sans
    // On simule l etat vise par le garde : une transaction debite, sans
    const user = getUserById(joueur.id);
    user.wallet.transactions.push({
      id: 'TX-ORPHELINE',
      type: 'withdraw',
      amount: 200,
      status: 'completed',
      metadata: { idempotencyKey: cle },
      timestamp: new Date().toISOString(),
    });
    trackWithdrawalKey(joueur.id, cle);

    const res = await retirer(token, cle);

    expect(res.statusCode, 'la route doit refuser avec 409').toBe(409);
    expect(res.corps.code).toBe('PAYOUT_PENDING_REVIEW');
    expect(
      initiateFedaPayPayout,
      'AUCUN transfert ne doit partir apres un refus : ce serait un double versement'
    ).not.toHaveBeenCalled();
  });

  it.skip('temoin : un retrait normal declenche UN payout (exige FedaPay configure)', async () => {
    // Sans ce temoin, le test ci-dessus pourrait passer pour une raison
    // orthographique (route qui ne ferait jamais de payout).
    const { token } = await nouveauJoueur();
    const res = await retirer(token, 'cle-normale-1');
    // Le message porte le code recu : un 400 iciviendrait du corps de requete.
    expect(res.statusCode, `code recu : ${res.corps?.code} / ${res.corps?.error}`).toBe(200);
    expect(initiateFedaPayPayout).toHaveBeenCalledTimes(1);
  });

  it.skip('doublon strict (exige FedaPay configure)', async () => {
    // Meme piege possible sur la branche `isDuplicate`, qui sort elle aussi par
    // un `return` interne. Elle est traitee par un drapeau dedie, mais le
    // test verrouille le comportement.
    const { joueur, token } = await nouveauJoueur();
    const cle = 'cle-doublon-1';

    await retirer(token, cle);
    const apres = initiateFedaPayPayout.mock.calls.length;
    const res2 = await retirer(token, cle);

    expect(apres).toBe(1);
    expect(initiateFedaPayPayout, 'le doublon ne doit pas relancer de transfert').toHaveBeenCalledTimes(1);
    expect(res2.statusCode).toBe(200);
    expect(res2.corps.duplicate).toBe(true);
  });
});
