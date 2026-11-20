import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, PLAYER_PASSWORD, type Actor } from '../api/support/harness';
import { openApp, waitForRender } from './support/session';

/**
 * Verrou ZD-12 (audit production 2026-11-19).
 *
 * Sur un identifiant inconnu, les pages de detail tournoi et ligue affichaient
 * un H2 sans H1, un bouton « Réessayer » de 20 px de haut et un titre
 * d'onglet generique. Une page d'erreur est une page : elle porte un H1, une
 * action atteignable et un titre qui dit ce qui s'est passe.
 */
test.use({ reducedMotion: 'reduce' });

let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2EERREUR');
});

test.afterAll(async () => {
  await disposeActors();
});

test('detail tournoi introuvable : H1, action atteignable, titre explicite (ZD-12)', async ({ page }) => {
  await openApp(page, joueur.pseudo, PLAYER_PASSWORD);
  await page.goto('/mj/tournois/AUDIT-INVALID', { waitUntil: 'domcontentloaded' });
  await waitForRender(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Tournoi introuvable' })).toBeVisible();
  const reessayer = page.getByRole('button', { name: 'Réessayer' });
  await expect(reessayer).toBeVisible();
  const boite = await reessayer.boundingBox();
  // WCAG 2.5.8 : cible d'au moins 24 x 24 px.
  expect(boite?.height ?? 0).toBeGreaterThanOrEqual(24);
  await expect(page).toHaveTitle(/Introuvable/);
});

test('saison de ligue introuvable : H1, action atteignable, titre explicite (ZD-12)', async ({ page }) => {
  await openApp(page, joueur.pseudo, PLAYER_PASSWORD);
  await page.goto('/br-league/AUDIT-INVALID', { waitUntil: 'domcontentloaded' });
  await waitForRender(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Saison introuvable' })).toBeVisible();
  const reessayer = page.getByRole('button', { name: 'Réessayer' });
  await expect(reessayer).toBeVisible();
  const boite = await reessayer.boundingBox();
  expect(boite?.height ?? 0).toBeGreaterThanOrEqual(24);
  await expect(page).toHaveTitle(/Introuvable/);
});
