import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Le budget des polices - verrou de performance.
 *
 * Pourquoi
 * -------
 * Quatre fontes variables sont chargees sur chaque page (Outfit, Inter,
 * JetBrains Mono normal et italique). Les fichiers d origine venaient de
 * Google Fonts avec l axe complet et toutes les tables OpenType : 161 Ko
 * transferes au premier ecran. Les jeux sont donc sous-ensemble : seuls
 * les caracteres latins declares, les variantes de graisse reellement
 * utilisees et les fonctions de composition utiles.
 *
 * INVARIANT : le latin (U+0000-00FF) couvre les accents employes par
 * l interface, y compris les ligatures U+0152-0153 (OE/oe). Comme dans
 * les fichiers Google Fonts d origine, le Y trema majuscule (U+0178)
 * reste servi par latin-ext : il ne faut pas le faire disparaitre en
 * retrecissant arbitrairement cette plage.
 *
 * PIEGE : un budget mesure en octets depend de l encodeur. On garde une
 * marge (31 Ko par fichier latin) pour ne pas casser au premier reglage
 * de qualite Brotli, sans laisser passer un retour aux fichiers pleins.
 */
const FONTS_CSS = readFileSync(resolve('src/styles/fonts.css'), 'utf8');
const RACINE = resolve('public');

const fichiers = [...FONTS_CSS.matchAll(/url\('(\/fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1]);
const blocs = FONTS_CSS.split('@font-face').slice(1).map((bloc) => bloc.split('}')[0]);

const estLatin = (bloc: string) => /unicode-range:[^;]*U\+0000-00FF/.test(bloc);

describe('Budget des polices', () => {
  it('chaque fonte declaree existe sur le disque', () => {
    const manquantes = fichiers.filter((url) => !existsSync(join(RACINE, url)));
    expect(manquantes, `fontes declarees mais absentes :\n  ${manquantes.join('\n  ')}`).toEqual([]);
  });

  it('chaque sous-ensemble latin tient dans 31 Ko', () => {
    const trop = blocs
      .filter(estLatin)
      .map((bloc) => {
        const url = /url\('(\/fonts\/[^']+)'\)/.exec(bloc)?.[1];
        return url ? { url, taille: statSync(join(RACINE, url)).size } : null;
      })
      .filter((entree): entree is { url: string; taille: number } => entree !== null)
      .filter((entree) => entree.taille > 31 * 1024)
      .map((entree) => `${entree.url} = ${(entree.taille / 1024).toFixed(1)} Ko`);

    expect(trop, `fontes latines au-dessus du budget :\n  ${trop.join('\n  ')}`).toEqual([]);
  });

  it('les quatre fontes latines cumulees tiennent dans 122 Ko', () => {
    const total = blocs
      .filter(estLatin)
      .reduce((somme, bloc) => {
        const url = /url\('(\/fonts\/[^']+)'\)/.exec(bloc)?.[1];
        return url && existsSync(join(RACINE, url)) ? somme + statSync(join(RACINE, url)).size : somme;
      }, 0);
    expect(total / 1024).toBeLessThanOrEqual(122);
  });

  it('le latin couvre les accents de l interface et les ligatures OE', () => {
    const latins = blocs.filter(estLatin);
    expect(latins.length).toBe(4);
    for (const bloc of latins) {
      expect(bloc).toContain('U+0000-00FF');
      expect(bloc).toContain('U+0152-0153');
    }
  });
});
