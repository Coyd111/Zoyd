import { test, expect } from '@playwright/test';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const BASE = 'https://zoyd.onrender.com/api';
const HEADERS = { Origin: 'https://zoyd.vercel.app' } as const;
const unique = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'LiveTest123!';
const h = (t: string) => ({ ...HEADERS, Authorization: `Bearer ${t}` });

async function waitForOk(request: any, url: string, opts: any, expectStatus: number, maxRetries = 5): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    const r = await request.post(url, opts);
    if (r.status() === expectStatus || (r.status() !== 429 && r.status() !== 400)) return r;
    if (r.status() === 429) await delay(5000);
  }
  const r = await request.post(url, opts);
  return r;
}

let tokenA = '', tokenB = '', tokenC = '';
let matchId = '';

test.describe.serial('LIVE API — Full E2E', () => {
  test('1. Register 3 users + Activate + Login', async ({ request }) => {
    const registerAndLogin = async (prefix: string, rank: string) => {
      const r = await request.post(`${BASE}/auth/register`, {
        headers: HEADERS,
        data: { pseudo: `${prefix}_${unique()}`, email: `${prefix.toLowerCase()}_${unique()}@test.com`, phone: `+22991${Math.floor(1000000 + Math.random() * 9000000)}`, gameId: `${prefix}_${unique()}`, password: PASSWORD, controllerType: 'touch', device: 'phone', levelCODM: 15, rankMJ: rank, rankBR: rank, country: 'Benin' },
      });
      expect(r.status()).toBe(201);
      const body = await r.json();
      expect(body.activationCode.length).toBe(8);
      await delay(1500);
      const act = await request.post(`${BASE}/auth/activate`, { headers: HEADERS, data: { email: body.user.email, code: body.activationCode } });
      expect(act.status()).toBe(200);
      await delay(1500);
      const login = await request.post(`${BASE}/auth/login`, { headers: HEADERS, data: { identifier: body.user.pseudo, password: PASSWORD } });
      expect(login.status()).toBe(200);
      return (await login.json()).token;
    };

    tokenA = await registerAndLogin('E2E_A', 'Gold');
    await delay(2000);
    tokenB = await registerAndLogin('E2E_B', 'Platinum');
    await delay(2000);
    tokenC = await registerAndLogin('E2E_C', 'Legendary');
  });

  test('2. GET /api/auth/me', async ({ request }) => {
    const r = await request.get(`${BASE}/auth/me`, { headers: h(tokenA) });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.user.trustScore).toBe(100);
  });

  test('3. PATCH /api/auth/me', async ({ request }) => {
    const r = await request.patch(`${BASE}/auth/me`, { headers: h(tokenA), data: { bio: 'E2E player', levelCODM: 25 } });
    expect(r.status()).toBe(200);
    expect((await r.json()).user.bio).toBe('E2E player');
  });

  test('4. Brute-force activation blocked', async ({ request }) => {
    const r = await request.post(`${BASE}/auth/register`, { headers: HEADERS, data: { pseudo: `BF_${unique()}`, email: `bf_${unique()}@test.com`, phone: `+22991${Math.floor(1000000 + Math.random() * 9000000)}`, gameId: `BF_${unique()}`, password: PASSWORD } });
    const b = await r.json();
    for (let i = 0; i < 5; i++) {
      await request.post(`${BASE}/auth/activate`, { headers: HEADERS, data: { email: b.user.email, code: '00000000' } });
    }
    const final = await request.post(`${BASE}/auth/activate`, { headers: HEADERS, data: { email: b.user.email, code: '00000000' } });
    expect(final.status()).toBe(400);
  });

  test('5. Wallet deposit + negative rejected', async ({ request }) => {
    const dep = await request.post(`${BASE}/wallet/deposit`, { headers: h(tokenA), data: { amount: 1000, method: 'E2E' } });
    expect(dep.status()).toBe(200);
    expect((await dep.json()).wallet.cashBalance).toBeGreaterThanOrEqual(1000);

    const neg = await request.post(`${BASE}/wallet/deposit`, { headers: h(tokenA), data: { amount: -500, method: 'hack' } });
    expect(neg.status()).toBe(400);

    const bal = await request.get(`${BASE}/wallet/me`, { headers: h(tokenA) });
    expect(bal.status()).toBe(200);
  });

  test('6. Wallet insufficient funds', async ({ request }) => {
    const dep = await request.post(`${BASE}/wallet/deposit`, { headers: h(tokenB), data: { amount: 200, method: 'E2E' } });
    expect(dep.status()).toBe(200);
  });

  test('7. Match: create', async ({ request }) => {
    const cr = await request.post(`${BASE}/matches`, { headers: h(tokenA), data: { format: '1v1', entryFee: 50, rules: { mode: 'MJ', map: 'Crossfire', scoreTarget: 6, bestOf: 3 }, visibility: 'public' } });
    expect(cr.status()).toBe(201);
    const body = await cr.json();
    expect(body.match.status).toBe('recruiting');
    matchId = body.match.id;
  });

  test('8. Match list: no roomPassword', async ({ request }) => {
    const r = await request.get(`${BASE}/matches`, { headers: HEADERS });
    const str = JSON.stringify(await r.json());
    expect(str).not.toContain('roomPassword');
  });

  test('9. Match: join', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/join`, { headers: h(tokenB), data: { team: 1 } });
    expect(r.status()).toBe(200);
    expect((await r.json()).match.status).toBe('full');
  });

  test('10. Match: self-join rejected', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/join`, { headers: h(tokenA), data: { team: 1 } });
    expect(r.status()).toBe(409);
  });

  test('11. Match: check-in both', async ({ request }) => {
    expect((await request.post(`${BASE}/matches/${matchId}/check-in`, { headers: h(tokenA) })).status()).toBe(200);
    expect((await request.post(`${BASE}/matches/${matchId}/check-in`, { headers: h(tokenB) })).status()).toBe(200);
  });

  test('12. Match: ready both', async ({ request }) => {
    expect((await request.post(`${BASE}/matches/${matchId}/ready`, { headers: h(tokenA) })).status()).toBe(200);
    expect((await request.post(`${BASE}/matches/${matchId}/ready`, { headers: h(tokenB) })).status()).toBe(200);
  });

  test('13. Match: assign arbiter', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/arbiter`, { headers: h(tokenC) });
    expect(r.status()).toBe(200);
    expect((await r.json()).match.arbiter).toBeTruthy();
  });

  test('14. Match: player cant assign arbiter', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/arbiter`, { headers: h(tokenA) });
    expect(r.status()).toBe(409);
  });

  test('14b. Match: schedule (required for room)', async ({ request }) => {
    const scheduledAt = new Date(Date.now() + 8 * 60 * 1000).toISOString(); // 8 min from now
    const r = await request.post(`${BASE}/matches/${matchId}/schedule`, { headers: h(tokenA), data: { scheduledAt } });
    expect(r.status()).toBe(200);
  });

  test('15. Match: room publish by arbiter', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/room`, { headers: h(tokenC), data: { roomName: 'E2E-Room', roomPassword: 'Secret123' } });
    expect(r.status()).toBe(200);
    expect((await r.json()).match.roomName).toBe('E2E-Room');
  });

  test('16. Match: room publish by player rejected', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/room`, { headers: h(tokenA), data: { roomName: 'Hack', roomPassword: 'x' } });
    expect(r.status()).toBe(403);
  });

  test('17. Match: launch', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/launch`, { headers: h(tokenC) });
    expect(r.status()).toBe(200);
    expect((await r.json()).match.status).toBe('in_progress');
  });

  test('18. Match: submit result', async ({ request }) => {
    const r = await request.post(`${BASE}/matches/${matchId}/result`, { headers: h(tokenC), data: { winnerTeam: 0, scores: { team0: 6, team1: 3 }, resolutionType: 'played', screenshots: ['https://example.com/proof.png'], proofs: { scoreboard: ['https://example.com/score.png'], finalResult: ['https://example.com/result.png'] } } });
    expect(r.status()).toBe(200);
    expect((await r.json()).match.status).toBe('finished');
  });

  test('19. Match: player cant submit result', async ({ request }) => {
    const cr = await request.post(`${BASE}/matches`, { headers: h(tokenA), data: { format: '1v1', entryFee: 0, rules: 'x', visibility: 'public' } });
    const m = (await cr.json()).match.id;
    const r = await request.post(`${BASE}/matches/${m}/result`, { headers: h(tokenA), data: { winnerTeam: 0, scores: { team0: 1, team1: 0 }, resolutionType: 'played', screenshots: [] } });
    expect(r.status()).toBe(403);
  });

  test('20. Health endpoint', async ({ request }) => {
    const r = await request.get(`${BASE}/health`, { headers: HEADERS });
    expect(r.status()).toBe(200);
    expect((await r.json()).service).toBe('zoyd-api');
  });

  test('21. Auth without token rejected', async ({ request }) => {
    expect((await request.get(`${BASE}/wallet/me`, { headers: HEADERS })).status()).toBe(401);
  });

  test('22. Auth with fake token rejected', async ({ request }) => {
    expect((await request.get(`${BASE}/wallet/me`, { headers: { ...HEADERS, Authorization: 'Bearer fake-token' } })).status()).toBe(401);
  });

  test('23. Wrong password rejected', async ({ request }) => {
    const r = await request.post(`${BASE}/auth/login`, { headers: HEADERS, data: { identifier: 'admin@zoyd.com', password: 'Wrong123!' } });
    expect(r.status()).toBe(401);
  });

  test('24. Match: insufficient funds rejected', async ({ request }) => {
    const r = await request.post(`${BASE}/matches`, { headers: h(tokenB), data: { format: '1v1', entryFee: 99999, rules: 'x', visibility: 'public' } });
    expect(r.status()).toBe(409);
  });

  test('25. Lists return data', async ({ request }) => {
    expect((await request.get(`${BASE}/matches`, { headers: HEADERS })).status()).toBe(200);
    expect((await request.get(`${BASE}/tournaments`, { headers: HEADERS })).status()).toBe(200);
    expect((await request.get(`${BASE}/leagues`, { headers: HEADERS })).status()).toBe(200);
  });
});
