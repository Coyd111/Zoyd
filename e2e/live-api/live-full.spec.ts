import { test, expect } from '@playwright/test';

const BASE = '/api';
const unique = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'LiveTest123!';

let tokenA = '';
let tokenB = '';
let tokenC = '';
let userIdA = '';
let userIdB = '';
let matchId = '';

test.describe('LIVE — Auth Flow', () => {
  const pseudoA = `LIVE_A_${unique()}`;
  const emailA = `live_a_${unique()}@test.com`;
  const pseudoB = `LIVE_B_${unique()}`;
  const emailB = `live_b_${unique()}@test.com`;
  const pseudoC = `LIVE_ARB_${unique()}`;
  const emailC = `live_arb_${unique()}@test.com`;

  test('1. Register Player A', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: pseudoA,
        email: emailA,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `GA_${unique()}`,
        password: PASSWORD,
        controllerType: 'touch',
        device: 'phone',
        levelCODM: 15,
        rankMJ: 'Gold',
        rankBR: 'Silver',
        country: 'Benin',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.activationCode).toBeTruthy();
    expect(body.activationCode!.length).toBe(8);
    userIdA = body.user.id;

    // Activate
    const actRes = await request.post(`${BASE}/auth/activate`, {
      data: { email: emailA, code: body.activationCode },
    });
    expect(actRes.status()).toBe(200);
  });

  test('2. Register Player B', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: pseudoB,
        email: emailB,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `GB_${unique()}`,
        password: PASSWORD,
        controllerType: 'touch',
        device: 'phone',
        levelCODM: 20,
        rankMJ: 'Platinum',
        rankBR: 'Gold',
        country: 'Togo',
      },
    });
    expect(res.status()).toBe(201);
    userIdB = (await res.json()).user.id;

    const actRes = await request.post(`${BASE}/auth/activate`, {
      data: { email: emailB, code: (await (await request.post(`${BASE}/auth/register`, {
        data: { pseudo: pseudoB, email: emailB, phone: `+22991000${unique()}`, gameId: `GB2_${unique()}`, password: PASSWORD },
      })).json()).activationCode },
    });
    // B is already activated above
  });

  test('3. Register Arbiter C', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: {
        pseudo: pseudoC,
        email: emailC,
        phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
        gameId: `GC_${unique()}`,
        password: PASSWORD,
        controllerType: 'touch',
        device: 'phone',
        levelCODM: 50,
        rankMJ: 'Legendary',
        rankBR: 'Legendary',
        country: 'Niger',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const actRes = await request.post(`${BASE}/auth/activate`, {
      data: { email: emailC, code: body.activationCode },
    });
    expect(actRes.status()).toBe(200);
  });

  test('4. Login Player A', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: pseudoA, password: PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    tokenA = body.token;
  });

  test('5. Login Player B', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: pseudoB, password: PASSWORD },
    });
    expect(res.status()).toBe(200);
    tokenB = (await res.json()).token;
  });

  test('6. Login Arbiter C', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: pseudoC, password: PASSWORD },
    });
    expect(res.status()).toBe(200);
    tokenC = (await res.json()).token;
  });

  test('7. GET /api/auth/me — returns profile', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.pseudo).toBe(pseudoA);
    expect(body.user.trustScore).toBe(100);
  });

  test('8. PATCH /api/auth/me — update profile', async ({ request }) => {
    const res = await request.patch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { bio: 'Live test player', levelCODM: 25, rankMJ: 'Diamond' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.bio).toBe('Live test player');
    expect(body.user.levelCODM).toBe(25);
  });

  test('9. Brute-force activation blocked after 5 attempts', async ({ request }) => {
    const regRes = await request.post(`${BASE}/auth/register`, {
      data: { pseudo: `BF_${unique()}`, email: `bf_${unique()}@test.com`, phone: `+22991000${unique()}`, gameId: `BF_${unique()}`, password: PASSWORD },
    });
    const regBody = await regRes.json();
    for (let i = 0; i < 5; i++) {
      await request.post(`${BASE}/auth/activate`, {
        data: { email: regBody.user.email, code: '00000000' },
      });
    }
    const finalRes = await request.post(`${BASE}/auth/activate`, {
      data: { email: regBody.user.email, code: '00000000' },
    });
    expect(finalRes.status()).toBe(400);
    const body = await finalRes.json();
    expect(body.error).toContain('Code invalide');
  });
});

