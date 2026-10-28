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
const PAGES: Array<{ name: string; path: string; heading?: string }> = [
  { name: 'Accueil', path: '/' },
  { name: 'Connexion', path: '/auth/login' },
  { name: 'Inscription', path: '/auth/register' },
  { name: 'Mot de passe oublie', path: '/auth/forgot-password' },
  // P15 C2 (audit-3) : le chemin historique '/selection-mode' n'existe pas
  // dans le routeur (la vraie route est '/mode', src/app/routes.tsx:94-97).
  // Le fallback SPA servait index.html, React Router rendait la 404
  // (RouteErrorBoundary) et axe-core analysait CETTE page : le test
  // « Selection de mode » restait vert sans jamais rendre ModeSelectionPage.
  // `heading` est la garde : la page analysee doit vraiment être celle
  // annoncee, sinon c'est une 404 qui se fait passer pour elle.
  { name: 'Selection de mode', path: '/mode', heading: 'terrain de jeu' },
];

/**
 * Attend que l'application ait PUBLIE la preference systeme resolue.
 *
 * Un delai fixe ne prouve rien : sous charge, React peut monter apres
 * 2,5 s et l attribut n'existe pas encore — le test echouait alors que
 * l application fonctionnait tres bien. Attendre la condition rend le test
 * deterministe, et supprime le seul vrai flake de la suite UI.
 */
const waitForMotionPreference = async (page: import('@playwright/test').Page) => {
  await page.waitForFunction(
    () => document.documentElement.dataset.reducedMotion !== undefined,
    undefined,
    { timeout: 30_000 }
  );
};

test.describe('Accessibilite (axe-core, violations serious/critical)', () => {
  for (const target of PAGES) {
    test(`${target.name} — aucun blocage`, async ({ page }) => {
      // L'accueil est de loin le test le plus lourd de la suite : vidéo de
      // hero, fonds de 350 ko, et il arrive en premier donc le serveur de dev
      // est encore froid. Budget propre — une VRAIE violation axe échoue sur
      // l'assertion, pas sur le délai, donc rien n'est masqué.
      test.setTimeout(target.path === '/' ? 240_000 : 120_000);

      // On n'attend PAS l'evenement `load` : il exige TOUTES les ressources, video
      // de hero et images de fond comprises, et la navigation de l'accueil
      // depasse alors 45 s. axe n'analyse que le DOM : on attend donc
      // `domcontentloaded`, puis on bloque jusqu a ce que React ait rendu.
      // Attendre un evenement plus large rendait le test instable.
      await page.goto(target.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // 45 s, aligné sur la navigation : sous charge (suite répétée, serveur de dev
      // qui transforme les modules à la volée), le premier rendu de l'accueil
      // dépasse 30 s. Ce n'est pas un défaut de l'application, c'est le coût
      // du serveur de dev — mais un budget plus court produirait un faux
      // échec qui ferait ignorer ce test.
      await page.waitForFunction(() => {
        const root = document.querySelector('#root');
        return Boolean(root && root.childElementCount > 0);
      }, undefined, { timeout: 45_000 });
      await page.waitForTimeout(1_000);

      // P15 C2 (audit-3) : verifier que la page rendue est bien celle
      // annoncee AVANT l'analyse. Un chemin fantome produit un DOM non vide
      // (la 404 de la SPA est rendue) — sans cette garde, axe-core analyse
      // cette page en la croyant la cible et le test reste vert a tort.
      if (target.heading) {
        await expect(
          page.getByRole('heading', { level: 1, name: target.heading }),
          `la page ${target.path} doit rendre son titre, sinon axe analyse la page 404`
        ).toBeVisible();
      }

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
    await waitForMotionPreference(page);

    // L'application publie sur <html> la preference systeme qu'elle a
    // resolue. On verifie le comportement constate, pas la configuration
    // declaree dans le code.
    const resolved = await page.evaluate(() => document.documentElement.dataset.reducedMotion);
    expect(resolved, 'la preference « mouvement reduit » du systeme doit etre respectee').toBe('true');
  });

  test('sans preference systeme, les animations restent actives', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForMotionPreference(page);

    const resolved = await page.evaluate(() => document.documentElement.dataset.reducedMotion);
    expect(resolved).toBe('false');
  });
});