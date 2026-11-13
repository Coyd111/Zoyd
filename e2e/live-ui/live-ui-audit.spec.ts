import { test, expect } from '@playwright/test';
import { auditerEcran, brancherSonde } from '../ui/support/audit';

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

/**
 * L audit UI, en PRODUCTION, sur les ecrans PUBLICS.
 *
 * Pourquoi seulement les ecrans publics
 * ------------------------------------
 * Les ecrans authentifies exigent un compte. Les creer en production
 *.pollue la base (c est exactement la raison pour laquelle le projet
 * `live-api` interdit le retry : chaque relance y laisse un compte de
 * plus). Les ecrans publics, eux, se mesurent sans rien creer.
 *
 * Ce que cela prouve
 * ------------------
 * Que le DEPLOY est correct : le bundle servi par Vercel est bien celui
 * du commit pousse, et les corrections de contraste, de nom accessible et
 * de cible tactile y sont reellement en vigueur. Un audit vert en local
 * ne dit rien du bundle deploye.
 *
 * La sonde est la MEME que celle du local (`../ui/support/audit.ts`) :
 * un seul definition des criteres, sinon le test de production ne
 * mesurerait pas la meme chose que le test de local.
 */

/** Les ecrans publics, parcourus SANS session. */
const ECRANS_PUBLICS = [
  { nom: 'Landing', chemin: '/' },
  { nom: 'Selection de mode', chemin: '/mode' },
  { nom: 'Connexion', chemin: '/auth/login' },
  { nom: 'Inscription', chemin: '/auth/register' },
  { nom: 'Mot de passe oublie', chemin: '/auth/forgot' },
  { nom: 'Activation', chemin: '/auth/activate' },
  { nom: 'Conditions', chemin: '/conditions' },
  { nom: 'Reglement et litiges', chemin: '/reglement-litiges' },
  { nom: 'Anti-fraude', chemin: '/anti-fraude' },
  { nom: 'Confidentialite', chemin: '/confidentialite' },
  { nom: 'Mentions legales', chemin: '/mentions' },
  { nom: 'Jeu responsable', chemin: '/jeu-responsable' },
  { nom: 'Classements (public)', chemin: '/classements' },
  { nom: 'Page 404', chemin: '/page-inexistante-aucune-entree' },
];

test.use({ reducedMotion: 'reduce' });

test.describe('LIVE — Audit UI des ecrans publics', () => {
  for (const ecran of ECRANS_PUBLICS) {
    test(`${ecran.nom} (${ecran.chemin})`, async ({ page }) => {
      // Budget large : le service Render peut mettre 30 a 60 s a repondre
      // quand il sort de veille.
      test.setTimeout(180_000);

      const collecte = brancherSonde(page, { anonyme: true });

      await page.goto(ecran.chemin, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForFunction(
        () => {
          const root = document.querySelector('#root');
          return Boolean(root && root.childElementCount > 0);
        },
        undefined,
        { timeout: 90_000 },
      );
      await page.waitForTimeout(1500);

      const { rapport } = await auditerEcran(page, ecran, collecte);

      expect(
        rapport,
        `Audit UI de « ${ecran.nom} » (${ecran.chemin}) en production :\n\n${rapport || 'aucun defaut detecte'}`,
      ).toBe('');
    });
  }
});
