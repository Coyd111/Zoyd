/**
 * codmNews - la veille CODM de ZOYD, datee et sourcee.
 *
 * Pourquoi ce module
 * ------------------
 * La page « Infos » gardait ses articles dans son propre fichier. Ils
 * avaient vieilli ensemble : Saison 8 « Twilight Heist » de septembre,
 * anniversaire annonce pour la Saison 9, Mythic Signal 50 encore
 * « attendu ». Le joueur lisait une saison finie comme si elle venait de
 * sortir.
 *
 * Une seule liste, une seule saison courante, une date ISO par article
 * et une source URL : la page ne peut plus raconter une autre histoire
 * que la donnee.
 *
 * INVARIANT : `publieLe` est la date de PUBLICATION de la source, pas la
 * date de redaction de ZOYD. Elle sert a la fois a l affichage et au
 * controle de fraicheur.
 * INVARIANT : `illustration` est un NOM du catalogue
 * (`src/app/data/illustrations.json`). Un nom inconnu ou une source non
 * diffusable est refuse par le verrou.
 * PIEGE : une date ISO sans heure est lue a minuit UTC. A l ouest de
 * Greenwich, elle peut reculer d un jour a l affichage : le formateur
 * fixe midi UTC pour garder le jour publie.
 */

export type CategorieArticleCodm = 'saison' | 'armes' | 'competition' | 'patches';

export type SourceArticleCodm = {
  libelle: string;
  url: string;
};

export type ArticleCodm = {
  id: string;
  titre: string;
  resume: string;
  contenu: readonly string[];
  categorie: CategorieArticleCodm;
  /** Date de publication de la source, au format AAAA-MM-JJ. */
  publieLe: string;
  etiquette: string;
  lectureMin: number;
  source: SourceArticleCodm;
  /** Nom d un visuel du catalogue, jamais un chemin ni une URL. */
  illustration?: string;
  /** Un seul article peut faire la une. */
  une?: boolean;
};

/** La saison courante du jeu, verifiee a la source. */
export const SAISON_CODM = {
  numero: 10,
  nom: '7th Anniversary',
  sortieLe: '2026-11-11',
  heure: '16 h PT',
} as const;

/** Date de la derniere verification editoriale. */
export const VERIFIE_LE = '2026-11-18';

/**
 * Formate une date de publication pour l affichage.
 *
 * PIEGE : ne jamais passer la chaine ISO directement a `new Date` pour
 * un affichage : sans heure, elle est interpretee a minuit UTC et peut
 * afficher la veille dans un fuseau negatif. Midi UTC neutralise le
 * decalage sans inventer d heure de publication.
 */
export const formaterDateCodm = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const BLOG_SAISON_10 =
  'https://www.callofduty.com/blog/2026/11/call-of-duty-mobile-season-10-7th-anniversary';

const SOURCE_OFFICIELLE: SourceArticleCodm = {
  libelle: 'Call of Duty — blog officiel',
  url: BLOG_SAISON_10,
};

const SOURCE_PATCH: SourceArticleCodm = {
  libelle: 'BestLoadout — notes de patch',
  url: 'https://bestloadout.com/news/cod-mobile-season-10-patch-notes-static-hv-nerfed-14-buffs-and-major-balance-changes',
};

/**
 * Les articles de la veille, du plus structurant au plus specialise.
 *
 * INVARIANT : les faits de la Saison 10 viennent du communique officiel
 * du 4 novembre 2026 (sortie le 11 a 16 h PT) et des notes de patch
 * datees du 12 novembre 2026. Aucune fonctionnalite que ZOYD ne possede
 * n est annoncee ici.
 */
