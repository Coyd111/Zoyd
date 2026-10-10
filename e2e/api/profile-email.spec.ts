import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  registerPlayer,
  registerPlayerWithResponse,
  PLAYER_PASSWORD,
} from './support/harness';

// ─────────────────────────────────────────────────────────────────────────────
// Changement d'email de connexion.
//
// L'email n'est pas une donnée de profil comme une autre : c'est l'IDENTIFIANT
// du compte. Si on le laisse se modifier librement, une session volée (XSS dans
// un autre onglet, poste partagé, cookie exfiltré) suffit à prendre la main
// DÉFINITIVEMENT : il suffit de changer l'email, et l'ancien mot de passe ne
// sert plus à rien pour revenir. D'où la reauthentification obligatoire.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Changement d'email de connexion", () => {
  test("refuse le changement sans le mot de passe actuel (session volee)", async () => {
    const player = await registerPlayer('Securite');

    const res = await call(player, 'PATCH', '/api/auth/me', {
      email: `volee_${Date.now()}@e2e.zoyd.test`,
    });

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');

    // Le compte n'a pas bouge : le joueur est toujours utilisable.
    const me = await call(player, 'GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body?.user?.email).toBe(player.email);
  });

  test("refuse un mot de passe errone", async () => {
    const player = await registerPlayer('Securite');

    const res = await call(player, 'PATCH', '/api/auth/me', {
      email: `faux_${Date.now()}@e2e.zoyd.test`,
      currentPassword: 'MauvaisMotDePasse!1',
    });

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
  });

  test("accepte un email libre et revoque l'ancien identifiant", async () => {
    const { actor, body } = await registerPlayerWithResponse('Renomme');
    const ancienEmail = body.user.email;
    const nouvelEmail = `nouveau_${Date.now()}@e2e.zoyd.test`;

    const res = await call(actor, 'PATCH', '/api/auth/me', {
      email: nouvelEmail,
      currentPassword: PLAYER_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body?.user?.email).toBe(nouvelEmail);

    // L'ancien email ne doit PLUS authentifier.
    const ancien = await callAnonymous('POST', '/api/auth/login', {
      identifier: ancienEmail,
      password: PLAYER_PASSWORD,
    });
    expect(ancien.status).not.toBe(200);

    // Le nouveau, si.
    const nouveau = await callAnonymous('POST', '/api/auth/login', {
      identifier: nouvelEmail,
      password: PLAYER_PASSWORD,
    });
    expect(nouveau.status).toBe(200);
    expect(nouveau.body?.user?.email).toBe(nouvelEmail);
  });

  test("refuse un email deja rattache a un autre compte", async () => {
    const cible = await registerPlayer('Cible');
    const attaquant = await registerPlayer('Attaquant');

    const res = await call(attaquant, 'PATCH', '/api/auth/me', {
      email: cible.email,
      currentPassword: PLAYER_PASSWORD,
    });

    expect(res.status).toBe(409);
    expect(res.body?.code).toBe('DUPLICATE_EMAIL');
  });

  test('refuse un email mal forme', async () => {
    const player = await registerPlayer('Format');

    for (const email of ['pas-un-email', 'sans@domaine', 'double@@zoyd.test', 'espace test@zoyd.test']) {
      const res = await call(player, 'PATCH', '/api/auth/me', {
        email,
        currentPassword: PLAYER_PASSWORD,
      });
      expect(res.status).toBe(400);
      expect(res.body?.code).toBe('INVALID_EMAIL');
    }
  });

  test("accepte le meme email sans exiger de confirmation", async () => {
    const player = await registerPlayer('Idem');

    const res = await call(player, 'PATCH', '/api/auth/me', {
      email: player.email,
      country: 'BJ',
    });

    expect(res.status).toBe(200);
  });

  test('refuse toute modification sans session', async () => {
    const res = await callAnonymous('PATCH', '/api/auth/me', {
      email: `intrus_${Date.now()}@e2e.zoyd.test`,
      currentPassword: PLAYER_PASSWORD,
    });

    expect(res.status).toBe(401);
  });
});