// Opérateurs Mobile Money par pays (miroir de PAYOUT_COUNTRY_CONFIG côté serveur).
// Modes FedaPay vérifiés dans la doc : mtn_open/moov/sbin (BJ), mtn_ci/moov_ci/
// orange_ci/wave_ci (CI), orange_sn/wave_sn (SN), moov_tg/togocel (TG).

export interface PayoutOperator {
  id: string;
  name: string;
  colorClass: string;
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
      { id: 'MTN MoMo', name: 'MTN MoMo', colorClass: 'bg-[#FFCC00]' },
      { id: 'Moov Money', name: 'Moov Money', colorClass: 'bg-[#009EE2]' },
      { id: 'Celtiis', name: 'Celtiis', colorClass: 'bg-[#00B0F0]' },
    ],
  },
  ci: {
    iso: 'ci',
    label: "Côte d'Ivoire",
    prefix: '+225',
    placeholder: '+225 07 00 00 00 00',
    operators: [
      { id: 'MTN MoMo', name: 'MTN MoMo', colorClass: 'bg-[#FFCC00]' },
      { id: 'Moov Money', name: 'Moov Money', colorClass: 'bg-[#009EE2]' },
      { id: 'Orange Money', name: 'Orange Money', colorClass: 'bg-[#FF7900]' },
      { id: 'Wave', name: 'Wave', colorClass: 'bg-[#1DC8FF]' },
    ],
  },
  sn: {
    iso: 'sn',
    label: 'Sénégal',
    prefix: '+221',
    placeholder: '+221 77 000 00 00',
    operators: [
      { id: 'Orange Money', name: 'Orange Money', colorClass: 'bg-[#FF7900]' },
      { id: 'Wave', name: 'Wave', colorClass: 'bg-[#1DC8FF]' },
    ],
  },
  tg: {
    iso: 'tg',
    label: 'Togo',
    prefix: '+228',
    placeholder: '+228 90 00 00 00',
    operators: [
      { id: 'Moov Money', name: 'Moov Money', colorClass: 'bg-[#009EE2]' },
      { id: 'Togocel', name: 'Togocel', colorClass: 'bg-[#E30613]' },
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
