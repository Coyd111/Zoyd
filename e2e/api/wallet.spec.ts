import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  creditWallet,
  disposeActors,
  loginAdminWithout2fa,
  openAdminSession,
  registerPlayer,
  type Actor,
} from './support/harness';

// Contrat réel relevé dans server/realtime-server.mjs :
//   GET  /api/wallet/me              200, { wallet, user }
//   POST /api/wallet/deposit         ADMIN + 2FA (requireAdmin2fa) + userId,
//                                     200 ; sinon 401/403 et AUCUN crédit.
//                                     Les dépôts JOUEUR passent par FedaPay
//                                     (POST /api/wallet/verify-fedapay).
//   POST /api/wallet/withdraw        150 ≤ amount ≤ 100 000 ZC, opérateur validé
//                                     pour le pays, téléphone valide,
//                                     idempotencyKey OBLIGATOIRE.
//   POST /api/wallet/verify-fedapay  transactionId numérique (1-20 chiffres).
//
// Le chemin « retrait réussi » n'est pas testable hors-ligne : il déclenche un
// payout FedaPay réel (server/payment-engine.mjs → initiateFedaPayPayout). On
// couvre donc TOUTES les gardes qui s'exécutent avant l'appel réseau, plus le
// refus pour solde insuffisant — et on vérifie qu'aucun débit n'a eu lieu.
const BASE = '/api';
const FIRST_DEPOSIT = 500;
const SECOND_DEPOSIT = 300;
const EXPECTED_BALANCE = FIRST_DEPOSIT + SECOND_DEPOSIT;
const MTN = 'MTN MoMo';
const BENIN_PHONE = '+22997000001';

