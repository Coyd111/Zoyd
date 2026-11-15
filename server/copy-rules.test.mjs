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
      // Les messages de JOURNAL : ils ne sont pas affiches au joueur,
      // mais ils sont lus par l exploitant, et ils melangeaient les deux
      // langues du projet.
      /log\.(?:trace|debug|info|warn|error|fatal)\(\s*'((?:[^'\\]|\\.)*)'/g,
      // Les NOTIFICATIONS : `title` et `body` sont affiches tels quels
      // dans le centre de notifications du joueur. Ils sont donc des
      // TEXTE VISIBLE, au meme titre qu un `error:` — et ils etaient
      // hors de portee du verrou (« Depot credite », « Arbitre
      // assigne », « Resultat a confirmer »).
      //
      // PIEGE : `body:` designe aussi le corps d'une requete HTTP
      // (`body: JSON.stringify(...)`) : le motif n'attrape que les
      // LITERAUX, donc pas ces appels.
      /\btitle:\s*'((?:[^'\\]|\\.)*)'/g,
      /\btitle:\s*`((?:[^`\\]|\\.)*)`/g,
      /\bbody:\s*'((?:[^'\\]|\\.)*)'/g,
      /\bbody:\s*`((?:[^`\\]|\\.)*)`/g,
      // Les `hint:` : l aide affichee au createur de salon (BR) ou la
      // consigne de l exploitant dans les journaux du serveur.
      /\bhint:\s*'((?:[^'\\]|\\.)*)'/g,
      /\bhint:\s*`((?:[^`\\]|\\.)*)`/g,
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
      // PIEGE : la comparaison se fait sur le texte SANS accents. Sinon
      // « l identite » (apostrophe elidee ET accent present) passe
      // sous la liste de mots, qui ne contient que des formes sans
      // accent : l apostrophe elidee y echappait.
      const plat = m.texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!re.test(plat)) continue;
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
    // Mots anglais qui n existent pas en francais. Les identifiants
    // techniques (app_users, Supabase, FedaPay, tick, sweep, webhook...)
    // sont VOLONTAIRES : ils sont les memes partout, cote serveur comme
    // cote base.
    const anglais = [
      'Failed to fetch', 'Upstream API error', 'Unauthorized.', 'Forbidden.',
      'Not found', 'Internal Server Error', 'Bad Request', 'Cannot ',
      'Unable to', 'Something went wrong', 'Access denied',
      'failed', 'unable', 'cannot', 'unexpected', 'missing', 'expired',
      'rejected', 'skipped', 'starting', 'stopping', 'received', 'denied',
      'timeout', 'retry', 'success', 'without', 'initiated', 'preserved',
      'ignored', 'released', 'evicted', 'discarded', 'loading', 'delivery',
      'persist', 'award', 'revoke', 'verify',
      'unread', 'marked', 'created', 'updated', 'deleted',
      // Mots anglais des NOTIFICATIONS : « (${kills} kills) » etait
      // affiche tel quel au joueur, dans un projet francais.
      'kills', 'kill',
      // « la room » : le mot anglais s etait glisse dans un message
      // joueur (« renseigne la room »). Toute l interface parle de
      // « salle ».
      'room',
      // « Ajoute au moins un scoreboard » : le mot anglais etait dans un
      // message joueur. Le tableau des scores est le mot francais.
      'scoreboard',
    ];
    for (const m of tousLesMessages) {
      // Frontieres de LETTRES (propriete Unicode) : « persisté » ne doit
      // pas etre lu comme « persist », et « cron_leases » ne doit pas
      // etre lu comme « leases ».
      //
      // PIEGE : un point devant exclut l IDENTIFICATEUR (`prize.kills`),
      // pas le mot affiche au joueur. « .kills » est un nom de
      // propriete ; « (2 kills) » est de l anglais affiche.
      const hit = anglais.find((a) => {
        const motif = new RegExp(`(?<![.\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu');
        return motif.test(m.texte);
      });
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
      // Mots du vocabulaire des journaux.
      'perime', 'perimes', 'perimee', 'expirees', 'expire', 'libere',
      'liberee', 'liberes', 'refusee', 'refuses', 'rejouees', 'rejoues',
      'supprimee', 'annulee', 'annulees', 'annules', 'reconcilies',
      'reconciliation', 'protege', 'protegee', 'proteges', 'present',
      'presente', 'presents', 'installe', 'installee', 'developpement',
      'terminee', 'terminees', 'ignore', 'ignoree', 'dedie', 'dediee',
      'emis', 'emise', 'integre', 'integree', 'echange', 'echangee',
      'preleve', 'prelevee', 'propriete', 'federation', 'generation',
      'recuperation', 'liberation', 'preparation', 'controle', 'controles',
      'integrite', 'memoire', 'fenetre', 'fenetres', 'donnees', 'donnee',
      'etat', 'etats', 'cloture', 'cloturee', 'cloturer', 'securite',
      'qualite', 'quantite', 'difficulte', 'identite', 'activite', 'modele',
      'libelle', 'evenement', 'evenements', 'numero', 'numeros', 'systeme',
      'periode', 'unites',
      // Mots des NOTIFICATIONS (texte affiche dans le centre de
      // notifications du joueur).
      'depot', 'depots', 'credite', 'creditee', 'ajoutes', 'delai',
      // Mots des `hint:` (aide affichee au createur de salon BR, consigne
      // de l exploitant dans les journaux).
      'redeploy', 'hebergeur', 'redemarrage', 'resolution', 'crediter',
      'chargee', 'prets', 'arret', 'cree',
      // Reprise du dictionnaire du verrou FRONT (`src/lib/copy-rules.test.ts`)
      // : un seul referentiel pour les deux moites du produit. Les mots
      // qui n etaient verifies que cote front sont des textes que le
      // serveur envoie au joueur.
      'elimination', 'dernieres', 'categorie', 'categories', 'debut', 'ete',
      'supprime', 'complete', 'completee', 'detail', 'details', 'tres',
      'penalite', 'decision', 'precision', 'benefice', 'recu', 'experience',
      'reference', 'visibilite', 'legalite', 'declaration', 'integration',
      'moderation',
    ];
    // Mots dont l accent depend du CONTEXTE : ils ne peuvent pas figurer
    // dans la liste ci-dessus (elle signalerait des homographes
    // legitimes). On les traite par EXPRESSION : la forme accentuee
    // doit etre presente, et la forme sans accent ne doit pas l etre.
    //
    // PIEGE : la comparaison se fait sur la version SANS accents du
    // message, avec une frontiere de lettre a droite. Sans cette
    // frontiere, « a confirmer » serait vu comme « a confirme » (prefixe)
    // et chaque message serait signale a tort.
    const EXPRESSIONS = [
      'à confirmer',            // « Resultat a confirmer » -> « Résultat à confirmer »
      'a confirmé',             // « a confirme le resultat » -> « a confirmé le résultat »
      'ajoutés à ton portefeuille',
      'assigné',                // « Arbitre assigne » -> « Arbitre assigné »
      'démarré',                // « Tournoi demarre » -> « Tournoi démarré »
      'a commencé',             // « a commence » -> « a commencé »
      'gagnés sur',             // « X gagnes sur ... » -> « X gagnés sur ... »
      'BR Lancée',              // « Journee BR Lancee » -> « Journée BR Lancée »
      'redéploiement limité',   // « redeploy limite » -> « redéploiement limité »
      'redéploiement illimité', // « redeploy illimite » -> « redéploiement illimité »
      'NON CONFIRMÉ',           // « NON CONFIRME » -> « NON CONFIRMÉ »
      'Résurgence',             // « Resurgence » -> « Résurgence »
    ];
    const sansAccents = (texte) => texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of tousLesMessages) {
      let coupable = null;
      for (const mot of MOTS) {
        const re = new RegExp(`(?<![\\p{L}])${mot}(?![\\p{L}])`, 'iu');
        if (!re.test(m.texte)) continue;
        coupable = `${m.fichier}:${m.ligne}  « ${m.texte.slice(0, 66)} »  (${mot})`;
        break;
      }
      if (!coupable) {
        const plat = sansAccents(m.texte);
        for (const expression of EXPRESSIONS) {
          const sans = sansAccents(expression);
          // Frontiere de LETTRE des deux cotes. A gauche, elle empeche
          // « Tu as deja confirme » de passer pour « a confirme » (le
          // « a » final de « deja ») ; a droite, elle empeche
          // « a confirmer » de passer pour « a confirme ».
          const presentSans = new RegExp(`(?<![\\p{L}])${echapper(sans)}(?![\\p{L}])`, 'iu').test(plat);
          if (!presentSans) continue;
          const presentAvec = new RegExp(`(?<![\\p{L}])${echapper(expression)}(?![\\p{L}])`, 'iu').test(m.texte);
          if (presentAvec) continue;
          coupable = `${m.fichier}:${m.ligne}  « ${m.texte.slice(0, 66)} »  (${expression})`;
          break;
        }
      }
      if (!coupable) continue;
      coupables.push(coupable);
    }
    expect(
      coupables.length,
      'texte serveur sans accent :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
});
