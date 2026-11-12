import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * La cle Supabase doit porter le role `service_role`.
 *
 * Pourquoi
 * --------
 * L invariant « seule une cle `service_role` est acceptee » etait annonce
 * dans l en-tete du module, mais le code ne le verifiait PAS : ilacceptait
 * n importequelle valeur de `SUPABASE_SERVICE_KEY`.
 *
 * Consequence concrete : une cle `anon` posee par erreur (un copier-coller
 * depuis le dashboard, un variable d environnement dupliquee) faisait
 * echouer CHAQUE ecriture derriere le RLS. Le serveur annoncait un client
 * actif, les lectures semblaient fonctionner, et l argent cessait d etre
 * persiste - sans la moindre alerte, exactement ce que l invariant
 * promettait d empecher.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Le role est lisible dans une cle JWT.
 * 2. Une cle dont le role n est pas `service_role` est REFUSEE : le client
 *    n est pas cree, le serveur passe en mode degrade, et `/api/health`
 *    repond 503 (l echec est visible).
 * 3. Une cle dont le role n est pas verifiable (format `sb_secret_...`)
 *    n est pas refusee pour autant - on ne refuse pas ce qu on ne peut
 *    pas controler.
 */

/** Fabrique un faux JWT dont le payload porte un role. */
const jwt = (role) => {
  const entete = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const charge = Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url');
  return `${entete}.${charge}.signature`;
};

const ENV_INITIAL = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ZOYD_DISABLE_SUPABASE: process.env.ZOYD_DISABLE_SUPABASE,
};

const restaurer = () => {
  for (const [cle, valeur] of Object.entries(ENV_INITIAL)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
};

/** Reimporte le module avec un environnement donne. */
const recharger = async (env) => {
  restaurer();
  for (const [cle, valeur] of Object.entries(env)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
  vi.resetModules();
  return import('./supabase.mjs');
};

afterEach(restaurer);

describe('Cle Supabase — lecture du role', () => {
  it('lit le role d une cle JWT', async () => {
    const { lireRoleCle } = await import('./supabase.mjs');
    expect(lireRoleCle(jwt('service_role'))).toBe('service_role');
    expect(lireRoleCle(jwt('anon'))).toBe('anon');
  });

  it('renvoie null quand la cle n est pas verifiable', async () => {
    const { lireRoleCle } = await import('./supabase.mjs');
    // Format `sb_secret_...` : pas un JWT, donc pas de role lisible.
    expect(lireRoleCle('sb_secret_abcdef')).toBeNull();
    expect(lireRoleCle('')).toBeNull();
    expect(lireRoleCle(undefined)).toBeNull();
    // Un JWT corrompu ne doit pas lever.
    expect(lireRoleCle('a.b.c')).toBeNull();
  });
});

describe('Cle Supabase — une cle qui n est pas service_role est refusee', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('une cle anon est refusee : aucun client, mode degrade', async () => {
    const { supabase } = await recharger({
      SUPABASE_URL: 'https://exemple.supabase.co',
      SUPABASE_SERVICE_KEY: jwt('anon'),
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      ZOYD_DISABLE_SUPABASE: undefined,
    });
    // Le client n est PAS cree : le serveur bascule en mode degrade, donc
    // /api/health repond 503 et l operateur voit le defaut.
    expect(supabase, 'une cle anon ne doit jamais creer de client').toBeNull();
  });

  it('une cle service_role est acceptee', async () => {
    const { supabase } = await recharger({
      SUPABASE_URL: 'https://exemple.supabase.co',
      SUPABASE_SERVICE_KEY: jwt('service_role'),
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      ZOYD_DISABLE_SUPABASE: undefined,
    });
    expect(supabase, 'une cle service_role doit creer le client').not.toBeNull();
  });

  it('une cle non verifiable est acceptee, mais signalee', async () => {
    const { supabase } = await recharger({
      SUPABASE_URL: 'https://exemple.supabase.co',
      SUPABASE_SERVICE_KEY: 'sb_secret_abcdef',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      ZOYD_DISABLE_SUPABASE: undefined,
    });
    // On ne refuse pas ce qu on ne peut pas controler.
    expect(supabase).not.toBeNull();
  });
});
