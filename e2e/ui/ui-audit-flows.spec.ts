import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, type Actor } from '../api/support/harness';
import { openApp, waitForRender } from './support/session';
import { auditerEcran, brancherSonde } from './support/audit';

/**
 * Audit UI des parcours a ETATS (ce qu une route ne dit pas).
 *
 * Le trou que ce fichier comble
 * ----------------------------
 * Un audit par route visite des URL. Or plusieurs ecrans de ZOYD ne sont
 * pas des pages mais des ETATS d une meme page :
 *
 *  - `/mj/creer` est un assistant de quatre etats (format -> configuration
 *    -> mise -> recapitulatif) ;
 *  - `/parametres` est un panneau de quatre onglets (compte -> securite ->
 *    gaming -> notifications).
 *
 * L audit par route s arretait donc sur le PREMIER etat. Les saisies de
 * formulaire, les boutons radio, les recapitulatifs de cagnotte et le
 * tableau de repartition du prize pool n ont jamais passe sous une sonde.
 * C est precisement la que se trouvaient des textes a `text-white/40`
 * (contraste WCAG non respecte) et un bouton de publication dont le nom
 * accessible ne contenait pas son texte visible.
 *
 * Pourquoi un fichier a part
 * --------------------------
 * Le parcours est une SUITE D INTERACTIONS, pas une liste d URL. La boucle
 * de l audit par route ne sait pas cliquer. Un fichier dedie garde les
 * deux approches lisibles.
 *
 * Chaque etat est mesure avec la meme sonde que le reste de l audit
 * (`support/audit.ts`) : une seule definition des criteres.
 */

/**
 * Mesure sur l etat STABILISE (animations coupees) : une animation en
 * cours fait baisser l opacite du texte et produit un FAUX POSITIF de
 * contraste. Voir le commentaire equivalent dans
 * `ui-audit-authenticated.spec.ts`.
 */
test.use({ reducedMotion: 'reduce' });

let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2EUIW');
});

test.afterAll(async () => {
  await disposeActors();
});

test.describe('Audit UI - parcours a etats', () => {
  test('l assistant de creation de match (4 etats)', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    await openApp(page, joueur.pseudo, 'ZoydE2E!Player2026');
    const collecte = brancherSonde(page);

    await page.goto('/mj/creer', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForRender(page);

    const rapports: string[] = [];

    const mesurer = async (etape: number) => {
      const chemin = `/mj/creer#etape-${etape}`;
      const { rapport } = await auditerEcran(
        page,
        { nom: `Assistant match - etape ${etape}`, chemin, tentative: testInfo.retry },
        collecte,
      );
      if (rapport) rapports.push(`[etape ${etape}]\n${rapport}`);
    };

    // ── Etape 1 : le format ────────────────────────────────────────────────
    await mesurer(1);

    await page.getByRole('radio', { name: /^Format 1VS1/ }).click();
    await page.getByRole('button', { name: "Continuer à l'étape suivante" }).click();
    await expect(page.getByRole('heading', { name: /Comment vous allez jouer/i })).toBeVisible();
    await waitForRender(page);

    // ── Etape 2 : le mode, la carte, les presets ──────────────────────────
    await mesurer(2);

    await page.getByRole('radio', { name: /^Mode / }).first().click();
    await page.getByRole('radio', { name: /^Carte / }).first().click();
    // PIEGE : chaque etape a SON libelle de passage (« Continuer »,
    // « Passer a la mise », « Passer au recapitulatif ») : un libelle
    // unique ne traverserait pas l assistant.
    await page.getByRole('button', { name: /Passer à la mise/ }).click();
    await expect(page.getByRole('heading', { name: /La Mise/i })).toBeVisible();
    await waitForRender(page);

    // ── Etape 3 : la mise et la repartition du prize pool ──────────────────
    await mesurer(3);

    await page.getByRole('radio', { name: /^Mise de / }).first().click();
    await page.getByRole('button', { name: /Passer au récapitulatif/ }).click();
    await expect(page.getByRole('heading', { name: /Récapitulatif du Wager/i })).toBeVisible();
    await waitForRender(page);

    // ── Etape 4 : le recapitulatif ───────────────────────────────────────
    await mesurer(4);

    expect(
      rapports.join('\n\n'),
      `Audit UI de l assistant de creation de match :\n\n${rapports.join('\n\n') || 'aucun defaut detecte'}`,
    ).toBe('');
  });

  test('les quatre onglets des parametres', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    await openApp(page, joueur.pseudo, 'ZoydE2E!Player2026');
    const collecte = brancherSonde(page);

    await page.goto('/parametres', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForRender(page);

    const rapports: string[] = [];

    const mesurer = async (onglet: string) => {
      const chemin = `/parametres#onglet-${onglet}`;
      const { rapport } = await auditerEcran(
        page,
        { nom: `Parametres - onglet ${onglet}`, chemin, tentative: testInfo.retry },
        collecte,
      );
      if (rapport) rapports.push(`[onglet ${onglet}]\n${rapport}`);
    };

    // L onglet « COMPTE » est affiche par defaut : il est deja mesure par
    // l audit par route. On mesure les trois autres.
    for (const libelle of ['SÉCURITÉ', 'GAMING', 'NOTIFICATIONS']) {
      await page.getByRole('tab', { name: libelle }).click();
      await waitForRender(page);
      await mesurer(libelle);
    }

    expect(
      rapports.join('\n\n'),
      `Audit UI des onglets de parametres :\n\n${rapports.join('\n\n') || 'aucun defaut detecte'}`,
    ).toBe('');
  });
});
