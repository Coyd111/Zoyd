import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Verrous orphelins (audit lot 3, B1) : le moteur verrouille le pass côté
 * wallet, puis `save*` peut échouer (conflit OCC en overlap de déploiement,
 * 503 Supabase). Sans compensation, le joueur est débité et absent de
 * l'entité persistée — `ALREADY_LOCKED` l'empêche de se réinscrire, fonds
 * gelés à jamais. Seule la ligue compensait (league.mjs) ; match, tournoi et
 * BR font désormais pareil.
 */

const h = vi.hoisted(() => ({
  etat: new Map(),
  traces: [],
  refunded: [],
  saveThrows: true,
  engineResult: null,
}));

vi.mock('./http-utils.mjs', () => ({
  getAuthenticatedAppSession: vi.fn(() => ({ user: { id: 'u-1', pseudo: 'P1' } })),
  parseRequestBody: vi.fn(async () => ({})),
  respondJson: vi.fn((_res, _status, payload) => { h.traces.push(`reponse:${payload?.ok}`); }),
  respondMappedError: vi.fn((_res, err) => { h.traces.push('erreur'); h.derniereErreur = err; }),
}));
vi.mock('./rate-limiter.mjs', () => ({
  getClientIp: vi.fn(() => '1.2.3.4'),
  rateLimitGuard: vi.fn(() => true),
}));
vi.mock('./mutex.mjs', () => ({
  withBrLobbyMutex: vi.fn(async (_id, fn) => fn()),
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withMatchMutex: vi.fn(async (fn) => fn()),
  withTournamentMutex: vi.fn(async (fn) => fn()),
  withUserMutex: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('./wallet-engine.mjs', () => ({
  refundLockedEntry: vi.fn(async (userId, entityId) => { h.refunded.push({ userId, entityId }); }),
}));
vi.mock('./br-engine.mjs', () => ({
  BR_MAPS: {}, BR_MAP_IDS: [], BR_MODES: {}, BR_MODE_IDS: [],
  BR_RANKING_MODES: {}, BR_RANKING_MODE_IDS: [], BR_VARIANTS: {}, BR_VARIANT_IDS: [],
  BR_PRIZED_PLACES: 8, BR_ARBITER_MAX_RATE: 0.02,
  createBrLobbyOnServer: vi.fn(),
  joinBrLobbyOnServer: vi.fn(async () => ({ lobby: { id: 'BR-1', players: [] }, lobbies: [{ id: 'BR-1' }] })),
  leaveBrLobbyOnServer: vi.fn(), checkInBrLobbyOnServer: vi.fn(),
  startBrLobbyOnServer: vi.fn(), eliminateBrPlayerOnServer: vi.fn(),
  settleBrLobbyOnServer: vi.fn(), computeBrPayouts: vi.fn(), computeBrRanking: vi.fn(() => []),
}));
vi.mock('./state-helpers.mjs', () => ({
  getStoredBrLobbies: vi.fn(() => [{ id: 'BR-1', status: 'scheduled', players: [] }]),
  saveBrLobbies: vi.fn(async () => { if (h.saveThrows) throw Object.assign(new Error('STATE_CONFLICT'), { code: 'STATE_CONFLICT' }); }),
  toPublicBrLobby: vi.fn((x) => x), toPublicBrRanking: vi.fn((x) => x || []),
  saveMatches: vi.fn(), buildMatchActionPayload: vi.fn(),
}));
vi.mock('./push-notifications.mjs', () => ({ deliverNotification: vi.fn(async () => {}), broadcastStateSnapshot: vi.fn() }));
vi.mock('./admin-totp.mjs', () => ({
  requireAdmin2fa: vi.fn(() => ({ user: { id: 'u-1' } })),
  require2faIfAdmin: vi.fn(() => ({ user: { id: 'u-1' } })),
}));
vi.mock('./persistence.mjs', () => ({
  getUserById: (id) => (id ? { id, pseudo: 'P1' } : null),
  getStateCollection: vi.fn(() => []),
  getStateEntity: vi.fn(() => null),
  upsertStateEntity: vi.fn(async () => {}),
  sanitizeText: (v) => String(v || '').trim(),
}));

const { handleBrRoutes } = await import('./routes/br.mjs');

beforeEach(() => {
  h.traces.length = 0;
  h.refunded.length = 0;
  h.saveThrows = true;
});

describe('BR join — compensation du verrou orphelin', () => {
  it('saveBrLobbies échoue → pass remboursé, erreur remontée', async () => {
    const ok = await handleBrRoutes({
      req: { method: 'POST' },
      res: {},
      io: null,
      pathname: '/api/br/lobbies/BR-1/join',
    });
    expect(ok).toBe(true);
    expect(h.refunded).toEqual([{ userId: 'u-1', entityId: 'BR-1' }]);
    expect(h.traces).toContain('erreur');
  });

  it('saveBrLobbies réussit → aucun remboursement', async () => {
    h.saveThrows = false;
    const ok = await handleBrRoutes({
      req: { method: 'POST' },
      res: {},
      io: null,
      pathname: '/api/br/lobbies/BR-1/join',
    });
    expect(ok).toBe(true);
    expect(h.refunded).toEqual([]);
    expect(h.traces).toContain('reponse:true');
  });
});
