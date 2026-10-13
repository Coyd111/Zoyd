import { describe, it, expect, vi } from 'vitest';

/**
 * Le mode detendu du rate limiting neutralise TOUS les garde-fous
 * anti-bruteforce : authentification, retraits, signalements.
 *
 * Il ne doit s'activer que pour une suite de tests en memoire. Une seule
 * variable erronee en production (NODE_ENV=test pose par erreur) suffisait a le
 * desactiver entierement, sans le moindre signal.
 *
 * On travaille sur le groupe `wallet`, dont le plafond (20 par fenetre) est
 * atteint vite : le groupe `auth` autorise 50, et un test qui n'en fait que 40
 * passerait meme avec la protection desactivee — c'est-a-dire qu'il ne
 * prouverait rien.
 *
 * Chaque test recharge le module avec un environnement controle : les valeurs
 * sont lues au chargement.
 */
const GROUPE = 'wallet';
const PLAFOND = 20;

const compterPasses = (mod, appels) => {
  let passes = 0;
  for (let i = 0; i < appels; i += 1) {
    if (mod.checkRateLimit('1.2.3.4', GROUPE).allowed) passes += 1;
  }
  return passes;
};

const chargerAvec = async (env) => {
  vi.resetModules();
  const sauvegarde = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ZOYD_') || k.startsWith('ALLOW_') || k.startsWith('SUPABASE_') || k === 'NODE_ENV') {
      delete process.env[k];
    }
  }
  Object.assign(process.env, env);
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

describe('mode detendu du rate limiting', () => {
  it("s'active en E2E : test + debug + base desactivee", async () => {
    const { mod, restaurer } = await chargerAvec({
      NODE_ENV: 'test',
      ALLOW_DEBUG_CODES: 'true',
      ZOYD_DISABLE_SUPABASE: 'true',
    });
    // 4 fois le plafond ne doit declencher aucun blocage.
    expect(compterPasses(mod, PLAFOND * 4)).toBe(PLAFOND * 4);
    restaurer();
  });

  it("REFUSE le mode detendu si une base reelle est configuree", async () => {
    const { mod, restaurer } = await chargerAvec({
      NODE_ENV: 'test',
      ALLOW_DEBUG_CODES: 'true',
      // ZOYD_DISABLE_SUPABASE absent : le service est connecte a une base.
      SUPABASE_URL: 'https://exemple.supabase.co',
      SUPABASE_SERVICE_KEY: 'cle',
    });
    expect(compterPasses(mod, PLAFOND * 4)).toBe(PLAFOND);
    restaurer();
  });

  it('laisse la protection active en production', async () => {
    const { mod, restaurer } = await chargerAvec({
      NODE_ENV: 'production',
      ALLOW_DEBUG_CODES: 'true',
      SUPABASE_URL: 'https://exemple.supabase.co',
    });
    expect(compterPasses(mod, PLAFOND * 4)).toBe(PLAFOND);
    restaurer();
  });

  it('laisse la protection active si NODE_ENV est errone', async () => {
    // NODE_ENV=test pose par megarde : c'est exactement le cas redoute.
    const { mod, restaurer } = await chargerAvec({
      NODE_ENV: 'test',
      ALLOW_DEBUG_CODES: 'true',
      SUPABASE_URL: 'https://exemple.supabase.co',
      SUPABASE_SERVICE_KEY: 'cle',
      ZOYD_DISABLE_SUPABASE: 'false',
    });
    expect(compterPasses(mod, PLAFOND * 4)).toBe(PLAFOND);
    restaurer();
  });

  it('bloque vraiment au-dela du plafond quand la protection est active', async () => {
    // Temoin : sans lui, les trois tests precedents pourraient passer pour la
    // mauvaise raison.
    const { mod, restaurer } = await chargerAvec({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://exemple.supabase.co',
    });
    const premier = mod.checkRateLimit('9.9.9.9', GROUPE);
    expect(premier.allowed).toBe(true);
    expect(premier.remaining).toBe(PLAFOND - 1);
    restaurer();
  });
});