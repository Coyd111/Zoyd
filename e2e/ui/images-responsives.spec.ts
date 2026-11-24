import { test, expect } from '@playwright/test';

/**
 * Images responsives - garde de performance.
 *
 * Trois garanties mesurees sur la page de connexion, la plus froide du site :
 *  1. les key arts sont servis en WebP et jamais en JPEG plein format ;
 *  2. chaque image declarative porte un srcset : le navigateur choisit la
 *     variante adaptee au viewport (480 a 1440 px) au lieu de 1920 px ;
 *  3. le wordmark de marque est servi en WebP, avec le PNG en repli.
 *
 * PIEGE : `loading="lazy"` retarde le telechargement, donc on interroge le
 * `currentSrc` apres stabilisation, pas au premier rendu.
 */
test.describe('Images responsives', () => {
  test('la connexion desktop ne telecharge aucun key art JPEG', async ({ page }) => {
    const jpegs: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/\/assets\/codm\/press\/ui\/[^/]+\.jpe?g(\?|$)/i.test(url)) jpegs.push(url);
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/auth/login');
    await expect(page.getByPlaceholder(/ShadowX/)).toBeVisible();

    const image = page.locator('img[src*="duel-operateurs"]').first();
    await expect(image).toBeVisible();
    await expect
      .poll(async () => image.evaluate((el) => (el as HTMLImageElement).currentSrc), { timeout: 15_000 })
      .toContain('.webp');

    await expect
      .poll(async () => image.getAttribute('srcset'), { timeout: 5_000 })
      .toContain('duel-operateurs-480.webp 480w');

    expect(jpegs, `key arts JPEG telecharges :\n  ${jpegs.join('\n  ')}`).toEqual([]);
  });

  test('la connexion mobile choisit une variante bornee et WebP', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/login');
    await expect(page.getByPlaceholder(/ShadowX/)).toBeVisible();

    const image = page.locator('img[src*="portrait-ghost"]').last();
    await expect(image).toBeVisible();
    await expect
      .poll(async () => image.evaluate((el) => (el as HTMLImageElement).currentSrc), { timeout: 15_000 })
      .toContain('.webp');

    const mesure = await image.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { naturelle: img.naturalWidth, srcset: img.getAttribute('srcset') || '', sizes: img.getAttribute('sizes') || '' };
    });
    expect(mesure.srcset).toContain('portrait-ghost-480.webp 480w');
    expect(mesure.sizes.length).toBeGreaterThan(0);
    // 564 px est la largeur du fichier d origine : aucune variante ne
    // doit etre surdimensionnee pour un ecran de 390 px.
    expect(mesure.naturelle).toBeLessThanOrEqual(564);
  });

  test('le wordmark est servi en WebP', async ({ page }) => {
    // Sur desktop, LoginPage masque le wordmark (panneau editorial a gauche).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/login');
    const logo = page.locator('img[alt="ZOYD"]:visible').first();
    await expect(logo).toBeVisible();
    await expect
      .poll(async () => logo.evaluate((el) => (el as HTMLImageElement).currentSrc), { timeout: 15_000 })
      .toContain('.webp');
  });
});
