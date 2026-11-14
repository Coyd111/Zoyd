import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Les regles de redaction des MESSAGES SERVEUR.
 *
 * Pourquoi un verrou cote serveur
 * ------------------------------
 * Les messages du serveur sont affiches au joueur : le front ne traduit
 * que les codes qu il connait (`ERROR_MESSAGES` dans `apiClient.ts`) et
 * retombe SINON sur le message du serveur. Un message serveur sans
 * accent, ou en anglais, ou avec une apostrophe elidee, est donc devant
 * les yeux du joueur.
 *
 * L apostrophe elidee a une cause precise : les messages sont des
 * chaines entre apostrophes simples, et ecrire une apostrophe
 * demanderait un echappement. L auteur supprimait donc l apostrophe :
 * « Tu n es pas inscrit », « l historique des bails », « d un compte ».
 * L apostrophe typographique `’` (U+2019) ne s echappe pas et c est la
 * forme correcte en francais.
 *
 * Les accents : le meme auteur ecrit les COMMENTAIRES du serveur avec
 * les accents, et les messages a cote sans. Le resultat etait un
 * serveur a deux langues.
 *
 * PIEGE : la regle ne doit pas hurler sur les homographes. « Confirme »
 * (imperatif) ne prend pas d accent, « confirmé » (participe) en prend
 * un ; meme orthographe, sens oppose. Ces mots-la sont exclus, et les
 * cas nominatifs sont verifies a part.
 */

/** Les chaines entre apostrophes simples : `'` ouvre, `\'` echappe. */
const lireMessages = (source) => {
  const messages = [];
  const lignes = source.split(/\r?\n/);
  lignes.forEach((ligne, i) => {
    if (/^\s*(\*|\/\/)/.test(ligne)) return;
    const motifs = [
      /error:\s*'((?:[^'\\]|\\.)*)'/g,
      /makeError\(\s*'[A-Z0-9_]+'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
    ];
    for (const motif of motifs) {
      for (const m of ligne.matchAll(motif)) {
        messages.push({ ligne: i + 1, texte: m[1].replace(/\\'/g, "'") });
      }
    }
  });
  return messages;
};

const racine = resolve('server');
const fichiers = [];
const parcourir = (dossier) => {
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) { parcourir(chemin); continue; }
    if (!entree.name.endsWith('.mjs')) continue;
    if (entree.name.endsWith('.test.mjs')) continue;
    fichiers.push(chemin);
  }
};
parcourir(racine);

const tousLesMessages = [];
for (const fichier of fichiers) {
  const source = readFileSync(fichier, 'utf8');
  for (const m of lireMessages(source)) {
    tousLesMessages.push({ ...m, fichier: fichier.replace(/\\/g, '/') });
  }
}

describe('Messages serveur - redaction', () => {
  it('la regle a des messages a inspecter (sinon elle ne verifierait rien)', () => {
    expect(fichiers.length).toBeGreaterThan(10);
    expect(tousLesMessages.length).toBeGreaterThan(100);
  });

  it('aucune apostrophe n est elidee', () => {
    const coupables = [];
    // Une apostrophe elidee : un mot suivi d un espace et d un mot, la
    // ou le premier mot est l elision (n, d, l, qu, c, j, jusqu).
    //
    // PIEGE : « Un arbitre » n est PAS une elision (« l'article » suivi
    // d un nom) : « un » + espace + mot ne devient jamais « un'... ».
    // Les articles sont donc exclus explicitement.
    const re = /(?<!(?:Un|Une|un|une) )(?<![a-zà-ÿA-ZÀ-Ý])(n|d|l|qu|c|j)(?= (est|etait|etaient|ai|as|es|importe|un|une|historique|export|equipe|operation|etat|inscription|identite|abord|il|elle|on|auc|avant|administrateur|administr administration|arbitre|admin|ecran))/g;
    for (const m of tousLesMessages) {
      if (!re.test(m.texte)) continue;
      re.lastIndex = 0;
      coupables.push(`${m.fichier}:${m.ligne}  « ${m.texte.slice(0, 70)} »`);
    }
    expect(
      coupables.length,
      'apostrophe elidee dans un message serveur (le joueur lit « n est ») :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });

  it('aucun message n est en anglais', () => {
    const coupables = [];
    const anglais = [
      'Failed to fetch', 'Upstream API error', 'Unauthorized.', 'Forbidden.',
      'Not found', 'Internal Server Error', 'Bad Request', 'Cannot ',
      'Invalid ', 'Missing ', 'Unable to', 'Something went wrong', 'Access denied',
    ];
    for (const m of tousLesMessages) {
      const hit = anglais.find((a) => m.texte.includes(a));
      if (!hit) continue;
      coupables.push(`${m.fichier}:${m.ligne}  « ${m.texte.slice(0, 70)} »`);
    }
    expect(
      coupables.length,
      'message serveur en anglais (le reste de l application est en francais) :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });

  it('aucun texte visible ne perd son accent', () => {
    const coupables = [];
    // Mots dont l accent est OBLIGATOIRE (jamais homographes).
    const MOTS = [
      'deja', 'apres', 'etre', 'etes', 'etais', 'etait', 'etaient',
      'cle', 'cles', 'entree', 'entrees', 'etat', 'etats',
      'verification', 'verifications', 'verifie', 'verifiez', 'verifier',
      'echouee', 'echouees', 'echec', 'echecs', 'ecriture', 'ecritures',
      'journal', 'journee', 'journees', 'resultat', 'resultats',
      'regle', 'regles', 'reglee', 'reglement', 'reglements',
      'equipe', 'equipes', 'necessaire', 'necessaires',
      'meme', 'numero', 'numeros', 'succes', 'echeance', 'echeances',
      'reessaye', 'reessayez', 'requete', 'requetes',
      'securite', 'identite', 'qualite', 'quantite', 'difficulte',
      'evenement', 'evenements', 'premiere', 'derniere', 'systeme',
      'libelle', 'modele', 'periode', 'unites', 'activite',
      'operation', 'operations', 'federation', 'generation',
      'propriete', 'proprietes', 'recuperation', 'liberation', 'preparation',
      'donnees', 'incomplete', 'incompletes', 'createur', 'facon',
      'parametres', 'partagee', 'privee', 'reservee',
      'terminee', 'terminees', 'annulee', 'annulees', 'activee', 'activees',
      'configuree', 'configurees', 'engagee', 'supprimee', 'supprimees',
      'verifiee', 'verifiees', 'eliminee', 'eliminations', 'elimine', 'elimines',
      'soldee', 'soldees', 'levee', 'levees', 'fermee', 'fermees',
      'identifie', 'identifiee', 'deja',
    ];
    for (const m of tousLesMessages) {
      for (const mot of MOTS) {
        const re = new RegExp(`(?<![\\p{L}])${mot}(?![\\p{L}])`, 'iu');
        if (!re.test(m.texte)) continue;
        coupables.push(`${m.fichier}:${m.ligne}  « ${m.texte.slice(0, 66)} »  (${mot})`);
        break;
      }
    }
    expect(
      coupables.length,
      'texte serveur sans accent :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
});
