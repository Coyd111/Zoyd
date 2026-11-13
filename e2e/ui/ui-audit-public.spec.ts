import { test, expect } from '@playwright/test';
import {
  call,
  creditWallet,
  disposeActors,
  openAdminSession,
  registerPlayer,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  type Actor,
} from '../api/support/harness';
import { openApp, waitForRender } from './support/session';
import { auditerEcran, brancherSonde } from './support/audit';

/**
 * Audit UI des ecrans PUBLICS, du back-office et des ecrans de DETAIL.
 *
 * Ce que couvre ce fichier, et pourquoi ce n est pas deja couvert
 * ---------------------------------------------------------------
 *  1. Les pages publiques : le premier contact d un joueur. Elles sont
 *     simples en etats, mais TRES riches en liens et en texte legal : un
 *     ecran de CGU avec une liste de liens illisibles ou des cibles
 *     tactiles minuscules est un ecran que l on ne regarde jamais.
 *  2. Le back-office (`/admin`) : l ecran le plus dense de l application
 *     (grille de KPI, tableaux, filtres). Aucun audit ne le regardait.
 *  3. Les ecrans de DETAIL (`/mj/match/:id`, `/mj/tournois/:id`,
 *     `/br/:lobbyId`, `/br-league/:seasonId`, `/profil/:id`) : ce sont des
 *     routes variables, donc invisibles pour un audit qui se contente de
 *     suivre les liens de navigation. Un detail a 404 n est jamais
 *     atteignable par le menu, et c est pourtant par la que les joueurs
 *     arrivent (lien partage, notification).
 *
 * Les donnees de detail sont FABRIQUEES par l API avant les tests : sans
 * cela, les cinq ecransvariables tomberaient tous sur leur etat « introuvable »
 * et l audit ne mesurerait que la page d erreur, cinq fois de suite.
 *
 * La mesure est celle de `support/audit.ts`, partagee avec la passe
 * « ecrans authentifies » : une seule definition des criteres.
 */

/**
 * Mesure sur l etat STABILISE (animations coupees) : une animation en
 * cours fait baisser l opacite du texte et produit un FAUX POSITIF de
 * contraste. Voir le commentaire equivalent dans
 * `ui-audit-authenticated.spec.ts`.
 */
test.use({ reducedMotion: 'reduce' });

/** Les ecrans publics, parcourus SANS session. */
const ECRANS_PUBLICS = [
  { nom: 'Landing', chemin: '/' },
  { nom: 'Selection de mode', chemin: '/mode' },
  { nom: 'Connexion', chemin: '/auth/login' },
  { nom: 'Inscription', chemin: '/auth/register' },
  { nom: 'Mot de passe oublie', chemin: '/auth/forgot' },
  { nom: 'Activation', chemin: '/auth/activate' },
  { nom: 'Conditions', chemin: '/conditions' },
  { nom: 'Reglement et litiges', chemin: '/reglement-litiges' },
  { nom: 'Anti-fraude', chemin: '/anti-fraude' },
  { nom: 'Confidentialite', chemin: '/confidentialite' },
  { nom: 'Mentions legales', chemin: '/mentions' },
  { nom: 'Jeu responsable', chemin: '/jeu-responsable' },
  { nom: 'Classements (public)', chemin: '/classements' },
  { nom: 'Page 404', chemin: '/page-inexistante-aucune-entree' },
];

const MATCH_RULES = { mode: 'battle_royale', map: 'Nuketown', scoreTarget: 10, bestOf: 3 };
const TOURNAMENT_RULES = { mode: 'S&D', mapPool: ['Raid', 'Standoff'], scoreTarget: 7, bestOf: 1 };
const BR_PAYOUT = { first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08, arbiterRate: 0.03 };
const dans24h = () => new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();

let joueur: Actor;
let ami: Actor;
let matchId = '';
let tournamentId = '';
let lobbyId = '';
let seasonId = '';

