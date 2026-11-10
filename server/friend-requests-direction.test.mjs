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
    pseudo: `Sens${unique}`,
    email: `sens-${unique}@test.local`,
    phone: `+22507${unique.slice(-8).padStart(8, '0')}`,
    gameId: `CO-SEN-${unique}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
    acceptedAt: new Date().toISOString(),
  };
};

/**
 * Direction des demandes d'ami.
 *
 * L'implémentation d'origine gardait `target_id === userId OU
 * sender_id === userId` : l'expéditeur récupérait donc ses propres demandes.
 * `FriendsWidget` affiche `senderPseudo` accompagné de « Accepter / Refuser »
 * — un joueur se voyait ainsi proposer d'accepter la demande qu'il venait
 * lui-même d'envoyer.
 *
 * Ces tests verrouillent la direction au niveau de la source, parce que le
 * défaut a deux consommateurs : `/api/social/pending` et le bootstrap temps
 * réel. Corriger le front ne suffirait pas.
 */
describe('getFriendRequestsForUser — direction', () => {
  let alice;
  let bob;

  beforeEach(async () => {
    alice = await persistence.createUserAccount(makeIdent());
    bob = await persistence.createUserAccount(makeIdent());
  });

  it('renvoie la demande chez celui qui l a recue', async () => {
    await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');

    const recues = persistence.getFriendRequestsForUser(bob.id);
    expect(recues).toHaveLength(1);
    expect(recues[0].senderId).toBe(alice.id);
    expect(recues[0].targetId).toBe(bob.id);
    expect(recues[0].senderPseudo).toBe(alice.pseudo);
  });

  it('ne renvoie RIEN a celui qui l a envoyee', async () => {
    await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');

    // C'etait LE bug : l'expediteur recuperait sa propre demande.
    expect(persistence.getFriendRequestsForUser(alice.id)).toHaveLength(0);
  });

  it('ne melange pas les demandes de deux expediteurs distincts', async () => {
    const carol = await persistence.createUserAccount(makeIdent());
    const dave = await persistence.createUserAccount(makeIdent());

    await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');
    await persistence.sendFriendRequest(carol.id, bob.id, 'Salut');
    await persistence.sendFriendRequest(dave.id, bob.id, 'Yo');

    const recues = persistence.getFriendRequestsForUser(bob.id);
    expect(recues).toHaveLength(3);
    expect(recues.map((r) => r.senderId).sort())
      .toEqual([alice.id, carol.id, dave.id].sort());
  });

  it('reste vide pour un tiers sans rapport', async () => {
    const stranger = await persistence.createUserAccount(makeIdent());
    await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');

    expect(persistence.getFriendRequestsForUser(stranger.id)).toHaveLength(0);
  });

  it('conserve le statut d une demande deja traitee', async () => {
    await persistence.sendFriendRequest(alice.id, bob.id, 'Coucou');
    const avant = persistence.getFriendRequestsForUser(bob.id)[0];
    await persistence.acceptFriendRequest(avant.id, bob.id);

    const apres = persistence.getFriendRequestsForUser(bob.id);
    expect(apres).toHaveLength(1);
    expect(apres[0].status).toBe('accepted');
  });

  it('normalise le pseudo de l expediteur', () => {
    // Regression historique : la ligne DB brute exposait `sender_id` et le
    // composant affichait "undefined veut t'ajouter".
    const recues = persistence.getFriendRequestsForUser(bob.id);
    for (const r of recues) {
      expect(r.senderPseudo).not.toBe('undefined');
      expect(r.senderPseudo).toBeTruthy();
      expect(r).toHaveProperty('timestamp');
    }
  });
});