// Opérateurs Mobile Money par pays (miroir de PAYOUT_COUNTRY_CONFIG côté serveur).
// Modes FedaPay vérifiés dans la doc : mtn_open/moov/sbin (BJ), mtn_ci/moov_ci/
// orange_ci/wave_ci (CI), orange_sn/wave_sn (SN), moov_tg/togocel (TG).

export interface PayoutOperator {
  id: string;
  name: string;
  /** Chemin du vrai logo (public/operators). Absent = badge texte stylé. */
  logo?: string;
  /** Couleur de fond du badge (fallback + fond logo) */
  bg: string;
  /** Couleur du texte du badge fallback */
  fg: string;
  /** Wordmark affiché si pas de logo */
  mark: string;
}

export interface PayoutCountry {
  iso: string;
  label: string;
  prefix: string;
  /** Nombre de chiffres ATTENDUS apres l'indicatif pays. */
  localLength: number;
  /** Longueurs historiques encore acceptees (plan de numerotation precedent). */
  legacyLengths?: number[];
  placeholder: string;
  operators: PayoutOperator[];
}

export const PAYOUT_COUNTRIES: Record<string, PayoutCountry> = {
  // BENIN : 10 chiffres depuis le 30 novembre 2024 (ARCEP), le prefixe `01`
  // ayant ete ajoute devant tous les numeros existants. L'UIT precise que le
  // `0` initial est obligatoire depuis l'etranger. Le format 8 chiffres reste
  // accepte pour les enregistrements anterieurs a la migration.
  bj: {
    iso: 'bj',
    label: 'Bénin',
    prefix: '+229',
    localLength: 10,
    legacyLengths: [8],
    placeholder: '+229 01 61 00 00 01',
    operators: [
      { id: 'MTN MoMo', name: 'MTN MoMo', logo: '/operators/mtn.svg', bg: '#FFCC00', fg: '#000000', mark: 'MTN' },
      { id: 'Moov Money', name: 'Moov Money', bg: '#009EE2', fg: '#FFFFFF', mark: 'moov' },
      { id: 'Celtiis', name: 'Celtiis', logo: '/operators/celtiis.svg', bg: '#FFFFFF', fg: '#0077B6', mark: 'celtiis' },
    ],
  },
  ci: {
    iso: 'ci',
    label: "Côte d'Ivoire",
    prefix: '+225',
    localLength: 10,
    placeholder: '+225 07 00 00 00 00',
    operators: [
      { id: 'MTN MoMo', name: 'MTN MoMo', logo: '/operators/mtn.svg', bg: '#FFCC00', fg: '#000000', mark: 'MTN' },
      { id: 'Moov Money', name: 'Moov Money', bg: '#009EE2', fg: '#FFFFFF', mark: 'moov' },
      { id: 'Orange Money', name: 'Orange Money', logo: '/operators/orange.svg', bg: '#000000', fg: '#FFFFFF', mark: 'Orange' },
      { id: 'Wave', name: 'Wave', logo: '/operators/wave.png', bg: '#FFFFFF', fg: '#0A0A0A', mark: 'wave' },
    ],
  },
  sn: {
    iso: 'sn',
    label: 'Sénégal',
    prefix: '+221',
    localLength: 9,
    placeholder: '+221 77 000 00 00',
    operators: [
      { id: 'Orange Money', name: 'Orange Money', logo: '/operators/orange.svg', bg: '#000000', fg: '#FFFFFF', mark: 'Orange' },
      { id: 'Wave', name: 'Wave', logo: '/operators/wave.png', bg: '#FFFFFF', fg: '#0A0A0A', mark: 'wave' },
    ],
  },
  tg: {
    iso: 'tg',
    label: 'Togo',
    prefix: '+228',
    localLength: 8,
    placeholder: '+228 90 00 00 00',
    operators: [
      { id: 'Moov Money', name: 'Moov Money', bg: '#009EE2', fg: '#FFFFFF', mark: 'moov' },
      { id: 'Togocel', name: 'Togocel', bg: '#E30613', fg: '#FFFFFF', mark: 'Tg' },
    ],
  },
};

const NAME_TO_ISO: Record<string, string> = {
  benin: 'bj',
  bj: 'bj',
  "cote d'ivoire": 'ci',
  'côte d’ivoire': 'ci',
  ci: 'ci',
  senegal: 'sn',
  'sénégal': 'sn',
  sn: 'sn',
  togo: 'tg',
  tg: 'tg',
};

/**
 * Normalise le pays du profil (nom FR ou iso) vers sa config payout, ou null si non supporté.
 *
 * Insensible aux accents et aux apostrophes : la table mélangeait `benin`
 * (sans accent) et `sénégal` (avec), donc un profil enregistré sous « Bénin » —
 * la forme affichée dans l'interface — renvoyait `null` et le joueur lisait
 * « Retraits bientôt disponibles pour ton pays ». Même règle que
 * `normalizePayoutCountry` côté serveur.
 */
export const getPayoutCountry = (country: string | undefined | null): PayoutCountry | null => {
  if (!country) return null;
  const key = country
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´]/g, "'")
    .replace(/\s+/g, ' ');
  const iso = NAME_TO_ISO[key];
  return (iso && PAYOUT_COUNTRIES[iso]) || null;
};

/**
 * Un numéro est-il recevable pour un pays donné ?
 *
 * Miroir EXACT de `parsePhoneForFedaPay` côté serveur. Sans ce miroir, le
 * front acceptait des numéros que le serveur refuse : `+2290165240654` passait
 * les trois validations d'entrée (inscription `.min(8)`, paramètres
 * `/^\+?[\d\s-]{7,15}$/`, retrait `length < 8`) et n'échouait qu'au moment du
 * payout, devant un bandeau d'erreur server incompréhensible.
 *
 * Dix chiffres après `+229` alors qu'un mobile béninois en compte huit : le
 * compte était alors stocké avec un numéro que ZOYD ne pouvait jamais payer.
 */
export const isValidPhoneForCountry = (rawPhone: string, country: PayoutCountry | null): boolean => {
  if (!country || !rawPhone) return false;
  const cleaned = rawPhone.replace(/[\s\-().]/g, '');
  if (!cleaned) return false;
  const lengths = [country.localLength, ...(country.legacyLengths || [])];
  return lengths.some((len) => (
    new RegExp(`^\\+?${country.prefix}(\\d{${len}})$`).test(cleaned)
    || new RegExp(`^\\d{${len}}$`).test(cleaned)
  ));
};

/**
 * Le numéro correspond-il à AU MOINS UN pays de retrait ?
 *
 * Pour les champs de profil (inscription, paramètres) : on ne veut pas
 * imposer un pays, seulement écarter les formats manifestement faux. Un joueur
 * peut enregistrer un numéro ivoirien tout en ayant le pays Bénin.
 */
export const isAnySupportedPhone = (rawPhone: string): boolean => {
  const value = (rawPhone || '').trim();
  if (!value) return false;
  return Object.values(PAYOUT_COUNTRIES).some((country) => isValidPhoneForCountry(value, country));
};

/** Message d'erreur utilisable tel quel dans un toast. */
export const phoneFormatError = (country?: PayoutCountry | null): string =>
  country
    ? `Numéro invalide. Format attendu : ${country.prefix} suivi de ${country.localLength} chiffres (ex. ${country.placeholder}).`
    : 'Numéro de téléphone invalide.';
