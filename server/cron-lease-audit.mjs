/**
 * server/cron-lease-audit.mjs - HISTORIQUE durable des prises de bail.
 *
 * Pourquoi un historique, alors que les compteurs existent
 * ------------------------------------------------------
 * Les compteurs de `cron-lease.mjs` repondent a « la protection
 * multi-instance fonctionne-t-elle MAINTENANT ? ». Ils sont en MEMOIRE : ils
 * repartent a zero au redemarrage de l'instance (Render l'hiberne, donc
 * le compteur retombe a zero plusieurs fois par jour).
 *
 * Une question d'exploitation est differente : « la protection a-t-elle
 * DEJA echoue, un jour, sur un job donne ? ». C'est une question
 * HISTORIQUE. Les compteurs y repondent par « je ne sais pas » — ils ont
 * forget.
 *
 * Concretement, les deux defauts de production vus apres le deploiement du
 * bail (INSERT refuse pour un BIGINT, sonde memorisee definitivement) etaient
 * invisibles pour l operateur : le booleen disait `true`, les compteurs
 * n'existaient pas encore, et la table des bails etait vide entre deux
 * jobs (le bail est RELACHE a la fin de chaque job). Il n'y avait AUCUN
 * endroit ou constater qu'un job tournait sans protection.
 *
 * Cet historique est cet endroit. Il est durable : il survit au
 * redemarrage de l'instance.
 *
 * INVARIANT : l'ecriture de l'historique ne doit JAMAIS faire echouer un
 *   job. C'est une trace de diagnostic, pas une condition d'execution : si
 *   l'insertion echoue, le job continue (fail-open, comme le bail).
 * INVARIANT : l'historique est RETENTIONNE — il ne doit pas grossir sans
 *   borne. Les lignes trop anciennes sont purgees.
 * PIEGE : la purge ne doit pas PLAGIER les jobs : elle filtre sur
 *   `acquired_at`, pas sur le job.
 */

import { supabase } from './supabase.mjs';
import { createLogger } from './logger.mjs';
import { INSTANCE_ID } from './instance-id.mjs';

const log = createLogger('cron-lease-audit');

/**
 * Duree de retention de l'historique (jours).
 *
 * 30 jours : assez pour couvrir un incident decouvert tard (un deploy qui
 * laisse une instance en hibernation, une alarme mensuelle), assez court
 * pour que la table reste petite.
 */
export const AUDIT_RETENTION_DAYS = 30;

/** Nombre maximum de lignes purgees par passage (evite un DELETE enorme). */
const PURGE_BATCH = 500;

/**
 * Enregistre une prise de bail.
 *
 * @param {object} evenement
 * @param {string} evenement.jobName - job de fond concerne
 * @param {boolean} evenement.acquired - le bail a-t-il ete obtenu ?
 * @param {string} [evenement.reason] - motif (acquis, busy, erreur-base...)
 * @param {number} [evenement.acquiredAt] - epoch ms
 * @param {number} [evenement.durationMs] - duree du job, si connu
 * @returns {Promise<boolean>} false si l trace n a pas pu etre ecrite
 */
