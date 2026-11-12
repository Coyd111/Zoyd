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

const hook = vi.hoisted(() => ({ echecRefund: false }));

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      // L'echec vise UNIQUEMENT l'ecriture du remboursement : celle qui
      // porte une transaction de type `refund`. Le debit (type `withdraw`)
      // et le tag qui suit restent ecrits normalement — sinon on testerait
      // l'echec du tag, pas celui du remboursement.
      q.upsert = vi.fn((payload) => {
        const txs = payload?.payload?.wallet?.transactions;
        if (hook.echecRefund && Array.isArray(txs) && txs.some((t) => t?.type === 'refund')) {
          return Promise.resolve({ error: { message: 'ecriture cassee (test)' } });
        }
        return Promise.resolve({ error: null });
      });
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

const initiateFedaPayPayout = vi.fn(async () => ({ status: 'success', payoutId: 1 }));
// Chemin relatif DEPUIS server/ : './payment-engine.mjs'. L'ancienne
// ecriture '../payment-engine.mjs' designait la racine du depot — le mock
// ne s'appliquait JAMAIS et la route aurait pu executer le VRAI module de
// payout en test.
vi.mock('./payment-engine.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initiateFedaPayPayout: (...args) => initiateFedaPayPayout(...args),
  };
});

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
  hook.echecRefund = false;
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

  it('temoin : un retrait normal declenche UN payout', async () => {
    // Sans ce temoin, le test ci-dessus pourrait passer pour une raison
    // orthographique (route qui ne ferait jamais de payout).
    const { token } = await nouveauJoueur();
    const res = await retirer(token, 'cle-normale-1');
    // Le message porte le code recu : un 400 iciviendrait du corps de requete.
    expect(res.statusCode, `code recu : ${res.corps?.code} / ${res.corps?.error}`).toBe(200);
    expect(initiateFedaPayPayout).toHaveBeenCalledTimes(1);
  });

  it('doublon strict (le troisieme appel avec la meme cle ne repasse pas)', async () => {
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

describe('Retrait : un remboursement ECHOUE ne doit pas clore la dette', () => {
  it('la dette reste ouverte et consultable quand le remboursement echoue', async () => {
    // Le cas le plus grave du chemin d argent : le prestataire refuse le
    // virement (l argent est parti), ET l ecriture du remboursement echoue
    // aussitot (base saturee).
    //
    // AVANT correctif : l erreur du remboursement etait avalee, puis la
    // transaction etait marquee `failed` et la cle d idempotence liberee. La
    // dette DISPARAISSAIT des radars : plus rien a reconcilier, plus rien a
    // rejouer, et le joueur avait perdu son argent sans trace. Seuls les logs
    // en gardaient une copie — un journal n est pas un registre de dettes.
    //
    // APRES correctif : la transaction reste `pending_review`. Elle demeure
    // visible (historique du joueur, observables `withdrawal_pending_review`)
    // et la cle n est pas liberee : le joueur ne peut pas relancer un
    // transfert sur une dette encore ouverte.
    const { joueur, token } = await nouveauJoueur();
    const cle = 'cle-refund-echoue';

    // Le payout est refuse, ET l ecriture du remboursement echoue aussitot.
    initiateFedaPayPayout.mockImplementation(async () => {
      hook.echecRefund = true;
      const err = new Error('payout refuse par le prestataire');
      err.code = 'PAYOUT_FAILED';
      throw err;
    });

    const res = await retirer(token, cle);

    // LE CODE REPONDU ne doit pas promettre un solde restaure qui ne l est
    // pas : l argent est ENCORE RETENU (le test le prouve ci-dessous par
    // le `pending_review`). `PAYOUT_FAILED` signifie « le transfert a echoue
    // ET le solde a ete restaure » - c est ce que le front affiche au
    // joueur. `REFUND_FAILED` dit la verite.
    expect(
      res.corps.code,
      'le joueur ne doit pas croire son solde restaure quand le remboursement a echoue',
    ).toBe('REFUND_FAILED');

    const wallet = getUserById(joueur.id).wallet;
    const tx = (wallet.transactions || []).find((t) => t?.metadata?.idempotencyKey === cle);
    expect(tx, 'la transaction de retrait existe').toBeTruthy();
    expect(
      tx.metadata.payoutStatus,
      'la dette reste OUVERTE : un retrait echoue n est pas un retrait clos',
    ).toBe('pending_review');
    expect(tx.status).toBe('pending_review');
  });

  it('le code PAYOUT_FAILED n est repondu que si le remboursement a REUSSI', async () => {
    // Le temoin du cas precedent : le transfert echoue, mais le
    // remboursement PASSE. Le solde est alors reellement restaure, et
    // `PAYOUT_FAILED` est le bon code : le front peut lannoncer au joueur.
    const { token } = await nouveauJoueur();

    initiateFedaPayPayout.mockImplementation(async () => {
      const err = new Error('payout refuse par le prestataire');
      err.code = 'PAYOUT_FAILED';
      throw err;
    });

    const res = await retirer(token, 'cle-refund-reussi');

    expect(
      res.corps.code,
      'un remboursement reussi justifie PAYOUT_FAILED (le solde est restaure)',
    ).toBe('PAYOUT_FAILED');
  });
});
