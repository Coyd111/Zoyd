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

export const LANDING_TICKER_ITEMS = [
  'Profil joueur unique',
  'Multijoueur CODM',
  'Battle Royale',
  'Wallet ZC',
  'Mobile Money',
  'Tournois publics',
] as const;
