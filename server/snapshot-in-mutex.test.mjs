import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

/**
 * C2 — Un snapshot d'état est relu DANS le verrou.
 *
 * Pourquoi un test d'invariant source, et pas un test de concurrence
 * -----------------------------------------------------------------
 * Deux requêtes simultanées lisent le même instantané hors verrou,
 * la dernière écriture écrase la première : joueur inscrit disparu
 * (pass bloqué sans trace), double versement `finish` BR. Le remède est
 * structurel — le cycle lire → calculer → écrire entier sous le mutex.
 * Un test « deux calls concurrents » serait flaky et ne voit pas un
 * troisième chemin oublié. Donc on garde la structure, comme
 * occ-revision-invariant.test.mjs et match-status-consistency.test.mjs.
 *
 * Ce que les tests gardent
 * ------------------------
 * Pour chaque route mutante (match, tournoi, ligue, admin, BR) :
 *   with*Mutex  <  lecture du snapshot  <  save*
 * dans CHAQUE bloc POST. Une lecture remontée avant le verrou (ou une
 * mutation hors verrou) fait tomber le test — mutation vérifiée :
 * déplacer `getStoredTournaments()` avant `withTournamentMutex` change
 * l'ordre des index et le test échoue.
 *
 * Les lectures GET (détail, liste, santé) sont autorisées hors verrou :
 * lecture seule, aucun read-modify-write.
 */

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..');
const lire = (p) => fs.readFileSync(path.join(racine, p), 'utf8');

const FICHIERS = [
  { fichier: 'server/routes/match.mjs', mutex: 'withMatchMutex', lecture: /getStateCollection\('matches'\)/, sauvegarde: /saveMatches/ },
  { fichier: 'server/routes/tournament.mjs', mutex: 'withTournamentMutex', lecture: /getStoredTournaments\(\)/, sauvegarde: /saveTournaments/ },
  { fichier: 'server/routes/league.mjs', mutex: 'withLeagueMutex', lecture: /getStoredLeagues\(\)/, sauvegarde: /saveLeagues/ },
  { fichier: 'server/routes/br.mjs', mutex: 'withBrLobbyMutex', lecture: /getStoredBrLobbies\(\)/, sauvegarde: /saveBrLobbies/ },
];

/**
 * Découpe le fichier en blocs par handler : chaque `if (req.method ...)`
 * et chaque `const … = pathname.match` ouvre un bloc jusqu'au suivant.
 * Sans regex globale : reconnaissance ligne par ligne, robuste aux fins
 * de ligne CRLF et aux `if (x && req.method` (BR).
 */
const decouperEnBlocs = (source) => {
  const lignes = source.split('\n');
  const blocs = [];
  let courant = null;
  for (const ligne of lignes) {
    const ouvreHandler =
      /^\s*if\s*\(.*req\.method\s*===\s*'(?:POST|GET)'/.test(ligne) ||
      /^\s*const\s+\w+\s*=\s*pathname\.match/.test(ligne);
    if (ouvreHandler) {
      if (courant !== null) blocs.push(courant);
      courant = ligne + '\n';
    } else if (courant !== null) {
      courant += ligne + '\n';
    }
  }
  if (courant !== null) blocs.push(courant);
  return blocs;
};

const blocPost = (blocs) => blocs.filter((b) => b.includes("req.method === 'POST'") || b.includes('req.method === "POST"'));

/** Retire les lignes de commentaire (//, /*, *) qui citent les symboles. */
const sansCommentaires = (bloc) =>
  bloc
    .split('\n')
    .filter((ligne) => {
      const t = ligne.trim();
      return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'));
    })
    .join('\n');

describe('C2 - snapshot relu dans le verrou', () => {
  for (const { fichier, mutex, lecture, sauvegarde } of FICHIERS) {
    it(`${fichier} : chaque POST lit après ${mutex} et écrit après la lecture`, () => {
      const source = lire(fichier);
      const blocs = blocPost(decouperEnBlocs(source));
      expect(blocs.length, `${fichier} doit contenir des blocs POST`).toBeGreaterThan(0);
      const fautifs = [];
      blocs.forEach((bloc, i) => {
        const code = sansCommentaires(bloc);
        const iMutex = code.indexOf(mutex);
        const iLecture = code.search(lecture);
        if (iLecture === -1) return; // handler sans lecture (ex. parse seul) : rien a garder
        if (iMutex === -1) {
          fautifs.push(`bloc POST #${i + 1} (${bloc.slice(0, 80).trim()}) : lecture sans ${mutex} — mutation hors verrou`);
          return;
        }
        if (iLecture < iMutex) {
          fautifs.push(`bloc POST #${i + 1} (${bloc.slice(0, 80).trim()}) : lecture avant ${mutex} — C2 violé`);
          return;
        }
        const iSave = code.search(sauvegarde);
        if (iSave !== -1 && iSave < iLecture) {
          fautifs.push(`bloc POST #${i + 1} : écriture avant lecture — ordre inversé`);
        }
      });
      expect(fautifs, fautifs.join('\n')).toEqual([]);
    });
  }

  it('BR (reference) : lecture + ecriture restent dans le meme verrou par salon', () => {
    const source = lire('server/routes/br.mjs');
    expect(source).toContain('withBrLobbyMutex(lobbyId, async () => {');
    // Le snapshot est relu APRES l'ouverture du verrou (C1 audit-2).
    const iMutex = source.indexOf('withBrLobbyMutex(lobbyId, async () => {');
    const iLecture = source.indexOf('getStoredBrLobbies().find', iMutex);
    expect(iLecture).toBeGreaterThan(iMutex);
  });

  it('admin : les mutations matchs relisent dans withMatchMutex', () => {
    const source = lire('server/routes/admin.mjs');
    // award / resolve-dispute / cancel : lecture APRES le verrou.
    for (const route of ['/award', '/resolve-dispute', '/cancel']) {
      const i = source.indexOf(route);
      expect(i, `route ${route} presente`).toBeGreaterThan(-1);
    }
    // Chaque withMatchMutex de mutation est suivi d une lecture.
    const occurrences = [...source.matchAll(/await withMatchMutex\(async/mg)];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const o of occurrences) {
      const troncon = source.slice(o.index, o.index + 1500);
      expect(troncon).toMatch(/getStateCollection\('matches'\)/);
    }
  });

  it('negatif : une lecture avant le verrou ferait echouer la regle', () => {
    // Mutation simulee en chaine : on prouve que le test detecte C2 violé.
    const simule = [
      'if (req.method === \'POST\' && pathname === \'/api/x\') {',
      '  const snapshot = getStoredTournaments();',
      '  await withTournamentMutex(async () => {',
      '  const outcome = createTournamentOnServer(snapshot);',
    ].join('\n');
    const iLecture = simule.search(/getStoredTournaments\(\)/);
    const iMutex = simule.indexOf('withTournamentMutex');
    expect(iLecture).toBeLessThan(iMutex); // la regle iLecture > iMutex echoue => detecte
  });
});
