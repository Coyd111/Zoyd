import { test, expect } from '@playwright/test';
import { registerPlayer, disposeActors, type Actor } from '../api/support/harness';
import { openApp, waitForRender } from './support/session';
import { auditerEcran, brancherSonde } from './support/audit';
import { creerSalonBr } from './support/fixtures';

/**
 * Audit UI des ecrans AUTHENTIFIES.
 *
 * Le trou que ce fichier comble
 * ----------------------------
 * L audit d accessibilite existant (`accessibility.spec.ts`) ne couvre que
 * CINQ pages publiques : accueil, connexion, inscription, mot de passe
 * oublie, selection de mode. Les ecrans ou les joueurs passent reellement
 * leur temps - hub, portefeuille, detail d un match, chat, tournois,
 * BR, ligue, reglages, gains, profil - n etaient analyses par PERSONNE.
 *
 * Les ecrans publics sont, par construction, les plus simples a tenir
 * (peu d etats, peu de donnees). Les ecrans authentifies sont les plus
 * complexes : listes vides, soldes, compteurs, erreurs de chargement.
 *
 * Ce que le test mesure, par ecran
 * -------------------------------
 *  1. Les violations axe-core bloquantes (serious / critical).
 *  2. Les images sans attribut `alt` (une image decorative DOIT avoir
 *    `alt=""` ; une image porteuse de sens doit avoir une alternative).
 *  3. Les elements interactifs sans nom accessible (bouton, lien, champ).
 *  4. Les cibles tactiles trop petites. WCAG 2.2 AA (2.5.8) exige
 *    24x24 px ; 44x44 est le confort tactile attendu sur mobile.
 *  5. Les erreurs JavaScript de la console et les reponses HTTP en erreur.
 *
 * Le rapport nomme le fichier et le detail : un audit qui dit « violation »
 * sans dire OU n est pas un audit, c est un constat.
 *
 * La mesure elle-meme est partagee avec la passe « ecrans publics »
 * (`support/audit.ts`) : deux copies divergeraient, et la seconde cesserait
 * de couvrir un critere sans que personne ne s en apercoive.
 */

/**
 * Mesure sur l etat STABILISE.
 *
 * PIEGE : les cartes du hub BR entrent en scene avec un `motion.div`
 * (`initial="hidden"`, `variants={staggerItem}`). Pendant l animation,
 * l opacite du texte est inferieure a 1 : axe compose alors le texte
 * avec le fond et mesure un contraste de 1,2:1 ou 3,5:1 - un FAUX
 * POSITIF pur et simple, reproduit de facon aleatoire selon le nombre de
 * cartes et le debit de l animation.
 *
 * `reducedMotion: 'reduce'` desactive ces animations (l application
 * respecte deja la preference : `MotionConfig reducedMotion="user"`).
 * On mesure donc l etat final, celui que voit un joueur qui a coupe les
 * animations - et celui qui est seul pertinent pour un contraste.
 */
test.use({ reducedMotion: 'reduce' });

/** Les ecrans authentifies, avec le titre attendu (garde anti-404). */
const ECRANS = [
  { nom: 'Hub MJ', chemin: '/mj' },
  { nom: 'Creer un match', chemin: '/mj/creer' },
  { nom: 'Tournois', chemin: '/mj/tournois' },
  { nom: 'Creer un tournoi', chemin: '/mj/tournois/creer' },
  { nom: 'Portefeuille', chemin: '/wallet' },
  { nom: 'Gains', chemin: '/earnings' },
  { nom: 'Chat', chemin: '/chat' },
  { nom: 'Profil', chemin: '/profil' },
  { nom: 'Parametres', chemin: '/parametres' },
  { nom: 'Battle Royale', chemin: '/br' },
  { nom: 'BR League', chemin: '/br-league' },
  { nom: 'Infos', chemin: '/infos' },
  { nom: 'Classements', chemin: '/classements' },
];

let joueur: Actor;

test.beforeAll(async () => {
  joueur = await registerPlayer('E2EUI');
  // `/br` n affiche ses CARTES que s il existe un salon. Sans ce salon,
  // l ecran mesurait un etat vide - et les defauts des cartes (contraste
  // du texte secondaire, libelle du bouton d inscription) n etaient
  // visibles QUE si une AUTRE serie avait cree un salon avant, dans le
  // meme processus. La couverture ne doit pas dependre de l ordre.
  await creerSalonBr(joueur);
});

test.afterAll(async () => {
  await disposeActors();
});

test.describe('Audit UI - ecrans authentifies', () => {
  for (const ecran of ECRANS) {
    test(`${ecran.nom} (${ecran.chemin})`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);

      await openApp(page, joueur.pseudo, 'ZoydE2E!Player2026');
      // La sonde est posee APRES la connexion : la page de connexion appelle
      // `/api/auth/me` en montant, et la reponse 401 de cet appel-la est
      // ATTENDUE (personne n est connecte a ce moment-la).
      const collecte = brancherSonde(page);

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
