import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Le plancher de contraste du texte - une REGLE, pas une liste.
 *
 * Le constat
 * ----------
 * L audit UI a trouve 19 textes a `text-white/40` ou `text-white/30`, sur
 * neuf fichiers. Sur les fonds de l application (`zoyd-black` #050505,
 * `black` #000), le blanc a 40 % d opacite plafonne a ~3,6:1 et a 30 % a
 * ~2,5:1 : les deux sont SOUS le 4,5:1 qu exige WCAG 1.4.3 pour du texte
 * courant. Un seul ecran (la page de selection de mode) portait un
 * `text-white/46` : meme famille, memeInterpolation.
 *
 * Coriger les cas laisse le piege : le prochain ecran introduit
 * `text-white/40` et rien ne le signale. D ou une REGLE.
 *
 * La regle
 * --------
 * 1. Un TEXTE ne descend pas sous 50 % d opacite (~5,3:1 sur fond quasi
 *    noir) - sauf si la ligne porte un marqueur `/* CONTRASTE-OK: ... *\/`
 *    qui donne la raison.
 * 2. Une ICONE (un composant auto-fermant : `<Bell className="..." />`) a
 *    un plancher plus bas, 40 % (~3,7:1) : WCAG 1.4.11 exige 3:1 pour un
 *    graphisme porteur de sens, et une illustration d etat vide en porte
 *    un (elle dit « il n y a rien ici »).
 *
 * Pourquoi une exception ecrite plutot qu une interdiction totale : WCAG
 * 1.4.3 exempte explicitement le texte incident et les composants
 * desactives. Interdire categoriquement une valeur legitimate obligerait un
 * jour a violer la norme. La marqueur impose d ecrire la raison - c est
 * la que se joue la relecture.
 */

/** Plancher du texte, en pourcentage d opacite. */
const PLANCHER_TEXTE = 50;
/** Plancher d une icone, en pourcentage d opacite. */
const PLANCHER_ICONE = 40;
/** Marqueur d exception, accompanied de sa raison. */
const MARQUEUR = 'CONTRASTE-OK:';

const racine = resolve('src');
const fichiers: string[] = [];

const parcourir = (dossier: string) => {
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      parcourir(chemin);
      continue;
    }
    if (!entree.name.endsWith('.tsx')) continue;
    if (entree.name.endsWith('.test.tsx')) continue;
    fichiers.push(chemin);
  }
};
parcourir(racine);

/**
 * La classe de couleur porte-t-elle une opacite sous le plancher ?
 * Renvoie l opacite trouvee, ou null.
 */
const opaciteDe = (ligne: string): number | null => {
  const m = /text-[a-z-]+\/(\d+)/.exec(ligne);
  if (!m) return null;
  const valeur = Number(m[1]);
  return Number.isNaN(valeur) ? null : valeur;
};

/**
 * La classe est-elle portee par une ICONE ?
 *
 * On remonte a la balise ouvrante la plus proche AVANT la classe : un
 * nom de composant en majuscule (`<Bell`, `<Calendar`) est une icone, un
 * nom en minuscule (`<div`, `<button`, `<span`) est du texte ou un
 * conteneur.
 */
const estIcone = (ligne: string, position: number): boolean => {
  const avant = ligne.slice(0, position);
  const dernier = avant.lastIndexOf('<');
  if (dernier === -1) return false;
  const m = /^<\s*([A-Za-z][A-Za-z0-9]*)/.exec(avant.slice(dernier));
  if (!m) return false;
  return /^[A-Z]/.test(m[1]);
};

describe('Plancher de contraste du texte', () => {
  it('la regle a des fichiers a inspecter (sinon elle ne verifierait rien)', () => {
    expect(fichiers.length).toBeGreaterThan(20);
  });

  it('aucun texte ne descend sous 50 % d opacite (icones : 40 %)', () => {
    const coupables: string[] = [];

    for (const fichier of fichiers) {
      const source = readFileSync(fichier, 'utf8');
      const lignes = source.split(/\r?\n/);

      for (let i = 0; i < lignes.length; i += 1) {
        const ligne = lignes[i];
        if (ligne.includes(MARQUEUR)) continue;

        const opacite = opaciteDe(ligne);
        if (opacite === null) continue;

        const position = ligne.indexOf('/');
        const plancher = estIcone(ligne, position) ? PLANCHER_ICONE : PLANCHER_TEXTE;
        if (opacite >= plancher) continue;

        coupables.push(
          `${fichier.replace(racine, 'src')}:${i + 1}  ${opacite} % < ${plancher} %  ${ligne.trim().slice(0, 90)}`,
        );
      }
    }

    expect(
      coupables.length,
      'texte sous le plancher de contraste (WCAG 1.4.3 / 1.4.11) - '
      + 'ou une marqueur `CONTRASTE-OK:` avec la raison :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });

  it('la regle distingue bien une icone d un texte', () => {
    expect(estIcone('<Bell className="w-8 h-8 text-white/40" />', 10)).toBe(true);
    expect(estIcone('<div className="text-white/40">', 10)).toBe(false);
    expect(estIcone('<button className="text-white/10">', 10)).toBe(false);
    // Multi-lignes : la balise ouvrante est plus haut.
    expect(estIcone('    className="text-white/40 mx-auto"', 10)).toBe(false);
  });

  it('le cas reel est corrige (plus aucune occurrence de 40 % sur du texte)', () => {
    // La page de selection de mode portait `text-white/46` : meme famille,
    // meme interpolation, et l audit ne l avait PAS signalee (46 % n est
    // pas un motif recherche par la sonde). C est precisement ce que la
    // regle couvrant TOUT le source apporte.
    const mode = readFileSync(resolve('src/app/pages/ModeSelectionPage.tsx'), 'utf8');
    expect(mode).not.toMatch(/text-white\/46/);
  });

  it('le jeton « muted » du design system respecte le plancher du texte', () => {
    // Un jeton de couleur ne se verifie pas a l oeil. `--color-zoyd-muted`
    // valait 40 % d opacite (~3,6:1) : sous le 4,5:1 de WCAG 1.4.3, et
    // il s'appliquait a TOUT le texte « secondaire » de l application.
    const theme = readFileSync(resolve('src/styles/theme.css'), 'utf8');
    const m = /--color-zoyd-muted:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)/.exec(theme);
    expect(m, 'le jeton --color-zoyd-muted doit etre explicite').not.toBeNull();
    const opacite = Number(m![1]);
    expect(
      opacite,
      `le jeton --color-zoyd-muted est a ${opacite * 100} % d opacite : `
      + `en dessous de ${PLANCHER_TEXTE} %, le texte secondaire n est pas lisible`,
    ).toBeGreaterThanOrEqual(PLANCHER_TEXTE / 100);
  });
});
