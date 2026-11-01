import { test, expect, type Page } from '@playwright/test';
import { registerPlayer, disposeActors, ADMIN_EMAIL, ADMIN_PASSWORD, type Actor } from '../api/support/harness';

// ─────────────────────────────────────────────────────────────────────────────
// Garde responsive mobile (audit UI : constats U-1..U-4).
//
// Pourquoi des sondes GEOMETRIQUES : le CSS produit masque tout scroll
// horizontal document (body { overflow-x: hidden, theme.css:60 } + le <main>
// du layout porte overflow-x-clip), donc un debordement interne (une cellule
// KPI rogee) ne se voit PAS dans `document.scrollWidth`. On scanne donc les
// rectangles reellement rendus : tout element hors viewport SANS ancetre
// scrollable (overflow-x auto/scroll, atteignable par l'utilisateur) est un
// clip reel. Les decors volontairement rognes (blobs flous du hero, bande
// marquee animee) sont exoneres par classes, et aria-hidden elague.
//
// Les cinq tests couvrent :
//   A  sweep standard 360x640 sur toutes les pages publiques et joueur
//      (pas de scroll document ni de clip interne partout)
//   B  /admin : aucune cellule KPI rogee a 360 ET 390 (U-1b, pre-fix : la
//      card SORTIES ARBITRES rendait a right=380/395, hors viewport)
//   C  /admin : pas de commentaire technique rendu comme texte de page
//      (U-1a, pre-fix : "// Revenu ZOYD = la commission..." s'affichait)
//   D  tiroir 'Plus' de la BottomNav integrement contenu a 320x568
//      (U-3, pre-fix : la croix etait a top=-69, inatteignable)
//   E  libelles courts de la BottomNav a 360, sans ellipsis CSS, avec les
//      aria-labels longs intacts (U-2, pre-fix : 3 labels sur 5 tronques)
// ─────────────────────────────────────────────────────────────────────────────

const VIEWPORT_SWEEP = { width: 360, height: 640 } as const;
const VIEWPORT_ADMIN = { width: 390, height: 844 } as const;
const VIEWPORT_SHORT = { width: 320, height: 568 } as const;

// Pages publiques (aucune session requise). Les 6 pages legales + auth + mode
// + l'orpheline activate (rendue meme sans token : elle affiche son etat).
const PAGES_PUBLIC = [
  '/auth/login',
  '/auth/register',
  '/auth/activate',
  '/auth/forgot',
  '/mode',
  '/conditions',
  '/reglement-litiges',
  '/anti-fraude',
  '/confidentialite',
  '/mentions',
  '/jeu-responsable',
  // la route '*' : la page 404 est une page reelle a verifier aussi.
  '/page-inexistante-aucune-entree',
];

// Pages joueur (session quelconque). / et la racine de mode sont couvertes ici
// comme vues authentifiees (le contenu differe de la version publique).
const PAGES_PLAYER = [
  '/',
  '/profil',
  '/wallet',
  '/parametres',
  '/chat',
  '/mj',
  '/mj/creer',
  '/mj/tournois/creer',
  '/earnings',
  '/br',
  '/br-league',
  '/classements',
  '/infos',
];

/**
 * Connexion par la page rejouant le flux reel (meme pattern que
 * layout.spec.ts) : placeholder pseudo, placeholder mot de passe, Enter.
 */
const openApp = async (page: Page, identifiant: string, password: string) => {
  await page.goto('/auth/login');
  await page.getByPlaceholder(/ShadowX/).fill(identifiant);
  await page.getByPlaceholder(/^\.*$/).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20_000 });
  await page.getByPlaceholder(/^\.*$/).press('Enter');
  expect((await loginResponse).status()).toBe(200);
};

/**
 * Attend la stabilite du layout apres chargement. PAS de 'networkidle' :
 * en dev Vite, les websockets HMR et les pre-chargements empechent parfois
 * le repos de 500 ms requis, et l'attente flambe jusqu'a son timeout (60 s)
 * sans raison reelle (constate sur le premier run). 'load' + un settle
 * fixe suffit : les contenus qui mangent de la largeur (grilles, tabs)
 * sont synchrones de la structure, pas des donnees.
 */
