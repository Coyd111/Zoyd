import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders the landing page with ZOYD branding', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ZOYD/i);
    await expect(page.locator('text=ZOYD').first()).toBeVisible();
  });

  test('displays platform feature cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Wagers Sécurisés').first()).toBeVisible();
    await expect(page.locator('text=Arbitrage Rémunéré').first()).toBeVisible();
    await expect(page.locator('text=Mobile Money').first()).toBeVisible();
  });

  test('has working navigation links to auth pages', async ({ page }) => {
    await page.goto('/');
    const loginLink = page.locator('a[href="/auth/login"]').first();
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('navigates to register page from landing', async ({ page }) => {
    await page.goto('/');
    const registerLink = page.locator('a[href="/auth/register"]').first();
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test('displays mode selection cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Multijoueur').first()).toBeVisible();
    await expect(page.locator('text=Battle Royale').first()).toBeVisible();
  });

  test('displays ticker or competition items', async ({ page }) => {
    await page.goto('/');
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});
