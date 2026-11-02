/**
 * competition.ts - referentiel du jeu : rangs, formats, cartes, modes.
 *
 * Source unique des listes utilisees par les formulaires (creer un match,
 * creer un tournoi, reglages) et des libelles affiches dans les cartes.
 *
 * INVARIANT : toute liste d'options de formulaire doit venir d'ici. Une
 * liste dupliquee dans un ecran diverge des autres et du serveur.
 * INVARIANT : les valeurs des options (format, device, controller) sont
 * exactement celles attendues par le serveur : ce sont des ENUMS, pas des
 * libelles.
 * PIEGE : un libelle peut contenir un accent, une valeur ne doit jamais en
 * contenir : les valeurs sont comparees et stockees.
 * PIEGE : getMapImage mappe une carte vers son visuel ; une carte ajoutee
 * au referentiel sans image fait tomber l'ecran sur une image par defaut.
 *
 * Voir aussi : docs/08-frontend.md - section 10 (Inventaire des pages)
 */
export const CODM_RANGS = [
  'Rookie',
  'Veteran',
  'Elite',
  'Pro',
  'Master',
  'Grandmaster',
  'Legendary',
] as const;

export const DEVICE_OPTIONS = [
  { id: 'phone', label: 'Téléphone' },
  { id: 'tablet', label: 'Tablette' },
  { id: 'pc', label: 'PC' },
  { id: 'other', label: 'Autre' },
] as const;

export const CONTROLLER_OPTIONS = [
  { id: 'touch', label: 'Touch (mobile natif)' },
  { id: 'controller', label: 'Manette Bluetooth' },
  { id: 'emulator', label: 'Emulateur' },
  { id: 'pc', label: 'PC / setup externe' },
  { id: 'other', label: 'Autre' },
] as const;

export const COUNTRY_OPTIONS = [
  'Benin',
  "Cote d'Ivoire",
  'Senegal',
  'Togo',
  'Cameroon',
  'Gabon',
  'RDC',
  'Nigeria',
  'Ghana',
  'Autre',
] as const;

/**
 * Pays (libellé de l'interface) -> code ISO attendu par Codashop.
 * Sans ce mapping, la boutique CODM interrogeait la session Inde en dur :
 * un joueur beninois voyait « 499.0 INR ».
 */
export const COUNTRY_TO_ISO: Record<string, string> = {
  'Benin': 'BJ',
  "Cote d'Ivoire": 'CI',
  'Senegal': 'SN',
  'Togo': 'TG',
  'Cameroon': 'CM',
  'Gabon': 'GA',
  'RDC': 'CD',
  'Nigeria': 'NG',
  'Ghana': 'GH',
  'Autre': 'BJ',
};

/** Code ISO pour un libellé de pays inconnu : BJ (seule devise XOF geree). */
export const toCountryIso = (country?: string): string =>
  (country ? COUNTRY_TO_ISO[country] : undefined) || 'BJ';

// Formats de match : 1VS1 à 5VS5 (limite serveur : voir match-engine/realtime-server).
export const MJ_FORMATS = ['1VS1', '2VS2', '3VS3', '4VS4', '5VS5'] as const;

export const MJ_MODE_OPTIONS = [
  { id: 'snd', name: 'S&D', desc: 'Recherche et destruction' },
  { id: 'hp', name: 'HARDPOINT', desc: "Rotation d'objectif" },
  { id: 'dom', name: 'DOMINATION', desc: 'Contrôle de zones' },
  { id: 'fl', name: 'FRONTLINE', desc: 'Respawn competitif' },
  { id: 'control', name: 'CONTROL', desc: 'Contrôle des zones, 3 manches gagnantes' },
] as const;

/**
 * Pool de cartes MJ, verifie le 02/11/2026 contre la liste officielle des
 * cartes multiplayer CODM (Call of Duty Wiki, 69 cartes - rapport de
 * recherche CODM en cache Temp/zoyd-codm-recherche.md).
 * CORRECTION P0 : 9 noms INEXISTANTS en jeu ont ete retires (Pawnshop,
 * Dashboard, Reactor, Aerial, Boulevard, Canopy, Townhouse, Sandbox,
 * Grazna - celle-ci etait une confusion avec la map Ground War "Grazna
 * Raid" du MW2019 console). Un match programme sur une carte fantome est
 * impossible a regler dans un salon prive CODM : litige arbitre garanti.
 * AJOUTS : cartes reelles manquantes (pools esports 2026 : Hacienda,
 * Combine, Arsenal, Crossroads Strike - nom du variant Control ; scene et
 * rotation 2026 : Apocalypse, Seaside, Winter Raid, Vacant, Hovec Sawmill).
 * NOTE P1 (pas corrige ici) : Oasis ne tourne qu'en Frontline (comme
 * Monastery) - a etiqueter au moment du filtrage par mode.
 */
export const MJ_MAP_POOL = [
  'Crash',
  'Crossfire',
  'Summit',
  'Raid',
  'Standoff',
  'Firing Range',
  'Nuketown',
  'Shipment',
  'Terminal',
  'Killhouse',
  'Cage',
  'King',
  'Satellite',
  'Coastal',
  'Oasis',
  'Slums',
  'Tunisia',
  'Hackney Yard',
  'Meltdown',
  'Shoot House',
  'Scrapyard',
  'Highrise',
  'Dome',
  'Apocalypse',
  'Hacienda',
  'Combine',
  'Arsenal',
  'Crossroads Strike',
  'Seaside',
  'Winter Raid',
  'Vacant',
  'Hovec Sawmill',
] as const;

export const getMapImage = (_mapName: string): string => {
  return '';
};

