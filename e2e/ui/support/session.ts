import { expect, type Page } from '@playwright/test';

/**
 * Connexion par la page, en rejouant le flux REEL.
 *
 * Pourquoi passer par le formulaire et non par l'API : le formulaire est le
 * chemin que chaque joueur emprunte. Un cookie pose a la main pourrait
 * masquer un defaut du parcours de connexion lui-meme (le bouton qui ne
 * repond pas, la rotation de session, le serment d integrite).
 *
 * Le serment est scelle par l'API : tant que `covenant` est absente du
 * compte, AppLayout rend un gate plein ecran au lieu du chrome - on
 * auditerait donc le gate, pas l application.
 */
export const openApp = async (page: Page, identifiant: string, password: string) => {
  await page.goto('/auth/login');
  await page.getByPlaceholder(/ShadowX/).fill(identifiant);
  await page.getByPlaceholder(/^\.*$/).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
  await page.getByPlaceholder(/^\.*$/).press('Enter');
  expect((await loginResponse).status()).toBe(200);
  await page.request.post('/api/auth/covenant', { data: {} });
};

/** Attend que l application ait rendu (le #root n est plus vide). */
export const waitForRender = async (page: Page, timeout = 30_000) => {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#root');
      return Boolean(root && root.childElementCount > 0);
    },
    undefined,
    { timeout },
  );
  // Le temps d'un rendu : les listes viennent du reseau (memoire en local,
  // mais la resolution passe par une promesse).
  await page.waitForTimeout(600);
  // PUIS les animations d ENTREE doivent etre finies.
  await waitForOpacities(page);
};

/**
 * Attend qu AUCUN element ne soit a mi-opacite.
 *
 * PIEGE (audit UI) : les cartes du hub BR entrent en scene avec un
 * `motion.div` (`initial="hidden"`, `variants={staggerItem}`). Pendant
 * l animation, l opacite du texte est inferieure a 1 : axe compose alors
 * le texte avec le fond et mesure 1,2:1 ou 3,5:1 la ou il y en a 15.
 * C est un FAUX POSITIF, et il est ALEATOIRE (il depend du nombre de
 * cartes et du debit de l animation) : l audit `/br` echouait une fois
 * sur deux.
 *
 * PIEGE bis : `prefers-reduced-motion` ne suffit PAS. Framer-motion coupe
 * les animations de TRANSFORM, mais PAS celles d OPACITE
 * (`MotionConfig reducedMotion="user"` preserve explicitement l opacite).
 *
 * On attend donc la stabilisation de l opacite. Les elements dont la
 * classe porte `animate-` sont ignores : ce sont des boucles voulues
 * (pulse, marquee) qui ne se stabilisent jamais.
 *
 * Le delai maximal est une garde : si un element est durablement a
 * mi-opacite (choix de design), on mesure quand meme plutot que de
 * bloquer l audit - axe jugera sur le contraste tel quel.
 */
export const waitForOpacities = async (page: Page, timeout = 15_000) => {
  try {
    await page.waitForFunction(
      () => {
        const enCours = Array.from(document.querySelectorAll('body *')).filter((el) => {
          const css = typeof el.className === 'string' ? el.className : '';
          if (css.includes('animate-')) return false;
          const opacite = Number(getComputedStyle(el).opacity);
          return opacite > 0.01 && opacite < 0.99;
        });
        return enCours.length === 0;
      },
      undefined,
      { timeout, polling: 200 },
    );
  } catch {
    // Garde : on mesure malgre tout (voir le commentaire ci-dessus).
  }
};