export const recordLeaseEvent = async (evenement = {}) => {
  if (!supabase) return false;
  const jobName = evenement.jobName;
  if (!jobName) return false;

  const acquiredAt = Number.isFinite(evenement.acquiredAt)
    ? evenement.acquiredAt
    : Date.now();

  try {
    const { error } = await supabase.from('cron_lease_audit').insert({
      job_name: jobName,
      holder: evenement.holder || INSTANCE_ID,
      acquired: Boolean(evenement.acquired),
      reason: evenement.reason || null,
      acquired_at: acquiredAt,
      duration_ms: Number.isFinite(evenement.durationMs) ? Math.round(evenement.durationMs) : null,
    });
    if (error) {
      // Un echec ici est sans consequence sur le job : on le signale, mais
      // on ne leve rien.
      log.warn('Historique du bail non ecrit', { job: jobName, message: error.message });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('Historique du bail non ecrit', { job: jobName, message: err?.message });
    return false;
  }
};

/**
 * Purge l'historique au-dela de la retention.
 *
 * `acquired_at` est un epoch ms (BIGINT), comme dans `cron_leases` : la
 * comparaison se fait donc en ENTIERS. Comparer une chaine ISO a un BIGINT
 * echouerait (« invalid input syntax for type bigint ») — le defaut exact
 * qui a produit l'incident du bail.
 *
 * @param {number} [retentionDays]
 * @returns {Promise<number>} nombre de lignes purgees
 */
export const purgeLeaseAudit = async (retentionDays = AUDIT_RETENTION_DAYS) => {
  if (!supabase) return 0;
  const seuil = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  try {
    // On borne le nombre de lignes supprimees par passage : un DELETE massif
    // sur une table deja grande bloquerait la base.
    const { data, error } = await supabase
      .from('cron_lease_audit')
      .delete()
      .lt('acquired_at', seuil)
      .select('id')
      .limit(PURGE_BATCH);
    if (error) {
      log.warn('Purge de l historique des bails impossible', { message: error.message });
      return 0;
    }
    const purgees = Array.isArray(data) ? data.length : 0;
    if (purgees > 0) log.info('Historique des bails purge', { purgees, retentionDays });
    return purgees;
  } catch (err) {
    log.warn('Purge de l historique des bails impossible', { message: err?.message });
    return 0;
  }
};

/**
 * La table d historique existe-t-elle ?
 *
 * Meme principe que la sonde des bails : la table est OPTIONNELLE (migration
 * manuelle) et son absence ne doit rien arreter.
 *
 * PIEGE : le resultat NEGATIF ne doit PAS etre memorise DEFINITIVEMENT.
 * La migration est jouee par un humain, A N IMPORTE QUEL MOMENT : si
 * l instance a sonde une fois l absence de la table, elle doit pouvoir la
 * voir apparaitre SANS redemarrage. C est exactement le defaut corrige sur
 * la sonde des baux (production : serveur demarre a 11:36, migration jouee
 * a 11:42, protection restee inactive jusqu au redeploiement suivant).
 *
 * null = pas encore sonde.
 */
let auditAvailable = null;
let lastAuditProbeAt = 0;

/** Delai minimum entre deux sondes lorsque la table est absente. */
export const AUDIT_PROBE_INTERVAL_MS = 60 * 1000;

export const isCronLeaseAuditAvailable = () => auditAvailable === true;

/** Test hook : rejoue la sonde. */
export const resetCronLeaseAuditStateForTests = () => {
  auditAvailable = null;
  lastAuditProbeAt = 0;
};

const probeAuditTable = async () => {
  if (!supabase) { auditAvailable = false; return false; }
  // Resultat positif : la table existe, elle ne disparait pas. Inutile de
  // re-sonder.
  if (auditAvailable === true) return true;
  // Resultat negatif : on re-sonde, mais pas plus souvent que
  // `AUDIT_PROBE_INTERVAL_MS` (une migration peut avoir ete jouee entre-temps).
  const maintenant = Date.now();
  if (auditAvailable === false && maintenant - lastAuditProbeAt < AUDIT_PROBE_INTERVAL_MS) {
    return false;
  }
  lastAuditProbeAt = maintenant;
  try {
    const { error } = await supabase.from('cron_lease_audit').select('id').limit(1);
    const nouveau = !error;
    if (nouveau && auditAvailable === false) {
      log.info('Table cron_lease_audit presente : l historique durable des bails est actif.');
    }
    auditAvailable = nouveau;
    if (error) {
      log.warn('Table cron_lease_audit absente : pas d historique durable des bails (migration en attente).', {
        message: error.message,
      });
    }
  } catch (err) {
    auditAvailable = false;
    log.warn('Sonde cron_lease_audit impossible', { message: err?.message });
  }
  return auditAvailable;
};

/**
 * Etat de l historique durable, pour `/api/health`.
 *
 * `available` dit si la table est detectee. C'est le SEUL signal qui
 * permet a l operateur de verifier, sans connexion SQL, que la migration
 * `supabase/migrate-cron-lease-audit.sql` est effective.
 */
export const getCronLeaseAuditHealth = () => ({
  available: auditAvailable === true,
  // null = pas encore sonde ; false = table absente.
  error: auditAvailable === false ? 'table absente' : null,
});

/**
 * Enregistre une prise de bail, si la table d historique existe.
 *
 * C'est le point d'entree appele par `cron-lease.mjs` : la table d
 * historique est un complement, jamais une condition.
 */
export const recordLeaseEventIfAvailable = async (evenement = {}) => {
  const disponible = await probeAuditTable();
  if (!disponible) return false;
  return recordLeaseEvent(evenement);
};
