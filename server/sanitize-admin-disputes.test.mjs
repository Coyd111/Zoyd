import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les notes d’un administrateur sont du TEXTE PERSISTE et re-expose :
 * `resolveDisputeOnServer` stocke `resolution` verbatim (match-engine
 * .mjs:1460 — resolveOpenDisputes l’attache aux disputes) et `cancelMatch
 * OnServer` fait de meme avec `reason`. Ces notes reviennent au joueur dans
 * l’historique du match — c’est une injection stockee au chemin le plus
 * court. Les canaux joueur (chat, pseudo) sont deja filtres par
 * `sanitizeText` ; le chemin admin ne fait pas exception, D’autant que le
 * garde 2FA ne protege pas de la valeur du texte, seulement de QUI l’ecrit.
 *
 * On ne teste pas le reglement : on verifie CE QUE les moteurs recus.
 *
 * Harnais : persistence REELLE (createAuthSession, markAdmin2faVerified),
 * supabase simule, moteurs match simules — cf. admin-result-2fa-gates.test.mjs.
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

vi.mock('./state-helpers.mjs', () => ({
  saveMatches: vi.fn(async () => {}),
  buildMatchActionPayload: vi.fn((match) => ({ ok: true, id: match?.id })),
}));

vi.mock('./match-engine.mjs', () => ({
  submitMatchResultOnServer: vi.fn(),
  settlePendingMatchResult: vi.fn(),
  resolveDisputeOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-SAN' } })),
  cancelMatchOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-SAN' } })),
}));

import { resolveDisputeOnServer, cancelMatchOnServer } from './match-engine.mjs';
import {
  createUserAccount,
  updateUserAccount,
  createAuthSession,
  markAdmin2faVerified,
} from './persistence.mjs';
import { adminTotpSecrets } from './admin-totp.mjs';
import { handleAdminRoutes } from './routes/admin.mjs';

const settle = () => new Promise((r) => setTimeout(r, 10));

let compteur = 0;
const nouveauCompteAdmin = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const compte = await createUserAccount({
    pseudo: `Sanit${compteur}${stamp}`.slice(0, 26),
    email: `sanit-${compteur}-${stamp}@test.local`,
    phone: `+2250703${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-SAN-${compteur}-${stamp}`,
    password: 'MotDePasseSolide2026!',
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  // Le role doit etre eleve AVANT la creation de session : le user embarque
  // dans la session est un instantane.
  await updateUserAccount(compte.id, (u) => ({ ...u, role: 'admin' }));
  await settle();
  const session = await createAuthSession(compte.id);
  return { compte, token: session.token, id: compte.id };
};

const activer2fa = (id) => {
  adminTotpSecrets.set(id, { secret: 'JBSWY3DPEHPK3PXP', enabled: true, verifiedAt: Date.now() });
};

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end() { this.ended = true; },
  json() { this.ended = true; },
});

// `parseRequestBody` itere sur la requete comme sur un flux.
const reqPour = (token, url, body = null, method = 'POST') => ({
  method, url,
  socket: { remoteAddress: '10.7.8.8' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {
    if (body) {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
  },
  on() {}, removeListener() {}, destroy() {},
});

/** Admin 2FA fraiche : le seul chemin qui atteint les moteurs admin. */
const adminFraiche = async () => {
  const { token, id } = await nouveauCompteAdmin();
  activer2fa(id);
  expect(markAdmin2faVerified(token)).toBe(true);
  return token;
};

// Le HTML charge est DOWNCASTE en texte brut : ni balise, ni gestionnaire
// inline, ni protocole actif. Ce sont les invariants du sanitizeText
// (persistence.mjs:142), pas une mise en forme a verrou.
const sansHtml = (texte) => {
  expect(String(texte)).not.toMatch(/</);
  expect(String(texte)).not.toMatch(/on\w+\s*=/i);
  expect(String(texte)).not.toMatch(/javascript:/i);
  expect(String(texte)).not.toMatch(/vbscript:/i);
  expect(String(texte).toLowerCase()).not.toContain('script');
};

beforeEach(() => {
  vi.clearAllMocks();
  adminTotpSecrets.clear();
});

describe('POST /api/admin/matches/:id/resolve-dispute', () => {
  it('la resolution stockee au moteur est sanitisée, jamais re-exposable en HTML', async () => {
    const token = await adminFraiche();
    const res = resFactice();
    await handleAdminRoutes({
      req: reqPour(token, '/api/admin/matches/M-SAN/resolve-dispute', {
        action: 'refund',
        resolution: '<svg onload="alert(1)">Litige clos</svg><b><script>alert(2)</script>javascript:alert(3)',
      }),
      res,
      pathname: '/api/admin/matches/M-SAN/resolve-dispute',
      io: null,
    });

    expect(res.statusCode).toBe(200);
    expect(resolveDisputeOnServer).toHaveBeenCalledTimes(1);
    const recue = resolveDisputeOnServer.mock.calls[0][3];
    expect(recue).not.toBe('<svg onload="alert(1)">Litige clos</svg><b><script>alert(2)</script>javascript:alert(3)');
    sansHtml(recue);
  });

  it('une note saine transite SANS deformation', async () => {
    const token = await adminFraiche();
    const res = resFactice();
    await handleAdminRoutes({
      req: reqPour(token, '/api/admin/matches/M-SAN/resolve-dispute', {
        action: 'settle',
        resolution: 'Resultat confirme, remboursement des passes approuve.',
      }),
      res,
      pathname: '/api/admin/matches/M-SAN/resolve-dispute',
      io: null,
    });

    expect(res.statusCode).toBe(200);
    expect(resolveDisputeOnServer).toHaveBeenCalledTimes(1);
    expect(resolveDisputeOnServer.mock.calls[0][3]).toBe(
      'Resultat confirme, remboursement des passes approuve.',
    );
  });
});

describe('POST /api/admin/matches/:id/cancel', () => {
  it('la raison stockee au moteur est sanitisée', async () => {
    const token = await adminFraiche();
    const res = resFactice();
    await handleAdminRoutes({
      req: reqPour(token, '/api/admin/matches/M-SAN/cancel', {
        reason: '<img src=x onerror=alert(1)>Match annule, passes remboursees',
      }),
      res,
      pathname: '/api/admin/matches/M-SAN/cancel',
      io: null,
    });

    expect(res.statusCode).toBe(200);
    expect(cancelMatchOnServer).toHaveBeenCalledTimes(1);
    expect(cancelMatchOnServer.mock.calls[0][3]).not.toBe(
      '<img src=x onerror=alert(1)>Match annule, passes remboursees',
    );
    sansHtml(cancelMatchOnServer.mock.calls[0][3]);
  });

  it('une raison saine transite SANS deformation', async () => {
    const token = await adminFraiche();
    const res = resFactice();
    await handleAdminRoutes({
      req: reqPour(token, '/api/admin/matches/M-SAN/cancel', {
        reason: 'Match annule par moderation.',
      }),
      res,
      pathname: '/api/admin/matches/M-SAN/cancel',
      io: null,
    });

    expect(res.statusCode).toBe(200);
    expect(cancelMatchOnServer).toHaveBeenCalledTimes(1);
    expect(cancelMatchOnServer.mock.calls[0][3]).toBe('Match annule par moderation.');
  });
});
