import { test, expect } from '@playwright/test';

/**
 * Verrou ZD-10 (audit production 2026-11-19).
 *
 * Le bouton « SE CONNECTER » etait precede d'un `div[tabindex="0"]` sans nom
 * accessible : le clavier s'arretait sur une cible muette avant le bouton.
 * On parcourt l'ordre de tabulation reel et on exige que chaque arret soit un
 * controle nomme, le bouton de soumission une seule fois.
 */
test('login : aucun wrapper focusable muet (ZD-10)', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Identification' })).toBeVisible();

  const arrets: Array<{ tag: string; tabindex: string | null; nom: string }> = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const nom =
        el.getAttribute('aria-label') ??
        el.getAttribute('placeholder') ??
        (el.textContent || '').trim();
      return {
        tag: el.tagName,
        tabindex: el.getAttribute('tabindex'),
        nom: nom.slice(0, 60),
      };
    });
    if (info) arrets.push(info);
  }

  const wrappers = arrets.filter((arret) => arret.tag === 'DIV' && arret.tabindex === '0');
  expect(wrappers, `Arrets focusables : ${JSON.stringify(arrets)}`).toEqual([]);

  const connexions = arrets.filter((arret) => /SE CONNECTER/i.test(arret.nom));
  expect(connexions, `Arrets focusables : ${JSON.stringify(arrets)}`).toHaveLength(1);
});
