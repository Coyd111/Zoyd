import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// La vérification d'intégrité compare la mémoire à Supabase. Le mock contient
// le contenu RÉEL de chaque table pour que le test vérifie la logique de
// comparaison, pas le mock lui-même.
let dbUsers = [];
let dbStateRows = [];
// Tables « absentes » : on simule une migration qui n'a pas encore ete jouee.
let missingTables = new Set();

vi.mock('./supabase.mjs', () => {
  // Chaine generique vide : `loadFromSupabase` Balaye plusieurs tables et
  // appelle select/order/range sur chacune.
  const chainRef = () => {
    const chain = {
      eq: vi.fn(() => chainRef()),
      lt: vi.fn(() => chainRef()),
      in: vi.fn(() => chainRef()),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      delete: vi.fn(() => chainRef()),
      update: vi.fn(() => chainRef()),
      select: vi.fn(() => chainRef()),
      order: vi.fn(() => chainRef()),
      limit: vi.fn(() => chainRef()),
      range: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
    chain.then = (onOk) => Promise.resolve({ data: [], error: null }).then(onOk);
    return chain;
  };

  return { supabase: { from: vi.fn((table) => {
      if (missingTables.has(table)) {
        // PostgREST sur une table absente : erreur 42P01, pas d'exception.
        const fail = () => Promise.resolve({ data: null, error: { message: `relation "public.${table}" does not exist`, code: '42P01' } });
        const missing = {
          then: (onOk, onErr) => fail().then(onOk, onErr),
          range: vi.fn(() => fail()),
          eq: vi.fn(() => missing),
          order: vi.fn(() => missing),
          select: vi.fn(() => missing),
        };
        return missing;
      }
      if (table === 'app_users') {
        return {
          select: vi.fn(() => ({
            // count:'exact' + head:true => pas de lignes, seulement un compte.
            then: (onOk) => Promise.resolve({ count: dbUsers.length, error: null }).then(onOk),
            // `range` sert au chargement au demarrage : on y vide la table,
            // chaque test part d'un etat propre.
            range: vi.fn(() => Promise.resolve({ data: [], error: null })),
            order: vi.fn(() => chainRef()),
          })),
          upsert: vi.fn(() => Promise.resolve({ error: null })),
          delete: vi.fn(() => chainRef()),
        };
      }
      if (table === 'state_snapshots') {
        return {
          select: vi.fn(() => ({
            then: (onOk) => Promise.resolve({ data: dbStateRows, error: null }).then(onOk),
            range: vi.fn(() => Promise.resolve({ data: [], error: null })),
            order: vi.fn(() => chainRef()),
          })),
          upsert: vi.fn(() => Promise.resolve({ error: null })),
          delete: vi.fn(() => chainRef()),
          update: vi.fn(() => chainRef()),
        };
      }
      // Toute autre table (notifications, canaux, sessions...) : chaine
      // complete et vide, pour que le chargement au demarrage n'echoue pas.
      return chainRef();
    }),
  } };
});

import * as persistence from './persistence.mjs';

let stamp = 0;
const unique = () => `${Date.now() % 1_000_000}-${(stamp += 1)}`;

/** Crée un vrai compte, dont la clé d'identifiant est derivée du pseudo. */
const createUser = async (overrides = {}) => {
  const id = unique();
  const created = await persistence.createUserAccount({
    pseudo: `Int${id.replace(/\W/g, '')}`,
    email: `int-${id}@test.local`,
    phone: `+22506${String(Date.now() % 10000000).padStart(7, '0')}${stamp}`,
    gameId: `CO-INT-${id}`,
    password: 'MotDePasse!Solide2026',
    acceptAdult: true,
    acceptTerms: true,
    ...overrides,
  });
  dbUsers.push({ id: created.id });
  return created;
};

/** Modifie le portefeuille d'un compte deja cree (l'API attend une fonction). */
const setWallet = async (userId, wallet) => {
  await persistence.updateUserAccount(userId, (user) => ({ ...user, wallet }));
};

/** Ecrit une entree d'etat en memoire ET en base (comme le fait le code). */
const seedState = async (kind, entityId, payload = {}) => {
  await persistence.upsertStateEntity(kind, { id: entityId, ...payload });
  dbStateRows.push({ kind, entity_id: entityId });
};

// `verifyDataIntegrity` met son resultat en cache 60 s. Sans faire avancer
// l'horloge, le deuxieme test lit le cache du premier et passe ou echoue pour
// la mauvaise raison. On decale donc l'horloge de plus que le TTL, et on rend
// l'heure native exacte au depart de chaque test.
const NATIVE_NOW = Date.now;
let clockShift = 0;

beforeEach(async () => {
  clockShift += 61_000;
  Date.now = () => NATIVE_NOW() + clockShift;
  dbUsers = [];
  dbStateRows = [];
  missingTables = new Set();
  // Le chargement marque l'etat comme fiable : sans ca, upsertStateEntity
  // refuse toute ecriture (garde-fou anti-purge).
  await persistence.loadFromSupabase();
});

afterEach(() => {
  Date.now = NATIVE_NOW;
});

describe('verifyDataIntegrity : comptes', () => {
  it('valide quand memoire et base concordent', async () => {
    await createUser();
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(true);
    expect(result.memoryUsers).toBe(result.dbUsers);
  });

  it('detecte un compte charge en trop par rapport a la base', async () => {
    await createUser();
    await createUser();
    dbUsers.pop();
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.memoryUsers - result.dbUsers).toBe(1);
  });
});