test.beforeAll(async () => {
  joueur = await registerPlayer('E2EUIP');
  ami = await registerPlayer('E2EUIF');

  const admin = await openAdminSession();
  // Le createur d un match paie son propre passe : le solde doit exister
  // AVANT la creation, sinon la page de detail n aurait rien a montrer.
  await creditWallet(admin, joueur.id, 1_000);

  const match = await call(joueur, 'POST', '/api/matches', {
    format: '1VS1',
    entryFee: 100,
    rules: MATCH_RULES,
    visibility: 'public',
  });
  expect(match.status, `creation du match : ${JSON.stringify(match.body)}`).toBe(201);
  matchId = match.body.match.id;

  const tournoi = await call(joueur, 'POST', '/api/tournaments', {
    name: 'Tournoi audit UI',
    format: '2VS2',
    entryFee: 100,
    maxEntries: 2,
    rules: TOURNAMENT_RULES,
    reserveCreatorAsArbiter: true,
  });
  expect(tournoi.status, `creation du tournoi : ${JSON.stringify(tournoi.body)}`).toBe(201);
  tournamentId = tournoi.body.tournament.id;

  const salon = await call(joueur, 'POST', '/api/br/lobbies', {
    name: 'Salon audit UI',
    mode: 'solo',
    map: 'isolated',
    entryFee: 50,
    scheduledAt: dans24h(),
    payout: BR_PAYOUT,
  });
  expect(salon.status, `creation du salon BR : ${JSON.stringify(salon.body)}`).toBe(201);
  lobbyId = salon.body.lobby.id;

  const saison = await call(admin, 'POST', '/api/leagues', {});
  expect(saison.status, `creation de la saison : ${JSON.stringify(saison.body)}`).toBe(201);
  seasonId = saison.body.season.id;

  // Le profil public `/profil/:id` ne resout un joueur que s il est dans
  // la liste d amis du visiteur (le serveur ne livre pas le pseudo d un
  // tiers). Sans ce lien, la page afficherait son etat « indisponible » et
  // l audit ne mesurerait pas le profil.
  const demande = await call(ami, 'POST', '/api/social/request', { targetId: joueur.id });
  expect(demande.status, `demande d ami : ${JSON.stringify(demande.body)}`).toBe(200);
  const enAttente = await call(joueur, 'GET', '/api/social/pending');
  expect(enAttente.status).toBe(200);
  const requete = enAttente.body.requests[0];
  expect(requete, 'la demande d ami doit etre recue').toBeTruthy();
  const acceptation = await call(joueur, 'POST', '/api/social/accept', {
    requestId: requete.id ?? requete.requestId,
  });
  expect(acceptation.status, `acceptation : ${JSON.stringify(acceptation.body)}`).toBe(200);
});

test.afterAll(async () => {
  await disposeActors();
});

test.describe('Audit UI - ecrans publics (anonyme)', () => {
  for (const ecran of ECRANS_PUBLICS) {
    test(`${ecran.nom} (${ecran.chemin})`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);

      // Ecran ANONYME : la sonde `/api/auth/me` renvoie 401, c est normal.
      const collecte = brancherSonde(page, { anonyme: true });

      await page.goto(ecran.chemin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitForRender(page);

      const { rapport } = await auditerEcran(
        page,
        { ...ecran, tentative: testInfo.retry },
        collecte,
      );

      expect(
        rapport,
        `Audit UI de « ${ecran.nom} » (${ecran.chemin}) :\n\n${rapport || 'aucun defaut detecte'}`,
      ).toBe('');
    });
  }
});

test.describe('Audit UI - back-office et ecrans de detail', () => {
  test('Administration (/admin)', async ({ page }) => {
    test.setTimeout(180_000);

    await openApp(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // 403 ATTENDU sur les trois lectures protegees par la 2FA admin : la
    // session du navigateur n a pas valide le code TOTP. Le back-office
    // affiche « N/D » et invite a revalider la 2FA — c est l etat
    // normal du panneau, pas un defaut.
    const collecte = brancherSonde(page, {
      attendus403: ['/api/admin/commissions', '/api/admin/reports', '/api/admin/sanctions'],
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForRender(page);
    // La grille KPI se remplit apres coup : on attend son contenu, sinon
    // la sonde validerait un DOM encore vide.
    await expect(page.getByText('SORTIES ARBITRES')).toBeVisible({ timeout: 30_000 });

    const { rapport } = await auditerEcran(page, { nom: 'Administration', chemin: '/admin' }, collecte);

    expect(
      rapport,
      `Audit UI de « Administration » (/admin) :\n\n${rapport || 'aucun defaut detecte'}`,
    ).toBe('');
  });

  // Les ecrans de detail : chaque route variable a son identifiant.
  // `id` est resolu AU MOMENT du test (les fixtures sont creees en
  // `beforeAll`), pas a la declaration du tableau.
  const DETAILS: Array<{ nom: string; base: string; chemin: () => string }> = [
    { nom: 'Detail du match', base: '/mj/match/:id', chemin: () => `/mj/match/${matchId}` },
    { nom: 'Bracket du tournoi', base: '/mj/tournois/:id', chemin: () => `/mj/tournois/${tournamentId}` },
    { nom: 'Salon BR', base: '/br/:lobbyId', chemin: () => `/br/${lobbyId}` },
    { nom: 'Saison BR League', base: '/br-league/:seasonId', chemin: () => `/br-league/${seasonId}` },
    { nom: 'Profil public', base: '/profil/:id', chemin: () => `/profil/${ami.id}` },
  ];

  for (const detail of DETAILS) {
    test(`${detail.nom} (${detail.base})`, async ({ page }) => {
      test.setTimeout(180_000);

      await openApp(page, joueur.pseudo, 'ZoydE2E!Player2026');
      const collecte = brancherSonde(page);

      const chemin = detail.chemin();

      await page.goto(chemin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitForRender(page);

      const { rapport } = await auditerEcran(page, { nom: detail.nom, chemin }, collecte);

      expect(
        rapport,
        `Audit UI de « ${detail.nom} » (${chemin}) :\n\n${rapport || 'aucun defaut detecte'}`,
      ).toBe('');
    });
  }
});
