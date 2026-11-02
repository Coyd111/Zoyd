/**
 * Spec e2e - /mode : hierarchie produit (arbitrage utilisateur 2026-11-02).
 *
 * Le produit courant = MJ + BR salons ; la BR League = EVENEMENT
 * hebdomadaire differe. Verifie que le launcher ne l'inverse plus :
 * - les DEUX grandes cartes vendent des modes ouverts (Multijoueur,
 *   Battle Royale = salons) : la carte BR n'annonce plus « 500 joueurs,
 *   5 jours de qualification » (pitch de l'evenement, maintenant uniquement
 *   dans la bande secondaire — 1 occurrence sur la page) ;
 * - la bande secondaire est la ligue, etiquetee « EVENEMENT hebdomadaire »
 *   + « OUVERTURE DIFFEREE » (badges), avec un chemin discret vers
 *   /br-league (« Voir la ligue »).
 *
 * NE couvre PAS les destinations des clics : /br et /br-league sont derriere
 * AppLayout et finissent toutes deux sur /auth/login pour un anonyme — la
 * redirection ne prouve rien. Route + lazy dest couverts par
 * responsive.spec / layout.spec.
 *
 * PIEGE : l'accessibilite d'un bouton = TOUT son texte : cibler avec un
 * regex de sous-chaine (la grande carte est un unique <button> englobant).
 */
import { test, expect } from '@playwright/test';

test.describe('/mode - hierarchie produit (arbitrage 2026-11-02)', () => {
  test('la grande carte BR vend les SALONS ; la ligue vit en bande evenement', async ({ page }) => {
    await page.goto('/mode');

    // Mode ouvert 1 : Multijoueur (inchange).
    await expect(page.getByRole('heading', { name: 'Multijoueur' })).toBeVisible();
    await expect(page.getByText('Entrer en MJ')).toBeVisible();

    // Mode ouvert 2 : Battle Royale = salons (la ligue n'y figure PLUS).
    await expect(page.getByRole('heading', { name: 'Battle Royale' })).toBeVisible();
    await expect(page.getByText('Entrer en Battle Royale')).toBeVisible();
    // exact = true : le paragraphe commence aussi par « Salons ouverts, » —
    // seul le badge d'angle porte la chaine a la lettre.
    await expect(page.getByText('Salons ouverts', { exact: true })).toBeVisible();
    await expect(page.getByText('Entrer en BR League')).toHaveCount(0);

    // Le pitch de l'evenement (500 joueurs / 5 jours) n'est present que dans
    // la bande secondaire : exactement UNE occurrence sur toute la page.
    await expect(page.getByText(/5 jours de qualification/)).toHaveCount(1);

    // Bande secondaire : la ligue, etiquetee EVENEMENT.
    await expect(page.getByText('BR League', { exact: true })).toBeVisible();
    await expect(page.getByText('Événement hebdomadaire')).toBeVisible();
    await expect(page.getByText('Ouverture différée')).toBeVisible();
    await expect(page.getByText('Voir la ligue')).toBeVisible();
  });
});
