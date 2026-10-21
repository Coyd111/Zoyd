import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

/**
 * Une seule source de verite pour les statuts de match.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Les statuts etaient redecrites a CINQ endroits, dans deux langages, et les
 * listes ne se contredisaient pas de la meme facon :
 *
 * | Liste | awaiting_arbiter | awaiting_confirmation |
 * |---|---|---|
 * | serveur `ACTIVE_STATUSES` | absent | present |
 * | front `matchStore` `ACTIVE_STATUSES` | absent | present |
 * | front `DashboardPage` | present | ABSENT |
 *
 * Consequence, deux bugs de sens opposes :
 * - un match en attente d'arbitre disparait de la liste des matchs actifs du
 *   joueur (il est pourtant vivant, et son pot est bloque) ;
 * - un match en attente de confirmation disparait du tableau de bord (la
 *   cagnotte est gelee, le joueur doit pouvoir la voir).
 *
 * Le type `MatchStatus` du front ne contenait meme pas `archived`, que le
 * serveur ecrit pourtant via le cron d archivage.
 *
 * CE QUE CE TEST GARDE
 * --------------------
 * 1. Les ensembles sont coherents : un statut n est pas a la fois actif et
 *    clos, et aucun statut ne traine hors categorie.
 * 2. Le type du front et la source unique designent les MEMES statuts.
 * 3. Le serveur et le front importent la MEME source.
 * 4. Aucune liste de statuts locale ne peut reapparaitre dans les fichiers qui
 *    gerent le cycle de vie d un match.
 * 5. Les DEUX invariants que le correctif a etablis sont explicites, avec
 *    leur raison.
 *
 * Le point 4 est cadre sur les fichiers de match, VOLONTAIREMENT. Une garde
 * lexicale sur tout le depot signalait 139 faux positifs : les statuts de
 * tournoi, de ligue, de salon BR et de demande d ami sont des entites
 * differentes, avec leurs propres listes. Cadre, la garde attrape exactement
 * les cinq listes qui ont diverge.
 */

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..');

// `path.join` CONCATENE quand le second argument est absolu — il faut donc
// traiter les deux cas.
const lire = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(racine, p), 'utf8');

const source = JSON.parse(lire('shared/match-status.json'));
const TOUS = new Set(source.ALL);
const ACTIFS = new Set(source.ACTIVE);
const CLOS = new Set(source.CLOSED);
const HISTOIRE = new Set(source.HISTORY);

/**
 * Fichiers qui gerent le cycle de vie d un match. C'est le perimetre de la
 * garde « aucune liste locale ».
 */
const FICHIERS_STATUT_MATCH = [
  'server/match-engine.mjs',
  'server/match-status.mjs',
  'src/app/stores/matchStore.ts',
  'src/app/lib/matchStatus.ts',
  'src/app/pages/DashboardPage.tsx',
  'src/app/pages/AdminDashboardPage.tsx',
  'src/app/components/MatchCard.tsx',
  'src/features/match/pages/MatchDetailPage.tsx',
  'src/features/match/components/MatchHeader.tsx',
];

const rel = (f) => path.relative(racine, f).replace(/\\/g, '/');

/**
 * Statuts dont la PRESENCE dans un tableau definit une CLASSIFICATION de
 * cycle de vie (actif / clos / historique). Les autres statuts — `recruiting`,
 * `check_in`, `ready`, `in_progress` — apparaissent aussi dans des conditions
 * d action (« peut-il se pointer ? », « peut-il lancer ? ») qui ne sont pas
 * des classifications, et qu on ne doit pas forcer dans la source unique.
 */
const STATUTS_DE_CLASSIFICATION = new Set([
  'awaiting_arbiter',
  'awaiting_confirmation',
  'disputed',
  'finished',
  'forfeited',
  'archived',
]);

