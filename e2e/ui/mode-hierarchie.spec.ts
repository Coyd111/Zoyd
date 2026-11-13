/**
 * Spec e2e - hierarchie produit sur les trois surfaces d'entree (arbitrage
 * utilisateur 2026-11-02).
 *
 * INVARIANT : le produit courant = MJ + BR salons ; la BR League = EVENEMENT
 * hebdomadaire differe (saisons apres l'ouverture publique). Aucun ecran ne
 * doit annoncer la ligue comme un mode ouvert.
 *
 * - /mode (launcher) : les DEUX grandes cartes vendent des modes ouverts
 *   (Multijoueur, Battle Royale = salons) ; la ligue vit en bande
 *   secondaire etiquetee.
 * - / (landing, D6) : le sous-titre et les signal strips du hero nomment
 *   les salons BR ouvert ; 4e pilier « Battle Royale » dans la section
 *   Plateforme ; le footer libelle /mode « MJ + BR ».
 * - /mj (hub MJ, D5) : bande secondaire STATIQUE vers /br + chemin discret
 *   vers /br-league. Authentifie : /mj est derriere AppLayout.
 *
 * NE couvre PAS les destinations par redirection : /br et /br-league sont
 * derriere AppLayout et toutes deux finissent sur /auth/login pour un
 * anonyme — on teste le DOM (liens visibles + href), pas une navigation
 * cliquee.
 *
 * PIEGES strict-mode :
 * - « Salons ouverts » matche le badge/strip ET le paragraphe qui commence
 *   par ces mots (sur /mode ET sur /) : cibler exact:true.
 * - une grande carte est un unique <button> englobant tout son contenu :
 *   cibler par sous-chaines, pas par le nom complet.
 * - la sidebar lie par aria-label « BR LEAGUE » (MAJUSCULES) : le regex
 *   /BR League/ du bandeau est case-sensitive et ne la touche pas.
 */
import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, openAdminSession, creditWallet, type Actor } from '../api/support/harness';
import { openApp } from './support/session';

// Pattern de connexion : helper partage `support/session.ts` (meme pattern
// que layout.spec - harness : session admin 2FA pour financer le joueur de
// test, cookie jar isole par acteur). Une seule implementation : une
// divergence silencieuse entre specs est un faux vert possible.

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

test.describe('/ - landing : vitrine D6 (arbitrage 2026-11-02)', () => {
  test('la landing annonce les salons BR au-dessus du fold, ligue = evenement', async ({ page }) => {
    await page.goto('/');

    // Sous-titre hero : la liste des surfaces du produit inclut le BR.
    await expect(page.getByText(/salons Battle Royale/)).toBeVisible();

    // Signal strips du hero : salons ouverts, ligue = evenement differe.
    // (La description du 4e pilier commence aussi par « Salons ouverts, » :
    // exact:true cible le strip seul.)
    await expect(page.getByText('Salons ouverts', { exact: true })).toBeVisible();
    await expect(page.getByText('BR League différé', { exact: true })).toBeVisible();

    // Section Plateforme : le 4e pilier vend le second mode ouvert.
    await expect(page.getByRole('heading', { name: 'Battle Royale', exact: true })).toBeVisible();
    await expect(page.getByText(/Salons ouverts, inscriptions directes/)).toBeVisible();

    // Footer : le chemin /mode est libelle « MJ + BR » — les deux modes
    // ouverts, sans la ligue.
    await expect(page.getByRole('link', { name: 'MJ + BR' })).toBeVisible();
  });
});

test.describe('/mj - hub : bande secondaire BR salons (D5)', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Actor;
  let pseudo = '';
  const password = 'ZoydE2E!Player2026';

  test.beforeAll(async () => {
    admin = await openAdminSession();
    const player: Actor = await registerPlayer('E2EHIER');
    pseudo = player.pseudo;
    await creditWallet(admin, player.id, 500);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('le hub MJ expose le chemin BR salons en bande secondaire', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, pseudo, password);
    await page.goto('/mj');

    // Bande STATIQUE : visible des le montage — ni le squelette, ni la liste
    // socket/polling, ni un eventuel echec de bootstrap n'agissent dessus.
    const salonsCta = page.getByRole('link', { name: 'Entrer en salons' });
    await expect(salonsCta).toBeVisible();
    await expect(salonsCta).toHaveAttribute('href', '/br');

    // Chemin ligue : lien discret (texte mono 9px), jamais un CTA majeur.
    const leagueLink = page.getByRole('link', { name: /BR League/ });
    await expect(leagueLink).toBeVisible();
    await expect(leagueLink).toHaveAttribute('href', '/br-league');
  });
});
