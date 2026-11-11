/**
 * server/cron-lease.mjs - BAIL DISTRIBUE pour les travaux de fond.
 *
 * Le probleme
 * -----------
 * Les jobs de fond (`cron.mjs`) sont proteges par des verrous de PROCESSUS
 * (`withMatchMutex`, `withWalletMutex`) et par des drapeaux
 * `*Running`. Ces deux protections sont valides... a l'interieur d'un seul
 * processus.
 *
 * Or deux instances coexistent pendant un deploiement : l'ancienne (qui
 * termine ses requetes) et la nouvelle (qui demarre). Les deux executent
 * `initCronJobs`, donc les deux balayent les reglements en attente.
 *
 * Concretement, sur le job des reglements de match :
 *   instance A : lit le match 'pending', calcule le partage, credite le
 *                vainqueur, ecrit `payoutDistributed = true` ;
 *   instance B : lit le MEME match 'pending' (son etat memoire est
 *                anterieur), calcule le meme partage, credite le vainqueur.
 *
 * Le credit est protege par la cle d'idempotence des gains
 * (`wallet.winningsKeys`, voir persistence.mjs), donc le joueur n'est pas
 * paye deux fois. MAIS le reste du travail ne l'est pas : le balayage
 * appelle des API externes (FedaPay), incremente des compteurs, et
 * journalise. Deux balayages concurrents, c'est deux appels FedaPay pour le
 * meme retrait, deux notifications, deux ecritures de l'etat.
 *
 * PIEGE : l'etat en memoire etant par instance, l'UNIQUE source qui decide
 *   « ce job tourne-t-il deja ? » est la BASE. Un simple drapeau en memoire
 *   ne dit rien de l'autre instance.
 *
 * La solution
 * -----------
 * Un BAIL en base : une ligne par job, avec un proprietaire et une date
 * d'expiration. L'acquisition est un INSERT qui REFUSE le doublon (code
 * Postgres 23505) : deux instances qui essaient en meme temps, une seule
 * reussit. C'est exactement le meme mecanisme que la revendication
 * d'idempotence FedaPay (`claimTransaction`, persistence.mjs).
 *
 * INVARIANT : un bail expire seul. Si l'instance qui le detient meurt (crash,
 *   redemarrage), le job ne doit pas rester bloque POUR TOUJOURS : le bail
 *   porte une expiration, et une instance peut le REPRENDRE s'il est
 *   expire.
 * INVARIANT : l'echec d'ACQUISITION n'est jamais fatal. Le job est simplement
 *   saute (l'autre instance s'en charge) ; il ne doit surtout pas arreter le
 *   serveur, ni faire echouer l'ecriture d'etat.
 * INVARIANT : en mode memoire (pas de base), le bail est toujours accorde :
 *   il n'y a qu'un processus, le verrou de processus suffit.
 * PIEGE : le bail ne remplace PAS les verrous de processus. Il complete le
 *   dispositif : le verrou protege l'etat memoire, le bail protege contre
 *   l'autre instance.
 */

/**
 * Duree de vie d'un bail, en millisecondes.
 *
 * 10 minutes : assez long pour qu'un balayage lent ( Supabase lent, API
 * FedaPay qui repond mal ) ne soit pas interrompu, assez court pour qu'un
 * crash ne bloque le job que 10 minutes au lieu de pour toujours.
 */
export const CRON_LEASE_TTL_MS = 10 * 60 * 1000;

/** Statuts de l'acquisition. */
export const LEASE_ACQUIRED = 'acquired';
export const LEASE_BUSY = 'busy';
export const LEASE_UNAVAILABLE = 'unavailable';

/**
 * Verifie qu'un bail est encore valide.
 *
 * @param {object|null} row - ligne du bail (ou null)
 * @param {number} nowMs
 * @returns {boolean} true si le bail est encore detenu ET non expire
 */
export const isLeaseValid = (row, nowMs = Date.now()) => {
  if (!row) return false;
  const expiresAt = Date.parse(row?.expiresAt || '');
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > nowMs;
};

