import { test, expect } from '@playwright/test';

const unique = () => Math.random().toString(36).slice(2, 8);
const TEST_PSEUDO = `UI_${unique()}`;
const TEST_EMAIL = `ui_${unique()}@test.com`;
const TEST_PHONE = `+229${Math.floor(10000000 + Math.random() * 90000000)}`;
const TEST_PASSWORD = 'TestPass123!';

test.describe('Login Page', () => {
  test('renders the login form', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('text=Connexion').first()).toBeVisible();
    await expect(page.locator('input[name="emailOrPseudo"]').first()).toBeVisible();
    await expect(page.locator('input[name="password"]').first()).toBeVisible();
  });

  test('shows validation errors for empty fields', async ({ page }) => {
    await page.goto('/auth/login');
    await page.locator('button[type="submit"]').first().click();
    // P15 C3 (audit-3) : « body truthy » passait avec la validation morte.
    // On affirme les messages reels rendus dans <p role="alert"> (Input.tsx:60).
    // Deux sources candidates dans le code : le schema zod (« Email ou pseudo
    // requis » LoginPage.tsx:37, « Le mot de passe doit contenir au moins
    // 8 caracteres » :38) ou les regles RHF de register (« Identification
    // requise » :259, « Mot de passe requis » :269) — on accepte les deux
    // ecritures, convention deja posee pour les libelles FR (test du titre
    // register plus bas). Ce qu'on n'accepte plus : l'ABSENCE de message.
    await expect(page.getByText(/Email ou pseudo requis|Identification requise/).first()).toBeVisible();
    await expect(page.getByText(/Le mot de passe doit contenir au moins 8 caractères|Mot de passe requis/).first()).toBeVisible();
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.locator('input[name="emailOrPseudo"]').fill('nonexistent_user');
    await page.locator('input[name="password"]').fill('WrongPassword123!');
    await page.locator('button[type="submit"]').first().click();
    // P15 C3 (audit-3) : la chaine de retour reelle — serveur 401
    // INVALID_CREDENTIALS (persistence.mjs:2207), message mappe
    // « Identifiants invalides. ... » (apiClient.ts:116), rendu en toast
    // role="alert" par ToastContainer. « body truthy » passait meme si
    // AUCUN retour n'etait rendu.
    await expect(page.getByText(/Identifiants invalides/).first()).toBeVisible();
  });

  test('has link to register page', async ({ page }) => {
    await page.goto('/auth/login');
    const registerLink = page.locator('a[href="/auth/register"]').first();
    await expect(registerLink).toBeVisible();
  });

  test('password toggle shows/hides password', async ({ page }) => {
    await page.goto('/auth/login');
    const passwordInput = page.locator('input[name="password"]').first();
    await expect(passwordInput).toHaveAttribute('type', 'password');
    // P15 C3 (audit-3) : le test ne faisait RIEN (if isVisible silencieux,
    // un clic, aucune assertion apres). On verrouille le comportement reel :
    // clic -> type 'text' + aria-label inverse (LoginPage.tsx:267 et :276),
    // second clic -> retour a l'etat masque.
    const afficher = page.getByRole('button', { name: 'Afficher le mot de passe' });
    await expect(afficher).toBeVisible();
    await afficher.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    const masquer = page.getByRole('button', { name: 'Masquer le mot de passe' });
    await expect(masquer).toBeVisible();
    await masquer.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

test.describe('Register Page', () => {
  test('renders the register form step 1', async ({ page }) => {
    await page.goto('/auth/register');
    // Le titre reel est accentue (« Créer un compte ») : on tolere les deux
// ecritures plutot que de casser des que la copie FR est corrigee.
await expect(page.getByRole('heading', { name: /Cr[eé]er un compte/ }).first()).toBeVisible();
    await expect(page.locator('input[name="pseudo"]').first()).toBeVisible();
    await expect(page.locator('input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[name="phone"]').first()).toBeVisible();
    await expect(page.locator('input[name="password"]').first()).toBeVisible();
  });

  test('shows validation for short pseudo', async ({ page }) => {
    await page.goto('/auth/register');
    await page.locator('input[name="pseudo"]').fill('ab');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body).toContain('3');
  });

  test('shows validation for short password', async ({ page }) => {
    await page.goto('/auth/register');
    await page.locator('input[name="pseudo"]').fill(`Valid_${unique()}`);
    await page.locator('input[name="email"]').fill(`valid_${unique()}@test.com`);
    await page.locator('input[name="phone"]').fill('+22990000000');
    await page.locator('input[name="password"]').fill('short');
    await page.locator('button[type="submit"]').first().click();
    // P15 C3 (audit-3) : message zod exact du code (RegisterPage.tsx:103,
    // « Minimum 8 caracteres »), rendu dans <p role="alert"> (Input.tsx:60).
    // « body truthy » passait avec la validation morte.
    await expect(page.getByText('Minimum 8 caractères').first()).toBeVisible();
  });

  test('has link to login page', async ({ page }) => {
    await page.goto('/auth/register');
    const loginLink = page.locator('a[href="/auth/login"]').first();
    await expect(loginLink).toBeVisible();
  });

  test('can fill step 1 and proceed to step 2', async ({ page }) => {
    await page.goto('/auth/register');
    await page.locator('input[name="pseudo"]').fill(TEST_PSEUDO);
    await page.locator('input[name="email"]').fill(TEST_EMAIL);
    await page.locator('input[name="phone"]').fill(TEST_PHONE);
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    // P15 C3 (audit-3) : la PROGRESSION est ce qu'on affirme — onStep1Submit
    // passe a l'etape 2 (RegisterPage.tsx:207-210), dont le h1 devient
    // « Configuration joueur » (:427). « body truthy » n'affirmait rien apres
    // le clic.
    await expect(page.getByRole('heading', { level: 1, name: 'Configuration joueur' })).toBeVisible();
  });
});

test.describe('Protected Routes', () => {
  // P15 C3 (audit-3) : la regex /\/(auth\/login|route)/ acceptait les DEUX
  // issues — redirection OU maintien — donc aucune garantie de garde. Les
  // comportements REELS, croises avec le code, divergent : /wallet est sous
  // AppLayout, qui rend <Navigate to="/auth/login" replace /> pour un anonyme
  // (AppLayout.tsx:49-51, apres le bootstrap 401 de useAuthSessionBootstrap) ;
  // /mode vit hors AppLayout PAR DESIGN (ModeSelectionPage.tsx:9-10) : la page
  // est rendue sans redirection. Chaque route a desormais son assertion stricte.
  test('wallet page requires auth', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('mode selection renders without auth', async ({ page }) => {
    await page.goto('/mode');
    // Statut verrouille : PAS de garde pour /mode — la vraie page est rendue
    // (meme garde h1 que le spec accessibilite, fix C2), ce n'est ni une 404
    // (catchall '*' routes.tsx:241-243) ni une redirection.
    await expect(page).toHaveURL(/\/mode/);
    await expect(page.getByRole('heading', { level: 1, name: 'terrain de jeu' })).toBeVisible();
  });
});

test.describe('Not Found Page', () => {
  test('shows 404 for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');
    // P15 C3 (audit-3) : le catchall '*' rend NotFoundPage (routes.tsx:241-243),
    // dont le h1 est « 404 » (NotFoundPage.tsx:38). « body truthy »
    // n'affirmait rien : la 404 pouvait ne jamais monter.
    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  });
});
