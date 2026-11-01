import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Groupe de quota absent de RATE_LIMIT_CONFIG : retombe sur `default`.
 *
 * Constat audit-5 : cette retombee etait TOTALEMENT silencieuse. Le groupe
 * `match` utilise par POST /api/br/lobbies n'existe pas dans la config (PIEGE
 * documente en tete de rate-limiter.mjs) : personne ne peut distinguer un
 * groupe assume de la prestation d'une faute de frappe future qui detruirait
 * un quota anti-bruteforce sans le moindre signal dans les logs.
 *
 * Correctif : UN warn par nom de groupe inconnu (pas par appel : les handlers
 * socket appelent checkRateLimit en boucle, un warn/appel serait du spam).
 */

const logMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('./logger.mjs', () => ({ createLogger: () => logMocks }));

const { checkRateLimit } = await import('./rate-limiter.mjs');

describe('groupe de quota inconnu : warn unique puis default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("avertit au PREMIER appel en nommant le groupe, et applique default", () => {
    const resultat = checkRateLimit('10.9.9.9', 'br_lobby');
    // Quota default : 60 par fenetre.
    expect(resultat).toEqual({ allowed: true, remaining: 59, retryAfter: 0 });
    expect(logMocks.warn).toHaveBeenCalledTimes(1);
    expect(String(logMocks.warn.mock.calls[0][0])).toContain('br_lobby');
  });

  it('ne repete pas le warn pour le meme groupe, re-avertit pour un nom different', () => {
    // Le Set de deduplication est un etat de MODULE : les noms utilises ne
    // se recouvrent pas entre les tests, sinon le premier warn serait absorbe
    // par le test precedent.
    checkRateLimit('11.0.0.1', 'benin_lobby');
    checkRateLimit('11.0.0.2', 'benin_lobby');
    checkRateLimit('11.0.0.3', 'benin_lobby');
    checkRateLimit('11.0.0.4', 'ivoire_lobby');
    expect(logMocks.warn).toHaveBeenCalledTimes(2);
    expect(String(logMocks.warn.mock.calls[1][0])).toContain('ivoire_lobby');
  });

  it('n avertit jamais pour un groupe declare', () => {
    checkRateLimit('10.9.9.6', 'auth');
    checkRateLimit('10.9.9.5', 'wallet');
    expect(logMocks.warn).not.toHaveBeenCalled();
  });
});
