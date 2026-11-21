import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, PLAYER_PASSWORD, type Actor } from '../api/support/harness';
import { openApp } from './support/session';

/**
 * ZD-18 : un joueur sans aucun gain voyait un cadre de graphique vide sur
 * `/earnings`, sans texte ni action. L ecran doit expliquer l absence de
 * donnees et proposer un chemin pour en produire (choisir un mode).
 */
let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2EGAIN');
});

test.afterAll(async () => {
  await disposeActors();
});

test('un joueur sans gain voit un etat vide et un CTA vers les modes', async ({ page }) => {
  await openApp(page, joueur.pseudo, PLAYER_PASSWORD);
  await page.goto('/earnings', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText(/Aucun gain pour l'instant/i)).toBeVisible({ timeout: 30_000 });
  const cta = page.getByRole('link', { name: /Trouver un match/i });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/mode');

  // Le conteneur du graphique ne doit pas etre monte : un cadre vide est
  // exactement le defaut signale.
  await expect(page.locator('[aria-label="Graphique d\'évolution des gains sur 30 jours"]')).toHaveCount(0);
});
