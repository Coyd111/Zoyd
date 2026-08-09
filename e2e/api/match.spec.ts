import { test, expect } from '@playwright/test';

const BASE = '/api';
let token = '';
let token2 = '';
let arbiterToken = '';
let matchId = '';

const unique = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'MatchTest123!';

test.describe('Match Lifecycle', () => {
  test.beforeAll(async ({ request }) => {
    // User 1 (creator) — fund wallet first
    const r1 = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: `MATCH_A_${unique()}`,
        email: `match_a_${unique()}@test.com`,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `MA_${unique()}`,
        password: PASSWORD,
      },
    });
    const b1 = await r1.json();
    token = b1.token;

    await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 5000, method: 'test' },
    });

    // User 2 (joiner)
    const r2 = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: `MATCH_B_${unique()}`,
        email: `match_b_${unique()}@test.com`,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `MB_${unique()}`,
        password: PASSWORD,
      },
    });
    const b2 = await r2.json();
    token2 = b2.token;

    await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${token2}` },
      data: { amount: 5000, method: 'test' },
    });

    // User 3 (arbiter)
    const r3 = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: `MATCH_C_${unique()}`,
        email: `match_c_${unique()}@test.com`,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `MC_${unique()}`,
        password: PASSWORD,
      },
    });
    const b3 = await r3.json();
    arbiterToken = b3.token;
  });

  test('POST /api/matches — creates 1v1 match', async ({ request }) => {
    const res = await request.post(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        format: '1v1',
        entryFee: 100,
        rules: 'Standard BR rules',
        visibility: 'public',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.match.format).toBe('1v1');
    expect(body.match.status).toBe('recruiting');
    matchId = body.match.id;
  });

  test('GET /api/matches — lists public matches', async ({ request }) => {
    const res = await request.get(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/matches/:id/join — second player joins', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/join`, {
      headers: { Authorization: `Bearer ${token2}` },
      data: { team: 1 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.match.players.length).toBeGreaterThanOrEqual(2);
  });

  test('POST /api/matches/:id/join — rejects self-join (409)', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/join`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { team: 1 },
    });
    expect(res.status()).toBe(409);
  });

  test('POST /api/matches/:id/arbiter — assign arbiter', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/arbiter`, {
      headers: { Authorization: `Bearer ${arbiterToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/matches/:id/check-in — both players check in', async ({ request }) => {
    const r1 = await request.post(`${BASE}/matches/${matchId}/check-in`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r1.status()).toBe(200);

    const r2 = await request.post(`${BASE}/matches/${matchId}/check-in`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(r2.status()).toBe(200);
  });

  test('POST /api/matches/:id/ready — both players ready', async ({ request }) => {
    const r1 = await request.post(`${BASE}/matches/${matchId}/ready`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r1.status()).toBe(200);

    const r2 = await request.post(`${BASE}/matches/${matchId}/ready`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(r2.status()).toBe(200);
  });

  test('POST /api/matches/:id/schedule — sets room details', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/schedule`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
        roomCode: `ROOM-${unique()}`,
        roomPassword: 'test123',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('POST /api/matches/:id/room — arbiter sets room details', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/room`, {
      headers: { Authorization: `Bearer ${arbiterToken}` },
      data: {
        roomName: `Room-${unique()}`,
        roomPassword: 'test123',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/matches/:id/launch — arbiter launches match', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/launch`, {
      headers: { Authorization: `Bearer ${arbiterToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/matches/:id/result — arbiter submits result', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/result`, {
      headers: { Authorization: `Bearer ${arbiterToken}` },
      data: {
        winnerTeam: 0,
        scores: { team0: 1, team1: 0 },
        screenshots: [],
        proofs: {
          scoreboard: ['https://example.com/score.png'],
          finalResult: ['https://example.com/result.png'],
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('POST /api/matches/:id/confirm — both players confirm', async ({ request }) => {
    const r1 = await request.post(`${BASE}/matches/${matchId}/confirm`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r1.status()).toBe(200);

    const r2 = await request.post(`${BASE}/matches/${matchId}/confirm`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(r2.status()).toBe(200);
  });

  test('POST /api/matches/:id/disputes — open dispute', async ({ request }) => {
    // Create a new match for dispute test
    const createRes = await request.post(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { format: '1v1', entryFee: 50, visibility: 'public' },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    const disputeMatchId = created.match.id;

    // Join with user 2
    await request.post(`${BASE}/matches/${disputeMatchId}/join`, {
      headers: { Authorization: `Bearer ${token2}` },
      data: { team: 1 },
    });

    const res = await request.post(`${BASE}/matches/${disputeMatchId}/disputes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { reason: 'Opponent cheated', evidence: ['https://example.com/proof.png'] },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
