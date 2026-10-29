/**
 * server/utils.mjs - Primitives partagees : arrondis, horodatage, erreurs codees,
 * formatage de montant et progression d'XP.
 *
 * Aucune dependance, aucune effet de bord : ce module est importe partout,
 * y compris par la couche de persistance.
 *
 * INVARIANT : tout montant monetaire passe par `roundAmount` (2 decimales).
 *   Sans cela, une somme d'arrondis ne se recompose pas et le reglement cree
 *   ou detruit de la monnaie.
 * INVARIANT : `makeError` est le SEUL moyen de creer une erreur metier.
 *   C'est `error.code` que `mapPersistenceError` fait correspondre ; une
 *   erreur sans `code` devient un 500 generique.
 * INVARIANT : `formatZcForNotification` est le MIROIR serveur de `formatZC`
 *   (src/lib/utils.ts). Les deux formats doivent rester identiques, sinon la
 *   notification et l'UI affichent des montants differents.
 * INVARIANT : `addXpToProgression` renvoie un NOUVEL objet, il ne mute pas
 *   l'argument : l'appelant range le resultat dans le compte.
 * PIEGE : `roundAmount` renvoie 0 pour une entree non finie - il masque
 *   l'erreur au lieu de la signaler : valider avant d'appeler.
 * PIEGE : les `details` de `makeError` sont copies sur l'Error ; c'est
 *   `payoutId` qui permet a l'appelant d'eviter un double remboursement.
 * PIEGE : `LEVEL_THRESHOLDS.PRO` vaut Infinity : la boucle d'XP s'arrete a PRO
 *   et `nextLevelXp` y vaut Infinity.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

export const roundAmount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100 || 0;
};

export const getNow = () => new Date().toISOString();

/**
 * Erreur applicative codee.
 *
 * `details` permet de porter un CONTEXTE ACTIONNABLE sur l'erreur — par
 * exemple un identifiant de payout FedaPay, qui dit a l'appelant si
 * l'argent a peut-etre malgre tout ete envoye. Sans cela, l'appelant ne peut
 * que supposer, et une supposition fausse coute de l'argent.
 *
 * @param {string} code
 * @param {string} message
 * @param {object} [details] - champs additionnels copies sur l'erreur
 */
export const makeError = (code, message, details = null) =>
  // P1 C5 (audit-3) : `code` en dernier — un `details.code` ne doit jamais
  // ecraser le code metier (le mapping HTTP en depend, faux 500 sinon).
  Object.assign(new Error(message), details || {}, { code });

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
