import { test, expect, type Page } from '@playwright/test';
import {
  registerPlayer, disposeActors, openAdminSession, creditWallet,
  call, ADMIN_EMAIL, ADMIN_PASSWORD, type Actor,
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

/** Date locale au format `datetime-local`, a J+32 h (dans la fenetre 24-48 h). */
const toLocalInputPlus32h = () => {
  const d = new Date(Date.now() + 32 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Connexion admin PAR LE FORMULAIRE.
 *
 * L'admin de test a son propre mot de passe (ZOYD_ADMIN_PASSWORD du serveur),
 * pas celui des joueurs : passer par le formulaire evite de bricoler le cookie
 * a la main et exerce le vrai chemin de l'utilisateur.
 */
const loginAdminWithCookie = async (page: Page) => {
  await page.goto('/auth/login');
  await page.getByPlaceholder(/ShadowX/).fill(ADMIN_EMAIL);
  await page.getByPlaceholder(/^\.*$/).fill(ADMIN_PASSWORD);
  const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
  await page.getByPlaceholder(/^\.*$/).press('Enter');
  expect((await loginResponse).status(), 'connexion admin').toBe(200);
};

/**
 * Salon BR avec 5 joueurs presents, prêt a etre lance par l'arbitre.
 * L'arbitre n'est pas joueur : on ne l'inscrit donc pas.
 */
const liveReadyLobby = async (admin: Actor) => {
  const created = await call(admin, 'POST', '/api/br/lobbies', {
    name: 'Salon panneau', mode: 'solo', map: 'isolated',
    entryFee: 50, scheduledAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
    rankingMode: 'survie_kills',
    payout: { first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08, arbiterRate: 0.03 },
  });
  expect(created.status).toBe(201);
  const lobbyId = created.body.lobby.id;
  for (let i = 0; i < 5; i++) {
    const actor = await registerPlayer(`BRPAN${i}`);
    await creditWallet(admin, actor.id, 500);
    expect((await call(actor, 'POST', `/api/br/lobbies/${lobbyId}/join`)).status).toBe(200);
    expect((await call(actor, 'POST', `/api/br/lobbies/${lobbyId}/checkin`)).status).toBe(200);
  }
  return lobbyId;
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

  test('le formulaire de creation est reserve a l\'admin', async ({ page }) => {
    const player = await registerPlayer('BRUI7');
    await login(page, player.pseudo, password);
    await page.goto('/br');
    await expect(page.getByRole('heading', { name: /BR — UN SALON/i })).toBeVisible({ timeout: 15_000 });
    // Un joueur ne doit pas pouvoir creer un salon.
    await expect(page.getByRole('button', { name: /Creer un salon BR/i })).toHaveCount(0);
  });

  test('l\'admin voit le formulaire, valide la repartition et cree le salon', async ({ page }) => {
    // L'admin de test a son propre mot de passe (celui du serveur), pas
    // celui des joueurs : on se connecte via l'API puis on injecte le cookie.
    await loginAdminWithCookie(page);
    await page.goto('/br');

    await page.getByRole('button', { name: /Creer un salon BR/i }).click();
    await expect(page.getByRole('heading', { name: /Nouveau salon Battle Royale/i })).toBeVisible();

    // La repartition par defaut est deja validee : le bouton est actif.
    const submit = page.getByRole('button', { name: /Creer le salon/i });
const totalLabel = page.locator('span', { hasText: /^Total/ }).first();
    await expect(totalLabel).toBeVisible({ timeout: 20_000 });
    // La repartition proposee a l'ouverture est deja valide (100 %).
    await expect(totalLabel).toHaveText('Total 100 %');
    // Le bouton actif prouve aussi que l'admin peut payer son propre pass
    // (le formulaire se bloque sinon sur `cashBalance < entryFee`).
    await expect(submit).toBeEnabled();

    // Casse volontairement la somme -> blocage immediat, sans aller-retour API.
    await page.locator('#br-payout-second').fill('0.5');
    await expect(page.getByText(/doit sommer a 100/i)).toBeVisible();
    await expect(submit).toBeDisabled();

    // Remise a la valeur d'origine (0.22) : le bouton redevient actif.
    await page.locator('#br-payout-second').fill('0.22');
    await expect(totalLabel).toHaveText('Total 100 %');
    await expect(submit).toBeEnabled();

    // Commission arbitre au-dela du plafond (5 %). Ce message doit etre
    // prioritaire sur l'erreur de somme : c'est la vraie cause.
    await page.locator('#br-payout-arbiter').fill('0.2');
    await expect(page.getByText(/Commission arbitre plafonnee/i)).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.locator('#br-payout-arbiter').fill('0.05');

    // Maps proposees : Alcatraz absent.
    const mapOptions = await page.locator('#br-map option').allInnerTexts();
    expect(mapOptions.join(' ')).toContain('Isolated');
    expect(mapOptions.join(' ')).not.toContain('Alcatraz');

    // Plafond effectif = min(mode, map), affiche et mis a jour.
    await page.locator('#br-map').selectOption('rebirth_island');
    await expect(page.getByText(/Plafond effectif de ce salon : 40/)).toBeVisible();
    await page.locator('#br-map').selectOption('isolated');

    // Date hors fenetre refusee.
    await page.locator('#br-date').fill('2020-01-01T10:00');
    await expect(page.getByText(/au moins 24 h/i)).toBeVisible();

    const created = page.waitForResponse((r) => r.url().endsWith('/api/br/lobbies') && r.request().method() === 'POST', { timeout: 20_000 });
    await page.locator('#br-date').fill(toLocalInputPlus32h());
    await submit.click();
    const res = await created;
    expect(res.status()).toBe(201);
    // Le panneau se referme et la liste se recharge : le salon apparait.
    // On verifie le resultat metier (le salon existe pour les joueurs), pas
    // le toast : un toast depend d'un refresh de wallet qui peut echouer.
    await expect(page.getByRole('heading', { name: /Nouveau salon Battle Royale/i })).toHaveCount(0);
    await expect(page.getByText('Salon BR officiel').first()).toBeVisible({ timeout: 15_000 });
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

  /**
 * Ouvre la page detail ET verifie que le salon a bien ete charge.
 *
 * Sans cette attente explicite, un 429 (la suite fait beaucoup de logins sur
 * la meme IP) se manifeste par un « heading introuvable » trompeur, au lieu
 * d'echouer sur la vraie cause.
 */
const gotoDetail = async (page: Page, lobbyId: string) => {
  const detail = page.waitForResponse(
    (r) => r.url().includes(`/api/br/lobbies/${lobbyId}`) && r.request().method() === 'GET',
    { timeout: 25_000 },
  );
  await page.goto(`/br/${lobbyId}`);
  expect((await detail).status(), `chargement du salon ${lobbyId}`).toBe(200);
};

test('le detail affiche la repartition de cagnotte', async ({ page }) => {
    const created = await newLobby(admin);
    const player = await registerPlayer('BRUI3');
    await login(page, player.pseudo, password);
    await gotoDetail(page, created.body.lobby.id);

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
    await gotoDetail(page, created.body.lobby.id);

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

    await gotoDetail(page, created.body.lobby.id);
    // La page detail charge son lobby en async : on attend le roster (le
    // createur y est) avant de raisonner sur l'etat du bouton, sinon on agit
    // sur le rendu « Chargement du salon... ».
    // Le titre porte le compteur (« Joueurs (1 / 40) ») : regex, pas egalite exacte.
    await expect(page.getByRole('heading', { name: /^Joueurs \(\d+ \/ \d+\)$/ })).toBeVisible({ timeout: 20_000 });
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

    await gotoDetail(page, created.body.lobby.id);
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

  test('le panneau d\'arbitrage est reserve a l\'arbitre du salon', async ({ page }) => {
    const lobbyId = await liveReadyLobby(admin);

    // L'arbitre voit le panneau, avec la vue complete (userId).
    await loginAdminWithCookie(page);
    await gotoDetail(page, lobbyId);
    await expect(page.getByRole('heading', { name: /^Arbitre$/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Lancer la partie/i })).toBeVisible();

    // Un joueur inscrit ne voit RIEN de tout ca : ni panneau, ni lancement.
    const player = await registerPlayer('BRUIVIEW');
    await creditWallet(admin, player.id, 500);
    await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    await login(page, player.pseudo, password);
    await gotoDetail(page, lobbyId);
    await expect(page.getByRole('heading', { name: /^Joueurs \(\d+ \/ \d+\)$/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /^Arbitre$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Lancer la partie/i })).toHaveCount(0);
  });

  test('l\'arbitre lance la partie et saisit une elimination', async ({ page }) => {
    const lobbyId = await liveReadyLobby(admin);
    await loginAdminWithCookie(page);
    await gotoDetail(page, lobbyId);

    await expect(page.getByRole('heading', { name: /^Arbitre$/ })).toBeVisible({ timeout: 20_000 });

    // Lancement : confirmation explicite, car les absents sont penalises.
    page.once('dialog', (dialog) => void dialog.accept());
    const startResponse = page.waitForResponse((r) => r.url().endsWith('/start'), { timeout: 20_000 });
    await page.getByRole('button', { name: /Lancer la partie/i }).click();
    expect((await startResponse).status()).toBe(200);

    // Le panneau bascule en saisie.
    await expect(page.getByLabel(/Joueur elimine/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/Tue par/i)).toBeVisible();

    // Elimination : le joueur choisi disparait du select (il est mort) et
    // apparait dans la liste des elimines.
    const options = await page.locator('#br-elim option').allInnerTexts();
    expect(options.length).toBeGreaterThan(2);
    const victim = options[1].replace(/\(\d+ kills?\)$/, '').trim();
    await page.locator('#br-elim').selectOption({ index: 1 });

    // Le tueur ne peut pas etre le joueur elimine.
    const killerOptions = await page.locator('#br-killer option').allInnerTexts();
    expect(killerOptions.join(' ')).not.toContain(victim);

    page.once('dialog', (dialog) => void dialog.accept());
    const killResponse = page.waitForResponse((r) => r.url().endsWith('/eliminate'), { timeout: 20_000 });
    await page.getByRole('button', { name: /Enregistrer l'elimination/i }).click();
    expect((await killResponse).status()).toBe(200);

    await expect(page.getByText(new RegExp(`${victim}\\s+elimine`))).toBeVisible({ timeout: 20_000 });
    // Le compteur « En vie » a baisse d'un cran.
    const alive = await page.locator('dt', { hasText: /^En vie$/ }).locator('..').locator('dd').innerText();
    expect(alive.trim()).toBe('4');
  });

  test('l\'arbitre ne peut pas eliminer un joueur deja mort ni double-cliquer', async ({ page }) => {
    // Le serveur refuse : le panneau n'a pas a le deviner, mais il ne doit
    // pas non plus envoyer une elimination impossible en boucle.
    const lobbyId = await liveReadyLobby(admin);
    await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/start`);

    await loginAdminWithCookie(page);
    await gotoDetail(page, lobbyId);
    await expect(page.getByLabel(/Joueur elimine/i)).toBeVisible({ timeout: 20_000 });

    // Le bouton est inactif tant qu'aucun joueur n'est choisi.
    const submit = page.getByRole('button', { name: /Enregistrer l'elimination/i });
    await expect(submit).toBeDisabled();
    await page.locator('#br-elim').selectOption({ index: 1 });
    await expect(submit).toBeEnabled();

    // Avec un seul vivant restant, la partie est finie : plus d'elimination.
    const view = await call(admin, 'GET', `/api/br/lobbies/${lobbyId}/arbiter`);
    expect(view.status).toBe(200);
  });
});
