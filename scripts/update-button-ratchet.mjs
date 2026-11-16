/**
 * scripts/update-button-ratchet.mjs - regenere le CRETOIR du verrou
 * d adoption du design system.
 *
 * Le cretoir vit dans `src/lib/design-system-adoption.test.ts` : la liste
 * des fichiers qui ont ENCORE des balises `<button>` brutes, et combien.
 *
 * Pourquoi un outil
 * -----------------
 * Ecrit a la main, ce cretoir ment : les compteurs a la main se
 * decalent des que le code bouge, et le verrou devient soit muet (il
 * ne protege plus rien), soit faux (il bloque un fichier legitime).
 * Il doit etre une MESURE, pas une intention.
 *
 * Usage : node scripts/update-button-ratchet.mjs [--check]
 *   --check  dit si le cretoir est a jour (mode CI) sans ecrire.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const FichierTest = 'src/lib/design-system-adoption.test.ts';
const seulementVerifier = process.argv.includes('--check');

/** Les commentaires ne comptent pas : une docstring qui parle de
 *  « `<button>` » gonflerait le decompte. */
const sansCommentaires = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((ligne) => !/^\s*(\*|\/\/)/.test(ligne))
  .join('\n');

const fichiers = [];
const parcourir = (dossier) => {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) { parcourir(chemin); continue; }
    if (/\.tsx$/.test(chemin) && !/\.test\.tsx$/.test(chemin)) fichiers.push(chemin);
  }
};
parcourir(resolve('src'));

const lignes = [];
let bruts = 0;
let designSystem = 0;
for (const fichier of fichiers) {
  const propre = sansCommentaires(readFileSync(fichier, 'utf8'));
  const b = (propre.match(/<button\b/g) || []).length;
  const c = (propre.match(/<Button\b/g) || []).length;
  bruts += b;
  designSystem += c;
  if (!b) continue;
  lignes.push(`  '${relative(process.cwd(), fichier).replace(/\\/g, '/')}': ${b},`);
}
lignes.sort();

const nouveau = `const RESTANTS: Record<string, number> = {\n${lignes.join('\n')}`;
const adoption = Math.round((100 * designSystem) / (bruts + designSystem));

const source = readFileSync(FichierTest, 'utf8');
const crlf = source.includes('\r\n');
const base = crlf ? source.replace(/\r\n/g, '\n') : source;
const debut = base.indexOf('const RESTANTS: Record<string, number> = {');
const fin = base.indexOf('};', debut);
if (debut < 0 || fin < 0) {
  console.error('Cretoir introuvable dans le fichier de test.');
  process.exit(1);
}
const resultat = base.slice(0, debut) + nouveau + base.slice(fin);

if (seulementVerifier) {
  const aJour = resultat === base;
  console.log(`Cretoir : ${aJour ? 'a jour' : 'PERIME'} (adoption ${adoption} %, ${lignes.length} fichier(s))`);
  process.exit(aJour ? 0 : 1);
}

writeFileSync(FichierTest, crlf ? resultat.replace(/\n/g, '\r\n') : resultat, 'utf8');
console.log(`Cretoir regenere : ${lignes.length} fichier(s) | adoption ${adoption} %`);
