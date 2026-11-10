import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  registerPlayer,
  registerPlayerWithResponse,
  PLAYER_PASSWORD,
} from './support/harness';

// ─────────────────────────────────────────────────────────────────────────────
// Changement de pseudo.
//
// Le pseudo n'est pas un détail cosmétique : c'est par lui que l'arbitre sait
// qui a gagné, et c'est aussi une clé de connexion (`/api/auth/login`
// accepte pseudo, email ou téléphone). D'où deux exigences : il doit être
// vraiment modifiable, et il ne doit jamais entrer en collision avec un
// compte existant — sinon deux joueurs s'appellent pareil et l'arbitre note
// le match en double.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Changement de pseudo', () => {
  test("accepte un pseudo libre, sans mot de passe (changement d'identité en jeu)", async () => {
    const { actor } = await registerPlayerWithResponse('Pseudo');
    const nouveau = `Zeyno_${Date.now()}`;

    const res = await call(actor, 'PATCH', '/api/auth/me', { pseudo: nouveau });

    expect(res.status).toBe(200);
    expect(res.body?.user?.pseudo).toBe(nouveau);
  });

  test("refuse un pseudo deja pris et ne vole rien d'autre", async () => {
    const cible = await registerPlayer('Cible');
    const autre = await registerPlayer('Autre');

    const res = await call(autre, 'PATCH', '/api/auth/me', { pseudo: cible.pseudo });

    expect(res.status).toBe(409);
    expect(res.body?.code).toBe('DUPLICATE_PSEUDO');

    // Le compte de la cible est intact (pseudo ET email).
    const me = await call(cible, 'GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body?.user?.pseudo).toBe(cible.pseudo);
    expect(me.body?.user?.email).toBe(cible.email);
  });

  test('ignore la casse et les espaces autour', async () => {
    const cible = await registerPlayer('CibleCas');
    const autre = await registerPlayer('AutreCas');

    const res = await call(autre, 'PATCH', '/api/auth/me', {
      pseudo: `  ${cible.pseudo.toUpperCase()}  `,
    });

    expect(res.status).toBe(409);
    expect(res.body?.code).toBe('DUPLICATE_PSEUDO');
  });

  test("l'ancien pseudo cesse d'authentifier, le nouveau prend le relais", async () => {
    const { actor, body } = await registerPlayerWithResponse('Bascule');
    const ancien = body.user.pseudo;
    const nouveau = `Bascule2_${Date.now()}`;

    const res = await call(actor, 'PATCH', '/api/auth/me', { pseudo: nouveau });
    expect(res.status).toBe(200);

    // Un joueur connecte avec son ANCIEN pseudo doit echouer : sans cela il
    // resterait deux cles actives pour un meme compte.
    const ancienLogin = await callAnonymous('POST', '/api/auth/login', {
      identifier: ancien,
      password: PLAYER_PASSWORD,
    });
    expect(ancienLogin.status).not.toBe(200);

    const nouveauLogin = await callAnonymous('POST', '/api/auth/login', {
      identifier: nouveau,
      password: PLAYER_PASSWORD,
    });
    expect(nouveauLogin.status).toBe(200);
    expect(nouveauLogin.body?.user?.pseudo).toBe(nouveau);
  });

  test('accepte le meme pseudo sans rien exiger', async () => {
    const player = await registerPlayer('Stable');

    const res = await call(player, 'PATCH', '/api/auth/me', { pseudo: player.pseudo });

    expect(res.status).toBe(200);
  });

  test('refuse un pseudo vide', async () => {
    const player = await registerPlayer('Vide');

    const res = await call(player, 'PATCH', '/api/auth/me', { pseudo: '   ' });

    // Le serveur ne doit ni vider le pseudo, ni casser.
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('PSEUDO_REQUIRED');
    const me = await call(player, 'GET', '/api/auth/me');
    expect(me.body?.user?.pseudo).toBeTruthy();
    expect(me.body?.user?.pseudo).toBe(player.pseudo);
  });

  test('refuse une tentative sans session', async () => {
    const res = await callAnonymous('PATCH', '/api/auth/me', { pseudo: 'Intrus_XYZ' });
    expect(res.status).toBe(401);
  });
});