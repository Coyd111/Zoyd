export const roundAmount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100 || 0;
};

export const getNow = () => new Date().toISOString();

export const makeError = (code, message) => Object.assign(new Error(message), { code });

/**
 * Formatage d'un montant ZC pour les notifications serveur.
 *
 * Miroir de `formatZC` (src/lib/utils.ts) : 1 décimale, virgule française,
 * suffixe « ZC ». Le serveur ne doit pas afficher « 123.4560000001 ZC ».
 *
 * Vivait dans `realtime-server.mjs` : les modules de routes en avaient besoin,
 * et le dupliquer aurait fait diverger les deux formats.
 */
export const formatZcForNotification = (amount) => {
  const rounded = Math.round(Number(amount) * 10) / 10;
  if (!Number.isFinite(rounded)) return '0 ZC';
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${display} ZC`;
};

const LEVEL_THRESHOLDS = { BEGINNER: 1000, COMPETITOR: 3000, CHALLENGER: 7000, ELITE: 15000, PRO: Infinity };
const PROGRESSION_LEVELS = ['BEGINNER', 'COMPETITOR', 'CHALLENGER', 'ELITE', 'PRO'];

export const addXpToProgression = (progression, amount) => {
  const next = {
    level: progression?.level || 'BEGINNER',
    xp: Number(progression?.xp || 0) + amount,
    nextLevelXp: Number(progression?.nextLevelXp || 1000),
  };
  let currentIdx = PROGRESSION_LEVELS.indexOf(next.level);
  while (currentIdx >= 0 && currentIdx < PROGRESSION_LEVELS.length - 1 && next.xp >= LEVEL_THRESHOLDS[next.level]) {
    next.level = PROGRESSION_LEVELS[currentIdx + 1];
    currentIdx++;
  }
  next.nextLevelXp = LEVEL_THRESHOLDS[next.level];
  return next;
};
