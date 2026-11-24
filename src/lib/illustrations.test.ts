import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { srcsetIllustration, srcsetPourUrl } from '../app/lib/illustrations';

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
    variantes?: Record<string, string>;
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

  it('chaque visuel photographique declare des variantes WebP bornees', () => {
    // Pourquoi : un key art 1920x1080 pese 250 a 350 Ko en JPEG. A 360 px,
    // la meme image en WebP 480 px suffit et pese moins de 30 Ko. Chaque
    // visuel d interface doit donc declarer ses tailles, et la plus grande
    // variante ne peut pas depasser la largeur d origine.
    const problemes: string[] = [];
    for (const [nom, entree] of Object.entries(MANIFESTE.illustrations)) {
      if (entree.categorie !== 'ui') continue;
      const variantes = entree.variantes;
      if (!variantes) { problemes.push(`${nom} : aucune variante responsive`); continue; }
      const largeurs = Object.keys(variantes).map(Number).sort((a, b) => a - b);
      if (largeurs.length < 3) problemes.push(`${nom} : ${largeurs.length} variante(s), 3 minimum`);
      const largeurOrigine = Number((entree.dimensions || '').split('x')[0]);
      for (const largeur of largeurs) {
        if (!Number.isInteger(largeur) || largeur <= 0) {
          problemes.push(`${nom} : largeur invalide « ${largeur} »`);
          continue;
        }
        if (Number.isFinite(largeurOrigine) && largeur > largeurOrigine) {
          problemes.push(`${nom} : variante ${largeur} px au-dela de l origine ${largeurOrigine} px`);
        }
        const fichier = variantes[String(largeur)];
        if (!fichier.endsWith('.webp')) problemes.push(`${nom} : ${fichier} n est pas un WebP`);
        if (!existsSync(join(RACINE, fichier))) problemes.push(`${nom} : ${fichier} absent du disque`);
      }
    }
    expect(problemes.length, `variantes responsives invalides :\n  ${problemes.join('\n  ')}`).toBe(0);
  });

  it('srcsetIllustration ordonne les candidats et ignore les visuels sans variantes', () => {
    // Le composant affiche l image d origine en repli et les variantes WebP
    // en srcset : le navigateur choisit selon la taille reelle du cadre.
    const srcset = srcsetIllustration('duel-operateurs');
    expect(srcset).toBeTruthy();
    expect(srcset).toContain('/assets/codm/press/ui/duel-operateurs-480.webp 480w');
    expect(srcset).toContain('/assets/codm/press/ui/duel-operateurs-1440.webp 1440w');
    expect(srcset!.indexOf('480w')).toBeLessThan(srcset!.indexOf('960w'));

    expect(srcsetIllustration('logo-mtn')).toBeUndefined();
    expect(srcsetIllustration('nom-inexistant')).toBeUndefined();
  });

  it('srcsetPourUrl retrouve les candidats depuis une URL du catalogue', () => {
    // ProfileView recoit une URL d image, pas un nom : le panneau vide doit
    // quand meme servir le WebP adapte.
    expect(srcsetPourUrl('/assets/codm/press/ui/duel-operateurs.jpg')).toContain('duel-operateurs-480.webp 480w');
    expect(srcsetPourUrl('/logo.png')).toBeUndefined();
    expect(srcsetPourUrl(undefined)).toBeUndefined();
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
