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

  test('la saisie du numero garde le focus (clavier mobile qui ne se ferme pas)', async ({ page }) => {
    await login(page);
    const modal = await openWithdrawModal(page);

    // Régression du signalement « le clavier se ferme à chaque frappe ».
    //
    // Le `Modal` avait `useEffect(..., [isOpen, onClose])`. Comme `onClose`
    // est une arrow function, sa référence changeait à chaque rendu du parent :
    // chaque frappe rejouait l'effet, dont le CLEANUP, qui rendait le focus au
    // déclencheur. Le champ perdait le focus — invisible sur desktop, mais sur
    // mobile cela ferme le clavier à chaque caractère saisi.
    //
    // On vérifie donc que le focus SURVIT à la saisie, caractère par caractère.
    const phone = modal.locator('#withdraw-phone');
    await phone.click();
    // Le champ est PRÉ-REMPLI avec le numéro du profil : on le vide d'abord,
    // sinon la saisie s'ajoute à l'existant et l'assertion n'aurait aucun sens.
    await phone.fill('');
    await phone.click();

    for (const digit of ['0', '1', '6', '5']) {
      await phone.press(digit);
      await expect
        .poll(async () => phone.evaluate((el) => el === document.activeElement), {
          message: `le focus doit rester dans le champ après la frappe « ${digit} »`,
        })
        .toBe(true);
    }

    // Et le format est bien appliqué : le joueur n'a tapé que des chiffres.
    await expect(phone).toHaveValue('01 65');
    await expect(phone).toHaveValue(/^[\d ]*$/);
  });

  test('le pavé numérique suffit : aucun espace nécessaire', async ({ page }) => {
    await login(page);
    const modal = await openWithdrawModal(page);

    // Le pavé d'un téléphone n'a PAS de touche espace, alors que le placeholder
    // affichait « +229 01 61 00 00 01 ». Le champ doit donc se formater seul.
    const phone = modal.locator('#withdraw-phone');
    await phone.click();
    // Saisie « brute », uniquement des chiffres, avec l'indicatif collé.
    await phone.fill('+2290165240654');

    await expect(phone).toHaveValue('+229 01 65 24 06 54');
    // Le format affiché est accepté par la validation : pas d'erreur en ligne.
    // `Input` omet l'attribut quand tout va bien, on vérifie donc l'absence
    // de `aria-invalid="true"` plutôt qu'une valeur.
    await expect(phone).not.toHaveAttribute('aria-invalid', 'true');
    await expect(modal.locator('#withdraw-phone-error')).toHaveCount(0);
  });

  test('un numero mal saisit affiche une raison, jamais un clic muet', async ({ page }) => {
    await login(page);
    const modal = await openWithdrawModal(page);

    // Le bouton n'était plus `disabled` sur une condition inexpliquée : le
    // joueur cliquait et rien ne se passait. Il doit donc TOUJOURS répondre.
    const submit = page.getByRole('button', { name: /confirmer le retrait/i });
    await expect(submit).toBeEnabled();

    const phone = modal.locator('#withdraw-phone');
    // L'ordre de résolution suit le formulaire : opérateur, puis montant, puis
    // numéro. L'écran doit dire où le joueur en est, pas tout d'un coup.
    await expect(modal.getByText(/Choisis ton opérateur/i)).toBeVisible();
    await submit.click();
    await expect(page.getByText(/opérateur Mobile Money/i).first()).toBeVisible();

    // Opérateur choisi : la raison devient le numéro, et elle doit dire
    // COMBIEN de chiffres sont attendus — sinon le joueur reformate au hasard.
    await modal.getByRole('button', { name: /Retirer via/i }).first().click();
    await phone.fill('+2290165240'); // 7 chiffres : trop court

    // Le champ porte le message d'erreur, pas seulement un toast.
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    const error = modal.locator('#withdraw-phone-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('10 chiffres');

    // Et la raison de blocage, affichée avant le clic, reprend la même info.
    await expect(modal.getByRole('status')).toContainText('10 chiffres');
  });

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
