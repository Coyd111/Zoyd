import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const query = {
        eq: vi.fn(() => query), lt: vi.fn(() => query), in: vi.fn(() => query),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => query), update: vi.fn(() => query),
        select: vi.fn(() => query),
        range: vi.fn(() => Promise.resolve({ data: [], error: null })),
        then: (onOk) => Promise.resolve({ data: [], error: null }).then(onOk),
      };
      return query;
    }),
  },
}));

import * as persistence from './persistence.mjs';

const PASSWORD = 'MotDePasse!Solide2026';

let stamp = 0;
const makeIdent = () => {
  stamp += 1;
  const unique = `${Date.now() % 1_000_000}${stamp}`;
  return {
    pseudo: `Garde${unique}`,
    email: `garde-${unique}@test.local`,
    phone: `+22507${unique.slice(-8).padStart(8, '0')}`,
    gameId: `CO-GAR-${unique}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
    acceptedAt: new Date().toISOString(),
  };
};

/**
 * Le seed admin ne doit jamais réécrire un compte qui existe déjà.
 *
 * Le scénario qui a motivé ce garde-fou : `ZOYD_ADMIN_EMAIL` est changé sur
 * l'hébergeur AVANT que le nouvel email soit appliqué dans l'application. Au
 * redémarrage, le seed ne trouve aucun compte à ce nouvel email et tombe dans
 * `insertUser`, qui fait un `sbUpsert` sur `ZOYD_ADMIN_ID` — un id déjà
 * occupé. L'upsert réécrivait alors toute la ligne avec les valeurs du seed :
 * `walletBalance: 0`, donc le solde du compte de contrôle tombait à zéro.
 *
 * On vérifie ici que l'écriture est refusée, et surtout que le compte survit
 * intact.
 */
describe('ensureSeedAdmin — jamais d ecriture sur un compte existant', () => {
  beforeEach(() => {
    delete process.env.ZOYD_ADMIN_EMAIL;
    delete process.env.ZOYD_ADMIN_PSEUDO;
    delete process.env.ZOYD_ADMIN_ID;
    process.env.ZOYD_ADMIN_PASSWORD = PASSWORD;
  });

  it('refuse d ecraser un compte dont l id est deja pris', async () => {
    const ident = makeIdent();
    const userId = (await persistence.createUserAccount(ident)).id;

    // Le compte a de l'argent et un profil personnalise : c'est ce qui ne
    // doit surtout pas disparaitre. `walletBalance` est RECALCULE depuis le
    // snapshot `wallet`, c'est donc lui qu'il faut toucher.
    const avant = persistence.getUserById(userId);
    await persistence.updateUserAccount(userId, (user) => ({
      ...user,
      email: 'ancien-email@test.local',
      wallet: { ...user.wallet, cashBalance: 1154.4, bonusBalance: 0 },
      bio: 'Bio qui doit survivre',
    }));
    expect(avant).not.toBeNull();

    process.env.ZOYD_ADMIN_ID = userId;
    process.env.ZOYD_ADMIN_EMAIL = 'nouvel-email@test.local';
    process.env.ZOYD_ADMIN_PSEUDO = 'Renomme';

    await persistence.ensureSeedAdmin();

    const apres = persistence.getUserById(userId);
    expect(apres).not.toBeNull();
    expect(apres.email).toBe('ancien-email@test.local');
    expect(apres.pseudo).toBe(ident.pseudo);
    expect(apres.bio).toBe('Bio qui doit survivre');
    expect(apres.walletBalance).toBeCloseTo(1154.4, 2);
  }, 30000);

  it('laisse le serveur demarrer meme quand le compte existe deja', async () => {
    const ident = makeIdent();
    const created = await persistence.createUserAccount(ident);
    process.env.ZOYD_ADMIN_ID = created.id;
    process.env.ZOYD_ADMIN_EMAIL = 'absent@test.local';

    // Pas d exception : une régression ici rendrait le service injoignable.
    await expect(persistence.ensureSeedAdmin()).resolves.not.toThrow();
  }, 30000);

  it('cree normalement quand aucun compte ne porte cet id', async () => {
    process.env.ZOYD_ADMIN_ID = 'admin-introuvable';
    process.env.ZOYD_ADMIN_EMAIL = 'seed-neuf@test.local';

    await persistence.ensureSeedAdmin();

    expect(persistence.getUserIdByEmail('seed-neuf@test.local')).toBe('admin-introuvable');
  }, 30000);
});