/**
 * scripts/convert-buttons.mjs - convertit les balises `<button>` d un
 * fichier en `<Button>` du design system.
 *
 * Pourquoi un outil
 * -----------------
 * La conversion vers le design system se fait par tranches de plusieurs
 * dizaines de boutons. Elle doit etre REPRODUCTIBLE : sinon la meme
 * decision (« ce bouton est-il une action en ligne ou un bouton icone ? »)
 * se reprend a la main, et diverge.
 *
 * L outil ne decide rien : il applique une DECLARATION. La liste des
 * variantes est ecrite a la main, bouton par bouton, dans un fichier de
 * specification versionne.
 *
 * Usage :
 *   node scripts/convert-buttons.mjs <fichier.tsx> <spec.json> [--check]
 *
 * La specification est un tableau, dans l ORDRE des `<button>` du
 * fichier :
 *   [{ "variant": "ghost", "size": "link" }, ...]
 *
 * Options :
 *   --check  n ecrit rien : se contente de dire si le fichier est
 *            deja converti (mode CI).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const [, , fichierArg, specArg, ...flags] = process.argv;

if (!fichierArg || !specArg) {
  console.error('Usage : node scripts/convert-buttons.mjs <fichier.tsx> <spec.json> [--check]');
  process.exit(2);
}

const seulementVerifier = flags.includes('--check');
// La specification est un JSON avec commentaires : le `//` de tete
// explique l ORDRE attendu, et l ordre des boutons est la seule chose
// qui compte. Sans cela, la specification serait illisible.
const specification = JSON.parse(
  readFileSync(specArg, 'utf8')
    .split('\n')
    .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
    .join('\n'),
);
const source = readFileSync(fichierArg, 'utf8');
const crlf = source.includes('\r\n');
const base = crlf ? source.replace(/\r\n/g, '\n') : source;

/** Les props du design system, et leur ordre d insertion. */
const props = (entree) => {
  const lignes = [
    `                variant="${entree.variant}"`,
    `                size="${entree.size || 'md'}"`,
  ];
  if (entree.fullWidth) lignes.push('                fullWidth');
  lignes.push('                animate={false}');
  return `\n${lignes.join('\n')}`;
};

const morceaux = base.split('<button');
if (morceaux.length - 1 !== specification.length) {
  // Un fichier deja converti n a plus de `<button` : la specification
  // devient une RELIQUE de la decision prise. Ce n est pas une erreur :
  // la conversion est deja faite.
  if (morceaux.length - 1 === 0) {
    console.log(`${fichierArg} : deja converti (${specification.length} bouton(s) dans la specification)`);
    process.exit(0);
  }
  console.error(
    `Le fichier compte ${morceaux.length - 1} bouton(s) et la specification en declare `
    + `${specification.length}.`,
  );
  process.exit(1);
}

const sortie = morceaux.map((morceau, i) => {
  if (i === 0) return morceau;
  const entree = specification[i - 1];
  if (!entree) return '<button' + morceau;
  return '<Button' + props(entree) + morceau;
}).join('');

let resultat = sortie.replace(/<\/button>/g, '</Button>');

// L import du design system, s il manque.
if (resultat.includes('<Button') && !/import \{[^}]*\bButton\b[^}]*\} from '.*ui\/Button'/.test(resultat)) {
  const dossier = resolve(fichierArg.slice(0, fichierArg.lastIndexOf('/')));
  let chemin = relative(dossier, resolve('src/app/components/ui/Button')).split('\\').join('/');
  // Un chemin relatif SANS point de depart n est pas un module : il faut
  // « ./ui/Button », pas « ui/Button ».
  if (!chemin.startsWith('.')) chemin = `./${chemin}`;
  const imports = [...resultat.matchAll(/^import .*?;$/gm)];
  if (imports.length) {
    const dernier = imports[imports.length - 1];
    resultat = resultat.slice(0, dernier.index + dernier[0].length)
      + `\nimport { Button } from '${chemin}';`
      + resultat.slice(dernier.index + dernier[0].length);
  } else {
    console.error('Aucun import trouve : ajouter manuellement l import du Button.');
    process.exit(1);
  }
}

if (seulementVerifier) {
  const identique = resultat === base;
  console.log(`${fichierArg} : ${identique ? 'deja converti' : 'CONVERSION A FAIRE'}`);
  process.exit(identique ? 0 : 1);
}

writeFileSync(fichierArg, crlf ? resultat.replace(/\n/g, '\r\n') : resultat, 'utf8');
console.log(`${fichierArg} : ${specification.length} bouton(s) converti(s)`);