const stable = async (page: Page) => {
  await page.waitForLoadState('load');
  await page.waitForTimeout(400);
};

/**
 * Sonde geometry : decrit ci-dessus (bloc d'en-tete du fichier). Renvoie la
 * liste des elements hors viewport non atteignables par un scroll horizontal.
 */
const scanOffenders = () => {
  const vw = window.innerWidth;
  const scrollable = ['auto', 'scroll'];
  const offenders: Array<{ tag: string; cls: string; right: number; left: number; text: string }> = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
    const css = typeof el.className === 'string' ? el.className : '';
    // Decors voulu rognes : la bande marquee et les blobs flous des heros.
    if (css && /animate-marquee|blur-\[/.test(css)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    // Un element lui-meme scrollable horizontalement (tabs a debordement
    // contenu, etc.) est legitime et atteignable : pas un clip.
    if (scrollable.includes(getComputedStyle(el).overflowX)) continue;
    let reachable = false;
    let node: Element | null = el.parentElement;
    while (node) {
      if (node === document.body) break;
      if (scrollable.includes(getComputedStyle(node).overflowX)) {
        reachable = true;
        break;
      }
      node = node.parentElement;
    }
    if (!reachable) {
      offenders.push({
        tag: el.tagName,
        cls: css.slice(0, 60),
        right: Math.round(r.right),
        left: Math.round(r.left),
        text: (el.textContent || '').trim().slice(0, 30),
      });
    }
  }
  return offenders;
};

const scanDocumentOverflow = () => {
  const doc = document.documentElement;
  const vw = window.innerWidth;
  return Math.max(doc.scrollWidth, document.body.scrollWidth, doc.clientWidth) > vw + 1;
};

/**
 * Libelles de la BottomNav passes par une troncature CSS ACTIVE (ellipsis
 * engagee : scrollWidth > clientWidth). Renvoie le DETAIL ({ text, sw, cw })
 * pour une identification immediate en cas d'echec, et [] sinon.
 *
 * Pourquoi des attentes lourdes autour d'une lecture simple :
 *   - la famille display (Outfit, theme.css:14) arrive par Google Fonts
 *     (fonts.css:1) : `document.fonts.ready` peut resoudre AVANT que le
 *     woff2 ne soit telecharge, et la lecture se fait alors avec les
 *     metriques de la police de substitution (plus larges), qui simulent
 *     une troncature fantasmee (constat : 1 libelle compte tronque dans un
 *     run alors qu'aucun ne l'est en regime etabli - la sonde live apres
 *     fonts charges montre sw == cw sur les cinq libelles) ;
 *   - apres l'eventuel swap de police, le reflow met une frame a se poser :
 *     on confirme sur deux lectures consecutives identiques.
 */
const libellesTronques = (page: Page) =>
  page.evaluate(async () => {
    const nav = [...document.querySelectorAll('nav')].find((n) => (n.className || '').includes('md:hidden'));
    if (!nav) throw new Error('nav basse (md:hidden) introuvable');
    const lire = () =>
      Array.from(nav.querySelectorAll('span'))
        .filter((s) => getComputedStyle(s).textOverflow === 'ellipsis' && s.scrollWidth > s.clientWidth)
        .map((s) => ({ text: (s.textContent || '').trim(), sw: s.scrollWidth, cw: s.clientWidth }));
    // Provoquer le chargement de la police EFFECTIVE des libelles : famille,
    // style, graisse et corps sont releves dans le computed du premier
    // libelle (ex. "italic 900 11px Outfit"), puis fonts.ready finalise.
    const libelle = nav.querySelector('a span');
    if (libelle) {
      const st = getComputedStyle(libelle);
      const familles = st.fontFamily
        .split(',')
        .map((f) => f.trim().replace(/^["']|["']$/g, ''))
        .filter((f) => f && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(f));
      await Promise.all(
        familles.map((f) =>
          document.fonts
            .load(`${st.fontStyle} ${st.fontWeight} ${st.fontSize} "${f}"`)
            .catch(() => undefined),
        ),
      );
      await document.fonts.ready;
    }
    // Stabilite : deux lectures consecutives identiques (cap ~2 s).
    let prev = JSON.stringify(lire());
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const cur = JSON.stringify(lire());
      if (cur === prev) return JSON.parse(cur);
      prev = cur;
    }
    return JSON.parse(prev);
  });

test.describe.configure({ mode: 'serial' });

let joueur: Actor = null as unknown as Actor;
let pseudoJoueur = '';
const MOT_DE_PASSE_JOUEUR = 'ZoydE2E!Player2026';

test.beforeAll(async () => {
  joueur = await registerPlayer('E2EUIRES');
  pseudoJoueur = joueur.pseudo;
});

test.afterAll(async () => {
  await disposeActors();
});

test.describe('Responsive mobile (sondes geometriques)', () => {
  test('A. aucune debordement ni clip interne sur les pages publiques et joueur en 360x640', async ({ page }) => {
    test.setTimeout(420_000);
    await page.setViewportSize(VIEWPORT_SWEEP);
    await openApp(page, pseudoJoueur, MOT_DE_PASSE_JOUEUR);
    for (const chemin of [...PAGES_PUBLIC, ...PAGES_PLAYER]) {
      // / (dashboard joueur) est deja couvert par la session ; les pages
      // publiques /auth/* rouvrent le formulaire sans casser la session.
      await page.goto(chemin);
      await stable(page);
      expect(await page.evaluate(scanDocumentOverflow), `scroll horizontal document sur ${chemin}`).toBeFalsy();
      expect(await page.evaluate(scanOffenders), `clips internes sur ${chemin}`).toEqual([]);
    }
  });

  test('B. /admin : aucune cellule KPI rogee, 360 puis 390 (U-1b)', async ({ page }) => {
    test.setTimeout(180_000);
    // La grille KPI rend ses fallbacks independamment des donnees (la carte
    // affiche 'indisponible' tant que les commissions ne sont pas lues),
    // la sonde est donc deterministe des que le layout est stable.
    for (const viewport of [VIEWPORT_SWEEP, VIEWPORT_ADMIN]) {
      await page.setViewportSize(viewport);
      await openApp(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/admin');
      await stable(page);
      // La grille KPI est rendue a la monte : on l'attend explicitement
      // avant de scanner (sinon le scan valide un DOM encore vide).
      await expect(page.getByText('SORTIES ARBITRES')).toBeVisible();
      const offenders = await page.evaluate(scanOffenders);
      // constat U-1 (pre-fix) : SORTIES ARBITRES rendait a right=380/395,
      // rogie par le masque horizontal, avec son hint coupe.
      expect(
        offenders,
        `clips internes sur /admin a ${viewport.width}px — detail: ${JSON.stringify(offenders.slice(0, 4))}`,
      ).toEqual([]);
    }
  });

  test('C. /admin : le commentaire de partition comptable n est pas rendu en texte (U-1a)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT_SWEEP);
    await openApp(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin');
    await stable(page);
    // Meme garde que B : le commentaire technique vit dans la grille KPI, on
    // attends qu'elle soit la pour capturer le texte.
    await expect(page.getByText('SORTIES ARBITRES')).toBeVisible();
    const bodyText = (await page.locator('body').textContent()) || '';
    expect(
      bodyText,
      "un commentaire technique (partition REVENUS/SORTIES) s'affiche comme texte de page",
    ).not.toContain('Revenu ZOYD = la commission');
  });

  test('D. tiroir Plus de la BottomNav contenu dans un ecran court 320x568 (U-3)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT_SHORT);
    await openApp(page, pseudoJoueur, MOT_DE_PASSE_JOUEUR);
    await page.goto('/profil');
    await stable(page);

    await page.getByLabel("Plus d'options", { exact: true }).click();
    const tiroir = page.locator('[role="dialog"][aria-label="Plus d\'options"]');
    await expect(tiroir).toBeVisible();

    // Le tiroir est anime (spring) : on attend sa POSE (deux lectures
    // marquees consecutives identiques) avant de mesurer, sinon un poll peut
    // attraper une frame de transition ou le tiroir transite par top=0
    // (l'ouverture part du bas de l'ecran et monte : elle depasse son top
    // final de facon transitoire). Pre-fix : pose a top=-82 (82 px hors
    // ecran en haut, croix inatteignable).
    const mesures = await tiroir.evaluate(async (el) => {
      const readTop = () => Math.round(el.getBoundingClientRect().top);
      let prev = readTop();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const cur = readTop();
        if (cur === prev) {
          const croix = el.querySelector('button[aria-label="Fermer le menu"]');
          const premier = el.querySelector('button[aria-label="Créer un match"]');
          return {
            top: cur,
            croixTop: croix ? Math.round(croix.getBoundingClientRect().top) : null,
            croixBottom: croix ? Math.round(croix.getBoundingClientRect().bottom) : null,
            premierTop: premier ? Math.round(premier.getBoundingClientRect().top) : null,
            premierBottom: premier ? Math.round(premier.getBoundingClientRect().bottom) : null,
          };
        }
        prev = cur;
      }
      return { top: prev, croixTop: null, croixBottom: null, premierTop: null, premierBottom: null };
    });

    // Le tiroir entierement dans le viewport (ni au-dessus, ni coupe en bas).
    expect(mesures.top, `${JSON.stringify(mesures)}`).toBeGreaterThanOrEqual(0);
    // La croix et le premier bouton ('Creer un match') atteignables.
    expect(mesures.croixTop).toBeGreaterThanOrEqual(0);
    expect(mesures.croixBottom).toBeLessThanOrEqual(VIEWPORT_SHORT.height);
    expect(mesures.premierTop).toBeGreaterThanOrEqual(0);
    expect(mesures.premierBottom).toBeLessThanOrEqual(VIEWPORT_SHORT.height);

    // Meme garde que E, a la hauteur de l'ecran court : aucun libelle de la
    // barre ne doit passer par une troncature CSS a 320 x 568. Le detail est
    // renvoye pour une identification immediate si la garde saute.
    const tronques320 = await libellesTronques(page);
    expect(tronques320, 'libelles tronques en 320').toEqual([]);
  });

  test('E. libelles courts de la BottomNav a 360 sans ellipsis, aria-labels longs intacts (U-2)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT_SWEEP);
    await openApp(page, pseudoJoueur, MOT_DE_PASSE_JOUEUR);
    await page.goto('/profil');
    await stable(page);

    // Texte visible de chaque entree de la nav basse.
    const labels = await page.evaluate(() => {
      const nav = [...document.querySelectorAll('nav')].find((n) => n.className.includes('md:hidden'));
      if (!nav) return [];
      return Array.from(nav.querySelectorAll('a,button')).map((el) => (el.textContent || '').trim().toUpperCase());
    });
    expect(labels, 'les libelles visibles doivent etre les versions courtes dediees').toEqual([
      'MULTI',
      'TOURNOI',
      'MSGS',
      'WALLET',
      'PLUS',
    ]);

    // Aucune troncature CSS active (les attentes de police et la stabilite
    // double-lecture vivent dans libellesTronques).
    const tronques = await libellesTronques(page);
    expect(tronques, 'libelles tronques en 360').toEqual([]);

    // Les destinations longues restent accessibles aux lecteurs d'ecran
    // (aria-label intact dans la nav basse; la Sidebar desktop montee dans le
    // DOM porte le meme aria-label, on cible donc nav.md:hidden explicitement).
    for (const label of ['MULTIJOUEUR', 'TOURNOIS', 'MESSAGES', 'WALLET']) {
      await expect(
        page.locator('nav.md\\:hidden').locator(`a[aria-label="${label}"]`),
        `aria-label ${label} intact`,
      ).toBeAttached();
    }
  });
});
