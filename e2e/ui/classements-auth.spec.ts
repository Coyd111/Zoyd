import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, PLAYER_PASSWORD, type Actor } from '../api/support/harness';
import { openApp, waitForRender } from './support/session';

/**
 * Verrou ZD-14 (audit production 2026-11-19).
 *
 * L'en-tete du classement authentifie affichait DEUX colonnes « RANG » : la
 * position numerique et, en realite, le grade CODM (BRONZE, LEGENDARY...).
 */
test.use({ reducedMotion: 'reduce' });

let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2ECLASSE');
});

test.afterAll(async () => {
  await disposeActors();
});

test('classements authentifies : un seul RANG, une colonne GRADE (ZD-14)', async ({ page }) => {
  await openApp(page, joueur.pseudo, PLAYER_PASSWORD);
  await page.goto('/classements', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitForRender(page);

  // La ligne du joueur courant garantit que l'en-tete est rendu, meme sans
  // activite (ZD-03 : ligne conservee, rang « NC »).
  await expect(page.getByText('RANG', { exact: true })).toHaveCount(1);
  await expect(page.getByText('GRADE', { exact: true })).toBeVisible();
});
