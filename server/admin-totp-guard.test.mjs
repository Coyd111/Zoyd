import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le garde admin est-il vraiment une barrière ?
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Le rapport d'audit signalait `routes.tsx:217` : la protection admin passe par
 * une prop `requireAdmin` sur `AppLayout`, pas par un garde React Router natif.
 * La conclusion : rien à corriger. Un garde CLIENT ne protège d'ailleurs rien —
 * n'importe qui peut appeler `/api/admin/*` sans navigateur, sans React.
 * La seule barrière qui compte est `requireAdmin2fa`, côté serveur.
 *
 * Ce fichier teste CE garde directement. C'est possible parce que
 * `admin-totp.mjs` n'importe que trois modules — dont aucun ne tire la chaîne
 * `web-push`. Tester le routeur complet (`admin.mjs`) à la place aurait
 * embarqué `push-notifications.mjs`, qui valide une clé VAPID À L'IMPORT.
 *
 * Chaque porte est testée séparément, et le chemin heureux aussi.
 * Ce dernier point est le plus important : une suite composée uniquement de
 * rejets passe aussi bien avec `() => null`. Sans cas positif, ce fichier
 * garantirait n'importe quoi — y compris une fonction morte.
 */

vi.mock('./logger.mjs', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/** Session resolue par le faux `getAuthenticatedAppSession`. */
let sessionCourante = null;

vi.mock('./http-utils.mjs', () => ({
  getAuthenticatedAppSession: vi.fn(() => sessionCourante),
  // Copie locale : on observe les statuts, on n'en rejoue pas la logique.
  respondJson: vi.fn((res, status, body) => {
    res.statusCode = status;
    res.payload = body;
    res.writeHead(status);
    res.end();
  }),
}));

import { requireAdmin, requireAdmin2fa, adminTotpSecrets } from './admin-totp.mjs';

/** Faux ServerResponse minimal : `respondJson` mocké n'en utilise qu'un peu. */
const creerReponse = () => ({
  statusCode: 200,
  payload: null,
  writeHead(code) { this.statusCode = code; return this; },
  end() {},
});

const sessionAdmin = (surcharge = {}) => ({
  user: { id: 'u-admin', pseudo: 'admin', role: 'admin' },
  admin2faVerified: true,
  admin2faExpires: Date.now() + 60_000,
  ...surcharge,
});

beforeEach(() => {
  sessionCourante = null;
  adminTotpSecrets.clear();
  adminTotpSecrets.set('u-admin', { enabled: true, secret: 'JBSWY3DPEHPK3PXP' });
});

describe('requireAdmin — la porte de role', () => {
  it('refuse une requete sans session', () => {
    const res = creerReponse();
    expect(requireAdmin({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it("refuse un joueur connecte", () => {
    sessionCourante = { user: { id: 'u-joueur', pseudo: 'jo', role: 'player' } };
    const res = creerReponse();
    expect(requireAdmin({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('laisse passer un admin', () => {
    sessionCourante = sessionAdmin();
    const res = creerReponse();
    expect(requireAdmin({ headers: {} }, res)).toBe(sessionCourante);
    expect(res.statusCode).toBe(200); // aucune reponse d'echec
  });
});

describe('requireAdmin2fa — la porte financiere', () => {
  it('refuse sans session', () => {
    const res = creerReponse();
    expect(requireAdmin2fa({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('refuse un joueur et renvoie ADMIN_REQUIRED', () => {
    sessionCourante = { user: { id: 'u-joueur', pseudo: 'jo', role: 'player' } };
    const res = creerReponse();
    expect(requireAdmin2fa({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('ADMIN_REQUIRED');
  });

  it("refuse un admin qui n'a pas active la 2FA", () => {
    adminTotpSecrets.clear(); // 2FA non configuree
    sessionCourante = sessionAdmin();
    const res = creerReponse();
    expect(requireAdmin2fa({ headers: {} }, res)).toBeNull();
    expect(res.payload.code).toBe('2FA_REQUIRED');
  });

  it('refuse un admin dont la 2FA est active mais non verifiee', () => {
    sessionCourante = sessionAdmin({ admin2faVerified: false });
    const res = creerReponse();
    expect(requireAdmin2fa({ headers: {} }, res)).toBeNull();
    expect(res.payload.code).toBe('2FA_REQUIRED');
  });

  it('refuse une 2FA verifiee mais expiree', () => {
    // Une session 2FA non renouvellee ne doit pas rester valable indefiniment.
    sessionCourante = sessionAdmin({ admin2faExpires: Date.now() - 1 });
    const res = creerReponse();
    expect(requireAdmin2fa({ headers: {} }, res)).toBeNull();
    expect(res.payload.code).toBe('2FA_REQUIRED');
  });

  it('laisse passer un admin avec 2FA active ET verifiee', () => {
    sessionCourante = sessionAdmin();
    const res = creerReponse();
    expect(requireAdmin2fa({ headers: {} }, res)).toBe(sessionCourante);
  });
});