/**
 * Presets de regles issus de la recherche CODM du 02/11/2026 : SEULEMENT
 * des valeurs verifiables, cles sur le libelle stocke dans rules.mode
 * (ex. "S&D") et pas sur l'id du referentiel : c'est le libelle qui circule
 * dans les matchs.
 * - S&D : premier a 9 manches gagnees, manche de 120 s (esports 2026, FT9
 *   apres le vote des pros ; DuelX joue 13 manches en scene wager).
 * - HARDPOINT : premier a 250 points, partie de 600 s (10 min).
 * - CONTROL : premier a 3 manches, manche de 90 s.
 * DOMINATION et FRONTLINE n'ont AUCUN preset : pas de valeur esports
 * verifiee dans les sources - la saisie reste libre.
 * PIEGE : un preset est une PROPOSITION pre-remplie, pas une regle
 * serveur : la decision finale reste celle du createur et de l'arbitre.
 */
export interface MjModePreset {
  scoreTarget: number;
  timeLimitSeconds: number;
  timeLimitScope: 'match' | 'round';
  source: string;
}

export const MJ_MODE_PRESETS: Partial<Record<string, MjModePreset>> = {
  'S&D': { scoreTarget: 9, timeLimitSeconds: 120, timeLimitScope: 'round', source: 'Esports CODM 2026 : FT9, manche 120 s' },
  'HARDPOINT': { scoreTarget: 250, timeLimitSeconds: 600, timeLimitScope: 'match', source: 'Esports CODM 2026 : FT 250, 10 min' },
  'CONTROL': { scoreTarget: 3, timeLimitSeconds: 90, timeLimitScope: 'round', source: 'Esports CODM 2026 : FT3, manche 90 s' },
};

/**
 * Compatibilite carte x mode VERIFIEE : une carte absente tourne dans tous
 * les modes ; on ne declare ici que les exclusions prouvees (recherche CODM
 * du 02/11/2026 - namu.wiki). Oasis ne se joue qu'en Frontline ; Monastery
 * est dans le meme cas mais hors referentiel. Cle = libelle de MJ_MAP_POOL.
 */
export const MJ_MAP_MODE_RESTRICTIONS: Record<string, { modes: readonly string[]; reason: string }> = {
  Oasis: { modes: ['FRONTLINE'], reason: 'Frontline uniquement en jeu' },
};

/** Cartes jouables pour un mode (libelle), exclusions appliquees. */
export const MJ_MAPS_FOR_MODE = (mode: string): readonly string[] =>
  MJ_MAP_POOL.filter((map) => {
    const restriction = MJ_MAP_MODE_RESTRICTIONS[map];
    return !restriction || restriction.modes.includes(mode);
  });

/**
 * Classes de restriction d'armes : la scene wager s'accorde sur UNE CLASSE
 * avant le lancement (DuelX : "AR only / SMG only..."). Remplace les
 * 4 vieilles chaines des matchs. PIEGE : un match precedent garde sa
 * propre chaine stockee : l'affichage reste brut dans MatchRules.
 * Harmonisation du 02/11/2026 : le tournoi (CreateTournamentPage + defaut
 * de creation de tournament-engine) propose le MEME referentiel. Les
 * vieilles valeurs tournoi ("Toutes armes selon reglement", "Assaut /
 * SMG", "No scorestreak agressif") restent affichees telles quelles sur
 * les tournois deja comptes : pas de regle inventee sur la data.
 */
export const MJ_WEAPON_OPTIONS = [
  'Toutes permises',
  'AR uniquement',
  'SMG uniquement',
  'Snipers uniquement',
  'Corps a corps uniquement',
] as const;

/**
 * P3 02/11/2026 : la convention anti-friction de la scene wager (DuelX :
 * "alternance picks") sur un BO3 - l'organisateur choisit la carte de la
 * manche 1, son adversaire celle de la manche 2, la manche de departage
 * fait l'objet d'un accord. CONTRAT AFFICHE (meme discipline que le
 * variant BR) : regle dans la salle CODM, aucun effet moteur - le texte
 * est affiche tel quel dans MatchRules et le recapitulatif de creation.
 */
export const MJ_PICKS_ALTERNANCE =
  'Manche 1 : createur / Manche 2 : adversaire / Departage : accord';

/**
 * Presets best-of de la scene wager (recherche CODM du 02/11/2026 : culture
 * DuelX "BO1/BO3/BO5, alternance des maps"). CHAMP LIBRE CONSERVE : un
 * preset REMPLIT le champ bestOf, il ne le remplace pas ; une autre valeur
 * explicite passe tel quel (reglement libre, aucune liste blanche).
 */
export const MJ_BEST_OF_PRESETS = [1, 3, 5] as const;

/** Texte affiche sous l'input "Best of" des deux formulaires MJ. */
export const MJ_BEST_OF_SCENE =
  'Scene wager (DuelX) : BO1, BO3 ou BO5. Un preset remplit le champ, une autre valeur reste libre.';

/**
 * Limite de temps CODM reformatee pour l'UI : "10 min" ou "2 min / manche".
 * Renvoie "" si absent ou invalide : l'affichage laisse le champ decore a
 * "Libre" (aucune limite saisie).
 */
export const formatTimeLimit = (
  timeLimitSeconds?: number,
  timeLimitScope?: 'match' | 'round',
): string => {
  if (!timeLimitSeconds || timeLimitSeconds <= 0) return '';
  const minutes = timeLimitSeconds / 60;
  const label = Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toLocaleString('fr-FR')} min`;
  return timeLimitScope === 'round' ? `${label} / manche` : label;
};

export const LANDING_TICKER_ITEMS = [
  'Profil joueur unique',
  'Multijoueur CODM',
  'Battle Royale',
  'Wallet ZC',
  'Mobile Money',
  'Tournois publics',
] as const;
