import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Le systeme d'images : un catalogue declare, une source pour chaque
 * visuel, aucun chemin ecrit en dur.
 *
 * Pourquoi ce verrou
 * -----------------
 * Les visuels du site etaient des chemins ecrits en dur, repartis dans
 * une dizaine d'ecrans. On ne savait plus quoi montrait quoi, ni d ou
 * ca venait, et le meme visuel etait copie sous plusieurs noms (quatre
 * doublons exacts, jamais references).
 *
 * Cinq garanties :
 *  1. chaque visuel declare existe sur le disque ;
 *  2. chaque source porte un usage, une signature et un statut de
 *     diffusion explicite ;
 *  3. aucun ecran ne reference un visuel par son chemin : tout passe
 *     par le catalogue ;
 *  4. aucun visuel d une source non diffusable n est utilise ;
 *  5. tout nom cite par un ecran existe au catalogue.
 */
const RACINE = resolve('public');
const MANIFESTE = JSON.parse(
  readFileSync(resolve('src/app/data/illustrations.json'), 'utf8'),
) as {
  version: number;
  sources: Record<string, { libelle: string; url: string; usage: string; signature: string; diffusable?: boolean; remarque?: string }>;
  illustrations: Record<string, {
    fichier: string; sujet: string; categorie: string; source: string; usage: string; dimensions?: string;
  }>;
};

const parcourir = (dossier: string, sortie: string[] = []): string[] => {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) { parcourir(chemin, sortie); continue; }
    if (/\.(tsx|ts|css)$/.test(chemin) && !/\.test\.tsx?$/.test(chemin)) sortie.push(chemin);
  }
  return sortie;
};

describe('Systeme d images', () => {
  it('le manifeste declare des sources et des visuels', () => {
    expect(MANIFESTE.version).toBeGreaterThan(0);
    expect(Object.keys(MANIFESTE.sources).length).toBeGreaterThan(0);
    expect(Object.keys(MANIFESTE.illustrations).length).toBeGreaterThan(0);
  });

  it('chaque visuel declare existe sur le disque', () => {
    const manquants: string[] = [];
    for (const [nom, entree] of Object.entries(MANIFESTE.illustrations)) {
      const chemin = join(RACINE, entree.fichier);
      if (!existsSync(chemin)) manquants.push(`${nom} -> ${entree.fichier}`);
    }
    expect(manquants.length, `visuels declares mais absents :\n  ${manquants.join('\n  ')}`).toBe(0);
  });

  it('chaque visuel declare une source connue, avec usage et signature', () => {
    const problemes: string[] = [];
    for (const [nom, entree] of Object.entries(MANIFESTE.illustrations)) {
      const source = MANIFESTE.sources[entree.source];
      if (!source) { problemes.push(`${nom} : source inconnue (« ${entree.source} »)`); continue; }
      if (!source.usage?.trim()) problemes.push(`${nom} : la source n declare pas son usage`);
      if (!source.signature?.trim()) problemes.push(`${nom} : la source ne porte pas de signature`);
      if (!entree.sujet?.trim()) problemes.push(`${nom} : le sujet n est pas decrit`);
      if (!entree.usage?.trim()) problemes.push(`${nom} : l usage prevu n est pas decrit`);
    }
    expect(problemes.length, `visuels mal declares :\n  ${problemes.join('\n  ')}`).toBe(0);
  });

  it('aucun ecran ne reference un visuel par son chemin', () => {
    // Un chemin en dur dans le front, c'est un visuel hors du catalogue :
    // on ne sait plus d ou il vient, et il echappe au verrou.
    const coupables: string[] = [];
    for (const fichier of parcourir(resolve('src'))) {
      const source = readFileSync(fichier, 'utf8');
      const lignes = source.split(/\r?\n/);
      lignes.forEach((ligne, i) => {
        const trouve = /["'`](\/(?:assets\/|operators\/)[A-Za-z0-9._/-]+\.(?:jpg|jpeg|png|webp|svg|mp4))["'`]/.exec(ligne);
        if (!trouve) return;
        // Le module de catalogue lui-memement ne peut pas se referencer.
        if (fichier.replace(/\\/g, '/').endsWith('src/app/lib/illustrations.ts')) return;
        coupables.push(
          `${fichier.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/')}:${i + 1}  « ${trouve[1]} »`,
        );
      });
    }
    expect(
      coupables.length,
      'visuels references en dur (ils doivent passer par le manifeste) :\n  '
      + coupables.join('\n  '),
    ).toBe(0);
  });

  it('aucun visuel non diffusable n est utilise, et chaque source le declare', () => {
    // Une source peut etre DECLAREE sans etre diffusable (une capture de la
    // communaute, par exemple). Deux garanties :
    //   1. chaque source dit explicitement si elle est diffusable ;
    //   2. un visuel dont la source ne l est pas n est utilise par AUCUN ecran.
    const sansStatut = Object.entries(MANIFESTE.sources)
      .filter(([, source]) => typeof source.diffusable !== 'boolean')
      .map(([nom]) => nom);
    expect(
      sansStatut.length,
      'sources qui ne disent pas si elles sont diffusables :\n  ' + sansStatut.join('\n  '),
    ).toBe(0);

    const interdits = Object.entries(MANIFESTE.illustrations)
      .filter(([, entree]) => MANIFESTE.sources[entree.source]?.diffusable === false)
      .map(([nom]) => nom);
    const coupables: string[] = [];
    for (const fichier of parcourir(resolve('src'))) {
      const source = readFileSync(fichier, 'utf8');
      for (const nom of interdits) {
        if (!source.includes(`"${nom}"`) && !source.includes(`'${nom}'`)) continue;
        coupables.push(`${fichier.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/')}  utilise ${nom}`);
      }
    }
    expect(
      coupables.length,
      'visuels non diffusables utilises :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });

  it('tout nom cite par un ecran existe au catalogue', () => {
    // PIEGE : urlIllustration('nom-inexistant') renvoie undefined, et
    // l ecran rend alors un src vide. La faute de frappe ne casse rien
    // visiblement : elle fait juste disparaitre le visuel. Le catalogue
    // est donc la seule source de noms valides.
    const connus = new Set(Object.keys(MANIFESTE.illustrations));
    const coupables: string[] = [];
    for (const fichier of parcourir(resolve('src'))) {
      const source = readFileSync(fichier, 'utf8');
      const noms = [
        ...[...source.matchAll(/<Illustration[^>]*\bnom="([^"]+)"/g)].map((m) => m[1]),
        ...[...source.matchAll(/urlIllustration\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]),
      ];
      for (const nom of noms) {
        if (connus.has(nom)) continue;
        coupables.push(
          `${fichier.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/')}  nom inconnu ${nom}`,
        );
      }
    }
    expect(
      coupables.length,
      'noms de visuels absents du catalogue :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
});
