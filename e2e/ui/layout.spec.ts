import { test, expect, type Page } from '@playwright/test';
import { registerPlayer, disposeActors, openAdminSession, creditWallet, type Actor } from '../api/support/harness';

// Sidebar compacte (icônes seules) + suppression du bouton déconnexion du
// header.
//
// Pourquoi : le header portait un bouton de déconnexion en doublon avec la
// sidebar, ce qui mangeait de la largeur sur mobile. Et la sidebar en w-64 avec
// des libelles en toutes capitales prenait un tiers de l'écran en 1280.

const openApp = async (page: Page, pseudo: string, password: string) => {
  await page.goto('/auth/login');
  await page.getByPlaceholder(/ShadowX/).fill(pseudo);
  await page.getByPlaceholder(/^\.*$/).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
  await page.getByPlaceholder(/^\.*$/).press('Enter');
  expect((await loginResponse).status()).toBe(200);
};

/**
 * Sélecteur de la sidebar applicative.
 * `page.locator('aside')` est ambigu : HubMJPage et CreateTournamentPage
 * portent aussi un <aside>. On cible par aria-label.
 */
const sidebarOf = (page: Page) => page.getByLabel('Barre de navigation');

test.describe('Layout compact', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Actor;
  let pseudo = '';
  const password = 'ZoydE2E!Player2026';

  test.beforeAll(async () => {
    admin = await openAdminSession();
    const player: Actor = await registerPlayer('E2ELAYOUT');
    pseudo = player.pseudo;
    await creditWallet(admin, player.id, 500);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('la sidebar est compacte et porte des icônes avec des libellés accessibles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/mj');

    const sidebar = sidebarOf(page);
    await expect(sidebar).toBeVisible();

    // Barre compacte : 64px (w-16) au lieu de 256px (w-64).
    const width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
    expect(width, 'la sidebar doit etre etroite').toBeLessThanOrEqual(80);

    // Les libellés ne sont plus affichés en texte mais restent accessibles.
    for (const label of ['MULTIJOUEUR', 'TOURNOIS', 'BR LEAGUE', 'MESSAGES']) {
      const link = sidebar.getByLabel(label, { exact: true });
      await expect(link, `${label} doit rester accessible`).toBeAttached();
    }

    // Aucun texte de navigation visible dans la sidebar.
    await expect(sidebar.getByText('MULTIJOUEUR')).toHaveCount(0);
  });

  test('le header n\'a plus de bouton de déconnexion (doublon supprimé)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/mj');

    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
    // Le header ne doit plus proposer la déconnexion.
    await expect(nav.getByLabel('Se déconnecter')).toHaveCount(0);

    // ...et la déconnexion reste accessible depuis la sidebar.
    await expect(sidebarOf(page).getByLabel('Se déconnecter')).toBeAttached();
  });

  test('la navigation par icône fonctionne', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/mj');

    await sidebarOf(page).getByLabel('BR LEAGUE', { exact: true }).click();
    await page.waitForURL(/\/br-league/, { timeout: 15_000 });

    await sidebarOf(page).getByLabel('TOURNOIS', { exact: true }).click();
    await page.waitForURL(/\/mj\/tournois/, { timeout: 15_000 });
  });

  test('l\'icône active est marquée pour les lecteurs d\'écran', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/br-league');

    const active = sidebarOf(page).getByLabel('BR LEAGUE', { exact: true });
    await expect(active).toHaveAttribute('aria-current', 'page');
  });
});
