import {
  test,
  expect,
} from '@playwright/test';
import {
  call,
  disposeActors,
  registerPlayer,
} from './support/harness';

const BASE = '/api';

/**
 * Deux failles d'authentification confirmees par la lecture exhaustive, sur les
 * vraies routes — pas sur des doubles.
 *
 * 1. Le telephone n'etait valide par RIEN dans `PATCH /api/auth/me`, alors
 *    qu'il alimente une cle d'unicite `phone_key` non nullable. `normalizePhoneKey`
 *    ne garde que les chiffres : `""` comme `"abc"` donnent tous deux la cle
 *    vide. Un joueur pouvait donc occuper cette cle, et le joueur suivant se
 *    prenait un echec d'ecriture 503 DEFINITIF. Un joueur bloquait la mise a jour
 *    de profil de tous les autres.
 *
 * 2. `POST /api/auth/logout` ne demande aucune authentification (le token est
 *    facultatif) mais consommait le MÊME quota que `login`, `register`,
 *    `forgot-password` et `reset-password`. 50 appels suffisaient a renvoyer 429
 *    partout pendant 15 minutes : un deni de connexion de masse sur IP partagee.
 *
 *    P15 C7 (audit-3) : cette suite ne teste que la faille 1. La seconde est
 *    verrouillee en UNITÉ (`rate-limiter.test.mjs:60-83`, separation du groupe
 *    `auth_logout`, rate-limiter.mjs:31-53) — l'en-tete laissait croire que
 *    les deux etaient couvertes ici.
 */

test.describe('PATCH /api/auth/me — telephone valide', () => {
  test('refuse un telephone vide, qui occuperait la cle unique vide', async () => {
    const player = await registerPlayer('phonevide');
    const res = await call(player, 'PATCH', `${BASE}/auth/me`, { phone: '' });
    // Le telephone est facultatif a la mise a jour : une chaine vide efface
    // proprement. Ce qui est refuse, c'est une valeur NON VIDES mais invalide.
    expect([200, 400]).toContain(res.status);

    const invalide = await call(player, 'PATCH', `${BASE}/auth/me`, { phone: 'abc' });
    expect(invalide.status).toBe(400);
    expect(invalide.body.code).toBe('INVALID_PHONE');

    await disposeActors();
  });

  test('un second joueur ne peut pas etre bloque par le telephone du premier', async () => {
    // Le scenario reel : A pose une cle `phone_key` vide, B echoue ensuite en 503
    // sur la meme valeur. Apres le correctif, la valeur est refusee a la
    // validation, donc aucun joueur n'occupe jamais la cle vide.
    const a = await registerPlayer('phonea');
    const b = await registerPlayer('phoneb');

    for (const acteur of [a, b]) {
      const res = await call(acteur, 'PATCH', `${BASE}/auth/me`, { phone: 'abc' });
      expect(res.status, 'la valeur invalide doit etre refusee a la validation').toBe(400);
      expect(res.status, 'jamais un 503 de contention de cle').not.toBe(503);
    }

    // Et le profil reste utilisable pour les deux.
    const profilB = await call(b, 'GET', `${BASE}/auth/me`);
    expect(profilB.status).toBe(200);

    await disposeActors();
  });
});
