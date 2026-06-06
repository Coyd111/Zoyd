export const CODM_RANKS = [
  'Rookie',
  'Veteran',
  'Elite',
  'Pro',
  'Master',
  'Grandmaster',
  'Legendary',
] as const;

export const CODM_RANK_SHOWCASE = ['Rookie', 'Elite', 'Master', 'Legendary'] as const;

export const DEVICE_OPTIONS = [
  { id: 'phone', label: 'Telephone' },
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

export const MJ_FORMATS = ['1VS1', '2VS2', '3VS3', '5VS5'] as const;

export const MJ_MODE_OPTIONS = [
  { id: 'snd', name: 'S&D', desc: 'Recherche et destruction' },
  { id: 'hp', name: 'HARDPOINT', desc: "Rotation d'objectif" },
  { id: 'dom', name: 'DOMINATION', desc: 'Controle de zones' },
  { id: 'fl', name: 'FRONTLINE', desc: 'Respawn competitif' },
] as const;

export const MJ_MAP_POOL = [
  'Raid',
  'Standoff',
  'Firing Range',
  'Nuketown',
  'Crash',
  'Summit',
  'Shipment',
  'Terminal',
] as const;

export const LANDING_TICKER_ITEMS = [
  'Profil joueur unique',
  'Multijoueur CODM',
  'Battle Royale',
  'Wallet ZC',
  'Mobile Money',
  'Tournois publics',
] as const;