/**
 * Le bail est-il reprenable (expire) ?
 *
 * Un bail expire n'appartient plus a personne : l'instance qui le detient a
 * disparu. La reprendre, c'est assurer la continuity du service.
 */
export const isLeaseExpired = (row, nowMs = Date.now()) => {
  if (!row) return true;
  const expiresAt = Date.parse(row?.expiresAt || '');
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= nowMs;
};

/**
 * Calcule l'expiration d'un bail.
 *
 * @param {number} nowMs
 * @param {number} ttlMs
 * @returns {string} horodatage ISO
 */
export const leaseExpiry = (nowMs = Date.now(), ttlMs = CRON_LEASE_TTL_MS) =>
  new Date(nowMs + ttlMs).toISOString();

// ─── Acces base ──────────────────────────────────────────────────────────────
//
// Le bail vit dans un module FEUILLE : il importe `supabase.mjs`
// directement, pas `persistence.mjs`. Raison : `cron.mjs` est teste par
// plusieurs fichiers qui REMPLACENT `persistence.mjs` par un mock (le moteur
// est simule). Un bail loge dans la persistance aurait impose d ajouter
// l'export a chacun de ces mocks, et le moindre oubli aurait casse des
// tests qui n'ont rien a voir avec le sujet.
//
// INVARIANT : ce module n'ecrit QUE dans la table `cron_leases`. Il ne
// touche ni a l'etat des joueurs, ni aux portefeuilles.

import { supabase } from './supabase.mjs';
import { createLogger } from './logger.mjs';
import { INSTANCE_ID } from './instance-id.mjs';

const log = createLogger('cron-lease');

/**
 * La table `cron_leases` existe-t-elle ?
 *
 * Elle est creee par une migration manuelle (cf. `supabase/schema.sql` et
 * `supabase/migrate-cron-leases.sql`). Tant qu'elle manque, le bail est
 * ACCORDE : la protection multi-instance n'est pas activee, mais aucun job
 * ne s'arrete. L'etat est expose dans `/api/health` pour que l'operateur
 * puisse voir que la migration manque.
 *
 * null = pas encore sonde.
 */
let tableAvailable = null;
let tableError = null;

const probeTable = async () => {
  if (!supabase) { tableAvailable = false; return false; }
  if (tableAvailable !== null) return tableAvailable;
  try {
    const { error } = await supabase.from('cron_leases').select('job_name').limit(1);
    tableAvailable = !error;
    tableError = error?.message || null;
    if (error) {
      log.warn('Table cron_leases absente : les jobs de fond ne sont PAS proteges contre l execution en double (migration en attente).', { message: error.message });
    }
  } catch (err) {
    tableAvailable = false;
    tableError = err?.message || null;
    log.warn('Sonde cron_leases impossible', { message: err?.message });
  }
  return tableAvailable;
};

/** L'etat de la table des bails est-il connu et favorable ? */
export const isCronLeaseTableAvailable = () => tableAvailable === true;

/** Etat de la table des bails, pour `/api/health`. */
export const getCronLeaseHealth = () => ({
  available: tableAvailable === true,
  error: tableError,
});

/** Test hook : rejoue la sonde (l'etat est memorise). */
export const resetCronLeaseStateForTests = () => {
  tableAvailable = null;
  tableError = null;
};

/**
 * Tente d'obtenir le bail d'un job de fond.
 *
 * @param {string} jobName - identite du job (ex. `sweepPendingSettlements`)
 * @param {object} [options]
 * @param {number} [options.ttlMs] - duree de vie du bail
 * @param {string} [options.holder] - proprietaire (par defaut : cette instance)
 * @returns {Promise<{ acquired: boolean, reason: string }>}
 */
