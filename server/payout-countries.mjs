// Matrice pays → opérateurs Mobile Money supportés par FedaPay (payout).
//
// Module FEUILLE : aucun import, volontairement. `payment-engine.mjs` importe
// `persistence.mjs`, donc `persistence.mjs` ne peut pas importer
// `payment-engine.mjs` sans créer un cycle d'imports. Les règles de format de
// téléphone vivent ici pour être accessibles aux deux.
//
// Origines des règles :
// - Bénin : MTN (mtn_open), Moov (moov), Celtiis (sbin)
// - Côte d'Ivoire : MTN (mtn_ci), Moov (moov_ci), Orange (orange_ci), Wave (wave_ci)
// - Sénégal : Orange (orange_sn), Wave (wave_sn)
// - Togo : Moov (moov_tg), Togocel (togocel)
// Pas de mode Orange/Wave au Bénin, pas de payout FedaPay pour CM/GA/CD/NG/GH.
//
// BENIN : 10 chiffres, pas 8.
// L'ARCEP Bénin a fait passer le plan national de 8 à 10 chiffres le
// 30 novembre 2024, en ajoutant le préfixe `01` devant les numéros existants
// (`95 99 20 00` → `01 95 99 20 00`). L'UIT précise que le `0` initial est
// OBLIGATOIRE depuis l'extérieur : format international `+229 0ZXXXXXXXX`.
// Notre configuration portait encore 8 chiffres : tout joueur béninois était
// refusé au retrait alors que son numéro était parfaitement valide.
export const PAYOUT_COUNTRY_CONFIG = {
  bj: {
    prefix: '229',
    localLength: 10,
    // Le format 8 chiffres est antérieur à la migration ARCEP. On continue de
    // l'accepter : des enregistrements plus anciens existent (et le numéro
    // admin par défaut en est un), et FedaPay reste l'arbitre final.
    legacyLengths: [8],
    label: 'Bénin',
    operators: { 'MTN MoMo': 'mtn_open', 'Moov Money': 'moov', 'Celtiis': 'sbin' },
  },
  ci: {
    prefix: '225', localLength: 10, label: "Côte d'Ivoire",
    operators: { 'MTN MoMo': 'mtn_ci', 'Moov Money': 'moov_ci', 'Orange Money': 'orange_ci', 'Wave': 'wave_ci' },
  },
  sn: {
    prefix: '221', localLength: 9, label: 'Sénégal',
    operators: { 'Orange Money': 'orange_sn', 'Wave': 'wave_sn' },
  },
  tg: {
    prefix: '228', localLength: 8, label: 'Togo',
    operators: { 'Moov Money': 'moov_tg', 'Togocel': 'togocel' },
  },
};

const COUNTRY_NAME_TO_ISO = {
  benin: 'bj', bj: 'bj',
  "cote d'ivoire": 'ci', 'côte d’ivoire': 'ci', ci: 'ci',
  senegal: 'sn', 'sénégal': 'sn', sn: 'sn',
  togo: 'tg', 'tg': 'tg',
};

/**
 * Cle de recherche insensible aux accents et aux apostrophes.
 *
 * La table melangeait `benin` (sans accent) et `sénégal` (avec) : un profil
 * enregistré sous « Bénin » — la forme affichee dans l'interface — renvoyait
 * `null`, donc « Retraits bientôt disponibles pour ton pays » pour un pays
 * parfaitement supporte. Meme probleme avec les apostrophes droites et
 * typographiques de « Côte d'Ivoire ».
 */
const countryLookupKey = (value) => String(value)
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'`´]/g, "'")
  .replace(/\s+/g, ' ');

/**
 * Normalize un pays (nom FR du profil ou iso) vers son iso payout.
 * @returns {string|null} 'bj'|'ci'|'sn'|'tg' ou null si non supporté
 */
export const normalizePayoutCountry = (country) => {
  if (!country || typeof country !== 'string') return null;
  return COUNTRY_NAME_TO_ISO[countryLookupKey(country)] || null;
};

/**
 * Longueurs acceptées pour un pays : la longueur courante, plus les formats
 * historiques listés dans `legacyLengths`.
 */
const acceptedLengths = (cfg) => [cfg.localLength, ...(cfg.legacyLengths || [])];

/**
 * Parse a phone number string into FedaPay format for a given payout country.
 * Accepts international (+2290165240654) or local (0165240654) forms.
 * @param {string} rawPhone - Raw phone input
 * @param {string} [countryIso='bj'] - Payout country iso
 * @returns {{ number: string, country: string }} number='' quand invalide
 */
export const parsePhoneForFedaPay = (rawPhone, countryIso = 'bj') => {
  const cfg = PAYOUT_COUNTRY_CONFIG[countryIso];
  if (!rawPhone || typeof rawPhone !== 'string' || !cfg) return { number: '', country: countryIso || 'bj' };
  const cleaned = rawPhone.replace(/[\s\-().]/g, '');

  for (const len of acceptedLengths(cfg)) {
    const matchPrefix = cleaned.match(new RegExp(`^\\+?${cfg.prefix}(\\d{${len}})$`));
    if (matchPrefix) return { number: matchPrefix[1], country: countryIso };
    if (new RegExp(`^\\d{${len}}$`).test(cleaned)) return { number: cleaned, country: countryIso };
  }

  return { number: '', country: countryIso };
};

/**
 * Le numéro correspond-il à AU MOINS UN pays de retrait ?
 *
 * Utilisé à l'inscription et dans les paramètres : on n'impose pas un pays
 * (un joueur peut enregistrer un numéro ivoirien tout en ayant le pays Bénin),
 * on écarte seulement les formats qu'aucun retrait ne pourra jamais payer.
 *
 * Origine : un compte Benin acceptait `+2290165240654` — dix chiffres après
 * l'indicatif, alors qu'un mobile béninois en compte huit. Les trois
 * validations d'entrée (`min(8)`, `/^\+?[\d\s-]{7,15}$/`, `length < 8`)
 * l'acceptaient ; seul le payout le refusait, devant un bandeau d'erreur.
 */
export const isAnySupportedPhone = (rawPhone) => {
  if (!rawPhone || typeof rawPhone !== 'string') return false;
  const cleaned = rawPhone.trim();
  if (!cleaned) return false;
  return Object.keys(PAYOUT_COUNTRY_CONFIG)
    .some((iso) => parsePhoneForFedaPay(cleaned, iso).number !== '');
};

/**
 * Message d'erreur explicite pour un pays donné : le joueur doit savoir
 * COMBIEN de chiffres sont attendus, sinon il reformate au hasard.
 */
export const phoneFormatError = (countryIso) => {
  const cfg = PAYOUT_COUNTRY_CONFIG[countryIso];
  if (!cfg) return 'Numéro de téléphone invalide.';
  return `Numéro invalide. Format attendu : +${cfg.prefix} suivi de ${cfg.localLength} chiffres.`;
};