describe("verifyDataIntegrity : collections d'etat", () => {
  it('valide des matchs concordants', async () => {
    await seedState('matches', 'M-1', { status: 'live' });
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(true);
    expect(result.state.matches).toBe(1);
  });

  it('detecte un batch tronque : plus en memoire qu\'en base', async () => {
    await seedState('tournaments', 'T-1', {});
    await seedState('tournaments', 'T-2', {});
    // T-2 n'a jamais atteint la base : le scenario exact d'un
    // replaceStateCollection interrompu.
    dbStateRows.pop();

    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.stateMismatches).toHaveLength(1);
    expect(result.stateMismatches[0]).toMatchObject({ kind: 'tournaments', memory: 2, db: 1 });
  });

  it('detecte une ligne en base absente de la memoire', async () => {
    await seedState('leagues', 'LS-1', {});
    dbStateRows.push({ kind: 'leagues', entity_id: 'LS-2' });

    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.stateMismatches[0]).toMatchObject({ kind: 'leagues', memory: 1, db: 2 });
  });

  it('ne se laisse pas tromper par deux kinds de meme taille', async () => {
    await seedState('matches', 'M-1', {});
    await seedState('tournaments', 'T-1', {});
    // La base ne contient qu'un tournoi : meme total, kinds differents.
    dbStateRows.splice(0, 1);

    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.stateMismatches).toHaveLength(1);
    expect(result.stateMismatches[0].kind).toBe('matches');
  });

  it('compare chaque kind independamment', async () => {
    await seedState('matches', 'M-1', {});
    await seedState('brLobbies', 'BR-1', {});
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(true);
    expect(result.state).toMatchObject({ matches: 1, brLobbies: 1 });
  });
});

describe("verifyDataIntegrity : invariant des portefeuilles", () => {
  const baseWallet = () => ({
    cashBalance: 1000,
    bonusBalance: 0,
    lockedBalance: 0,
    pendingWinnings: 0,
    lockedEntries: {},
    transactions: [],
  });

  it('valide un portefeuille equilibre', async () => {
    const user = await createUser();
    await setWallet(user.id, { ...baseWallet(), lockedBalance: 100, lockedEntries: { 'M-1': { amount: 60 }, 'M-2': { amount: 40 } } });
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(true);
    expect(result.walletIssues).toHaveLength(0);
  });

  it('detecte une mise bloquee sans reservation (argent perdu)', async () => {
    const user = await createUser();
    await setWallet(user.id, { ...baseWallet(), lockedBalance: 100, lockedEntries: {} });
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.walletIssues).toHaveLength(1);
    expect(result.walletIssues[0]).toMatchObject({ userId: user.id, lockedBalance: 100, entriesTotal: 0 });
  });

  it('detecte une reservation sans mise bloquee (argent fantome)', async () => {
    const user = await createUser();
    await setWallet(user.id, { ...baseWallet(), lockedBalance: 0, lockedEntries: { 'M-1': { amount: 50 } } });
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.walletIssues[0]).toMatchObject({ entriesTotal: 50, diff: -50 });
  });

  it('detecte un solde bloque negatif', async () => {
    const user = await createUser();
    await setWallet(user.id, { ...baseWallet(), lockedBalance: -20, lockedEntries: { 'M-1': { amount: -20 } } });
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(false);
    expect(result.walletIssues.some((issue) => issue.reason === 'NEGATIVE_LOCKED_BALANCE')).toBe(true);
  });

  it('tolere une derive d\'arrondi inferieure au centime', async () => {
    const user = await createUser();
    await setWallet(user.id, {
      ...baseWallet(),
      lockedBalance: 99.99,
      lockedEntries: { a: { amount: 33.33 }, b: { amount: 33.33 }, c: { amount: 33.33 } },
    });
    const result = await persistence.verifyDataIntegrity();
    expect(result.ok).toBe(true);
  });

  it('ignore un portefeuille absent', async () => {
    await createUser();
    const result = await persistence.verifyDataIntegrity();
    expect(result.walletIssues).toHaveLength(0);
  });
});

describe('table login_attempts absente : degrade sans casser le serveur', () => {
  it('ne met PAS stateTrusted a false', async () => {
    // Le piege : `fetchAllRows` leve sur une table absente, et l'echec remettait
    // `stateTrusted = false`, ce qui REFUSE toute ecriture d'etat. Le serveur
    // demarrerait en lecture seule a cause d'une migration en attente, alors
    // que la base est saine.
    missingTables.add('login_attempts');
    await persistence.loadFromSupabase();

    const health = persistence.getHealthInfo();
    expect(health.stateTrusted).toBe(true);
    expect(health.stateLoadError).toBeNull();
  });

  it('signale que le verrouillage n\'est pas persiste', async () => {
    missingTables.add('login_attempts');
    await persistence.loadFromSupabase();
    expect(persistence.getHealthInfo().loginLockoutPersisted).toBe(false);
  });

  it('signale le verrouillage comme persiste quand la table existe', async () => {
    await persistence.loadFromSupabase();
    expect(persistence.getHealthInfo().loginLockoutPersisted).toBe(true);
  });
});

describe('getHealthInfo publie le dernier controle', () => {
  it('expose un controle valide', async () => {
    await createUser();
    await persistence.verifyDataIntegrity();
    const health = persistence.getHealthInfo();
    expect(health.integrity).not.toBeNull();
    expect(health.integrity.ok).toBe(true);
    expect(health.integrity.walletIssues).toBe(0);
    expect(typeof health.integrity.checkedAt).toBe('string');
  });

  it('expose un KO avec le nombre d\'anomalies', async () => {
    const user = await createUser();
    await setWallet(user.id, { ...{ cashBalance: 0, bonusBalance: 0, lockedBalance: 77, pendingWinnings: 0, lockedEntries: {}, transactions: [] } });
    await persistence.verifyDataIntegrity();
    const health = persistence.getHealthInfo();
    expect(health.integrity.ok).toBe(false);
    expect(health.integrity.walletIssues).toBe(1);
  });
});