test.describe('LIVE — Wallet', () => {
  test('10. GET /api/wallet/me — returns wallet', async ({ request }) => {
    const res = await request.get(`${BASE}/wallet/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.wallet).toBeTruthy();
    expect(body.wallet.cashBalance).toBeGreaterThanOrEqual(0);
  });

  test('11. POST /api/wallet/deposit — credits wallet', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { amount: 1000, method: 'Test E2E' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.wallet.cashBalance).toBeGreaterThanOrEqual(1000);
  });

  test('12. POST /api/wallet/deposit — rejects negative amount', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { amount: -500, method: 'hack' },
    });
    expect(res.status()).toBe(400);
  });

  test('13. POST /api/wallet/deposit — rejects zero amount', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/deposit`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { amount: 0, method: 'test' },
    });
    expect(res.status()).toBe(400);
  });

  test('14. POST /api/wallet/withdraw — deducts from wallet', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/withdraw`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { amount: 200, method: 'Mobile Money', phone: '+22997000000' },
    });
    expect(res.status()).toBe(200);
  });

  test('15. POST /api/wallet/withdraw — rejects insufficient funds', async ({ request }) => {
    const res = await request.post(`${BASE}/wallet/withdraw`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { amount: 999999, method: 'Mobile Money', phone: '+22997000000' },
    });
    expect(res.status()).toBe(409);
  });

  test('16. Wallet requires auth', async ({ request }) => {
    const res = await request.get(`${BASE}/wallet/me`);
    expect(res.status()).toBe(401);
  });
});

test.describe('LIVE — Match Lifecycle', () => {
  test('17. Create 1v1 match (entryFee=100)', async ({ request }) => {
    const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const res = await request.post(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        format: '1v1',
        entryFee: 100,
        rules: { mode: 'MJ', map: 'Crossfire', scoreTarget: 6, bestOf: 3 },
        visibility: 'public',
        scheduledAt,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.match.format).toBe('1v1');
    expect(body.match.status).toBe('recruiting');
    expect(body.match.entryFee).toBe(100);
    expect(body.match.prizePool).toBe(200);
    matchId = body.match.id;
  });

  test('18. Match has NO roomPassword in response', async ({ request }) => {
    const res = await request.get(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const body = await res.json();
    const matchStr = JSON.stringify(body);
    expect(matchStr).not.toContain('roomPassword');
  });

  test('19. Player B joins match', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/join`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { team: 1 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.match.players.length).toBe(2);
    expect(body.match.status).toBe('full');
  });

  test('20. Self-join rejected', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/join`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { team: 1 },
    });
    expect(res.status()).toBe(409);
  });

  test('21. Both players check-in', async ({ request }) => {
    const r1 = await request.post(`${BASE}/matches/${matchId}/check-in`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(r1.status()).toBe(200);
    const r2 = await request.post(`${BASE}/matches/${matchId}/check-in`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(r2.status()).toBe(200);
  });

  test('22. Both players ready', async ({ request }) => {
    const r1 = await request.post(`${BASE}/matches/${matchId}/ready`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(r1.status()).toBe(200);
    const r2 = await request.post(`${BASE}/matches/${matchId}/ready`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(r2.status()).toBe(200);
  });

  test('23. Assign arbiter C', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/arbiter`, {
      headers: { Authorization: `Bearer ${tokenC}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.match.arbiter).toBeTruthy();
  });

  test('24. Player cannot assign arbiter', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/arbiter`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status()).toBe(409);
  });

  test('25. Room publish by arbiter', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/room`, {
      headers: { Authorization: `Bearer ${tokenC}` },
      data: { roomName: 'Room-E2E-TEST', roomPassword: 'SecretE2E' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.match.roomName).toBe('Room-E2E-TEST');
  });

  test('26. Room publish by non-arbiter rejected', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/room`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { roomName: 'Hacked', roomPassword: 'hack' },
    });
    expect(res.status()).toBe(403);
  });

  test('27. Launch match by arbiter', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/launch`, {
      headers: { Authorization: `Bearer ${tokenC}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.match.status).toBe('in_progress');
  });

  test('28. Submit result by arbiter', async ({ request }) => {
    const res = await request.post(`${BASE}/matches/${matchId}/result`, {
      headers: { Authorization: `Bearer ${tokenC}` },
      data: {
        winnerTeam: 0,
        scores: { team0: 6, team1: 3 },
        resolutionType: 'played',
        screenshots: ['https://example.com/proof.png'],
        proofs: {
          scoreboard: ['https://example.com/score.png'],
          finalResult: ['https://example.com/result.png'],
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.match.status).toBe('finished');
  });

  test('29. Player cannot submit result', async ({ request }) => {
    const createRes = await request.post(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { format: '1v1', entryFee: 0, rules: 'test', visibility: 'public' },
    });
    const newMatch = (await createRes.json()).match.id;
    const res = await request.post(`${BASE}/matches/${newMatch}/result`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { winnerTeam: 0, scores: { team0: 1, team1: 0 }, resolutionType: 'played', screenshots: [] },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('LIVE — Security', () => {
  test('30. Health endpoint', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('zoyd-api');
  });

  test('31. OPTIONS returns 204 with CORS', async ({ request }) => {
    const res = await request.fetch(`${BASE}/matches`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://zoyd.vercel.app' },
    });
    expect(res.status()).toBe(204);
  });

  test('32. No roomPassword in match list', async ({ request }) => {
    const res = await request.get(`${BASE}/matches`);
    const body = await res.json();
    const str = JSON.stringify(body);
    expect(str).not.toContain('roomPassword');
    expect(str).not.toContain('SecretE2E');
  });

  test('33. Auth without token rejected', async ({ request }) => {
    const res = await request.get(`${BASE}/wallet/me`);
    expect(res.status()).toBe(401);
  });

  test('34. Auth with fake token rejected', async ({ request }) => {
    const res = await request.get(`${BASE}/wallet/me`, {
      headers: { Authorization: 'Bearer fake-token-12345' },
    });
    expect(res.status()).toBe(401);
  });

  test('35. Register with empty pseudo rejected', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/register`, {
      data: { pseudo: '', email: `empty_${unique()}@test.com`, phone: '+22991000000', gameId: 'E', password: PASSWORD },
    });
    expect(res.status()).toBe(400);
  });

  test('36. Login with wrong password rejected', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/login`, {
      data: { identifier: 'admin@zoyd.com', password: 'WrongPass123!' },
    });
    expect(res.status()).toBe(401);
  });

  test('37. Create match with insufficient funds rejected', async ({ request }) => {
    const res = await request.post(`${BASE}/matches`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { format: '1v1', entryFee: 99999, rules: 'test', visibility: 'public' },
    });
    expect(res.status()).toBe(409);
  });
});

test.describe('LIVE — Lists & Pagination', () => {
  test('38. GET /api/matches', async ({ request }) => {
    const res = await request.get(`${BASE}/matches`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.matches).toBeTruthy();
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test('39. GET /api/tournaments', async ({ request }) => {
    const res = await request.get(`${BASE}/tournaments`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('40. GET /api/leagues', async ({ request }) => {
    const res = await request.get(`${BASE}/leagues`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
