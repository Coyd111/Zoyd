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
  placeholder: string;
  operators: PayoutOperator[];
}

export const PAYOUT_COUNTRIES: Record<string, PayoutCountry> = {
  bj: {
    iso: 'bj',
    label: 'Bénin',
    prefix: '+229',
    placeholder: '+229 61 00 00 01',
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

/** Normalise le pays du profil (nom FR ou iso) vers sa config payout, ou null si non supporté. */
export const getPayoutCountry = (country: string | undefined | null): PayoutCountry | null => {
  if (!country) return null;
  const iso = NAME_TO_ISO[country.trim().toLowerCase()];
  return (iso && PAYOUT_COUNTRIES[iso]) || null;
};