test.describe('Wallet API', () => {
  test.describe.configure({ mode: 'serial' });

  let player: Actor;
  let admin: Actor;

  test.beforeAll(async () => {
    player = await registerPlayer('E2EWALLET');
    admin = await openAdminSession();
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('GET /api/wallet/me — renvoie le wallet du joueur', async () => {
    const res = await call(player, 'GET', `${BASE}/wallet/me`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.wallet).toBeTruthy();
    expect(res.body.wallet.cashBalance).toBe(0);
    expect(res.body.wallet.bonusBalance).toBe(0);
    expect(res.body.wallet.lockedBalance).toBe(0);
    expect(res.body.wallet.lockedEntries).toEqual({});
    expect(res.body.wallet.transactions).toEqual([]);
    expect(res.body.user.id).toBe(player.id);
  });

  test('GET /api/wallet/me — 401 sans session', async () => {
    const res = await callAnonymous('GET', `${BASE}/wallet/me`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('POST /api/wallet/deposit — refus : le dépôt est admin-only', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/deposit`, {
      amount: 5_000,
      method: 'test',
    });

    // requireAdmin2fa répond 403 avant toute écriture.
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.wallet).toBeUndefined();

    const wallet = await call(player, 'GET', `${BASE}/wallet/me`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.wallet.cashBalance).toBe(0);
    expect(wallet.body.wallet.transactions).toEqual([]);
  });

  test('POST /api/wallet/deposit — refus : admin sans TOTP vérifié sur la session', async () => {
    const unverified = await loginAdminWithout2fa();

    const res = await call(unverified, 'POST', `${BASE}/wallet/deposit`, {
      amount: 5_000,
      userId: player.id,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('2FA_REQUIRED');
    expect(res.body.requires2fa).toBe(true);

    const wallet = await call(player, 'GET', `${BASE}/wallet/me`);
    expect(wallet.body.wallet.cashBalance).toBe(0);
  });

  test('POST /api/wallet/deposit — admin + TOTP crédite le wallet ciblé', async () => {
    const res = await call(admin, 'POST', `${BASE}/wallet/deposit`, {
      amount: FIRST_DEPOSIT,
      userId: player.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.wallet.cashBalance).toBe(FIRST_DEPOSIT);
    expect(res.body.wallet.transactions[0].type).toBe('deposit');
    expect(res.body.wallet.transactions[0].amount).toBe(FIRST_DEPOSIT);
    expect(res.body.user.id).toBe(player.id);

    const wallet = await call(player, 'GET', `${BASE}/wallet/me`);
    expect(wallet.body.wallet.cashBalance).toBe(FIRST_DEPOSIT);
  });

  test('POST /api/wallet/deposit — les crédits s’accumulent', async () => {
    const res = await call(admin, 'POST', `${BASE}/wallet/deposit`, {
      amount: SECOND_DEPOSIT,
      userId: player.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.wallet.cashBalance).toBe(EXPECTED_BALANCE);
  });

  test('POST /api/wallet/deposit — 400 sur un montant nul', async () => {
    const res = await call(admin, 'POST', `${BASE}/wallet/deposit`, { amount: 0, userId: player.id });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');

    const wallet = await call(player, 'GET', `${BASE}/wallet/me`);
    expect(wallet.body.wallet.cashBalance).toBe(EXPECTED_BALANCE);
  });

  test('POST /api/wallet/deposit — 400 sans userId cible', async () => {
    const res = await call(admin, 'POST', `${BASE}/wallet/deposit`, { amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_JSON');
  });

  test('POST /api/wallet/deposit — 404 sur un userId inconnu', async () => {
    const res = await call(admin, 'POST', `${BASE}/wallet/deposit`, {
      amount: 100,
      userId: '00000000-0000-4000-8000-000000000000',
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  test('GET /api/wallet/history — trace les crédits', async () => {
    const res = await call(player, 'GET', `${BASE}/wallet/history?limit=50`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const deposits = res.body.transactions.filter((tx: any) => tx.type === 'deposit');
    expect(deposits).toHaveLength(2);
    expect(deposits.reduce((sum: number, tx: any) => sum + tx.amount, 0)).toBe(EXPECTED_BALANCE);
  });

  test('POST /api/wallet/withdraw — 401 sans session', async () => {
    const res = await callAnonymous('POST', `${BASE}/wallet/withdraw`, {
      amount: 200,
      method: MTN,
      phone: BENIN_PHONE,
      idempotencyKey: 'e2e-anonymous',
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('POST /api/wallet/withdraw — 400 sous le minimum de 150 ZC', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 149,
      method: MTN,
      phone: BENIN_PHONE,
      idempotencyKey: 'e2e-below-min',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  test('POST /api/wallet/withdraw — 400 au-dessus du plafond de 100 000 ZC', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 100_001,
      method: MTN,
      phone: BENIN_PHONE,
      idempotencyKey: 'e2e-above-max',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  test('POST /api/wallet/withdraw — 400 sur un opérateur non supporté', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 200,
      method: 'mobile',
      phone: BENIN_PHONE,
      idempotencyKey: 'e2e-bad-operator',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OPERATOR');
    expect(String(res.body.error)).toContain('MTN MoMo');
  });

  test('POST /api/wallet/withdraw — 400 sur un téléphone malformé', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 200,
      method: MTN,
      phone: '+229970',
      idempotencyKey: 'e2e-bad-phone',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PHONE');
  });

  test('POST /api/wallet/withdraw — 400 sans idempotencyKey', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 200,
      method: MTN,
      phone: BENIN_PHONE,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('POST /api/wallet/withdraw — 400 sur un pays sans opérateur de payout', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 200,
      method: MTN,
      phone: BENIN_PHONE,
      country: 'Nigeria',
      idempotencyKey: 'e2e-bad-country',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_COUNTRY');
  });

  test('POST /api/wallet/withdraw — 409 si le solde est insuffisant, sans débiter', async () => {
    const res = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 100_000,
      method: MTN,
      phone: BENIN_PHONE,
      idempotencyKey: 'e2e-insufficient',
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');

    // Aucune réservation, aucune transaction de retrait : le refus est atomique.
    const wallet = await call(player, 'GET', `${BASE}/wallet/me`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.wallet.cashBalance).toBe(EXPECTED_BALANCE);
    expect(wallet.body.wallet.lockedBalance).toBe(0);
    expect(wallet.body.wallet.transactions.some((tx: any) => tx.type === 'withdraw')).toBe(false);
  });

  test('GET /api/wallet/me — publie la politique de retrait (taux serveur)', async () => {
    // Le taux etait code en dur dans le front (a deux endroits) et le net
    // recalcule localement : l'aperci pouvait diverger du montant verse.
    const res = await call(player, 'GET', `${BASE}/wallet/me`);

    expect(res.status).toBe(200);
    expect(res.body.withdrawal).toBeTruthy();
    expect(res.body.withdrawal.feeRate).toBe(0.02);
    expect(res.body.withdrawal.minAmount).toBe(150);
  });

  test('GET /api/admin/commissions — refuse sans session et sans rôle admin', async () => {
    const anon = await callAnonymous('GET', '/api/admin/commissions');
    expect(anon.status).toBe(401);

    const asPlayer = await call(player, 'GET', '/api/admin/commissions');
    expect(asPlayer.status).toBe(403);
  });

  test('GET /api/admin/commissions — agrège les frais de retrait (2 %) réellement encaissés', async () => {
    const before = await call(admin, 'GET', '/api/admin/commissions');
    expect(before.status).toBe(200);
    expect(typeof before.body.commissions.withdrawalFees).toBe('number');

    // Un retrait honore doit apparaitre dans l'agregat. Le payout FedaPay
    // n'etant pas testable hors-ligne, on verifie le contrat et le refus du
    // double debit (le 409 ne doit rien ajouter a l'agregat).
    const refused = await call(player, 'POST', `${BASE}/wallet/withdraw`, {
      amount: 100_000,
      method: MTN,
      phone: BENIN_PHONE,
      idempotencyKey: 'e2e-commissions-noop',
    });
    expect(refused.status).toBe(409);

    const after = await call(admin, 'GET', '/api/admin/commissions');
    expect(after.status).toBe(200);
    // 2 % de 800 ZC = 16 ZC si un retrait avait abouti ; un refus ne cree rien.
    expect(after.body.commissions.withdrawalFees).toBe(before.body.commissions.withdrawalFees);
    expect(after.body.commissions.withdrawalCount).toBe(before.body.commissions.withdrawalCount);
    expect(after.body.commissions.arbiterPayouts).toBe(before.body.commissions.arbiterPayouts);
  });

  test('GET /api/admin/commissions — le revenu est la commission de retrait, PAS les parts d\'arbitre', async () => {
    // Le revenue est le seul chiffre a reporter comme chiffre d'affaires : le
    // combiner aux commissions d'arbitre (une SORTIE de cagnotte) majorait le
    // chiffre d'affaires. Ce test verrouille la separation.
    const res = await call(admin, 'GET', '/api/admin/commissions');
    expect(res.status).toBe(200);
    const c = res.body.commissions;
    expect(typeof c.revenue).toBe('number');
    expect(c.revenue).toBe(c.withdrawalFees);
    expect(typeof c.arbiterPayouts).toBe('number');
    // Plus de champ « total » ambigu a trainer dans l'API.
    expect(c.total).toBeUndefined();
  });

  test('POST /api/wallet/verify-fedapay — 401 sans session', async () => {
    const res = await callAnonymous('POST', `${BASE}/wallet/verify-fedapay`, { transactionId: '42' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('POST /api/wallet/verify-fedapay — 400 sur un transactionId malformé', async () => {
    // Budget rate-limit : le groupe `wallet` est plafonné à 20 requêtes / 10 min
    // pour l'IP du runner, budget partagé avec match.spec.ts. On couvre les deux
    // formes de rejet les plus parlantes sans l'épuiser.
    for (const transactionId of ['abc', '1'.repeat(21)]) {
      const res = await call(player, 'POST', `${BASE}/wallet/verify-fedapay`, { transactionId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TRANSACTION_ID');
    }

    const wallet = await call(player, 'GET', `${BASE}/wallet/me`);
    expect(wallet.body.wallet.cashBalance).toBe(EXPECTED_BALANCE);
  });

  test('POST /api/wallet/deposit — le canal de financement admin est opérationnel', async () => {
    // C'est LE seul canal de crédit de l'API : sans admin + TOTP, aucun joueur
    // ne peut être financé (les dépôts joueur passent par FedaPay). On le
    // vérifie de bout en bout sur un compte neuf.
    const funded = await registerPlayer('E2EWFUND');
    try {
      const before = await call(funded, 'GET', `${BASE}/wallet/me`);
      expect(before.status).toBe(200);
      expect(before.body.wallet.cashBalance).toBe(0);

      const deposit = await creditWallet(admin, funded.id, 750);
      expect(deposit.status).toBe(200);
      expect(deposit.body.wallet.cashBalance).toBe(750);
      expect(deposit.body.user.id).toBe(funded.id);

      const after = await call(funded, 'GET', `${BASE}/wallet/me`);
      expect(after.body.wallet.cashBalance).toBe(750);
    } finally {
      await funded.context.dispose();
    }
  });
});
