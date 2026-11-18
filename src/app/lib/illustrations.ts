/**
 * illustrations - le catalogue des visuels de ZOYD.
 *
 * Pourquoi un manifeste
 * ---------------------
 * Les visuels du site etaient des chemins ecrits en dur, repartis dans
 * une dizaine d'ecrans (`/assets/images/codm-3.jpg`). Trois problemes :
 *
 *  1. on ne savait plus QUOI montrait quoi, ni d ou ca venait ;
 *  2. le meme visuel etait copie sous plusieurs noms (les quatre
 *     fichiers a nom hache de `assets/codm/image/` etaient des doublons
 *     exacts, jamais references) ;
 *  3. un visuel du press kit officiel etait melee a une capture de la
 *     communaute filigrasee : le risque se voyait a peine.
 *
 * Le manifeste declare donc, pour chaque visuel : le fichier, le sujet,
 * la SOURCE (press kit, communaute, marque d un tiers) et l usage prevu.
 * Le code ne connait plus que des NOMS.
 *
 * PIEGE : les chemins sont relatifs a `public/` (le catalogue couvre
 * les visuels illustratifs du site, pas seulement ceux de CODM ; le
 * logo et les icones de l application relevent de l identite de marque).
 * PIEGE : une source « communaute » ne doit jamais etre diffusee : le
 * verrou le signale.
 */
import manifeste from '../data/illustrations.json';

export type SourceIllustration = {
  libelle: string;
  url: string;
  usage: string;
  signature: string;
  /** La source autorise-t-elle la diffusion du visuel ? */
  diffusable: boolean;
  remarque?: string;
};

export type CategorieIllustration = 'ui' | 'videos' | 'operateurs';

export type Illustration = {
  fichier: string;
  sujet: string;
  categorie: CategorieIllustration;
  source: string;
  usage: string;
  dimensions?: string;
};

export type EntreeIllustration = Illustration & {
  nom: string;
  source_: SourceIllustration;
  /** Le chemin public, tel que le navigateur le requestera. */
  url: string;
};

const sources = manifeste.sources as Record<string, SourceIllustration>;
const illustrations = manifeste.illustrations as Record<string, Illustration>;

/** Tous les visuels declares, dans l ordre du manifeste. */
export const toutesLesIllustrations = (): EntreeIllustration[] =>
  Object.entries(illustrations).map(([nom, illustration]) => ({
    nom,
    ...illustration,
    source_: sources[illustration.source],
    url: `/${illustration.fichier}`,
  }));

/** Le visuel nomme, ou `undefined` si le nom est inconnu. */
export const illustration = (nom: string): EntreeIllustration | undefined => {
  const trouvee = illustrations[nom];
  if (!trouvee) return undefined;
  return {
    nom,
    ...trouvee,
    source_: sources[trouvee.source],
    url: `/${trouvee.fichier}`,
  };
};

/**
 * L URL d un visuel nomme.
 *
 * PIEGE : elle renvoie `undefined` et non une chaine vide : une image
 * dont le fichier manque doit tomber sur le REPLI graphique, pas sur une
 * image cassee.
 */
export const urlIllustration = (nom: string): string | undefined => illustration(nom)?.url;

/** Les visuels d une categorie. */
export const illustrationsDe = (categorie: CategorieIllustration): EntreeIllustration[] =>
  toutesLesIllustrations().filter((entree) => entree.categorie === categorie);

/** Les sources declarees (press kit, communaute, marques de tiers). */
export const sourcesDesIllustrations = (): Record<string, SourceIllustration> => sources;
