import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

// Capture des ecritures vers Supabase : c'est ce qui permet de verifier que
// l'etat de verrouillage survit a un redemarrage, puisque la RAM est vide
// dans ce test.
const upserts = [];
let selectRows = [];

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => {
      // Chaîneable : eq / lt / in puis resolution en { data, error }.
      const query = {
        eq: vi.fn(() => query),
        lt: vi.fn(() => query),
        in: vi.fn(() => query),
        upsert: vi.fn((payload) => {
          upserts.push({ table, payload });
          return Promise.resolve({ error: null });
        }),
        delete: vi.fn(() => query),
        update: vi.fn(() => query),
        select: vi.fn(() => query),
        range: vi.fn(() => Promise.resolve({ data: selectRows, error: null })),
        then: (onOk) => Promise.resolve({ data: selectRows, error: null }).then(onOk),
      };
      return query;
    }),
  },
}));

import * as persistence from './persistence.mjs';

const PASSWORD = 'MotDePasse!Solide2026';

// Reproduit le prefixe de hashLockoutKey pour verifier la forme de la cle.
const lockoutKeyOf = (normalizedIdentifier) =>
  crypto.createHash('sha256').update(`zoyd-lockout:${normalizedIdentifier}`).digest('hex');

let stamp = 0;

// Identifiants uniques par test : ensureUniqueRegistration refuse un pseudo
// deja connu, y compris entre deux tests du meme fichier.
const makeIdent = () => {
  stamp += 1;
  const unique = `${Date.now() % 1_000_000}${stamp}`;
  return {
    pseudo: `Verrou${unique}`,
    email: `verrou-${unique}@test.local`,
    phone: `+22507${unique.slice(-8).padStart(8, '0')}`,
    gameId: `CO-VRQ-${unique}`,
  };
};

// `sbFire` est fire-and-forget : l'ecriture part apres le retour de
// authenticateUserAccount. Sans cette vidange de microtaches, le test observe
// une base vide et Echoue pour une raison qui n'a rien a voir avec le code.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const lastLockoutUpsert = () => [...upserts].reverse().find((e) => e.table === 'login_attempts');
const countLockoutUpserts = () => upserts.filter((e) => e.table === 'login_attempts').length;

// L'API attend un objet { identifier, password }.
const tryLogin = async (ident, password) => {
  await settle();
  try {
    await persistence.authenticateUserAccount({ identifier: ident.pseudo, password });
    await settle();
    return { ok: true };
  } catch (err) {
    await settle();
    return { ok: false, code: err.code };
  }
};

let ident;
let userId;

beforeEach(async () => {
  upserts.length = 0;
  selectRows = [];
  ident = makeIdent();
  const created = await persistence.createUserAccount({
    ...ident, password: PASSWORD, acceptAdult: true, acceptTerms: true,
  });
  userId = created.id;
});

describe('verrouillage de connexion : ce qui part en base', () => {
  it('ecrit un verrou apres MAX echecs', async () => {
    let locked = null;
    for (let i = 0; i < 6; i += 1) {
      const result = await tryLogin(ident, `Mauvais${i}`);
      if (result.code === 'ACCOUNT_LOCKED') locked = result;
    }
    expect(locked).not.toBeNull();

    const row = lastLockoutUpsert();
    expect(row).toBeDefined();
    expect(row.payload.locked_until).toBeTruthy();
  });

  it('incremente le compteur a chaque echec', async () => {
    const counts = [];
    for (let i = 0; i < 3; i += 1) {
      await tryLogin(ident, `Mauvais${i}`);
      const row = lastLockoutUpsert();
      if (row) counts.push(row.payload.count);
    }
    expect(counts).toEqual([1, 2, 3]);
  });

  it('n\'ecrit jamais l\'identifiant en clair', async () => {
    await tryLogin(ident, 'Mauvais');
    const row = lastLockoutUpsert();
    const serialized = JSON.stringify(row.payload);

    // La table ne doit pas devenir un annuaire des pseudos et emails essayes.
    expect(serialized).not.toContain(ident.pseudo);
    expect(serialized).not.toContain(ident.email);
    expect(serialized).not.toContain(ident.phone);
    expect(row.payload.id).toMatch(/^[0-9a-f]{64}$/);
    expect(row.payload.id).toBe(lockoutKeyOf(ident.pseudo.trim().toLowerCase()));
  });

  it('purge le verrou apres une connexion reussie', async () => {
    await tryLogin(ident, 'Mauvais');
    expect(lastLockoutUpsert()).toBeDefined();
    const writesBefore = countLockoutUpserts();

    const result = await tryLogin(ident, PASSWORD);
    expect(result.ok).toBe(true);
    // Aucune NOUVELLE ecriture de verrou : le chemin de purge a ete pris.
    expect(countLockoutUpserts()).toBe(writesBefore);
  });
});