describe('Statuts de match — une seule source de verite', () => {
  it('la source unique declare des ensembles coherents', () => {
    // Un statut actif ne peut pas etre clos, et inversement.
    const chevauche = [...ACTIFS].filter((s) => CLOS.has(s));
    expect(chevauche, 'un statut ne peut pas etre a la fois actif et clos').toEqual([]);

    // L historique est un sous-ensemble de l ensemble connu.
    const hors = [...HISTOIRE].filter((s) => !TOUS.has(s));
    expect(hors, 'statuts d historique inconnus').toEqual([]);

    // Aucun statut ne doit trainer dans les limbes.
    const orphelins = [...TOUS].filter((s) => !ACTIFS.has(s) && !CLOS.has(s) && s !== 'disputed');
    expect(orphelins, 'statuts sans categorie').toEqual([]);
  });

  it('V3 : un match en attente d arbitre est ACTIF', () => {
    // Raison : l arbitre n est pas encore designe, donc le match ne peut pas
    // avancer — mais il vit, et son pot est bloque. Le retirer des matchs
    // actifs le fait disparaitre de l ecran du joueur, qui ne comprend alors
    // pas pourquoi son match ne demarre pas.
    expect(
      ACTIFS.has('awaiting_arbiter'),
      'awaiting_arbiter doit etre actif : le match vit et son pot est bloque'
    ).toBe(true);
  });

  it('V4 : un match archive est CLOS et reste dans l HISTORIQUE', () => {
    // Raison : un match archive par le cron est termine. S il n est pas clos,
    // la derivation de statut peut le reclasser actif, et il disparait de
    // l historique du joueur alors qu il a bien eu lieu.
    expect(CLOS.has('archived'), 'archived doit etre clos').toBe(true);
    expect(
      HISTOIRE.has('archived'),
      'archived doit rester dans l historique : le match a bien eu lieu'
    ).toBe(true);
  });

  it('un match en attente de confirmation reste ACTIF', () => {
    // La cagnotte est gelee : le joueur doit le voir.
    expect(ACTIFS.has('awaiting_confirmation')).toBe(true);
  });

  it("le type du front designe exactement les memes statuts que la source unique", () => {
    const typeFront = lire('src/app/lib/matchStatus.ts');
    const union = typeFront.match(/export type MatchStatus =([\s\S]*?);/);
    expect(union, 'type MatchStatus introuvable').toBeTruthy();
    const duType = new Set([...union[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

    const manquants = [...TOUS].filter((s) => !duType.has(s));
    const enTrop = [...duType].filter((s) => !TOUS.has(s));
    expect(manquants, 'statuts de la source unique absents du type du front').toEqual([]);
    expect(enTrop, 'statuts du type du front absents de la source unique').toEqual([]);
  });

  it('le serveur et le front importent la MEME source', () => {
    const moteur = lire('server/match-engine.mjs');
    expect(moteur, 'le moteur doit importer la source unique').toContain("from './match-status.mjs'");

    const moduleServeur = lire('server/match-status.mjs');
    expect(moduleServeur, 'le module serveur doit lire le JSON partage').toContain('shared/match-status.json');

    const libFront = lire('src/app/lib/matchStatus.ts');
    expect(libFront, 'le front doit importer le JSON partage').toContain('shared/match-status.json');
  });

  it('aucune liste de statuts locale ne peut reapparaitre dans les fichiers de match', () => {
    const coupables = [];
    for (const relatif of FICHIERS_STATUT_MATCH) {
      // Le module front des statuts est le point de declencheur : il peut
      // porter des ensembles supplementaires (file de priorite admin).
      if (relatif === 'src/app/lib/matchStatus.ts') continue;
      const fichier = path.join(racine, relatif);
      if (!fs.existsSync(fichier)) continue;
      const texte = lire(fichier);
      // Tableau litteral : ['a', 'b']
      const tableaux = texte.match(/\[[^[\]]*'([a-z_]+)'[^[\]]*\]/g) || [];
      for (const tableau of tableaux) {
        const elements = [...tableau.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
        if (elements.length < 2) continue;
        if (!elements.every((e) => TOUS.has(e))) continue;
        // Seules les listes de CLASSIFICATION sont interdites : une condition
        // d action (« peut-il se pointer ») n a pas sa place dans la source
        // unique, et n a pas vocation a y etre.
        if (!elements.some((e) => STATUTS_DE_CLASSIFICATION.has(e))) continue;
        coupables.push(`${rel(fichier)} : ${tableau.slice(0, 70)}`);
      }
    }
    expect(
      coupables,
      'liste de statuts locale detectee — utiliser shared/match-status.json'
    ).toEqual([]);
  });
});
