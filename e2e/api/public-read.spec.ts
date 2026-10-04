import { test, expect } from '@playwright/test';
import { callAnonymous, call, registerPlayer, disposeActors, type Actor } from './support/harness';

// Fumée sur les routes PUBLIQUES de lecture.
//
// Ces routes sont atteintes par la home, le hub et le SEO. Elles n'appellent
// aucune action d'écriture, mais une ReferenceError dans le handler suffit à
// les faire répondre 500 (le `catch` la masque en LOAD_ERROR) : c'est ce qui
// est arrivé à GET /api/tournaments, où `session?.userId` était référencé
// sans que `session` existe.
//
// Piège : `all.map(...)` n'exécute son callback que s'il y a des éléments. Sur
// une base vide, le ReferenceError ne se produit donc jamais en local, alors
// que la production (qui a des tournois) renvoyait 500. D'où le test
// « avec un tournoi présent » : c'est lui qui reproduit réellement le bug.

const PUBLIC_READ_ROUTES = [
  '/api/matches',
  '/api/tournaments',
  '/api/leagues',
  '/api/stats',
];

const uniqueName = () => `Tournoi Fumee ${Date.now().toString(36)}`;

test.describe('API publique - routes de lecture', () => {
  test.afterAll(async () => {
    await disposeActors();
  });

  for (const route of PUBLIC_READ_ROUTES) {
    test(`GET ${route} répond 200 en anonyme`, async () => {
      const res = await callAnonymous('GET', route);
      expect(res.status).toBe(200);
      expect(res.body?.ok).toBe(true);
    });
  }

  test('GET /api/tournaments répond 200 AVEC un tournoi (isMe calculé)', async () => {
    const actor: Actor = await registerPlayer('pubread-t');
    const created = await call(actor, 'POST', '/api/tournaments', {
      name: uniqueName(),
      format: '1VS1',
      maxEntries: 8,
      entryFee: 0,
    });
    expect(created.status).toBe(201);

    // Sans ce tournament, le callback du .map n'est jamais execute et le bug
    // resterait invisible.
    const list = await callAnonymous('GET', '/api/tournaments');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body?.tournaments)).toBe(true);
    expect(list.body.tournaments.length).toBeGreaterThan(0);
  });

  test('GET /api/tournaments répond 200 avec une session (isMe calculé)', async () => {
    const actor: Actor = await registerPlayer('pubread-s');
    const res = await call(actor, 'GET', '/api/tournaments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.tournaments)).toBe(true);
  });

  test('GET /api/matches ne renvoie aucun userId dans les joueurs', async () => {
    const res = await callAnonymous('GET', '/api/matches');
    expect(res.status).toBe(200);
    for (const match of res.body?.matches || []) {
      for (const player of match.players || []) {
        expect(player.userId).toBeUndefined();
      }
    }
  });

  test('les routes de lecture refusent les méthodes d’écriture', async () => {
    const res = await callAnonymous('POST', '/api/tournaments');
    expect(res.status).not.toBe(200);
  });
});