describe('verrouillage de connexion : resistance au redemarrage', () => {
  it('relit le verrou en base quand la memoire est vide', async () => {
    // On fabrique l'etat que le serveur aurait en base apres 5 echecs.
    const key = lockoutKeyOf(ident.pseudo.trim().toLowerCase());
    selectRows = [{
      id: key,
      count: 0,
      locked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }];

    // Memoire vierge pour cette cle => c'est la base qui doit trancher.
    const result = await tryLogin(ident, PASSWORD);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ACCOUNT_LOCKED');
  });

  it('un verrou expire en base ne bloque pas', async () => {
    const key = lockoutKeyOf(ident.pseudo.trim().toLowerCase());
    selectRows = [{
      id: key,
      count: 0,
      locked_until: new Date(Date.now() - 1000).toISOString(),
    }];
    const result = await tryLogin(ident, PASSWORD);
    expect(result.ok).toBe(true);
  });

  it('la connexion reussie apres redemarrage fonctionne toujours', async () => {
    // Aucune ligne : premier essai apres redemarrage, on ne doit pas casser
    // l'authentification normale.
    selectRows = [];
    const result = await tryLogin(ident, PASSWORD);
    expect(result.ok).toBe(true);
  });

  it('le compteur relu depuis la base continue a compter', async () => {
    // 3 echous deja enregistres en base, RAM vide : le 4e doit repartir de 3.
    const key = lockoutKeyOf(ident.pseudo.trim().toLowerCase());
    selectRows = [{ id: key, count: 3, locked_until: null }];

    await tryLogin(ident, 'Mauvais4');
    const row = lastLockoutUpsert();
    expect(row.payload.count).toBe(4);
    // 4 < MAX : pas encore de verrou, la ligne ne doit donc pas etre verrouillee.
    expect(row.payload.locked_until).toBeNull();
  });

  it('le 5e echec relu depuis la base declenche le verrou', async () => {
    const key = lockoutKeyOf(ident.pseudo.trim().toLowerCase());
    selectRows = [{ id: key, count: 4, locked_until: null }];

    const result = await tryLogin(ident, 'Mauvais5');
    expect(result.code).toBe('INVALID_CREDENTIALS');
    const row = lastLockoutUpsert();
    expect(row.payload.locked_until).toBeTruthy();
  });
});

describe('verrouillage de connexion : suppression de compte', () => {
  it('ne laisse plus d\'ecriture de verrou apres suppression', async () => {
    await tryLogin(ident, 'Mauvais');
    expect(lastLockoutUpsert()).toBeDefined();

    await persistence.deleteUserAccount(userId);
    const writesAfterDelete = countLockoutUpserts();

    // Le compte n'existe plus : aucune donnee de verrou ne doit plus etre
    // ecrit pour lui.
    await tryLogin(ident, 'Mauvais');
    expect(countLockoutUpserts()).toBe(writesAfterDelete);
  });
});
