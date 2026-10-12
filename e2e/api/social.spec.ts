import { test, expect } from '@playwright/test';
import { call, callAnonymous, registerPlayer } from './support/harness';

// ─────────────────────────────────────────────────────────────────────────────
// Routes sociales et notifications.
//
// Ces routes n'avaient AUCUNE couverture : le bloc entier pouvait être
// réécrit, mal extrait ou perdu, et la suite verte ne l'aurait pas signalé.
// Leur existence même justifie ces tests — le refactor de `realtime-server`
// s'appuie dessus pour garantir qu'aucune route ne change de comportement.
//
// On couvre le cycle complet d'une relation, pas seulement les codes de
// retour : une liste d'amis qui répond 200 mais reste vide passerait un test
// naïf.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Routes sociales', () => {
  test('demande, acceptation et liste d amis', async () => {
    const alice = await registerPlayer('Alice');
    const bob = await registerPlayer('Bob');

    // Liste d'amis vide au départ.
    const listeAvant = await call(alice, 'GET', '/api/social/friends');
    expect(listeAvant.status).toBe(200);
    expect(listeAvant.body?.friends).toHaveLength(0);

    const demande = await call(alice, 'POST', '/api/social/request', {
      targetId: bob.id,
      message: 'On joue ensemble ?',
    });
    expect(demande.status).toBe(200);

    // La demande apparaît chez le receveur.
    const pendingBob = await call(bob, 'GET', '/api/social/pending');
    expect(pendingBob.body?.requests.length).toBeGreaterThan(0);

    // ATTENTION — comportement OBSERVÉ, pas souhaité : l'endpoint renvoie
    // aussi les demandes ENVOYÉES. `getFriendRequestsForUser` garde les deux
    // directions, et la route ne filtre que sur `status`. `FriendsWidget`
    // ne filtre pas davantage : un joueur voit donc ses propres demandes dans
    // son onglet « Demandes d'ami ». Le test fixe la réalité constatée pour
    // qu'une évolution soit visible ; corriger le comportement est une
    // décision produit à part.
    const pendingAlice = await call(alice, 'GET', '/api/social/pending');
    expect(pendingAlice.body?.requests.length).toBeGreaterThan(0);
    expect(pendingAlice.body?.requests[0].targetId).toBe(bob.id);

    // Acceptation.
    const requete = pendingBob.body.requests[0];
    const acceptation = await call(bob, 'POST', '/api/social/accept', {
      requestId: requete.id ?? requete.requestId,
    });
    expect(acceptation.status).toBe(200);

    const amisAlice = await call(alice, 'GET', '/api/social/friends');
    expect(amisAlice.body?.friends.length).toBeGreaterThan(0);

    // Le lien est réciproque.
    const amisBob = await call(bob, 'GET', '/api/social/friends');
    expect(amisBob.body?.friends.length).toBeGreaterThan(0);
  });

  test('refus de se demander soi-meme en ami', async () => {
    const alice = await registerPlayer('Auto');

    const res = await call(alice, 'POST', '/api/social/request', { targetId: alice.id });
    expect(res.status).not.toBe(200);
  });

  test('refus d une demande vers un compte inexistant', async () => {
    const alice = await registerPlayer('Fantome');

    const res = await call(alice, 'POST', '/api/social/request', {
      targetId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).not.toBe(200);
  });

  test('blocage puis déblocage', async () => {
    const alice = await registerPlayer('Bloc');
    const bob = await registerPlayer('Deblo');

    const blocage = await call(alice, 'POST', '/api/social/block', { targetId: bob.id });
    expect(blocage.status).toBe(200);

    const deblocage = await call(alice, 'POST', '/api/social/unblock', { targetId: bob.id });
    expect(deblocage.status).toBe(200);
  });

  test('refus de tout appel social sans session', async () => {
    for (const [method, route] of [
      ['GET', '/api/social/friends'],
      ['GET', '/api/social/pending'],
      ['POST', '/api/social/request'],
      ['POST', '/api/social/accept'],
      ['POST', '/api/social/block'],
      ['POST', '/api/social/unblock'],
      ['POST', '/api/social/report'],
      ['GET', '/api/notifications'],
      ['POST', '/api/notifications/read'],
      ['POST', '/api/notifications/read-all'],
    ] as const) {
      const res = await callAnonymous(method, route, { targetId: 'x' });
      expect(res.status, `${method} ${route} sans session`).toBe(401);
    }
  });

  test('signalement exige une cible et un motif', async () => {
    const alice = await registerPlayer('Signal');

    const vide = await call(alice, 'POST', '/api/social/report', {});
    expect(vide.status).toBe(400);
    expect(vide.body?.code).toBe('MISSING_FIELDS');

    const complet = await call(alice, 'POST', '/api/social/report', {
      targetId: '00000000-0000-4000-8000-000000000000',
      reason: 'Test de signalement',
    });
    expect(complet.status).toBe(201);
  });
});

test.describe('Notifications', () => {
  test('la liste démarre vide et se met à jour après une demande', async () => {
    const alice = await registerPlayer('NotifA');
    const bob = await registerPlayer('NotifB');

    const avant = await call(bob, 'GET', '/api/notifications');
    expect(avant.status).toBe(200);
    const countAvant = avant.body?.count ?? 0;

    await call(alice, 'POST', '/api/social/request', { targetId: bob.id });

    const apres = await call(bob, 'GET', '/api/notifications');
    expect(apres.body?.count).toBeGreaterThan(countAvant);

    // Marquer tout comme lu doit ramener le compteur à zéro.
    const toutLu = await call(bob, 'POST', '/api/notifications/read-all');
    expect(toutLu.status).toBe(200);

    const finale = await call(bob, 'GET', '/api/notifications');
    expect(finale.body?.count).toBe(0);
  });
});
