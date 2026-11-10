import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les groupes de quota de `server/rate-limiter.mjs`.
 *
 * Deux corrections sont verrouillees ici.
 *
 * 1. Le groupe `match` (utilise par `POST /api/br/lobbies`) N'EXISTAIT PAS dans
 *    `RATE_LIMIT_CONFIG` : la route retombait silencieusement sur `default`
 *    (60/min) et partageait donc le seau de toutes les lectures publiques.
 *    Le nom du groupe ne protegeait rien. Il doit desormais exister, avec
 *    10 par minute.
 *
 * 2. Les operations d'argent partageaient UN seau `wallet` (20/10 min) : le
 *    retrait, la verification de depot et le depot admin. Le seau est par IP,
 *    et en CGNAT (tres courant en Afrique) des centaines de joueurs partagent
 *    une IP publique : un SEUL compte suffisait a paralyser les retraits de
 *    tous les autres pendant 10 minutes. Il faut donc trois seaux
 *    distincts (`wallet_withdraw`, `wallet_deposit`, `wallet_admin`), le
 *    groupe historique `wallet` restant l'ALIAS du retrait pour ne pas
 *    casser les appelants existants (`routes/wallet.mjs`).
 *
 * Le module se configure AU CHARGEMENT : on le recharge avec un environnement
 * maitrise (comme `rate-limiter-guard.test.mjs`), sinon le mode detendu de la
 * CI E2E changerait les plafonds observes et le test ne prouverait rien.
 */

const logMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('./logger.mjs', () => ({ createLogger: () => logMocks }));

/**
 * Recharge le rate limiter avec un environnement maitrise : la relaxation
 * (NODE_ENV=test + ALLOW_DEBUG_CODES + ZOYD_DISABLE_SUPABASE) doit etre
 * IMPOSSIBLE ici, sinon les plafonds observes seraient 100000/1 ms.
 */
const charger = async () => {
  vi.resetModules();
  const sauvegarde = { ...process.env };
  delete process.env.ALLOW_DEBUG_CODES;
  delete process.env.ZOYD_RATE_LIMIT_MAX;
  const mod = await import('./rate-limiter.mjs');
  return {
    mod,
    restaurer: () => {
      for (const k of Object.keys(process.env)) {
        if (!Object.prototype.hasOwnProperty.call(sauvegarde, k)) delete process.env[k];
      }
      Object.assign(process.env, sauvegarde);
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('groupe `match` : la creation de salon BR a son propre quota', () => {
  it('est declare : 10 par minute', async () => {
    const { mod, restaurer } = await charger();
    expect(mod.RATE_LIMIT_CONFIG.match).toEqual({ max: 10, windowMs: 60 * 1000 });
    restaurer();
  });

  it('ne retombe PAS sur le quota `default`', async () => {
    const { mod, restaurer } = await charger();
    const premier = mod.checkRateLimit('10.30.0.1', 'match');
    expect(premier.allowed).toBe(true);
    // `default` autorise 60/min : un groupe DECLARE a 10/min rend `remaining`
    // a 9. Un 59 prouverait au contraire la retombee silencieuse sur default.
    expect(premier.remaining).toBe(9);
    expect(
      logMocks.warn.mock.calls.filter((call) => String(call[0]).includes('Groupe de rate limit inconnu')),
      'un groupe declare ne doit jamais etre signale comme inconnu',
    ).toHaveLength(0);
    restaurer();
  });

  it('bloque au-dela de 10/min, sur SON seau', async () => {
    const { mod, restaurer } = await charger();
    const ip = '10.30.0.2';
    let autorisees = 0;
    for (let i = 0; i < 12; i += 1) {
      if (mod.checkRateLimit(ip, 'match').allowed) autorisees += 1;
    }
    expect(autorisees).toBe(10);
    // Le seau `default` (lectures publiques) n'est pas concerne.
    expect(mod.checkRateLimit(ip, 'default').allowed).toBe(true);
    restaurer();
  });
});

describe('operations d argent : trois seaux distincts', () => {
  it('`wallet` est un ALIAS de `wallet_withdraw` : le MEME seau', async () => {
    const { mod, restaurer } = await charger();
    expect(mod.resolveRateLimitGroup('wallet')).toBe('wallet_withdraw');
    const ip = '10.30.1.1';
    // Saturation du seau canonique (20/10 min).
    for (let i = 0; i < 20; i += 1) mod.checkRateLimit(ip, 'wallet_withdraw');
    expect(mod.checkRateLimit(ip, 'wallet_withdraw').allowed).toBe(false);
    // L'alias historique est bloque par le MEME compteur : les appelants
    // existants (`routes/wallet.mjs`) gardent exactement le budget d'aujourd'hui.
    expect(mod.checkRateLimit(ip, 'wallet').allowed).toBe(false);
    restaurer();
  });

  it('saturer le retrait ne bloque plus le depot', async () => {
    const { mod, restaurer } = await charger();
    const ip = '10.30.1.2';
    for (let i = 0; i < 20; i += 1) mod.checkRateLimit(ip, 'wallet_withdraw');
    expect(mod.checkRateLimit(ip, 'wallet_withdraw').allowed).toBe(false);
    // Le depot a son PROPRE seau : sur une IP partagee (CGNAT), un compte
    // qui sature les retraits ne doit plus geler les depots des autres.
    expect(mod.checkRateLimit(ip, 'wallet_deposit').allowed).toBe(true);
    expect(mod.checkRateLimit(ip, 'wallet_admin').allowed).toBe(true);
    restaurer();
  });

  it('saturer le depot ne bloque plus le retrait', async () => {
    const { mod, restaurer } = await charger();
    const ip = '10.30.1.3';
    for (let i = 0; i < 20; i += 1) mod.checkRateLimit(ip, 'wallet_deposit');
    expect(mod.checkRateLimit(ip, 'wallet_deposit').allowed).toBe(false);
    expect(mod.checkRateLimit(ip, 'wallet_withdraw').allowed).toBe(true);
    expect(mod.checkRateLimit(ip, 'wallet_admin').allowed).toBe(true);
    restaurer();
  });

  it('aucun plafond n a ete relache : les trois groupes valent 20', async () => {
    const { mod, restaurer } = await charger();
    expect(mod.RATE_LIMIT_CONFIG.wallet_withdraw.max).toBe(20);
    expect(mod.RATE_LIMIT_CONFIG.wallet_deposit.max).toBe(20);
    expect(mod.RATE_LIMIT_CONFIG.wallet_admin.max).toBe(20);
    // La fenetre du retrait est inchangee (10 min) : c'est la GRANULARITE
    // des seaux qui change, pas la severite des quotas.
    expect(mod.RATE_LIMIT_CONFIG.wallet_withdraw.windowMs).toBe(10 * 60 * 1000);
    restaurer();
  });

  it('le seau est par IP : une autre IP n est pas affectee', async () => {
    const { mod, restaurer } = await charger();
    for (let i = 0; i < 20; i += 1) mod.checkRateLimit('10.30.1.4', 'wallet_withdraw');
    expect(mod.checkRateLimit('10.30.1.4', 'wallet_withdraw').allowed).toBe(false);
    expect(mod.checkRateLimit('10.30.1.5', 'wallet_withdraw').allowed).toBe(true);
    restaurer();
  });
});
