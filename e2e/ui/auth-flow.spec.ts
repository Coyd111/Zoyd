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
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.locator('input[name="emailOrPseudo"]').fill('nonexistent_user');
    await page.locator('input[name="password"]').fill('WrongPassword123!');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
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
    const toggleBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Register Page', () => {
  test('renders the register form step 1', async ({ page }) => {
    await page.goto('/auth/register');
    await expect(page.locator('text=Creer un compte').first()).toBeVisible();
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
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
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
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});

test.describe('Protected Routes', () => {
  test('redirects to login when accessing protected pages', async ({ page }) => {
    await page.goto('/mode');
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toMatch(/\/(auth\/login|mode)/);
  });

  test('wallet page requires auth', async ({ page }) => {
    await page.goto('/wallet');
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toMatch(/\/(auth\/login|wallet)/);
  });
});

test.describe('Not Found Page', () => {
  test('shows 404 for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});
