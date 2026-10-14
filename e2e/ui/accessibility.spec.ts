import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Audit d'accessibilite reel, dans un vrai navigateur.
 *
 * Pourquoi ce fichier existe : les analyses par expression reguliere sur le
 * code source donnent des faux positifs massifs. Un attribut `aria-label`
 * ecrit sur la ligne suivante du tag, ou un `>`-cache dans une expression
 * JSX (`tab === 'friends'`), suffisent a faire conclure a tort qu'un champ ou
 * un bouton n'a pas de nom accessible. Seule une evaluation dans le DOM rendu
 * ne se trompe pas.
 *
 * On ne retient que les violations `serious` et `critical` : ce sont celles
 * qui bloquent reellement quelqu'un. Les regles `moderate` (rapport de
 * contraste, par exemple) sont bruitées par le theme sombre.
 */
const PAGES = [
  { name: 'Accueil', path: '/' },
  { name: 'Connexion', path: '/auth/login' },
  { name: 'Inscription', path: '/auth/register' },
  { name: 'Mot de passe oublie', path: '/auth/forgot-password' },
  { name: 'Selection de mode', path: '/selection-mode' },
];

test.describe('Accessibilite (axe-core, violations serious/critical)', () => {
  for (const target of PAGES) {
    test(`${target.name} — aucun blocage`, async ({ page }) => {
      // On n'attend PAS l'evenement `load` : il exige TOUTES les ressources, video
      // de hero et images de fond comprises, et la navigation de l'accueil
      // depasse alors 45 s. axe n'analyse que le DOM : on attend donc
      // `domcontentloaded`, puis on bloque jusqu a ce que React ait rendu.
      // Attendre un evenement plus large rendait le test instable.
      await page.goto(target.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForFunction(() => {
        const root = document.querySelector('#root');
        return Boolean(root && root.childElementCount > 0);
      }, undefined, { timeout: 30_000 });
      await page.waitForTimeout(1_000);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );

      const report = blocking
        .map(
          (v) =>
            `[${v.impact}] ${v.id} — ${v.help}\n` +
            v.nodes
              .slice(0, 4)
              .map((n) => `      ${n.target.join(' ')}`)
              .join('\n')
        )
        .join('\n\n');

      expect(
        blocking.length,
        `Violations bloquantes sur « ${target.name} » (${target.path}) :\n\n${report || 'aucune'}`
      ).toBe(0);
    });
  }
});

test.describe('Preference systeme de mouvement reduit', () => {
  test('les animations animees en JavaScript respectent prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_500);

    // L'application publie sur <html> la preference systeme qu'elle a
    // resolue. On verifie le comportement constate, pas la configuration
    // declaree dans le code.
    const resolved = await page.evaluate(() => document.documentElement.dataset.reducedMotion);
    expect(resolved, 'la preference « mouvement reduit » du systeme doit etre respectee').toBe('true');
  });

  test('sans preference systeme, les animations restent actives', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_500);

    const resolved = await page.evaluate(() => document.documentElement.dataset.reducedMotion);
    expect(resolved).toBe('false');
  });
});