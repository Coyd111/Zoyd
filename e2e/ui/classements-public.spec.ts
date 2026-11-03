/**
 * Spec e2e - /classements pour un visiteur ANONYME (PublicClassementsPage).
 *
 * Verifie le contrat produit pose le 2026-11-02 : un visiteur sans session
 * RESTE sur /classements (aucune redirection /auth/login â€” l'ancien
 * comportement AppLayout), recoit le VRAI classement servi par
 * /api/leaderboard (moque ici pour un jeu de donnees deterministe), peut
 * changer d'onglet, et en cas d'echec serveur voit un panneau explicite
 * sans rang invente.
 *
 * NE couvre PAS la version authentifiee : PAGES_PLAYER de
 * responsive.spec.ts sondes deja /classements connecte (agregation
 * stores, AppLayout) â€” aucune brique de cette voie n'a ete bougee.
 *
 * PIEGE : /api/stats est volontairement PAS moquee : elle est accessoire
 * par design (sa panne n'arrete pas le classement, PublicClassementsPage).
 * Seul /api/leaderboard est intercepte.
 * PIEGE : les onglets de la version authentifiee (TOP ACTIVITE,
 * EQUIPES, PAR PAYS, PAR CONTROLE) n'existent PAS sur la page anonyme :
 * les TABS publics sont TOP ELO / GAINS â€” TOP 50 ELO / VICTOIRES â€” TOP 50
 * ELO seulement. (P2-5 audit UI : les onglets GAINS/VICTOIRES re-trient le
 * top 50 ELO du serveur â€” libelles renommes pour le dire, plus note sous la
 * tablist.)
 */
import { test, expect, type Page } from '@playwright/test';

const SAMPLE_PLAYERS = {
  ok: true,
  total: 3,
  hasMore: false,
  players: [
    // La projection EXACTE de /api/leaderboard (persistence.getLeaderboard) :
    // id, pseudo, country, elo, winRate, totalMatches, totalEarnings, wins,
    // trustScore, controllerType, rankMJ, isOnline.
    {
      id: 'u1',
      pseudo: 'GHOST_229',
      country: 'Benin',
      elo: 1731,
      winRate: 61,
      totalMatches: 33,
      totalEarnings: 4600,
      wins: 21,
      trustScore: 92,
      controllerType: 'Mobile',
      rankMJ: 'Gold',
      isOnline: true,
    },
    {
      id: 'u2',
      pseudo: 'SNIPER_DK',
      country: 'Nigeria',
      elo: 1632,
      winRate: 48,
      totalMatches: 25,
      totalEarnings: 9800,
      wins: 12,
      trustScore: 71,
      controllerType: 'Mobile',
      rankMJ: 'Silver',
      isOnline: false,
    },
    {
      id: 'u3',
      pseudo: 'MOD_ALPHA',
      country: 'Cote dIvoire',
      elo: 1580,
      winRate: 55,
      totalMatches: 40,
      totalEarnings: 2100,
      wins: 22,
      trustScore: 84,
      controllerType: 'Manette',
      rankMJ: 'Gold',
      isOnline: false,
    },
  ],
};

const mockLeaderboard = (page: Page, payload: object | null) =>
  page.route('**/api/leaderboard**', (route) => {
    if (payload === null) {
      void route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      return;
    }
    void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

test.describe('/classements - version anonyme', () => {
  test('aucune redirection login : header, onglets publics et CTA auth', async ({ page }) => {
    await mockLeaderboard(page, SAMPLE_PLAYERS);
    await page.goto('/classements');

    await expect(page).toHaveURL(/\/classements$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'TOP ELO' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'GAINS â€” TOP 50 ELO' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'VICTOIRES â€” TOP 50 ELO' })).toBeVisible();
    // P2-5 : la note d'honnetete sous la tablist est rendue.
    await expect(page.getByText(/top 50 ELO servi par le serveur/)).toBeVisible();
    // Les onglets qui exigent la version authentifiee n'existent pas ici.
    await expect(page.getByRole('tab', { name: 'ACTIVITÃ‰' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'CrÃ©er un compte' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
  });

  test('les rangs du serveur sont rendus ; l onglet GAINS re-oriente le 1er rang', async ({ page }) => {
    await mockLeaderboard(page, SAMPLE_PLAYERS);
    await page.goto('/classements');

    // TOP ELO : GHOST_229 (elo 1731) est le 1er rang du sample.
    const firstPseudo = page.getByTestId('classements-public-pseudo').first();
    await expect(page.getByTestId('classements-public-row')).toHaveCount(3);
    await expect(firstPseudo).toContainText('GHOST_229');
    await expect(page.getByRole('tab', { name: 'TOP ELO' })).toHaveAttribute('aria-selected', 'true');

    // GAINS â€” TOP 50 ELO : le tri passe par totalEarnings â€” SNIPER_DK (9800)
    // passe 1er (re-trie du plateau top-50 ELO, cf. note P2-5).
    await page.getByRole('tab', { name: 'GAINS â€” TOP 50 ELO' }).click();
    await expect(page.getByRole('tab', { name: 'GAINS â€” TOP 50 ELO' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('classements-public-pseudo').first()).toContainText('SNIPER_DK');

    // VICTOIRES â€” TOP 50 ELO : MOD_ALPHA (22 victoires) passe 1er apres
    // SNIPER_DK (12) et GHOST_229 (21)... ce qui place MOD_ALPHA 1er uniquement
    // s'il a plus de victoires que les autres : 22 > 21 > 12.
    await page.getByRole('tab', { name: 'VICTOIRES â€” TOP 50 ELO' }).click();
    await expect(page.getByTestId('classements-public-pseudo').first()).toContainText('MOD_ALPHA');
  });

  test('leaderboard vide : etat explicite, aucune ligne fantome', async ({ page }) => {
    await mockLeaderboard(page, { ok: true, players: [], total: 0, hasMore: false });
    await page.goto('/classements');
    await expect(page.getByText('Aucun classement pour le moment')).toBeVisible();
    await expect(page.getByTestId('classements-public-row')).toHaveCount(0);
  });

  test('serveur en echec : panneau clair + Reessayer, jamais de rang invente', async ({ page }) => {
    await mockLeaderboard(page, null);
    await page.goto('/classements');
    await expect(page.getByText('Classement indisponible')).toBeVisible();
    await expect(page.getByRole('button', { name: /Réessayer/i })).toBeVisible();
    await expect(page.getByTestId('classements-public-row')).toHaveCount(0);

    // Retour du serveur -> le bouton retabli la liste (deuxieme interception).
    // getByTestId et NON getByText : le pseudo existe aussi dans la cellule
    // mobile (DOM hidden) â€” getByText violerait le mode strict (2 matches).
    await mockLeaderboard(page, SAMPLE_PLAYERS);
    await page.getByRole('button', { name: /Réessayer/i }).click();
    await expect(page.getByTestId('classements-public-pseudo').first()).toContainText('GHOST_229');
  });
});
