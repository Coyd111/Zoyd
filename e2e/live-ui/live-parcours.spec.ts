import { test, expect } from '@playwright/test';

// ─── Garde-fou PRODUCTION ────────────────────────────────────────────────────
// Ce fichier vise zoyd.vercel.app ET cree un compte reel en production.
// Sans intention explicite, il ne s'execute pas.
test.beforeAll(async () => {
  if (process.env.ZOYD_ALLOW_LIVE_TESTS !== '1') {
    throw new Error(
      'Refus de lancer un test LIVE sur la PRODUCTION.\n'
      + 'Relancer avec : ZOYD_ALLOW_LIVE_TESTS=1 pnpm test:e2e:live-ui',
    );
  }
});

/**
 * Le PARCOURS JOUEUR, en production, dans un vrai navigateur.
 *
 * Ce que le script `scripts/prod-walkthrough.mjs` ne fait pas
 * -------------------------------------------------------
 * Le script parle a l'API : il prouve que le SERVEUR se comporte. Il ne
 * prouve rien du FRONT deploye — ni que la session traverse le cookie
 * cross-site (Vercel -> Render), ni que les ecrans s'affichent, ni que
 * les boutons repondent.
 *
 * Cette spec ferme la boucle : elle pilote le vrai site, dans le vrai
 * navigateur, et verifie ce que le joueur voit.
 *
 * Ce que cette spec ne fait pas
 * -----------------------------
 * Elle ne touche pas a l'argent : le depot passe par le widget FedaPay
 * (un iframe tiers qui capte la carte Mobile Money). Le parcours de
 * l'argent est verifie par le script, sur l'API.
 *
 * PIEGE : chaque creation de compte laisse une ligne en base. Le test
 * SUPPRIME son compte a la fin (DELETE /api/auth/me, mot de passe
 * exige). Si l'echec survient avant la suppression, le compte reste :
 * c'est le prix d'un parcours qui verifie l 'interface reelle.
 */

const API = 'https://zoyd.onrender.com';
const MOT_DE_PASSE = 'Zt7!qVx2@Lp9#Rw4';

let pseudo = '';
let email = '';
let telephone = '';

const inscription = async (request: import('@playwright/test').APIRequestContext) => {
  // Un pseudo ET un telephone uniques par execution : le telephone est
  // UNIQUE en base, et le parcours peut etre rejoue.
  //
  // Format international du Benin (`+229 0ZXXXXXXXX`, 10 chiffres, le `0`
  // initial obligatoire depuis l exterieur).
  const marque = Date.now().toString(36).slice(-5).toUpperCase();
  pseudo = `PARC${marque}`;
  email = `parcours-${pseudo.toLowerCase()}@example.com`;
  telephone = `+22901${String(Date.now()).slice(-8)}`;

  const reponse = await request.post(`${API}/api/auth/register`, {
    headers: { Origin: 'https://zoyd.vercel.app' },
    data: {
      pseudo,
      email,
      phone: telephone,
      gameId: `6799${marque}`,
      password: MOT_DE_PASSE,
      acceptAdult: true,
      acceptTerms: true,
      device: 'phone',
      controllerType: 'touch',
      country: 'Bénin',
      levelCODM: 150,
    },
  });
  expect(reponse.status(), 'inscription du compte de parcours').toBe(201);
};

