/**
 * Gravite et sanction recommandee, derivees du motif du signalement.
 *
 * Le serveur ne se fie pas a ce que le client appelle `reason` : un joueur
 * peut envoyer n'importe quelle chaine. Seul le joint de cette table est
 * accepte ; tout le reste tombe dans `a_qualifier`, qui ne declenche AUCUNE
 * sanction automatique.
 *
 * `recommended` n'est PAS applique tout seul. C'est une RECOMMANDATION
 * presentee a l admin dans la file d'attente, qui tranche. Bannir
 * automatiquement sur un signalement unique reviendrait a laisser n'importe
 * quel joueur faire bannir son rival en le signalant une fois : le
 * signalement est une accusation, pas une preuve.
 */
export const REPORT_SEVERITIES = {
  harassment: 'grave',
  cheating: 'grave',
  toxic_behavior: 'moyenne',
  no_show: 'legere',
  other: 'a_qualifier',
};

export const SANCTION_KINDS = ['warning', 'temporary_ban', 'permanent_ban', 'dismissed'];

/** Duree par defaut d'un bannissement temporaire, en jours. */
export const DEFAULT_TEMP_BAN_DAYS = 7;

/**
 * Plafond des sanctions temporaires. Au-dela, legerement au-dessus d'un mois,
 * un bannissement temporaire devient de fait permanent — autant demander
 * `permanent_ban`, qui laisse une trace explicite.
 */
export const MAX_TEMP_BAN_DAYS = 30;

/**
 * @param {string} reason motif declare par le joueur
 * @returns {'grave'|'moyenne'|'legere'|'a_qualifier'}
 */
export const severityForReason = (reason) => {
  const key = String(reason || '').trim();
  return REPORT_SEVERITIES[key] || 'a_qualifier';
};

/**
 * Sanction recommandee pour une gravite donnee.
 *
 * `grave` propose un bannissement temporaire court, pas un definitif : meme
 * un signalement de harcelement peut etre emitted par un joueur qui veut
 * ecarter un concurrent. Le definitif se merite par la RECIDIVE, que
 * l admin constate, pas par un seul signalement.
 *
 * @param {string} severity
 * @returns {{ kind: string, durationDays?: number, label: string }}
 */
export const recommendedSanction = (severity) => {
  switch (severity) {
    case 'grave':
      return { kind: 'temporary_ban', durationDays: DEFAULT_TEMP_BAN_DAYS, label: 'Bannissement temporaire' };
    case 'moyenne':
      return { kind: 'warning', label: 'Avertissement' };
    case 'legere':
      return { kind: 'dismissed', label: 'Classement seul' };
    default:
      return { kind: 'dismissed', label: 'A qualifier par un administrateur' };
  }
};

/**
 * Severite MAXIMALE jamais levee. Le definitif n'est jamais automatique :
 * il se choisit. Cette borne sert de garde-fou, pas de politique.
 */
export const isSanctionKind = (kind) => SANCTION_KINDS.includes(kind);

/**
 * Date d'expiration d'une sanction temporaire, ou null si elle est
 * permanente ou levee.
 *
 * @param {string} kind
 * @param {number} [durationDays]
 * @returns {string|null} horodatage ISO
 */
export const computeExpiry = (kind, durationDays) => {
  if (kind !== 'temporary_ban') return null;
  const days = Math.min(
    Math.max(Number(durationDays) || DEFAULT_TEMP_BAN_DAYS, 1),
    MAX_TEMP_BAN_DAYS
  );
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
};

/**
 * Une sanction est-elle active a l instant present ?
 *
 * Une sanction temporaire dont l'echeance est passee cesse de s'appliquer
 * TOUTE SEULE. C'est ce qui evite d'avoir a relancer une tache de fond pour
 * lever les expirations, et ce qui garantit qu'un joueur ne reste pas banni
 * parce que le nettoyage n'a pas tourne.
 *
 * @param {{ revokedAt?: string|null, expiresAt?: string|null }} sanction
 * @param {number} [now]
 * @returns {boolean}
 */
export const isSanctionActive = (sanction, now = Date.now()) => {
  if (!sanction) return false;
  if (sanction.revokedAt) return false;
  if (sanction.expiresAt && new Date(sanction.expiresAt).getTime() <= now) return false;
  return true;
};