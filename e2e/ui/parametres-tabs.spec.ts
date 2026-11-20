import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, PLAYER_PASSWORD, type Actor } from '../api/support/harness';
import { openApp, waitForRender } from './support/session';

/**
 * Verrou ZD-09 (audit production 2026-11-19).
 *
 * Les quatre onglets de /parametres etaient tous dans l'ordre de tabulation,
 * les fleches ne changeaient rien, et le survol de l'onglet actif repeignait
 * le fond en blanc 10 % sous un texte noir : contraste quasi nul.
 */
test.use({ reducedMotion: 'reduce' });

let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2ETABS');
});

test.afterAll(async () => {
  await disposeActors();
});

test('parametres : onglets au clavier et survol lisible (ZD-09)', async ({ page }) => {
  await openApp(page, joueur.pseudo, PLAYER_PASSWORD);
  await page.goto('/parametres', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitForRender(page);

  const compte = page.getByRole('tab', { name: 'COMPTE' });
  const securite = page.getByRole('tab', { name: 'SÉCURITÉ' });
  const notifications = page.getByRole('tab', { name: 'NOTIFICATIONS' });

  await expect(page.getByRole('tab')).toHaveCount(4);

  // Roving tabindex : une seule cible dans l'ordre de tabulation.
  await compte.click();
  await expect(compte).toHaveAttribute('tabindex', '0');
  await expect(securite).toHaveAttribute('tabindex', '-1');

  // Fleches : le focus ET la selection suivent.
  await compte.focus();
  await page.keyboard.press('ArrowDown');
  await expect(securite).toBeFocused();
  await expect(securite).toHaveAttribute('aria-selected', 'true');
  await expect(securite).toHaveAttribute('tabindex', '0');
  await expect(compte).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('End');
  await expect(notifications).toBeFocused();
  await page.keyboard.press('Home');
  await expect(compte).toBeFocused();

  // Survol de l'onglet actif : fond OPAQUE, contraste WCAG >= 4.5:1. Avant le
  // correctif, `hover:bg-white/10` de la variante secondary s'appliquait
  // par-dessus `bg-white` et faisait tomber le contraste.
  await compte.click();
  await compte.hover();
  const style = await compte.evaluate((el) => {
    const computed = getComputedStyle(el);
    return { bg: computed.backgroundColor, color: computed.color };
  });
  expect(style.bg).toBe('rgb(255, 255, 255)');

  const luminance = (couleur: string): number => {
    const canaux = (couleur.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const [r, g, b] = canaux.map((valeur) => {
      const c = valeur / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const clair = luminance(style.bg);
  const sombre = luminance(style.color);
  const contraste = (Math.max(clair, sombre) + 0.05) / (Math.min(clair, sombre) + 0.05);
  expect(contraste).toBeGreaterThanOrEqual(4.5);
});
