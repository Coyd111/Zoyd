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

/**
 * Intervalle minimum entre deux traces NORMALES d un meme job (ms).
 *
 * PIEGE : le volume. Un job de fond tourne toutes les minutes ; sans
 * deduplication, l historique stockait ~4 300 lignes par JOUR (mesure en
 * production : 47 lignes en 15 min 45 s). A 30 jours de retention, cela
 * fait ~130 000 lignes, soit une centaine de mo sur le plan gratuit de
 * Supabase (500 Mo au total) — pour une trace de diagnostic.
 *
 * On ne garde donc qu UNE trace normale par job et par heure. Ce qui est
 * RARE reste conserve en totalite : un refus de bail (une autre instance
 * detenait le job), une erreur de base, un job execute sans protection.
 * Ce sont ces evenements-la qu on cherche en premier, et ils sont rares —
 * donc peu volumineux.
 */
export const TRACE_INTERVAL_MS = 60 * 60 * 1000;


/**
 * Derniere trace NORMALE ecrite, par job (epoch ms).
 *
 * Sert a la deduplication : une trace normale n est ecrite qu une fois par
 * heure et par job. Les evenements RARES (refus, erreur, job sans
 * protection) ne passent pas par ici : ils sont TOUJOURS ecruits.
 */
const dernierTraceNormale = new Map();

/**
 * Un evenement est-il ANORMAL (donc toujours conserve) ?
 *
 * Anormal = le bail n a pas ete obtenu (`busy` : une autre instance
 * detenait le job), la base a refuse (erreur), ou le job a ete execute sans
 * protection (`table-absente`). Ce sont precisement les evenements qu on
 * cherche quand on diagnostique : ils doivent etre exhaustifs.
 */
const estAnormal = (evenement) => {
  if (!evenement.acquired) return true;
  const raison = String(evenement.reason || '');
  return !['acquis', 'repris', ''].includes(raison);
};

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

  // Deduplication : une trace NORMALE par job et par heure. Sans elle, la
  // table poussait ~4 300 lignes par jour (mesure en production) — soit
  // ~130 000 lignes a 30 jours de retention, pour une trace de diagnostic.
  if (!estAnormal(evenement)) {
    const precedente = dernierTraceNormale.get(jobName) || 0;
    if (acquiredAt - precedente < TRACE_INTERVAL_MS) return false;
    dernierTraceNormale.set(jobName, acquiredAt);
  }

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
    // PIEGE : pas de `limit()` ici. `DELETE ... RETURNING id LIMIT n` est
    // INVALIDE en SQL (erreur 42601, « syntax error at or near "limit" »,
    // reproduite en production) : la purge echouait donc SILENCIEUSEMENT,
    // et la table grossissait de ~4 300 lignes par jour sans borne.
    // Le DELETE reste un statement unique : PostgreSQL le fait en un scan,
    // et il ne bloque pas les INSERT (verrou ROW EXCLUSIVE).
    const { data, error } = await supabase
      .from('cron_lease_audit')
      .delete()
      .lt('acquired_at', seuil)
      // `RETURNING id` : sans lui, PostgREST ne renvoie rien et le nombre de
      // lignes purgees resterait a zero — donc invisible dans la sonde.
      .select('id');
    if (error) {
      log.warn('Purge de l historique des bails impossible', { message: error.message });
      etatPurge.derniereErreur = error.message;
      etatPurge.derniereExecutionAt = new Date().toISOString();
      return 0;
    }
    const purgees = Array.isArray(data) ? data.length : 0;
    etatPurge.dernierSuccesAt = new Date().toISOString();
    etatPurge.derniereErreur = null;
    etatPurge.lignesPurgees = purgees;
    if (purgees > 0) log.info('Historique des bails purge', { purgees, retentionDays });
    return purgees;
  } catch (err) {
    log.warn('Purge de l historique des bails impossible', { message: err?.message });
    etatPurge.derniereErreur = err?.message || String(err);
    etatPurge.derniereExecutionAt = new Date().toISOString();
    return 0;
  }
};

/**
 * Etat de la purge, pour `/api/health`.
 *
 * PIEGE : une purge qui ECHOUE doit etre visible. C est exactement le piege
 * qu on vient de corriger : le `limit()` invalide faisait echouer la purge
 * silencieusement, et rien ne le signalait — la table grossissait sans que
 * personne ne le voie. Le compteur de lignes purgees et la derniere erreur
 * sont donc publies.
 */
const etatPurge = {
  dernierSuccesAt: null,
  derniereErreur: null,
  derniereExecutionAt: null,
  lignesPurgees: 0,
};

/** Etat de la purge de l historique, pour `/api/health`. */
export const getCronLeaseAuditPurgeHealth = () => ({
  ...etatPurge,
  retentionDays: AUDIT_RETENTION_DAYS,
});

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
  dernierTraceNormale.clear();
  etatPurge.dernierSuccesAt = null;
  etatPurge.derniereErreur = null;
  etatPurge.derniereExecutionAt = null;
  etatPurge.lignesPurgees = 0;
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
