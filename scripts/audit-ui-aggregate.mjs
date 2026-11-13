/**
 * scripts/audit-ui-aggregate.mjs - agrege les inventaires d audit UI par
 * CLASSE de defaut.
 *
 * Pourquoi cet outil existe
 * -------------------------
 * L audit UI ecrit un inventaire JSON par ecran dans `test-results/`. Un
 * audit qui s'arrete au PREMIER ecran en echec ne dit pas grand-chose : il
 * faut la LISTE complete des defauts, ecran par ecran.
 *
 * Mais la liste brute est elle-meme peu exploitable : 40 occurrences
 * « cible tactile < 24 px » et 3 « nom accessible » ne demandent pas
 * quarante corrections, mais TROIS corrections de code. Ce qui compte,
 * c est la CLASSE de defaut : le composant partage, le motif repetitif.
 *
 * L outil classe donc par nature de defaut et affiche, pour chaque classe,
 * le nombre d occurrences, le nombre d ecrans touches et des extraits.
 *
 * Usage
 * -----
 *   node scripts/audit-ui-aggregate.mjs            # apres un run playwright
 *   node scripts/audit-ui-aggregate.mjs --json     # sortie machine
 *
 * Les inventaires sont ecrits par `e2e/ui/support/audit.ts` (un fichier par
 * ecran, dans `test-results/`).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = 'test-results';
const PREFIXE = 'ui-audit-';

/** Regroupe un defaut dans une classe nommee. */
const classer = (ecran, categorie, detail) => {
  const classes = new Map();
  const ajouter = (classe, texte) => {
    if (!classes.has(classe)) {
      classes.set(classe, { occurrences: 0, ecrans: new Set(), details: new Set() });
    }
    const c = classes.get(classe);
    c.occurrences += 1;
    c.ecrans.add(ecran);
    c.details.add(texte);
  };

  for (const v of categorie.axe || []) {
    ajouter(`axe:${v.id} (${v.impact})`, `${v.aide} :: ${(v.noeuds || []).slice(0, 2).join(' | ')}`);
  }
  for (const img of categorie.imagesSansAlt || []) ajouter('image sans alt', img);
  for (const s of categorie.sansNom || []) ajouter('element sans nom accessible', s);
  for (const c of categorie.ciblesPetites || []) ajouter('cible tactile < 24 px', c);
  for (const e of categorie.erreursConsole || []) ajouter('erreur console', e);
  for (const r of categorie.reponsesApiEnErreur || []) ajouter('reponse API en erreur', r);

  return classes;
};

if (!existsSync(DOSSIER)) {
  console.error(`Aucun dossier « ${DOSSIER} » : lance d'abord la suite Playwright (les inventaires y sont ecrits).`);
  process.exit(1);
}

const fichiers = readdirSync(DOSSIER).filter((f) => f.startsWith(PREFIXE) && f.endsWith('.json'));
const total = new Map();
let ecransAnalyses = 0;

for (const f of fichiers) {
  const j = JSON.parse(readFileSync(join(DOSSIER, f), 'utf8'));
  ecransAnalyses += 1;
  for (const [classe, c] of classer(j.ecran, j)) {
    if (!total.has(classe)) total.set(classe, { occurrences: 0, ecrans: new Set(), details: new Set() });
    const t = total.get(classe);
    t.occurrences += c.occurrences;
    t.ecrans.add(j.ecran);
    for (const d of c.details) t.details.add(d);
  }
}

const classes = [...total.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(
    {
      ecrans: ecransAnalyses,
      classes: classes.map(([nom, c]) => ({
        classe: nom,
        occurrences: c.occurrences,
        ecrans: [...c.ecrans],
        exemples: [...c.details].slice(0, 6),
      })),
    },
    null,
    1,
  ));
} else {
  console.log(`ecrans analyses : ${ecransAnalyses}`);
  console.log(`classes de defauts : ${classes.length}\n`);
  for (const [nom, c] of classes) {
    console.log(`### ${nom}`);
    console.log(`    occurrences : ${c.occurrences} sur ${c.ecrans.size} ecran(s) : ${[...c.ecrans].join(', ')}`);
    for (const d of [...c.details].slice(0, 6)) console.log(`      - ${d}`);
    console.log('');
  }
  if (classes.length === 0) console.log('aucun defaut : les ecrans audites sont verts.');
}
