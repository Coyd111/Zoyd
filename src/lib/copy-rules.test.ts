import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Les regles de REDACTION de l interface.
 *
 * Pourquoi ce fichier
 * -------------------
 * Un audit de redaction trouve des CAS ; il ne les empeche pas de
 * revenir. Ces trois regles couvrent des CLASSES entieres :
 *
 *  1. Les accents. Le texte utilisateur de ZOYD est accentue (« Récapitulatif »,
 *     « Créer », « Dépôt »). Un accent manquant dans une CGU, une meta
 *     description ou un `aria-label` est visible par le joueur - et par
 *     Google dans les resultats de recherche. On l avait deja paye deux
 *     fois : « Arbitres necessaires », « Base de donnees complete ».
 *
 *  2. Le libelle d action. Un BOUTON porte une ACTION : un verbe. Un
 *     lien de navigation porte un NOM : « Connexion » (la page). Melanger
 *     les deux laisse le joueur sans savoir s il declenche quelque chose.
 *     Le bouton de connexion disait « CONNEXION ».
 *
 *  3. Le taux ZC -> FCFA. Il a une source unique (`ZC_TO_FCFA`) et un
 *     miroir verifie cote serveur (`format-mirror.test.ts`). Mais deux
 *     ecrans du front faisaient LEUR PROPRE conversion (`livePot * 10`,
 *     « x 10 FCFA » en clair) : le miroir ne controle que la constante,
 *     pas ses usages. Les CGU, elles, affirmaient un taux ecrit a la
 *     main - troisieme copie, non verifiee.
 *
 * PIEGE : la lecture est volontairement APPROXIMATIVE (pas d analyseur
 * TS). Une regle trop fine produit des faux positifs, et un test qui
 * hurle sans raison s arrete d etre lu - c est ainsi qu un verrou
 * devient un decor.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Lecture des chaines visibles
// ─────────────────────────────────────────────────────────────────────────────

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

interface Chaine {
  fichier: string;
  ligne: number;
  texte: string;
}

const ATTRIBUTS_TEXTE = 'aria-label|title|placeholder|alt|label|description|helperText|hint|tooltip|confirmLabel|message';
const CLES_TEXTE = 'label|title|description|placeholder|message|text|name|helperText|tooltip|emptyTitle|emptyText|ariaLabel|confirmLabel|copy|hint|subtitle|badge|caption|cta|actionLabel|helpText';

