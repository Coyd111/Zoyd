import { test, expect } from '@playwright/test';

const BASE = '/api';

const unique = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'WalletTest123!';

test.describe('Wallet', () => {
  let token = '';

  test.beforeAll(async ({ request }) => {
    // Register and use a fresh user
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: `WALLET_${unique()}`,
        email: `wallet_${unique()}@test.com`,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `WALLET_${unique()}`,
        password: PASSWORD,
      },
    });
    // Accept 201 or 429 (rate limited) — if rate limited, try login instead
    if (res.status() === 429) {
      // Try logging in with a known user
      const loginRes = await request.post(`${BASE}/auth/login`, {
        data: { identifier: 'admin@zoyd.com', password: process.env.ZOYD_ADMIN_PASSWORD! },
      });
      if (loginRes.status() === 200) {
        const loginBody = await loginRes.json();
        token = loginBody.token;
      }
    } else {
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      token = body.token;
    }
  });

  test('GET /api/wallet/me — returns wallet', async ({ request }) => {
    const res = await request.get(`${BASE}/wallet/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.wallet).toBeTruthy();
    expect(body.wallet.cashBalance).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/wallet/me — rejects without auth', async ({ request }) => {
    const res = await request.get(`${BASE}/wallet/me`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/wallet/deposit — credits wallet', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 500, method: 'test' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.wallet.cashBalance).toBeGreaterThanOrEqual(500);
  });

  test('POST /api/wallet/deposit — accumulates balance', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 300, method: 'test' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.wallet.cashBalance).toBeGreaterThanOrEqual(800);
  });

  test('POST /api/wallet/deposit — rejects zero amount', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 0, method: 'test' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/wallet/withdraw — deducts from wallet', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/withdraw`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 200, method: 'mobile', phone: '+22997000000' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/wallet/withdraw — rejects insufficient funds', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/withdraw`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 999999, method: 'mobile', phone: '+22997000000' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('POST /api/wallet/withdraw — rejects without auth', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/withdraw`, {
      data: { amount: 100, method: 'mobile', phone: '+22997000000' },
    });
    expect(res.status()).toBe(401);
  });
});