export const acquireCronLease = async (jobName, options = {}) => {
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : CRON_LEASE_TTL_MS;
  const holder = options.holder || INSTANCE_ID;
  const maintenant = Date.now();
  const expiresAt = leaseExpiry(maintenant, ttlMs);

  // Pas de base : un seul processus, le verrou de processus suffit.
  if (!supabase) return { acquired: true, reason: 'memoire' };

  const disponible = await probeTable();
  if (!disponible) return { acquired: true, reason: 'table-absente' };

  // INSERT atomique : refuse le doublon (23505). C'est le meme mecanisme que
  // la reservation FedaPay (`claimTransaction`).
  const { error: erreurInsert } = await supabase
    .from('cron_leases')
    .insert({ job_name: jobName, holder, acquired_at: maintenant, expires_at: expiresAt });
  if (!erreurInsert) return { acquired: true, reason: 'acquis' };

  if (erreurInsert.code !== '23505') {
    // Panne de la base : on NE BLOQUE PAS le job. Un job de fond qui ne
    // tourne pas, c'est de l'argent qui ne bouge pas ; un job qui tourne en
    // double, c'est de l'argent qui bouge deux fois. Le second risque est
    // borne (cles d'idempotence), le premier ne l'est pas.
    log.error('Bail de cron indisponible : le job s execute sans protection multi-instance', {
      job: jobName, message: erreurInsert.message,
    });
    return { acquired: true, reason: 'erreur-base' };
  }

  // Le bail existe deja. Il peut etre detenu par l autre instance (on
  // s arrete) ou EXPIRE (on le reprend).
  const { data: lignes } = await supabase
    .from('cron_leases')
    .select('job_name, holder, expires_at')
    .eq('job_name', jobName)
    .limit(1);
  const row = Array.isArray(lignes) ? lignes[0] : null;

  if (row && !isLeaseExpired({ expiresAt: row.expires_at }, maintenant)) {
    return { acquired: false, reason: 'busy' };
  }

  // Bail expire : on le reprend. L UPDATE est conditionnel sur
  // l expiration observee : si l autre instance l a repris entre-temps,
  // 0 ligne est touchee et l on s arrete aussi.
  const { data: touches } = await supabase
    .from('cron_leases')
    .update({ holder, acquired_at: maintenant, expires_at: expiresAt })
    .eq('job_name', jobName)
    .lt('expires_at', new Date(maintenant).toISOString())
    .select('job_name');
  if (Array.isArray(touches) && touches.length === 1) {
    log.info('Bail de cron repris (expire)', { job: jobName, ancienHolder: row?.holder || null });
    return { acquired: true, reason: 'repris' };
  }
  return { acquired: false, reason: 'busy' };
};

/**
 * Rend le bail d'un job de fond.
 *
 * @param {string} jobName
 * @param {object} [options]
 * @param {boolean} [options.force] - rend le bail meme sans en etre le
 *   proprietaire (nettoyage administratif ; un job en cours sur l autre
 *   instance ne doit PAS etre vole par accident).
 * @param {string} [options.holder] - proprietaire attendu
 */
export const releaseCronLease = async (jobName, options = {}) => {
  if (!supabase) return false;
  const disponible = await probeTable();
  if (!disponible) return false;
  const holder = options.holder || INSTANCE_ID;
  let requete = supabase.from('cron_leases').delete().eq('job_name', jobName);
  if (!options.force) requete = requete.eq('holder', holder);
  const { error } = await requete;
  if (error) {
    log.error('Liberation du bail de cron impossible', { job: jobName, message: error.message });
    return false;
  }
  return true;
};

/**
 * Execute un job de fond SOUS BAIL : une seule instance le traite a la fois.
 *
 * Le bail est rendu dans un `finally` : un job qui echoue ne doit pas
 * laisser le verrou bloque pendant 10 minutes.
 *
 * @param {string} jobName
 * @param {Function} fn - le job
 * @param {object} [options]
 * @returns {Promise<boolean>} false si le job a ete saute (bail detention par
 *   l autre instance)
 */
export const withCronLease = async (jobName, fn, options = {}) => {
  const bail = await acquireCronLease(jobName, options);
  if (!bail.acquired) {
    log.info('Job de fond ignore : une autre instance le traite', { job: jobName, raison: bail.reason });
    return false;
  }
  try {
    await fn();
    return true;
  } finally {
    await releaseCronLease(jobName, { holder: options.holder });
  }
};