export const ARTICLES_CODM: readonly ArticleCodm[] = [
  {
    id: 'saison-10-verdansk',
    titre: 'Saison 10 : Verdansk ouvre une nouvelle ère du Battle Royale',
    resume:
      "Sortie le 11 novembre 2026, la saison du 7e anniversaire apporte Verdansk, le Goulag, les Field Assets et le fusil de précision Signal 50.",
    contenu: [
      "La Saison 10 de Call of Duty: Mobile, baptisée 7th Anniversary, est sortie le 11 novembre 2026 à 16 h PT. Activision la présente comme une nouvelle ère du Battle Royale, avec l'arrivée de Verdansk et une refonte des commandes de déplacement et de vol.",
      "La carte compte plus de 15 points d'intérêt majeurs. Les parachutes peuvent être ouverts en cours de match à la place des wingsuits, les portes s'enfoncent en courant avec l'épaule et les coéquipiers à terre peuvent être tirés pendant qu'on les ranime.",
      "Le Battle Pass gratuit inclut le Signal 50, un fusil de précision à tir rapide taillé pour les longues lignes de vue de Verdansk. Deux Mythic Drops accompagnent la saison : Alias — Shattered Effigy et le Signal 50 — Exobotanica.",
    ],
    categorie: 'saison',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 4,
    source: SOURCE_OFFICIELLE,
    illustration: 'duel-operateurs',
    une: true,
  },
  {
    id: 'verdansk-carte',
    titre: "Verdansk : 18 points d'intérêt nommés, du Superstore au Military Base",
    resume:
      "La nouvelle carte du 7e anniversaire reprend les lieux iconiques de Verdansk : 18 points d'intérêt confirmés, des Buy Stations et des véhicules.",
    contenu: [
      "Verdansk arrive dans Call of Duty: Mobile avec plus de 15 points d'intérêt majeurs. Activision en nomme 18 : Superstore, Airport, Storage Town, Dam, Scrapyard, Train Station, TV Station, Promenade, Hospital, Downtown, Park, Port, Prison, Farmland, Stadium, Lumber, Quarry et Military Base.",
      "Chaque zone est décrite comme unique et très détaillée, avec de quoi avancer, se cacher, tendre une embuscade ou sniper à distance.",
      "Verdansk est aussi ajoutée à DMZ: Recon. En Battle Royale, les contrats en jeu donnent des récompenses et les Buy Stations permettent d'acheter des Field Assets.",
    ],
    categorie: 'saison',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 3,
    source: SOURCE_OFFICIELLE,
    illustration: 'escouade-action',
  },
  {
    id: 'goulag-duel',
    titre: 'Goulag : une première élimination, un duel, une seconde chance',
    resume:
      "Dans Verdansk, la première élimination envoie au Goulag. Gagner le duel redéploie dans la partie ; perdre laisse attendre un rachat en Buy Station.",
    contenu: [
      "Le Goulag fait son retour dans Verdansk. À la première élimination d'un match, le joueur est envoyé dans l'arène et attend son tour avec les autres spectateurs.",
      "Le duel se joue en un contre un. Le vainqueur est redéployé dans Verdansk ; le perdant reste éliminé jusqu'à ce qu'un coéquipier achète son redéploiement dans une Buy Station.",
      "La mécanique ne s'applique qu'à la première élimination : elle donne une seconde chance, pas un retour illimité.",
    ],
    categorie: 'saison',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 2,
    source: SOURCE_OFFICIELLE,
    illustration: 'portrait-ghost',
  },
  {
    id: 'field-assets-perks',
    titre: 'Field Assets et Perks : le Battle Royale change de vocabulaire',
    resume:
      "Les Scorestreaks deviennent des Field Assets, les Wildcards des Perks. Les deux s'équipent sur les Loadouts et s'achètent aux Buy Stations.",
    contenu: [
      "À partir de la Saison 10, les Scorestreaks du Battle Royale s'appellent des Field Assets. Ils s'équipent désormais sur les Loadouts, deviennent plus rares en match et s'achètent aux Buy Stations.",
      "Les Wildcards deviennent des Perks, uniquement en Battle Royale. Ils se trouvent en match ou s'équipent sur le Loadout, puis s'obtiennent via les Loadout Drops et les Buy Stations. Activision en liste quatorze, dont Wild Hip Fire, Tracking Ammo, Sniper Expert et Reload Rush.",
      "Deux nouveaux Field Assets arrivent : Death Machine et EMP Systems. Le Strafing Run et le Stealth Chopper gagnent un nouveau mécanisme de visée à l'activation.",
    ],
    categorie: 'saison',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 3,
    source: SOURCE_OFFICIELLE,
    illustration: 'operateur-lame',
  },
  {
    id: 'signal-50',
    titre: 'Signal 50 : le nouveau fusil de précision gratuit du Battle Pass',
    resume:
      "Arme de la Saison 10, le Signal 50 arrive au palier gratuit du Battle Pass, avec une version Mythic dans le Botanist Mythic Drop.",
    contenu: [
      "Le Signal 50 est la nouvelle arme de la Saison 10. Activision le décrit comme un fusil de précision à tir rapide, conçu pour les longues distances de Verdansk, et le place au palier gratuit du Battle Pass.",
      "Le Battle Pass premium comprend le Signal 50 — Nightfallen, aux côtés du RAM-7 — Golden Shadow, du KRM 262 — Regal Shot et du Hades — Tartarus. Les skins d'opérateur premium incluent Naga — Trickster Royale, Velikan — Blackcell, Death Angel Alice — Midnight et Keegan — Trap Master Royale.",
      "Le Botanist Mythic Drop propose le Signal 50 — Exobotanica, un blueprint mythique translucide qui laisse voir un échantillon végétal dans la structure de l'arme, avec le skin Tempest — Exo Botanist.",
    ],
    categorie: 'armes',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 3,
    source: SOURCE_OFFICIELLE,
    illustration: 'arme-bleue',
  },
  {
    id: 'dmz-recon-chemist',
    titre: 'DMZ: Recon : Verdansk, le boss Chemist et le contrat Prison',
    resume:
      "Verdansk arrive aussi en DMZ: Recon, avec un nouveau boss dans la zone de radiation et un contrat qui transforme l'escouade en prisonniers.",
    contenu: [
      "Verdansk est ajoutée à DMZ: Recon dans la Saison 10. Les escouades y affrontent des ennemis joueurs et non joueurs et remplissent des contrats pour gagner des récompenses.",
      "Le nouveau boss, The Chemist, occupe la zone de radiation avec des gardes d'élite. Il dispose d'un lance-grenades, de grenades à gaz et d'une attaque au corps à corps ; le masque à gaz est recommandé avant d'entrer. Le vaincre peut donner un blueprint d'arme, son skin d'opérateur et du butin de haut niveau.",
      "Le contrat Prison demande de laisser son équipement pour devenir prisonnier, de fouiller la prison et de trouver la clé du directeur pour sortir.",
    ],
    categorie: 'saison',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 3,
    source: SOURCE_OFFICIELLE,
    illustration: 'operatrice-studio',
  },
  {
    id: 'evenements-anniversaire',
    titre: 'Operation: Verdansk Convergence, Mail Call et Ready Set Ford',
    resume:
      "Trois événements structurent le 7e anniversaire : une guerre de factions, un plateau de dés et une collaboration Ford Racing avec plus de 20 récompenses.",
    contenu: [
      "Operation: Verdansk Convergence oppose trois factions : Makarov, Task Force 141 et les Observers. Les objectifs se répartissent en plusieurs actes, et les récompenses comprennent Ghost — Desert Ghost, le DLQ33 — Verdansk Event et, en récompense finale, l'AK47 légendaire — Pharoah's Decree.",
      "Une fois les tâches d'une faction terminées, le joueur peut en rejoindre une autre : toutes les récompenses restent accessibles. Mail Call se joue sur un plateau de dés et distribue des notes des développeurs, un Kilo 141 épique et des récompenses d'anniversaire.",
      "Ready Set Ford arrive une semaine après le lancement. Les tâches simples — se connecter, jouer, éliminer — donnent plus de 20 récompenses, dont Urban Tracker — Pit Crew, le skin de véhicule Rallycar — Sports Mode et le DRH — Command Console.",
    ],
    categorie: 'saison',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 4,
    source: SOURCE_OFFICIELLE,
    illustration: 'affiche-promo-cod',
  },
  {
    id: 'world-champs-2026',
    titre: '2026 World Champs : un tirage final et un pronostic gratuit',
    resume:
      "Le 2026 World Champs Final Draw met en avant l'USS 9 — COD:M Champion, tandis que Finale — Winner Takes All offre des coupons de réduction.",
    contenu: [
      "Activision accompagne la fin de saison compétitive avec le 2026 World Champs Final Draw. Le tirage contient l'USS 9 — COD:M Champion en légendaire, le FFAR1 — 2026 World Champs Final en épique et le Karambit — World Champs Finals en épique.",
      "L'événement Finale — Winner Takes All permet de pronostiquer le vainqueur du championnat du monde 2026 et de gagner des récompenses gratuites, dont des coupons pour le tirage.",
      "Le Battle Pass Vault accueille aussi le Final Snow Battle Pass de 2021, avec Girasol — Clairvoyant, FFAR 1 — Surrender et Koshka — Illusory Moon.",
    ],
    categorie: 'competition',
    publieLe: '2026-11-04',
    etiquette: 'OFFICIEL',
    lectureMin: 3,
    source: SOURCE_OFFICIELLE,
    illustration: 'duel-operateurs',
  },
  {
    id: 'equilibrage-saison-10',
    titre: 'Équilibrage S10 : Static-HV nerfé, les SMG buffés',
    resume:
      "Le patch du 7e anniversaire réduit les dégâts et la portée du Static-HV, et buff le CBR4, le MSMC, le Pharo, le PPSh-41 et le Striker 45.",
    contenu: [
      "Le patch de la Saison 10 touche d'abord les SMG. Le Static-HV perd des dégâts et de la portée. Le CBR4 gagne un point de dégâts initial et de la portée sur ses trois premières plages ; le MSMC voit sa portée initiale passer de 8 à 9,5 m et ses dégâts de deuxième plage de 21 à 23.",
      "Le Pharo réduit son délai de rafale de 150 à 118 ms ; le PPSh-41 réduit son recul en tir à la hanche. Le Striker 45 améliore ses tirs à la tête avec le chargeur .45 Hollow Point 12-R et réduit son délai de rafale de 180 à 145 ms.",
      "Le patch ajuste aussi le Bruen MK9, le Peacekeeper MK2, le Kilo 141, l'EM2, le LAG 53, l'Argus, le Shorty et le DR-MK2, ainsi que des compétences d'opérateur, des Scorestreaks et la classe Kinetic Station en Battle Royale.",
    ],
    categorie: 'patches',
    publieLe: '2026-11-12',
    etiquette: 'PATCH',
    lectureMin: 4,
    source: SOURCE_PATCH,
    illustration: 'arme-bleue',
  },
];
