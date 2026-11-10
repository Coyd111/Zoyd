import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La route `logout` doit consommer SON PROPRE quota, et pas celui des routes
 * d'authentification.
 *
 * Le test E2E correspondant ne peut pas le prouver : le rate limiter est
 * ASSOUPLI quand `NODE_ENV=test` ET `ALLOW_DEBUG_CODES=true`, donc une
 * saturation y passe toujours — correct comme régressé. Le test serait vert
 * dans les deux cas, donc faux.
 *
 * Ici on appelle la VRAIE fonction de route, avec l'assouplissement neutralise.
 * C'est le seul niveau qui relie le groupe choisi par la route a l'effet
 * observable sur le quota de `login`.
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

// L'assouplissement ne doit PAS s'appliquer ici : on est du cote production.
process.env.NODE_ENV = 'production';
delete process.env.ALLOW_DEBUG_CODES;

const { handleAuthRoutes } = await import('./routes/auth.mjs');
const { rateLimitGuard } = await import('./rate-limiter.mjs');

const stubRes = () => ({
  statusCode: 200,
  headersSent: false,
  ended: false,
  setHeader() {},
  getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end() { this.ended = true; },
  json() { this.ended = true; },
});

const req = (pathname) => ({
  method: 'POST',
  url: pathname,
  socket: { remoteAddress: '10.9.9.9' },
  headers: {},
  on() {},
  removeListener() {},
});

const callLogout = async (ip = '10.9.9.9') => {
  const res = stubRes();
  const request = { ...req('/api/auth/logout'), socket: { remoteAddress: ip } };
  await handleAuthRoutes({ req: request, res, pathname: '/api/auth/logout', io: null });
  return res;
};

beforeEach(() => {
  // Chaque test repart d'une fenetre propre.
  vi.resetModules();
});

describe('POST /api/auth/logout consomme le groupe auth_logout', () => {
  it('la route ne met pas en compte le quota `auth`', async () => {
    // On sature largement la limite de `auth` (50 / 15 min) via la vraie route.
    for (let i = 0; i < 70; i += 1) {
      await callLogout('10.9.9.9');
    }

    // Si la route avait utilise `auth`, ce controle serait refuse.
    const res = stubRes();
    const autorise = rateLimitGuard(res, '10.9.9.9', 'auth');
    expect(
      autorise,
      'la saturation de logout ne doit pas epuiser le quota des routes d authentification'
    ).toBe(true);
  });

  it('le groupe `auth` reste bien sature quand on l utilise vraiment', async () => {
    // Témoin : le mécanisme de quota fonctionne, on ne teste pas du vide.
    for (let i = 0; i < 60; i += 1) rateLimitGuard(stubRes(), '10.9.9.8', 'auth');
    expect(rateLimitGuard(stubRes(), '10.9.9.8', 'auth')).toBe(false);
  });

  it('logout repond 200 sans session : la route reste appelable par tous', async () => {
    // C'est precisement ce qui rend la separation necessaire.
    const res = await callLogout('10.9.9.7');
    expect(res.statusCode).toBe(200);
  });
});