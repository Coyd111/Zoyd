import { test, expect } from '@playwright/test';

// ─── Garde-fou PRODUCTION ────────────────────────────────────────────────────
// Ce fichier vise zoyd.vercel.app. Sans intention explicite, il ne s'exécute
// pas : `playwright test` sans `--project` touchait la production par défaut,
// parce que ce projet était simplement dans la liste.
test.beforeAll(async () => {
  if (process.env.ZOYD_ALLOW_LIVE_TESTS !== '1') {
    throw new Error(
      'Refus de lancer un test LIVE sur la PRODUCTION.\n'
      + 'Relancer avec : ZOYD_ALLOW_LIVE_TESTS=1 pnpm test:e2e:live-ui',
    );
  }
});

test.describe('LIVE — Landing Page', () => {
  test('renders with ZOYD branding', async ({ page }) => {
    await page.goto('/', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).toContain('ZOYD');
  });

  test('displays feature cards', async ({ page }) => {
    await page.goto('/', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/Wagers|Sécurisés|Arbitrage|Wallet/i);
  });

  test('has login link', async ({ page }) => {
    await page.goto('/');
    const loginLink = page.locator('a[href="/auth/login"]').first();
    await expect(loginLink).toBeVisible({ timeout: 10000 });
    await loginLink.click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('has register link', async ({ page }) => {
    await page.goto('/');
    const registerLink = page.locator('a[href="/auth/register"]').first();
    await expect(registerLink).toBeVisible({ timeout: 10000 });
    await registerLink.click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});

test.describe('LIVE — Login Page', () => {
  test('renders login form', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('input[name="emailOrPseudo"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[name="password"]').first()).toBeVisible();
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.locator('input[name="emailOrPseudo"]').fill('FakeUser999');
    await page.locator('input[name="password"]').fill('WrongPass123!');
    await page.locator('button[type="submit"]:has-text("CONNEXION")').click();
    await page.waitForTimeout(5000);
    const url = page.url();
    expect(url).toContain('/auth/login');
  });

  test('has link to register', async ({ page }) => {
    await page.goto('/auth/login');
    const registerLink = page.locator('a[href="/auth/register"]').first();
    await expect(registerLink).toBeVisible({ timeout: 10000 });
  });
});

test.describe('LIVE — Register Page', () => {
  test('renders register form', async ({ page }) => {
    await page.goto('/auth/register');
    await expect(page.locator('input[name="pseudo"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[name="password"]').first()).toBeVisible();
  });

  test('has link to login', async ({ page }) => {
    await page.goto('/auth/register');
    const loginLink = page.locator('a[href="/auth/login"]').first();
    await expect(loginLink).toBeVisible({ timeout: 10000 });
  });

  test('validates short pseudo', async ({ page }) => {
    await page.goto('/auth/register');
    await page.locator('input[name="pseudo"]').fill('ab');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/3|caractère|minimum/i);
  });
});

test.describe('LIVE — Protected Routes', () => {
  // P15 C3 (audit-3) : la regex /\/(auth\/login|route)/ acceptait les DEUX
  // issues (redirection OU maintien) — tautologique. Croise avec le code :
  // /wallet et /mj sont sous AppLayout, qui rend <Navigate to="/auth/login"
  // replace /> pour un anonyme (AppLayout.tsx:49-51). /dashboard n'est PAS
  // une route (35 entrees, routes.tsx ; doc 08 §3) : le catchall '*'
  // (routes.tsx:241-243) rend NotFoundPage — c'est ce statut que son test
  // affirme desormais. Budgets 30 s : le bootstrap /api/auth/me d'un Render
  // endormi peut consommer tout le timeout du fetch avant de rendre.
  test('dashboard unknown route shows the 404 page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible({ timeout: 30_000 });
  });

  test('wallet redirects to login', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 30_000 });
  });

  test('mj redirects to login', async ({ page }) => {
    await page.goto('/mj');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 30_000 });
  });
});

test.describe('LIVE — SPA Routing', () => {
  test('all main routes return 200', async ({ page }) => {
    const routes = ['/', '/auth/login', '/auth/register'];
    for (const route of routes) {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
    }
  });

  test('unknown route shows the 404 page', async ({ page }) => {
    await page.goto('/this-does-not-exist-xyz');
    // P15 C3 (audit-3) : pas de « 404 ou landing » — le comportement reel est
    // deterministe : le catchall '*' rend NotFoundPage (routes.tsx:241-243,
    // h1 « 404 »). « body truthy » n'affirmait rien.
    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('LIVE — Assets & Performance', () => {
  test('main JS bundle loads', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    const scripts = await page.locator('script').count();
    expect(scripts).toBeGreaterThan(0);
  });

  test('CSS loads', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    const stylesheets = await page.locator('link[rel="stylesheet"]').count();
    expect(stylesheets).toBeGreaterThan(0);
  });

  test('la page d\'accueil se charge et monte sans erreur JS', async ({ page }) => {
    // Ce test affirmait `expect(true).toBe(true)` : il ne verifiait rien et
    // laisait passer une home blanche ou une exception au montage.
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('#root')).toBeVisible();
    await page.waitForLoadState('domcontentloaded');

    expect(pageErrors, `erreurs JS au montage : ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
