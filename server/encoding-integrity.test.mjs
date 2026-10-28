import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Détection du double encodage UTF-8 (mojibake).
 *
 * Comment c'est arrivé
 * -------------------
 * Deux fois pendant cette session, un fichier source a été corrompu de la même
 * manière : relu avec `Get-Content -Raw` — qui décode avec la page de code
 * ANSI — puis réécrit en UTF-8. Les accents deja présents devenaient
 * « Ã¨ » / « Â§ » : le fichier passait encore `node --check` et les tests, et
 * l'erreur n'apparaissait qu'au lint, sous le nom opaque « irregular
 * whitespace ».
 *
 * Pire : le contenu devient illisible pour l'auteur, donc les commentaires
 * qui expliquent les invariants cessent d'expliquer quoi que ce soit. Sur ce
 * dépôt, les commentaires portent une partie de la charge — plusieurs
 * corrections n'ont de sens que parce qu'on lit pourquoi.
 *
 * Ce test échoue vite et sans ambiguïté, au lieu d'être découvert par le lint
 * ou pire, par un commit.
 */

/** Séquences typiques d'un texte UTF-8 relu en Latin-1 puis réécrit en UTF-8. */
const SIGNE_MOJIBAKE = /Ã[\x80-\xBF-¿]|Â[\x80-\xBF-¿]|â€[\x80-\xBF-¿]|ï»¿|Ã©|Ã¨|Ã |Â |â€™|â€œ|â€/;

const PARCOURIR = (racine, extensions, accumulator = []) => {
  for (const nom of readdirSync(racine)) {
    if (nom === 'node_modules' || nom === '.git' || nom === 'dist' || nom === 'test-results') continue;
    const chemin = join(racine, nom);
    if (statSync(chemin).isDirectory()) {
      PARCOURIR(chemin, extensions, accumulator);
    } else if (extensions.includes(extname(chemin))) {
      accumulator.push(chemin);
    }
  }
  return accumulator;
};

describe('Integrite de l encodage des sources', () => {
  it('aucun fichier source ne contient de double encodage', () => {
    const fichiers = PARCOURIR('.', ['.mjs', '.ts', '.tsx', '.js', '.sql']);
    expect(fichiers.length, 'des fichiers doivent etre analyses').toBeGreaterThan(20);

    // Ce fichier CONTIENT les signatures qu'il cherche : il se signalerait
    // lui-meme. On l'exclut explicitement plutot que d'elargir la regex, sinon
    // le filtre deviendrait si permissif qu'il ne detecterait plus rien.
    const SOI_MEME = 'encoding-integrity.test.mjs';
    const corrompus = [];
    for (const fichier of fichiers) {
      if (fichier.endsWith(SOI_MEME)) continue;
      let contenu;
      try {
        contenu = readFileSync(fichier, 'utf8');
      } catch {
        continue;
      }
      if (SIGNE_MOJIBAKE.test(contenu)) corrompus.push(fichier);
    }

    expect(corrompus.length, 'fichiers a reparer un par un : ' + corrompus.join(', ')).toBe(0);
  });

  it('aucun fichier source ne contient de caractere de remplacement U+FFFD', () => {
    // P15 C4 (audit-3) : contrairement au double encodage ci-dessus, un
    // U+FFFD (replacement character) est irrécupérable — les octets d'origine
    // sont déjà perdus, remplacés au décodage. Invisible au `node --check`
    // comme au lint, il ne trébuche qu'à la relecture de l'invariant
    // documenté. Deux occurrences vécues : `e2e/api/admin-reports.spec.ts`
    // (garde anti-takeover) et `server/rate-limiter.test.mjs` (quota auth).
    const FFFD = /\uFFFD/;
    const fichiers = PARCOURIR('.', ['.mjs', '.ts', '.tsx', '.js', '.sql']);
    const corrompus = [];
    for (const fichier of fichiers) {
      let contenu;
      try {
        contenu = readFileSync(fichier, 'utf8');
      } catch {
        continue;
      }
      if (FFFD.test(contenu)) corrompus.push(fichier);
    }
    expect(corrompus.length, 'fichiers a reparer un par un : ' + corrompus.join(', ')).toBe(0);
  });

  it('les sources critiques sont bien en UTF-8 lisible', () => {
    // Contrôle ciblé : ces fichiers portent l'encodage des accents dans leurs
    // commentaires d'invariant, et une régression y serait particulièrement
    // coûteuse à diagnostiquer plus tard.
    const cibles = [
      'server/persistence.mjs',
      'server/wallet-engine.mjs',
      'server/routes/wallet.mjs',
      'supabase/schema.sql',
    ];
    for (const fichier of cibles) {
      const contenu = readFileSync(fichier, 'utf8');
      expect(SIGNE_MOJIBAKE.test(contenu), `${fichier} est corrompu`).toBe(false);
      // `é` doit survivre au aller-retour : preuve directe que l'accent est
      // stocké en UTF-8 et pas en Latin-1 déguisé.
      expect(contenu.includes('é') || contenu.includes('É'), `${fichier} ne contient aucun accent UTF-8`).toBe(true);
    }
  });
});