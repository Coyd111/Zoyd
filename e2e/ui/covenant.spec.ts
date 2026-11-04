import { test, expect, type Page } from '@playwright/test';

/**
 * Le Serment d'intégrité (F1..F10) — e2e réel, backend mémoire.
 *
 * Chemin testé : inscription API (le cookie zoyd_auth httpOnly est déposé
 * dans le jar partagé du contexte) → première navigation authentifiée →
 * le gate plein écran bloque TOUT le chrome → les dix fenêtres → le
 * scellement serveur → le gate reste mort aux sessions suivantes → le
 * sceau s'affiche sur le profil propre.
 *
 * Ce spec complète server/covenant.test.mjs : là où les erreurs serveur
 * (idempotence, ordre des écritures, anonymat) sont vérifiées en unitaire,
 * ici c'est l'UX qui est verrouillée — les CTA exactes, la progression,
 * la disparition définitive du gate après scellement.
 */

const unique = () => Math.random().toString(36).slice(2, 8);

/** Inscrit un compte par l'API reelle et laisse le cookie dans le contexte. */
const registerPlayerCookie = async (page: Page) => {
  const stamp = unique();
  const register = await page.request.post('/api/auth/register', {
    data: {
      pseudo: `COV${stamp}`,
      email: `cov_ui_${stamp}@test.com`,
      phone: `+229${Math.floor(10000000 + Math.random() * 90000000)}`,
      gameId: `CO-COV-${stamp}`,
      password: 'TestPass123!',
      acceptAdult: true,
      acceptTerms: true,
    },
  });
  expect(register.status(), 'inscription API reelle').toBe(201);
  const body = await register.json();
  // Le compte sortant n'a pas de covenant : c'est la condition du gate.
  expect(body.user.covenant ?? null).toBeNull();
  return body.user.pseudo as string;
};

test.describe('Serment d intégrité — gate plein écran', () => {
  test('la première session authentifiée tombe sur la fenêtre F1, sans chrome', async ({ page }) => {
    await registerPlayerCookie(page);
    await page.goto('/mj');

    // L'entête du gate, avec la version scellée.
    await expect(page.getByText(/Serment d.int/)).toBeVisible();
    await expect(page.getByText(/Étape 1\/10/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Le serment d.int/ })).toBeVisible();

    // PAS de chrome : la seule chose rendue est le serment. Ni main, ni
    // sidebar, ni navigation — le passage est un sas, pas un bandeau.
    await expect(page.locator('#main-content')).toHaveCount(0);
    await expect(page.locator('aside')).toHaveCount(0);
  });

  test('les dix fenêtres mènent au sceau, puis ne reviennent jamais', async ({ page }) => {
    await registerPlayerCookie(page);
    await page.goto('/mj');

    await page.getByRole('button', { name: 'Commencer le serment' }).click();
    await expect(page.getByText(/Étape 2\/10/)).toBeVisible();

    // F2 — OUI ouvre l'interstitiel solennel (jamais accusatoire).
    await page.getByRole('button', { name: 'Oui', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Respect' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    // F3 — lecture.
    await page.getByRole('button', { name: "J'ai lu — continuer" }).click();
    await expect(page.getByText(/Étape 4\/10/)).toBeVisible();

    // F4 — OUI (deux sens du fair-play).
    await page.getByRole('button', { name: 'Oui', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Deux promesses dites' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    // F5, F6 — règles de conduite et conséquences.
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Continuer' }).click();

    // F7 — signalement anonyme : le formulaire ne porte que le pseudo
    // suspecté et une note libre ; le nom de celui qui signale n'existe
    // nulle part.
    await page.locator('#covenant-suspect').fill(`Tricheur_${unique()}`);
    await page.locator('#covenant-note').fill('aim bot visible au BR');
    await page.getByRole('button', { name: 'Je rapporte' }).click();

    // F8 — ce qui est scellé (et le rappel que le signal part anonyme).
    await expect(page.getByText(/Ton signalement partira avec le serment/)).toBeVisible();
    await page.getByRole('button', { name: "J'ai lu — continuer" }).click();

    // F9 — l'habitude. F10 — le scellement.
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: "Entrer dans l'arène" }).click();

    // Le chrome revient ; le gate est parti.
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.getByText(/Serment d.int/)).toHaveCount(0);

    // Recharge : la session hydrate un user scellé — pas de nouvelle porte.
    await page.reload();
    await expect(page.locator('#main-content')).toBeVisible();

    // Le sceau promis en F10 vit sur le profil PROPRE. Regex sur la seule
    // sous-chaine stable (SCEAU D'INT...) : la chaine complete contient
    // INT-EG-RI-T (INTÉGRIT), un motif type D.INT.RIT (un seul joker entre
    // INT et RIT) ne peut JAMAIS y matcher.
    await page.goto('/profil');
    await expect(page.getByText(/SCEAU D.INT/)).toBeVisible({ timeout: 60_000 });
  });

  test('les branches NON honorent la réponse franche et mènent aussi au sceau', async ({ page }) => {
    await registerPlayerCookie(page);
    await page.goto('/mj');

    await page.getByRole('button', { name: 'Commencer le serment' }).click();
    await page.getByRole('button', { name: 'Non', exact: true }).click();
    await expect(page.getByRole('heading', { name: /n.avance pas contre toi/ })).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    await page.getByRole('button', { name: "J'ai lu — continuer" }).click();
    await page.getByRole('button', { name: 'Non', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'La question reste ouverte' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    // F5, F6, F7 (sans signal), F8, F9, F10.
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.getByRole('button', { name: "J'ai lu — continuer" }).click();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: "Entrer dans l'arène" }).click();

    await expect(page.locator('#main-content')).toBeVisible();
  });
});
