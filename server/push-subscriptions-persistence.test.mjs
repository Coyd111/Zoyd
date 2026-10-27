import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La resolution utilisateur -> souscriptions Web Push (audit-3 P9 C1).
 *
 * Le trou ferme : `upsertPushSubscription` rangeait en memoire la
 * souscription BRUTE du navigateur, SANS le userId — le front n'en envoie
 * pas, la route fournit l'acteur authentifie via la session, et le userId ne
 * vivait que dans la colonne Supabase (`user_id`). Le filtre de
 * `getPushSubscriptionsForUser` (payload.userId / payload.user_id)
 * n'aboutissait JAMAIS : `sendPushToUser` livrait 0 notification a tout le
 * monde, en silence, et la purge a la suppression de compte ne supprimait
 * rien non plus.
 *
 * Meme cause racine pour le rechargement : la colonne `user_id` n'etait pas
 * fusionnee dans le payload memoire, donc apres chaque redemarrage une
 * souscription encore valide n'appartenait a personne.
 */

let dbPushRows = [];

vi.mock('./supabase.mjs', () => {
  // Chaine generique vide : `loadFromSupabase` balaie une douzaine de tables
  // (select/order/limit/range) et les sondes optionnelles (login_attempts,
  // colonne revision, sanctions) s'y resolvent sans erreur.
  const chainRef = () => {
    const chain = {
      eq: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      in: vi.fn(() => chain),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      delete: vi.fn(() => chain),
      update: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
    };
    chain.select = vi.fn(() => chain);
    chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
    chain.then = (onOk) => Promise.resolve({ data: [], error: null }).then(onOk);
    return chain;
  };

  return { supabase: { from: vi.fn((table) => {
    if (table === 'push_subscriptions') {
      const chain = chainRef();
      // Le chargement au demarrage lit via select('*').range(...) ; les
      // lectures ciblees (purge de compte) attendent la chaine entiere.
      chain.range = vi.fn(() => Promise.resolve({ data: dbPushRows, error: null }));
      chain.then = (onOk) => Promise.resolve({ data: dbPushRows, error: null }).then(onOk);
      return chain;
    }
    return chainRef();
  }) } };
});

// Import apres mock
import * as persistence from './persistence.mjs';

const makeSubscription = (endpoint, tag = 'defaut') => ({
  endpoint,
  keys: { p256dh: `p256dh-${tag}`, auth: `auth-${tag}` },
  expirationTime: null,
});

describe('persistence - resolution utilisateur -> souscriptions push (audit-3 P9 C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbPushRows = [];
  });

  it('reproducteur audit-3 : une souscription upsertee est retrouvee par son utilisateur', async () => {
    await persistence.loadFromSupabase(); // caches vides

    const sub = makeSubscription('https://push.test/ep-1');
    persistence.upsertPushSubscription('user-target', sub);

    const subs = persistence.getPushSubscriptionsForUser('user-target');
    expect(subs).toHaveLength(1);
    expect(subs[0].endpoint).toBe('https://push.test/ep-1');
    expect(subs[0].keys.p256dh).toBe('p256dh-defaut');
    expect(subs[0].userId).toBe('user-target');

    // Isolation : la souscription d un autre utilisateur reste introuvable.
    expect(persistence.getPushSubscriptionsForUser('user-autre')).toHaveLength(0);
  });

  it('re-upsert du MEME endpoint remplace la souscription (le navigateur reutilise son endpoint)', async () => {
    await persistence.loadFromSupabase();

    const oldSub = makeSubscription('https://push.test/ep-a');
    const newSub = {
      endpoint: oldSub.endpoint,
      keys: { p256dh: 'cle-tournee', auth: 'auth-tournee' },
      expirationTime: null,
    };
    persistence.upsertPushSubscription('user-x', oldSub);
    persistence.upsertPushSubscription('user-x', newSub);

    const subs = persistence.getPushSubscriptionsForUser('user-x');
    expect(persistence.countPushSubscriptions()).toBe(1); // pas de doublon
    expect(subs).toHaveLength(1);
    expect(subs[0].keys.p256dh).toBe('cle-tournee');
  });

  it('la suppression du compte purge ses souscriptions (meme filtre, meme cause racine)', async () => {
    await persistence.loadFromSupabase();

    const created = await persistence.createUserAccount({
      pseudo: 'PushOwner',
      email: 'push-owner@test.local',
      // 10 chiffres apres +225 (longueur Cote d'Ivoire) : un compte valide
      // pour un pays de retrait, comme l'exigent les gardes d'inscription.
      phone: '+2250700000001',
      gameId: 'CO-PUSH-0001',
      password: 'MotDePasse!Solide2026',
      acceptAdult: true,
      acceptTerms: true,
    });

    persistence.upsertPushSubscription(created.id, makeSubscription('https://push.test/ep-own'));
    expect(persistence.getPushSubscriptionsForUser(created.id)).toHaveLength(1);

    await persistence.deleteUserAccount(created.id);
    expect(persistence.getPushSubscriptionsForUser(created.id)).toHaveLength(0);
    expect(persistence.countPushSubscriptions()).toBe(0);
  });

  it('rechargement : la colonne user_id est fusionnee dans le payload memoire', async () => {
    dbPushRows = [{
      endpoint: 'https://push.test/ep-reload',
      user_id: 'user-reload',
      payload: makeSubscription('https://push.test/ep-reload', 'reload'),
      updated_at: new Date().toISOString(),
    }];

    await persistence.loadFromSupabase();

    const subs = persistence.getPushSubscriptionsForUser('user-reload');
    expect(subs).toHaveLength(1);
    expect(subs[0].endpoint).toBe('https://push.test/ep-reload');
    expect(subs[0].keys.p256dh).toBe('p256dh-reload');
    expect(subs[0].userId).toBe('user-reload');

    // Le payload brut du navigateur est preserve (contrat web-push).
    expect(subs[0].expirationTime).toBeNull();
  });
});
