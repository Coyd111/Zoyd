import { test, expect, type Page } from '@playwright/test';
import { registerPlayer, disposeActors, openAdminSession, creditWallet, type Actor } from '../api/support/harness';

// Avertissement sur les DEUX frais d'un retrait (commission ZOYD 2 % + taux
// propre de FedaPay).
//
// Pourquoi ce test existe : avant, le recapitulatif affichait « Frais (2 %) »
// puis « Tu recevras {net} ». Un joueur pouvait croire que son numero etait
// credite du net, alors que FedaPay preleve son propre taux par-dessus. La
// surprise tombait apres l'envoi, une fois l'argent parti.
//
// Portee : le composant est verifie via le DOM rendu sur la page wallet
// reelle. La connexion se fait par le formulaire (cookie `zoyd_auth`), comme un
// joueur, plutot qu'injecter un token de debug.

test.describe('Avertissement frais de retrait', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Actor;
  let pseudo = '';
  const password = 'ZoydE2E!Player2026';

  test.beforeAll(async () => {
    admin = await openAdminSession();
    const player: Actor = await registerPlayer('E2EFEEWARN');
    pseudo = player.pseudo;
    await creditWallet(admin, player.id, 1000);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  const login = async (page: Page) => {
    await page.goto('/auth/login');
    // Le composant `Input` ne pose pas `type="text"` sur le champ identifiant
    // et ses labels sont en MAJUSCULES avec accents (« TÉLÉPHONE »), donc on
    // cible les placeholders, stables et sans accents.
    // react-hook-form : on saisit puis on valide au clavier, ce qui déclenche
    // le onSubmit du <form> de façon fiable. L'écoute est posée AVANT l'action,
    // sinon la requête part avant qu'on la surveille.
    await page.getByPlaceholder(/ShadowX/).fill(pseudo);
    await page.getByPlaceholder(/^\.*$/).fill(password);

    const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
    await page.getByPlaceholder(/^\.*$/).press('Enter');
    expect((await loginResponse).status(), 'la connexion doit réussir').toBe(200);
  };

  /** Ouvre le modal de retrait depuis la page wallet. */
  const openWithdrawModal = async (page: Page, amount = '500') => {
    await page.goto('/wallet');
    const button = page.getByRole('button', { name: /retirer/i }).first();
    await expect(button).toBeVisible({ timeout: 20_000 });
    await button.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.locator('#withdraw-amount').fill(amount);
    return modal;
  };

  test('la page wallet distingue la commission ZOYD des frais FedaPay', async ({ page }) => {
    await login(page);
    const modal = await openWithdrawModal(page);

    // 1. L'alerte apparait et distingue les deux frais + leurs destinataires.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Commission ZOYD');
    await expect(alert).toContainText('FedaPay');
    await expect(alert).toContainText('ne nous revient pas');
    await expect(alert).toContainText('peut être inférieur');
    // Le taux de FedaPay n'est volontairement pas chiffré : c'est contractuel
    // et peut changer. Un montant inventé dans l'UI serait pire que silence.
    await expect(alert).toContainText('son propre taux');

    // 2. Le recapitulatif ne promet plus « Tu recevras » (c'etait la source
    //    de la meconception) et nomme l'expediteur du net.
    await expect(modal).not.toContainText('Tu recevras');
    await expect(modal).toContainText('Frais de transfert FedaPay');
  });

  test('« Ne plus afficher » masque l\'alerte et laisse un lien pour la revoir', async ({ page }) => {
    await login(page);
    await openWithdrawModal(page);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();

    // On clique le TEXTE du label plutôt que l'input : ce dernier est une case
    // native encapsulée, et `check()` est plus fragile que le label entier.
    await alert.getByText('Ne plus afficher ce message').click();

    // Masque immediatement, et le rappel devient accessible.
    await expect(page.getByRole('alert')).toHaveCount(0);
    const remind = page.getByRole('button', { name: /Rappeler les frais/i });
    await expect(remind).toBeVisible();
    await remind.click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('la preference « ne plus afficher » survit au rechargement', async ({ page }) => {
    await login(page);
    await openWithdrawModal(page);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await alert.getByText('Ne plus afficher ce message').click();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Preference conservee : l'alerte ne revient pas d'elle-meme.
    await openWithdrawModal(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rappeler les frais/i })).toBeVisible();
  });

  test('la commission ZOYD reste publiee par le serveur', async ({ page }) => {
    await login(page);
    // Le taux n'est plus code en dur dans la page : il vient de `/api/wallet/me`.
    // On interroge l'API avec la session du joueur (cookie `zoyd_auth`).
    const payload = await page.evaluate(async () => {
      const response = await fetch('/api/wallet/me', { credentials: 'include' });
      return response.json();
    });
    expect(payload.withdrawal.feeRate).toBe(0.02);
    expect(payload.withdrawal.minAmount).toBe(150);
  });
});
