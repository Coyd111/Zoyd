/**
 * server/instance-id.mjs - Identite de CETTE instance de serveur.
 *
 * Pendant un deploiement, Render fait coexister l'ancienne et la nouvelle
 * instance : les deux servent en parallele, avec deux etats en memoire
 * differents. C'est une limite CONNUE et BORNEE (le garde-fou multi-processus
 * ne voit pas ce cas, cf. single-process-guard.mjs), mais elle doit etre
 * VISIBLE et, surtout, elle doit pouvoir etre ARBITREE : deux instances qui
 * traitent le meme travail en double paie deux fois.
 *
 * Ce module est une FEUILLE : il n'importe rien du projet. Il peut donc etre
 * utilise par `persistence.mjs` (sonde de sante) comme par `cron-lease.mjs`
 * (bail de cron) sans creer de cycle.
 *
 * INVARIANT : l'identite est stable pour toute la duree du processus. Elle
 *   sert de « proprietaire » d'un bail : un bail doit pouvoir etre relache
 *   par celui qui l'a pris, et aucun autre.
 * PIEGE : `RENDER_INSTANCE_ID` n'existe que chez Render. En local, on retombe
 *   sur `HOSTNAME`, puis sur le PID : les trois sont stables pour la duree du
 *   processus, ce qui suffit.
 */

const INSTANCE_ID = process.env.RENDER_INSTANCE_ID
  || process.env.HOSTNAME
  || `local-${process.pid}`;

const PROCESS_STARTED_AT = new Date().toISOString();

/**
 * Identite de l'instance courante.
 *
 * @returns {{ instanceId: string, processStartedAt: string, pid: number }}
 */
export const getInstanceInfo = () => ({
  instanceId: INSTANCE_ID,
  processStartedAt: PROCESS_STARTED_AT,
  pid: process.pid,
});

export { INSTANCE_ID };