test.describe('LIVE — Parcours joueur de bout en bout', () => {
  test.use({ reducedMotion: 'reduce' });

  test('inscription, connexion, navigation et suppression du compte', async ({ page, request }) => {
    test.setTimeout(240_000);

    // ─── 1. L'inscription ────────────────────────────────────────────────────
    await inscription(request);

    // ─── 2. La connexion, dans le VRAI navigateur ───────────────────────────
    // C'est le moment le plus risque du produit : le front (Vercel) et
    // l'API (Render) sont sur DEUX sites differents. Le cookie de session
    // est donc `SameSite=None; Secure`. Aucun test local n'exerce ce
    // chemin-la : si le cookie est mal regle, plus personne ne peut se
    // connecter, et la suite locale reste verte.
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.locator('input[name="emailOrPseudo"]').fill(pseudo);
    await page.locator('input[name="password"]').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: 'SE CONNECTER' }).click();

    await page.waitForURL(/\/(mj|$)/, { timeout: 90_000 }).catch(() => {});
    await expect(
      page.locator('body'),
      'le tableau de bord affiche le pseudo du compte connecte',
    ).toContainText(pseudo, { timeout: 60_000 });

    // Le cookie de session a bien ete pose, et il est cross-site.
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === 'zoyd_auth');
    expect(session, 'le cookie de session est pose').toBeTruthy();
    expect(session?.sameSite, 'le cookie de session est cross-site').toBe('None');
    expect(session?.secure, 'le cookie de session est en HTTPS seul').toBe(true);
    expect(session?.httpOnly, 'le cookie de session est inaccessible au script').toBe(true);

    // ─── 3. Les ecrans du parcours ──────────────────────────────────────────
    const etapes: { nom: string; chemin: string; attendu: RegExp }[] = [
      { nom: 'Portefeuille', chemin: '/wallet', attendu: /LE COFFRE-FORT|WALLET/i },
      { nom: 'Hub MJ', chemin: '/mj', attendu: /MJ|MATCH|TOURNOI/i },
      { nom: 'Creation de match', chemin: '/mj/creer', attendu: /FORMAT|1VS1|MATCH/i },
      { nom: 'Profil', chemin: '/profil', attendu: /PROFIL|pseudo|AUDIT|PARC/i },
      { nom: 'Parametres', chemin: '/parametres', attendu: /PARAM|PROFIL|NOTIFICATION/i },
      { nom: 'Classements', chemin: '/classements', attendu: /CLASSEMENT|LEADERBOARD|JOUEUR/i },
    ];

    for (const etape of etapes) {
      await page.goto(etape.chemin, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      // PIEGE : le service Render se reveille et l API met parfois
      // plusieurs secondes a repondre. Lire le texte UNE FOIS, tot,
      // donnerait un ecran vide et un echec qui ne veut rien dire.
      // On ASSERT sur le contenu, avec un delai : l attente est alors
      // explicitement « le contenu apparait ».
      await expect(
        page.locator('body'),
        `l ecran ${etape.nom} (${etape.chemin}) affiche son contenu`,
      ).toContainText(etape.attendu, { timeout: 60_000 });
    }

    // ─── 4. Le retrait reste bloque (le retrait n est pas teste ici) ─────────
    // On verifie seulement que l'ecran de retrait REFUSE une action
    // sans confirmation : c est un garde-fou d'ARGENT, pas un test de
    // retrait (le retrait lui-meme est hors perimetre, comme demande).
    await page.goto('/wallet', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await expect(page.locator('body')).toContainText(/LE COFFRE-FORT|WALLET/i, { timeout: 60_000 });
    const retrait = page.locator('button[aria-label*="Retirer"], button:has-text("RETIRER")').first();
    if (await retrait.count()) {
      await retrait.click({ timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const corps = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      // Un solde nul doit etre annonce : le retrait ne part pas en silence.
      expect(corps).toMatch(/150|minimum|MINIMUM|solde|SOLDE/i);
    }

    // ─── 5. Le nettoyage ────────────────────────────────────────────────────
    // DELETE /api/auth/me exige le mot de passe courant : c est la preuve
    // de possession, et le solde restant estconfisque (confirmeForfeit).
    const suppression = await request.delete(`${API}/api/auth/me`, {
      headers: { Origin: 'https://zoyd.vercel.app' },
      data: { confirmForfeit: true, currentPassword: MOT_DE_PASSE },
    });
    expect(
      [200, 404].includes(suppression.status()),
      `le compte de parcours est supprime (HTTP ${suppression.status()})`,
    ).toBe(true);
  });
});
