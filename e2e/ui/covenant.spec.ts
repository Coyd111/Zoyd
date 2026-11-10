import { test, expect, type Page } from '@playwright/test';

/**
 * Le Serment d'intégrité (F1..F10) — e2e réel, backend mémoire.
 *
 * Chemin testé : inscription API (le cookie zoyd_auth httpOnly est déposé
 * dans le jar partagé du contexte) → première navigation authentifiée →
 * le serment est PROPOSÉ en bannière, sans bloquer l'arène → les trois
 * écrans → le scellement serveur → la bannière ne revient jamais → le sceau
 * s'affiche sur le profil propre.
 *
 * bb58fb1 / 922da29 (2026-11-09) : le serment est passé de « mur plein
 * écran de dix clics AVANT le premier match » à « bannière + modale
 * fermable, trois écrans, jamais bloquant avant le 1er match ». Ce spec
 * encodait encore l'ancien gate bloquant — il a été réécrit avec le
 * changement de comportement. Le scellement reste serveur, une seule fois
 * par compte.
 *
 * Ce spec complète server/covenant.test.mjs : là où les erreurs serveur
 * (idempotence, ordre des écritures, anonymat) sont vérifiées en unitaire,
 * ici c'est l'UX qui est verrouillée — la bannière, les CTA exacts, la
 * progression en trois écrans, la disparition définitive de la bannière
 * après scellement.
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

test.describe('Serment d’intégrité — bannière + modale 3 écrans, jamais bloquant', () => {
  test('la bannière propose le serment sans empêcher d’explorer l’arène', async ({ page }) => {
    await registerPlayerCookie(page);
    await page.goto('/mj');

    // Le chrome est LA : le serment n'est plus un sas, c'est une proposition.
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('aside').first()).toBeVisible();

    // La bannière, avec ses deux portes.
    const banniere = page.getByText(/Serment d.int.grit. . signer avant de miser/);
    await expect(banniere).toBeVisible();
    await expect(page.getByRole('button', { name: 'Signer' })).toBeVisible();
    await expect(page.getByRole('button', { name: /D.couvrir d.abord/ })).toBeVisible();

    // « Découvrir d'abord » referme la bannière ET laisse l'arène intacte.
    await page.getByRole('button', { name: /D.couvrir d.abord/ }).click();
    await expect(banniere).toHaveCount(0);
    await expect(page.locator('#main-content')).toBeVisible();
  });

  test('les trois écrans mènent au sceau, qui ne revient jamais', async ({ page }) => {
    await registerPlayerCookie(page);
    await page.goto('/mj');

    await page.getByRole('button', { name: 'Signer' }).click();

    // La modale s'ouvre : elle est plein ecran, mais VOLONTAIREMENT ouverte.
    const modale = page.getByRole('dialog', { name: /Serment d.int.grit/ });
    await expect(modale).toBeVisible();
    await expect(page.getByText(/Étape 1\/3/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Gagner au plein jeu/ })).toBeVisible();

    await page.getByRole('button', { name: /Commencer le serment/ }).click();
    await expect(page.getByText(/Étape 2\/3/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ce que le serment prot.ge/ })).toBeVisible();

    await page.getByRole('button', { name: /J.ai lu/ }).click();
    await expect(page.getByText(/Étape 3\/3/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Entre dans l.ar.ne/ })).toBeVisible();

    await page.getByRole('button', { name: /Entrer dans l.ar.ne/ }).click();

    // Le scellement est passe : la modale se ferme et la bannière part.
    await expect(modale).toHaveCount(0);
    await expect(page.getByText(/Serment d.int.grit. . signer avant de miser/)).toHaveCount(0);
    await expect(page.locator('#main-content')).toBeVisible();

    // Recharge : la session hydrate un user scellé — pas de nouvelle porte.
    await page.reload();
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.getByText(/Serment d.int.grit. . signer avant de miser/)).toHaveCount(0);

    // Le sceau promis au dernier écran vit sur le profil PROPRE. Regex sur
    // la seule sous-chaine stable (SCEAU D'INT...) : la chaine complete
    // contient INT-EG-RI-T (INTÉGRITÉ), un motif type D.INT.RIT (un seul
    // joker entre INT et RIT) ne peut JAMAIS y matcher.
    await page.goto('/profil');
    await expect(page.getByText(/SCEAU D.INT/)).toBeVisible({ timeout: 60_000 });
  });

  test('le signalement anonyme part avec le serment', async ({ page }) => {
    await registerPlayerCookie(page);
    await page.goto('/mj');

    await page.getByRole('button', { name: 'Signer' }).click();
    await page.getByRole('button', { name: /Commencer le serment/ }).click();

    // Le signalement est OPTIONNEL et ANONYME : le formulaire ne porte que
    // le pseudo suspecté et une note libre ; le nom de celui qui signale
    // n'existe nulle part.
    await page.getByRole('button', { name: /Signaler un suspect/ }).click();
    await page.getByLabel(/Pseudo du suspect/).fill(`Tricheur_${unique()}`);
    await page.getByLabel(/Note de signalement/).fill('aim bot visible au BR');

    await page.getByRole('button', { name: /J.ai lu/ }).click();
    await page.getByRole('button', { name: /Entrer dans l.ar.ne/ }).click();

    // Le sceau est pose : le serment est passe, signalement ou non.
    await expect(page.getByRole('dialog', { name: /Serment d.int.grit/ })).toHaveCount(0);
    await page.goto('/profil');
    await expect(page.getByText(/SCEAU D.INT/)).toBeVisible({ timeout: 60_000 });
  });
});
