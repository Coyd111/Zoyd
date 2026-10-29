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
    pseudo: `Acc${unique}`,
    email: `acc-${unique}@test.local`,
    phone: `+22507${unique.slice(-8).padStart(8, '0')}`,
    gameId: `CO-ACC-${unique}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
    acceptedAt: new Date().toISOString(),
  };
};

/**
 * Acceptation d'une demande d'ami : le profil renvoye.
 *
 * `acceptFriendRequest` renvoyait le profil INTERNE du demandeur
 * (`getUserById` -> `sanitizeUserPayload`, qui ne retire RIEN) : la route
 * `/api/social/accept` le livrait tel quel et le front l'insérait brut dans
 * `friends` — email, telephone et wallet d'un tiers transitaient au
 * destinataire. La liste d'amis, elle, est hydratee depuis la version
 * publique (`getFriendsForUser` -> `getPublicUserById`).
 *
 * Ces tests verrouillent la SOURCE (comme friend-requests-direction) : la
 * voie est front-transparente, corriger seulement le front n'aurait rien
 * protege — la fuite passait avant la reponse HTTP. Audit-4 C1.
 */
describe('acceptFriendRequest — le profil du demandeur reste public', () => {
  let alice;
  let bob;

  beforeEach(async () => {
    alice = await persistence.createUserAccount(makeIdent());
    bob = await persistence.createUserAccount(makeIdent());
  });

  it('livre le profil public du demandeur (sans email, phone, wallet, legal)', async () => {
    const request = await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');
    const friend = await persistence.acceptFriendRequest(request.id, bob.id);

    expect(friend).not.toBeNull();
    expect(friend.id).toBe(alice.id);
    expect(friend.pseudo).toBe(alice.pseudo);
    // C'etait LA fuite : passer par une lecture interne livrait ces champs.
    expect(friend).not.toHaveProperty('email');
    expect(friend).not.toHaveProperty('phone');
    expect(friend).not.toHaveProperty('wallet');
    expect(friend).not.toHaveProperty('walletBalance');
    expect(friend).not.toHaveProperty('legal');
  });

  it('la lecture interne du meme compte porte bien ces champs (differentiel)', async () => {
    // Preuve que le test ci-dessus aurait DETECTE la regression : la forme
    // interne (getUserById) expose email/phone/wallet, la forme acceptee ne
    // doit pas les exposer.
    const request = await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');
    const friend = await persistence.acceptFriendRequest(request.id, bob.id);
    const interne = persistence.getUserById(alice.id);

    expect(interne).not.toBeNull();
    expect(interne).toHaveProperty('email');
    expect(interne).toHaveProperty('phone');
    expect(friend).not.toHaveProperty('email');
    expect(friend).not.toHaveProperty('phone');
  });

  it('garde les champs publics utiles a la notification et au rendu', async () => {
    const request = await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');
    const friend = await persistence.acceptFriendRequest(request.id, bob.id);

    // La route notifie le demandeur via friend.id ; le rendu lit pseudo et
    // trustScore (normalizeServerFriend derive le reste).
    expect(friend.id).toBe(alice.id);
    expect(friend.pseudo).toBe(alice.pseudo);
    expect(friend.trustScore).toBeTypeOf('number');
  });
});
