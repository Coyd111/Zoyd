import { test, expect, type Page } from '@playwright/test';
import {
  registerPlayer, disposeActors, openAdminSession, creditWallet,
  call, type Actor,
} from '../api/support/harness';

// UI Battle Royale : liste des salons, regle "pas de remboursement" visible,
// detail d'un salon avec la repartition de cagnotte.
//
// Pourquoi c'est important : la regle commerciale du BR (le pass n'est pas
// rembourse apres le lancement) doit etre lisible AVANT que le joueur ne paie,
// pas seulement dans les CGU. Si cette note disparait, on a des litiges.
//
// Chaque test cree SON PROPRE salon : un salon partage entre tests serie
// accumule les inscriptions et rend les assertions dependantes de l'ordre.

const newLobby = async (admin: Actor, overrides: Record<string, unknown> = {}) =>
  call(admin, 'POST', '/api/br/lobbies', {
    name: 'Salon UI test', mode: 'solo', map: 'isolated',
    entryFee: 50, scheduledAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
    rankingMode: 'survie_kills',
    payout: { first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08, arbiterRate: 0.03 },
    ...overrides,
  });

const login = async (page: Page, pseudo: string, password: string) => {
  await page.goto('/auth/login');
  await page.getByPlaceholder(/ShadowX/).fill(pseudo);
  await page.getByPlaceholder(/^\.*$/).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
  await page.getByPlaceholder(/^\.*$/).press('Enter');
  expect((await loginResponse).status()).toBe(200);
};

test.describe('Battle Royale UI', () => {
  test.describe.configure({ mode: 'serial' });
  const password = 'ZoydE2E!Player2026';
  let admin: Actor;

  test.beforeAll(async () => {
    admin = await openAdminSession();
    await creditWallet(admin, admin.id, 100_000);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('la liste affiche le salon et la regle "pas de remboursement"', async ({ page }) => {
    await newLobby(admin);
    const player = await registerPlayer('BRUI1');
    await login(page, player.pseudo, password);
    await page.goto('/br');

    await expect(page.getByRole('heading', { name: /BR — UN SALON/i })).toBeVisible();

    // La regle commerciale doit etre visible AVANT toute inscription.
    const notice = page.getByRole('heading', { name: /jamais rembourse/i });
    await expect(notice).toBeVisible();

    await expect(page.getByText('Salon UI test').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Isolated').first()).toBeVisible();
  });

  test('les maps affichees viennent du serveur et excluent Alcatraz', async ({ page }) => {
    await newLobby(admin);
    const player = await registerPlayer('BRUI2');
    await login(page, player.pseudo, password);
    await page.goto('/br');

    await expect(page.getByRole('heading', { name: /Maps et modes/i })).toBeVisible({ timeout: 15_000 });
    for (const label of ['Isolated', 'Blackout', 'Krai', 'Rebirth Island']) {
      await expect(page.getByText(new RegExp(label, 'i')).first()).toBeVisible();
    }
    // Alcatraz a ete retire du jeu : il ne doit pas etre propose.
    await expect(page.getByText('Alcatraz')).toHaveCount(0);
  });

  test('le detail affiche la repartition de cagnotte', async ({ page }) => {
    const created = await newLobby(admin);
    const player = await registerPlayer('BRUI3');
    await login(page, player.pseudo, password);
    await page.goto(`/br/${created.body.lobby.id}`);

    await expect(page.getByRole('heading', { name: /Repartition de la cagnotte/i })).toBeVisible({ timeout: 15_000 });
    for (const place of ['1e place', '2e place', '3e place', '4e place', '5e place']) {
      await expect(page.getByText(place)).toBeVisible();
    }
    await expect(page.getByText('Arbitre')).toBeVisible();
    await expect(page.getByText(/max 5 %/).first()).toBeVisible();
  });

  test('la regle de non-remboursement est visible meme pour un non inscrit', async ({ page }) => {
    const created = await newLobby(admin);
    const player = await registerPlayer('BRUI4');
    await creditWallet(admin, player.id, 500);
    await login(page, player.pseudo, password);
    await page.goto(`/br/${created.body.lobby.id}`);

    // L'information doit etre lue AVANT de payer, donc presente pour tous.
    await expect(page.getByText(/pas\s+rembourse/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /S'inscrire sur ce salon/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Me desinscrire/i })).toHaveCount(0);
  });

test('inscription puis check-in : le pass est bloque', async ({ page }) => {
    const created = await newLobby(admin);
    const player = await registerPlayer('BRUI5');
    await creditWallet(admin, player.id, 500);
    await login(page, player.pseudo, password);

    await page.goto(`/br/${created.body.lobby.id}`);
    // La page detail charge son lobby en async : on attend le roster (le
    // createur y est) avant de raisonner sur l'etat du bouton, sinon on agit
    // sur le rendu « Chargement du salon... ».
    await expect(page.getByRole('heading', { name: 'Joueurs' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /S'inscrire sur ce salon/i })).toBeVisible({ timeout: 20_000 });
    const joinResponse = page.waitForResponse((r) => r.url().includes('/join'), { timeout: 20_000 });
    await page.getByRole('button', { name: /S'inscrire sur ce salon/i }).click();
    expect((await joinResponse).status()).toBe(200);

    // Le check-in devient disponible. On verifie le solde cote API plutot que
    // dans le header : le header lit le store, qui peut avoir un rendu retarde.
    await expect(page.getByRole('button', { name: /Confirmer ma presence/i })).toBeVisible({ timeout: 15_000 });
    const wallet = await call(player, 'GET', '/api/wallet/me');
    expect(wallet.status).toBe(200);
    // 500 - 50 : le pass est bloque, le disponible baisse bien.
    expect(wallet.body.wallet.cashBalance).toBe(450);
    expect(wallet.body.wallet.lockedBalance).toBe(50);
  });

  test('un joueur inscrit peut se desinscrire AVANT le lancement et recuperer son pass', async ({ page }) => {
    const created = await newLobby(admin);
    const player = await registerPlayer('BRUI6');
    await creditWallet(admin, player.id, 500);
    await login(page, player.pseudo, password);

    await page.goto(`/br/${created.body.lobby.id}`);
    // L'inscription se fait depuis la page du salon : on cible CE salon, pas
    // « le premier de la liste » (il y en a un par test et ils se cumulent).
    const joinResponse = page.waitForResponse((r) => r.url().includes('/join'), { timeout: 20_000 });
    await page.getByRole('button', { name: /S'inscrire sur ce salon/i }).click();
    expect((await joinResponse).status()).toBe(200);

    await expect(page.getByRole('button', { name: /Me desinscrire/i })).toBeVisible({ timeout: 15_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    const leaveResponse = page.waitForResponse((r) => r.url().includes('/leave'), { timeout: 20_000 });
    await page.getByRole('button', { name: /Me desinscrire/i }).click();
    expect((await leaveResponse).status()).toBe(200);

    // Rembourse : le joueur disparait du roster.
    await expect(page.getByRole('button', { name: /Me desinscrire/i })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /S'inscrire sur ce salon/i })).toBeVisible();
    // Et son solde est revenu a 500 : le seul cas de remboursement.
    const wallet = await call(player, 'GET', '/api/wallet/me');
    expect(wallet.body.wallet.cashBalance).toBe(500);
  });
});