/** Les chaines visibles d un composant. */
const chainesVisibles = (source: string): Chaine[] => {
  const out: Chaine[] = [];
  source.split(/\r?\n/).forEach((ligne, i) => {
    // Les commentaires ne sont pas du texte utilisateur.
    const estCommentaire = /^\s*(\/\/|\*|\/\*)/.test(ligne);
    if (estCommentaire) return;

    for (const m of ligne.matchAll(new RegExp(`\\b(${ATTRIBUTS_TEXTE})\\s*=\\s*"([^"]{2,})"`, 'g'))) {
      out.push({ fichier: '', ligne: i + 1, texte: m[2] });
    }
    for (const m of ligne.matchAll(/>([^<>{}]{2,})</g)) {
      const t = m[1].trim();
      if (t && !/^[/*\s]*$/.test(t)) out.push({ fichier: '', ligne: i + 1, texte: t });
    }
    for (const m of ligne.matchAll(new RegExp(`\\b(${CLES_TEXTE})\\s*:\\s*'([^']{2,})'`, 'g'))) {
      out.push({ fichier: '', ligne: i + 1, texte: m[2] });
    }
    for (const m of ligne.matchAll(new RegExp(`\\b(${CLES_TEXTE})\\s*:\\s*"([^"]{2,})"`, 'g'))) {
      out.push({ fichier: '', ligne: i + 1, texte: m[2] });
    }
    for (const m of ligne.matchAll(new RegExp(`\\b(${ATTRIBUTS_TEXTE})\\s*=\\s*\\{\`([^\`]{2,})\`\\}`, 'g'))) {
      out.push({ fichier: '', ligne: i + 1, texte: m[2] });
    }
    // Les messages de toast sont de l texte utilisateur : ils s affichent
    // en bas de l ecran.
    for (const m of ligne.matchAll(/\btoast\.\w+\(\s*'([^']{2,})'/g)) {
      out.push({ fichier: '', ligne: i + 1, texte: m[1] });
    }
    for (const m of ligne.matchAll(/\btoast\.\w+\(\s*"([^"]{2,})"/g)) {
      out.push({ fichier: '', ligne: i + 1, texte: m[1] });
    }
  });
  return out;
};

/** Le texte d un element, ses balises enlevees. */
const texteElement = (bloc: string): string =>
  bloc
    .replace(/<[^>]*>/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Les MOTS du libelle d une action.
 *
 * PIEGE : le libelle peut contenir du JavaScript (`{isLoading ? (...) :
 * (...) }`). On ne garde que les mots composes de lettres : les classes
 * CSS (`w-6`, `ml-2`) et la ponctuation disparaissent, ce qui laisse le
 * libelle reellement affiche.
 */
const motsDuLibelle = (texte: string): string[] =>
  texte
    .split(/[\s()?:;,=!/]+/)
    .map((m) => m.trim())
    .filter((m) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*$/.test(m))
    .map((m) => m.toLowerCase());

interface Action {
  fichier: string;
  ligne: number;
  texte: string;
  classe: string;
  type: 'bouton' | 'lien';
}

/** Les elements d action : boutons, et liens qui font office de bouton. */
const actions = (source: string): Action[] => {
  const out: Action[] = [];

  const blocDe = (depart: number, fermeture: string): { enfants: string; classe: string; fin: number } | null => {
    const reste = source.slice(depart);
    const fin = reste.indexOf(fermeture);
    if (fin === -1) return null;
    const bloc = reste.slice(0, fin);
    // Les ATTRIBUTS ne sont pas du texte : on ne garde que les ENFANTS,
    // ce qui suit le `>` de la balise ouvrante.
    const ferme = bloc.indexOf('>');
    if (ferme === -1) return null;
    const attributs = bloc.slice(0, ferme);
    const classe = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attributs);
    return {
      enfants: bloc.slice(ferme + 1),
      classe: (classe?.[1] || classe?.[2] || ''),
      fin: depart + fin,
    };
  };

  // PIEGE : les index sont ceux de la SOURCE, pas de la ligne : le bloc
  // d un bouton s etend sur plusieurs lignes. Matcher ligne par ligne
  // puis chercher dans la source melangeait deux reperes, et le bouton
  // de connexion echappait a la regle.
  for (const m of source.matchAll(/<(button|Button|Link)\b/g)) {
    const debut = m.index! + m[0].length;
    const type = m[1] === 'Link' ? 'lien' : 'bouton';
    const bloc = blocDe(debut, `</${m[1]}>`);
    if (!bloc) continue;
    const texte = texteElement(bloc.enfants);
    if (!texte || texte.length > 60) continue;
    // Un lien n est une ACTION que s il a l aspect d un bouton.
    if (type === 'lien' && !/bg-(white|zoyd-yellow|zoyd-blue)\b/.test(bloc.classe)) continue;
    out.push({
      fichier: '',
      ligne: source.slice(0, m.index).split(/\r?\n/).length,
      texte,
      classe: bloc.classe,
      type,
    });
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Regle 1 - les accents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mots francais qui portent un accent. La liste est volontairement
 * courte et VERIFIEE : chaque entree correspond a une coquille
 * reellement trouvee dans l audit, pas a une intuition.
 *
 * PIEGE : ne pas y mettre un mot qui existe SANS accent dans un autre
 * sens : « complet » (plein) et « arbitre » (le role) ne prennent pas
 * d accent, contrairement a « complete » (acheve) et « arbitres »
 * (participe passe). « termine » et « annule » sont eux aussi
 * ambigus : a l IMPERATIF (« Termine tes matchs »), ils ne prennent
 * PAS d accent. Ils sont donc traites par des cas explicites plus bas.
 */
const MOTS_SANS_ACCENT_OBLIGATOIRE: Record<string, string> = {
  necessaire: 'nécessaire',
  necessaires: 'nécessaires',
  cloture: 'clôture',
  elimination: 'élimination',
  dernieres: 'dernières',
  donnees: 'données',
  categorie: 'catégorie',
  categories: 'catégories',
  debut: 'début',
  equipes: 'équipes',
  ete: 'été',
  supprime: 'supprimé',
  supprimee: 'supprimée',
  complete: 'complète',
  completee: 'complétée',
  detail: 'détail',
  details: 'détails',
  reglement: 'règlement',
  reglements: 'règlements',
  terminee: 'terminée',
  annulee: 'annulée',
  evenement: 'événement',
  deja: 'déjà',
  apres: 'après',
  tres: 'très',
  etre: 'être',
  premiere: 'première',
  securite: 'sécurité',
  identite: 'identité',
  penalite: 'pénalité',
  decision: 'décision',
  precision: 'précision',
  benefice: 'bénéfice',
  depot: 'dépôt',
  depots: 'dépôts',
  echec: 'échec',
  recu: 'reçu',
  propriete: 'propriété',
  experience: 'expérience',
  verification: 'vérification',
  integre: 'intègre',
  verifie: 'vérifie',
  cree: 'créé',
  regle: 'règle',
  regles: 'règles',
  cle: 'clé',
  cles: 'clés',
  reference: 'référence',
  qualite: 'qualité',
  quantite: 'quantité',
  difficulte: 'difficulté',
  visibilite: 'visibilité',
  legalite: 'légalité',
  echeance: 'échéance',
  preparation: 'préparation',
  declaration: 'déclaration',
  recuperation: 'récupération',
  liberation: 'libération',
  operation: 'opération',
  integration: 'intégration',
  moderation: 'modération',
  federation: 'fédération',
  generation: 'génération',
};

describe('Regles de redaction - les accents', () => {
  it('la regle a des fichiers a inspecter (sinon elle ne verifierait rien)', () => {
    expect(fichiers.length).toBeGreaterThan(20);
  });

  it('aucun texte visible ne perd son accent', () => {
    const coupables: string[] = [];

    for (const fichier of fichiers) {
      const source = readFileSync(fichier, 'utf8');
      for (const c of chainesVisibles(source)) {
        for (const [mot, correct] of Object.entries(MOTS_SANS_ACCENT_OBLIGATOIRE)) {
          const re = new RegExp(`(?<![\\p{L}])${mot}(?![\\p{L}])`, 'iu');
          if (!re.test(c.texte)) continue;
          coupables.push(`${fichier.replace(racine, 'src')}:${c.ligne}  « ${c.texte.slice(0, 60)} »  (${mot} -> ${correct})`);
          break;
        }
      }
    }

    expect(
      coupables.length,
      'texte visible sans accent :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas reels : les mots ambigus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * « Termine », « annule », « arbitres » sont ambigus : a l IMPERATIF
 * (« Termine tes matchs ») ils ne prennent pas d accent, au PARTICIPE
 * passe (« un match termine », « SORTIES ARBITRES ») ils en prennent un.
 *
 * Une regle generale ne peut pas trancher. Ces cas la sont donc
 * verrouilles nominativement : ils correspondent a des coquilles
 * reellement trouvees par l audit.
 */
describe('Regles de redaction - les cas ambigus', () => {
  const source = (chemin: string) => readFileSync(resolve(chemin), 'utf8');

  it('les badges de statut BR gardent leurs accents', () => {
    const br = source('src/features/br/pages/BrPage.tsx');
    expect(br).toContain("label: 'RÈGLEMENT'");
    expect(br).toContain("label: 'TERMINÉ'");
    expect(br).toContain("label: 'ANNULÉ'");
  });

  it('le libelle admin des sorties d arbitre est accentue', () => {
    const admin = source('src/app/pages/AdminDashboardPage.tsx');
    expect(admin).toContain('SORTIES ARBITRÉS');
    expect(admin).not.toContain('SORTIES ARBITRES');
  });

  it('la part des arbitres s ellide', () => {
    const tournoi = source('src/app/pages/mj/CreateTournamentPage.tsx');
    expect(tournoi).toContain("label=\"Part d'arbitres\"");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regle 2 - un libelle d action porte un verbe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Noms qui ne doivent JAMAIS etre le libelle d une action : ils
 * designent un ETAT ou une PAGE, pas un clic.
 *
 * PIEGE 1 : « Connexion » reste un libelle valide pour un lien de
 * navigation (la page de connexion) et pour un titre de section. La
 * regle ne regarde donc QUE les elements d action : les boutons, et les
 * liens qui ont l aspect d un bouton.
 *
 * PIEGE 2 : la liste est courte et ciblee. « Retrait » ou « Depot »
 * sont des mots de contenu legitimes dans un libelle (« Retrait minimum :
 * 150 ZC ») : les y mettre produirait des faux positifs. Ce sont les
 * noms qui designent une PAGE ou un ETAT, jamais une action, qui sont
 * listes ici.
 */
const NOMS_INTERDITS = [
  'connexion',
  'creation',
  'validation',
  'recherche',
  'filtres',
  'parametres',
];

describe('Regles de redaction - un libelle d action porte un verbe', () => {
  it('aucun bouton ni bouton-lien ne porte un nom', () => {
    const coupables: string[] = [];

    for (const fichier of fichiers) {
      const source = readFileSync(fichier, 'utf8');
      for (const a of actions(source)) {
        const mots = motsDuLibelle(a.texte);
        if (mots.length === 0 || mots.length > 5) continue;
        if (!NOMS_INTERDITS.some((nom) => mots.includes(nom))) continue;
        coupables.push(`${fichier.replace(racine, 'src')}:${a.ligne}  [${a.type}]  « ${a.texte} »`);
      }
    }

    expect(
      coupables.length,
      'libelle d action au nom (un bouton porte un VERBE) :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regle 3 - le taux ZC -> FCFA n est jamais ecrit en clair
// ─────────────────────────────────────────────────────────────────────────────

describe('Regles de redaction - le taux ZC -> FCFA', () => {
  it('aucun ecran n ecrit le taux en clair ni ne recalcule la conversion', () => {
    const coupables: string[] = [];

    for (const fichier of fichiers) {
      const source = readFileSync(fichier, 'utf8');
      source.split(/\r?\n/).forEach((ligne, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
        // « 1 ZC = 10 FCFA » ecrit en clair, ou une conversion `x 10`.
        if (/\b1\s*ZC\s*=\s*\d+\s*FCFA/.test(ligne) || /×\s*\d+\s*FCFA/.test(ligne)) {
          coupables.push(`${fichier.replace(racine, 'src')}:${i + 1}  taux ecrit en clair`);
          return;
        }
        // Une conversion manuelle : `montant * 10` dans du JSX visible.
        if (/<[^>]*>|[{]/.test(ligne) && /\*\s*10\b/.test(ligne) && !/ZC_TO_FCFA|formatFCFA/.test(ligne)) {
          coupables.push(`${fichier.replace(racine, 'src')}:${i + 1}  conversion manuelle`);
        }
      });
    }

    expect(
      coupables.length,
      'taux ZC -> FCFA ecrit en dur (utiliser ZC_TO_FCFA / formatFCFA) :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
});
