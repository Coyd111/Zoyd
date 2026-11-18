import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, type Actor } from '../api/support/harness';
import { openApp, waitForRender } from './support/session';

/**
 * La saison CODM est un FAIT VIVANT, pas un decor fige.
 *
 * Le module `codmNews.ts` et son verrou garantissent que la donnee est
 * datee et sourcee. Ce test verifie l autre moitie : que les ecrans de
 * jeu l affichent vraiment, et que le lien vers la veille n est offert
 * qu a un joueur connecte.
 *
 * PIEGE : `/mode` est PUBLIC alors que `/infos` exige une session. Offrir
 * le lien sur `/mode` enverrait un visiteur vers la page de connexion au
 * lieu de la veille.
 */

test.use({ reducedMotion: 'reduce' });

let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2ESAISON');
});

test.afterAll(async () => {
  await disposeActors();
});

test('les ecrans de jeu affichent la saison et menent a la veille', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, joueur.pseudo, 'ZoydE2E!Player2026');

  for (const chemin of ['/mj', '/mj/tournois']) {
    await page.goto(chemin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForRender(page);

    const encart = page.getByRole('complementary', { name: /Saison Call of Duty/ });
    await expect(encart, `${chemin} : encart de saison absent`).toBeVisible();
    await expect(encart).toContainText(/Saison\s+10/);
    await expect(encart).toContainText('Verdansk');
    await expect(encart.getByRole('link', { name: /veille CODM/i })).toHaveAttribute(
      'href',
      '/infos',
    );
  }
});

test('le mode public montre la saison sans lien vers la veille', async ({ page }) => {
  await page.goto('/mode', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitForRender(page);

  const encart = page.getByRole('complementary', { name: /Saison Call of Duty/ });
  await expect(encart).toBeVisible();
  await expect(encart).toContainText(/Saison\s+10/);
  await expect(
    encart.getByRole('link'),
    'un visiteur non connecte se voit offrir /infos, qui exige une session',
  ).toHaveCount(0);
});
