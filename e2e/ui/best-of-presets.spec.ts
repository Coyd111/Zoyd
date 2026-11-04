/**
 * Spec e2e - presets best-of de la scene wager (roadmap 2026-11-02,
 * presets BO1/BO3/BO5, recherche CODM).
 *
 * INVARIANT : un preset REMPLIT le champ bestOf (champ libre conserve,
 * reglement libre) ; le preset et la saisie libre produisent tous deux un
 * bestOf envoye tel quel au moteur (stockage sans liste blanche, prouve
 * au P3 par vitest).
 *
 * Couverture : formulaire TOURNOI (single-page) - chips visibles, le
 * preset BO3 remplit le champ, BO5 encore, helper affiche. Le formulaire
 * MATCH porte les memes chips sur la deuxieme etape de son wizard : pas
 * de parcours wizard existant en e2e, la presence est verifiee par la
 * sonde bundle (marqueurs "Preset best of" dans les chunks) et la sonde
 * geometrique responsive.spec sur /mj/creer.
 *
 * P5 02/11/2026 : alternance des picks BO3+ - la checkbox
 * (#picks-alternance) n'est rendue qu'en BO3+ (garde P3 reutilisee) ;
 * le champ bestOf reste libre, aucun couplage cache.
 *
 * PIEGE : les chips ont un aria-label ("Preset best of N") et un texte
 * visible "BO3" engendré par template - ne jamais cibler par le texte
 * visible, toujours par l aria-label.
 */
import { test, expect, type Page } from '@playwright/test';
import { registerPlayer, disposeActors, openAdminSession, creditWallet, type Actor } from '../api/support/harness';

// Pattern de connexion identique a layout.spec et mode-hierarchie.spec
// (harness : session admin 2FA pour financer le joueur de test).
const openApp = async (page: Page, pseudo: string, password: string) => {
  await page.goto('/auth/login');
  await page.getByPlaceholder(/ShadowX/).fill(pseudo);
  await page.getByPlaceholder(/^\.*$/).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
  await page.getByPlaceholder(/^\.*$/).press('Enter');
  expect((await loginResponse).status()).toBe(200);
  // Serment d'intégrité : tant que `covenant` est absente du compte,
  // AppLayout rend le gate plein écran au lieu du chrome. On scelle par
  // l'API (le cookie zoyd_auth du formulaire vit dans le jar partagé du
  // contexte) ; le serveur ignore le corps et date lui-même. La navigation
  // suivante hydrate alors un user scellé : pas de gate.
  await page.request.post('/api/auth/covenant', { data: {} });
};

test.describe('presets BO1/BO3/BO5 - formulaire tournoi', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Actor;
  let pseudo = '';
  const password = 'ZoydE2E!Player2026';

  test.beforeAll(async () => {
    admin = await openAdminSession();
    const player: Actor = await registerPlayer('E2EBOF');
    pseudo = player.pseudo;
    await creditWallet(admin, player.id, 500);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('les chips BO1/BO3/BO5 remplissent le champ best-of (champ libre conserve)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/mj/tournois/creer');

    const bo1 = page.getByRole('button', { name: 'Preset best of 1' });
    const bo3 = page.getByRole('button', { name: 'Preset best of 3' });
    const bo5 = page.getByRole('button', { name: 'Preset best of 5' });
    await expect(bo1).toBeVisible();
    await expect(bo3).toBeVisible();
    await expect(bo5).toBeVisible();

    // Defaut tournoi = BO1 (moteur) ; un preset remplit le champ sans le
    // remplacer : une saisie libre reste possible au clavier.
    const bestOf = page.locator('#best-of');
    await expect(bestOf).toHaveValue('1');
    await bo3.click();
    await expect(bestOf).toHaveValue('3');
    await bo5.click();
    await expect(bestOf).toHaveValue('5');

    // Helper source unique sous le champ (marqueur du referentiel partage).
    await expect(page.getByText('Scene wager (DuelX) : BO1, BO3 ou BO5', { exact: false })).toBeVisible();
  });

  test('P5 : la checkbox alternance n existe qu en BO3+ (garde P3)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/mj/tournois/creer');

    const picks = page.locator('#picks-alternance');
    // Defaut tournoi = BO1 : la case est absente du DOM (alternance = au
    // moins deux manches a choisir, garde P3 reutilisee).
    await expect(picks).toHaveCount(0);

    const bo3 = page.getByRole('button', { name: 'Preset best of 3' });
    await bo3.click();
    await expect(picks).toBeVisible();

    // Le contrat affiche sous la case vient du referentiel partage
    // (competition.ts MJ_PICKS_ALTERNANCE_BRACKET).
    await expect(
      page.getByText('Manche 1 : meilleur seed / Manche 2 : adversaire', { exact: false })
    ).toBeVisible();

    // toujours presente en BO5 : la garde est "BO3+", pas "BO3".
    const bo5 = page.getByRole('button', { name: 'Preset best of 5' });
    await bo5.click();
    await expect(picks).toBeVisible();
  });
});
