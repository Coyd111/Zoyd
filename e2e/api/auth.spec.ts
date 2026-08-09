import { test, expect } from '@playwright/test';

const BASE = '/api';
let token = '';
let userId = '';

const unique = () => Math.random().toString(36).slice(2, 8);
const TEST_PSEUDO = `E2E_${unique()}`;
const TEST_EMAIL = `e2e_${unique()}@test.com`;
const TEST_PHONE = `+229${Math.floor(10000000 + Math.random() * 90000000)}`;
const TEST_GAME_ID = `E2E_${unique()}`;
const TEST_PASSWORD = 'TestPass123!';

test.describe('Auth', () => {
  test('POST /api/auth/register — creates account', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: TEST_PSEUDO,
        email: TEST_EMAIL,
        phone: TEST_PHONE,
        gameId: TEST_GAME_ID,
        password: TEST_PASSWORD,
        controllerType: 'touch',
        device: 'phone',
        levelCODM: 50,
        rankMJ: 'Gold',
        rankBR: 'Gold',
        country: 'Benin',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.pseudo).toBe(TEST_PSEUDO);
    token = body.token;
    userId = body.user.id;
  });

  test('POST /api/auth/register — rejects duplicate pseudo', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: TEST_PSEUDO,
        email: `dup_${unique()}@test.com`,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `DUP_${unique()}`,
        password: TEST_PASSWORD,
      },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('pseudo');
  });

  test('POST /api/auth/register — rejects short password', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: `SHORT_${unique()}`,
        email: `short_${unique()}@test.com`,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `SHORT_${unique()}`,
        password: '1234567',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/login — authenticates with identifier', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: TEST_PSEUDO, password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.pseudo).toBe(TEST_PSEUDO);
    token = body.token;
  });

  test('POST /api/auth/login — rejects wrong password', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: TEST_PSEUDO, password: 'WrongPassword123!' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('POST /api/auth/login — authenticates with email', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    token = body.token;
  });

  test('GET /api/auth/me — returns profile', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.pseudo).toBe(TEST_PSEUDO);
    expect(body.user.id).toBe(userId);
  });

  test('GET /api/auth/me — rejects without token', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('PATCH /api/auth/me — updates profile', async ({ request }) => {
    const res = await request.patch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { bio: 'E2E test player', levelCODM: 75 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.bio).toBe('E2E test player');
    expect(body.user.levelCODM).toBe(75);
  });

  test('POST /api/auth/change-password — succeeds with correct current', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/change-password`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: TEST_PASSWORD, newPassword: 'NewPass456!' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/auth/change-password — rejects wrong current password', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/change-password`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: 'WrongOldPass!', newPassword: 'NewPass789!' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/auth/change-password — rejects short new password', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/change-password`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: 'NewPass456!', newPassword: 'short' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/logout — invalidates session', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/logout`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify token is now invalid
    const meRes = await request.get(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status()).toBe(401);
  });
});
