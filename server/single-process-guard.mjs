/**
 * Verrou d'unicite du processus.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * L'etat des joueurs vit en memoire. Chaque mutation fait un
 * lecture-modification-ecriture du payload complet, sous un verrou cree par
 * `async-mutex` — donc un verrou de PROCESSUS.
 *
 * Tant qu'un seul processus tourne, c'est correct. Des qu'il y en a deux
 * (deux instances Render pendant un deploiement, ou une mise a l'echelle), deux
 * mutations concurrentes lisent le MEME instantane, calculent chacune leur
 * resultat, et la derniere ecriture remplace la premiere :
 *
 *   instance A : lit solde 1 000, retire 800  -> ecrit solde 200
 *   instance B : lit solde 1 000, credite 500 -> ecrit solde 1 500
 *   resultat   : solde 1 500. Les 800 de A ont disparu.
 *
 * Aucun verrou ne l'empeche : ils sont dans deux espaces memoire differents.
 * Et rien ne les remarque : `/api/health` reste vert, parce que chaque instance
 * est individuellement coherente.
 *
 * Pourquoi refuser de demarrer
 * -----------------------------
 * L'alternative — demarrer et journaliser un avertissement — a deja ete le
 * statu quo, et le doc affirmait une garantie que rien n'appliquait. Un serveur
 * qui tourne en acceptant de l'argent risque de le perdre ; un serveur qui ne
 * demarre pas, non. Un operateur voit le motif dans les logs et corrige.
 */

import cluster from 'node:cluster';

/**
 * Le nombre de processus que l'outillage de lancement en a decides.
 * `cluster` suit la variable d'environnement elle-meme (c'est ainsi que
 * `async-mutex` documente son integration cluster). On lit donc la variable
 * plutot que de deviner depuis le nombre de sockets ouverts : `cluster` peut
 * demarrer des workers meme avec `WEB_CONCURRENCY` absent.
 *
 * Valeur illisible : on ne sait pas si le lancement est multi-processus, donc
 * on ne peut ni affirmer le multi-processus (et casser un service qui
 * fonctionne) ni l'ignorer. C'est le SEUL cas ou l'on demarre malgre tout, avec
 * un avertissement explicite.
 *
 * Le defaut de cette protection est donc borne et connu : si quelqu'un lance
 * deux processus SANS passer par `WEB_CONCURRENCY` ni `cluster` — c'est-a-dire
 * avec deux commandes de demarrage independantes, ce que Render ne fait pas —
 * rien ne le detecte. Ce cas est traite dans `docs/audit/02-argent.md`.
 */
const VALEUR_ATTENDUE = Symbol('valeur-illisible');

const requestedWorkers = () => {
  const brut = process.env.WEB_CONCURRENCY;
  if (brut === undefined || brut === null || brut === '') return 1;
  const n = Number.parseInt(brut, 10);
  if (!Number.isFinite(n) || n < 1) return VALEUR_ATTENDUE;
  return n;
};

/**
 * Le processus est-il le worker principal d'un cluster ?
 *
 * `cluster.isPrimary` vaut `true` aussi dans un lancement simple, donc cette
 * fonction seule ne prouve rien : c'est `requestedWorkers() > 1` qui est le
 * signal, et `isPrimary === false` qui prouve qu'on est worker.
 */
export const isClusterWorker = () =>
  typeof cluster !== 'undefined' && Boolean(cluster?.isPrimary === false);

/**
 * Le serveur tourne-t-il avec plus d'un processus ?
 *
 * Une variable illisible ne prouve rien : on repond `false` pour ne pas
 * confondre « je ne sais pas » et « je sais que c'est bon ».
 *
 * @returns {boolean}
 */
export const isMultiProcess = () => {
  const demande = requestedWorkers();
  if (demande === VALEUR_ATTENDUE) return false;
  return demande > 1 || isClusterWorker();
};

/**
 * La variable est-elle presente mais illisible ?
 *
 * Cas distinct : le garde laisse demarrer (voir le commentaire de
 * `requestedWorkers`), mais en le signalant. `/api/health` l'expose, pour que
 * l'anomalie se voie sans avoir a lire les logs.
 */
export const hasIllegibleConcurrencyConfig = () => requestedWorkers() === VALEUR_ATTENDUE;

/**
 * Verifie l'unicite du processus, et leve si ce n'est pas le cas.
 *
 * A appeler AVANT tout chargement d'etat : charger puis refuser laisserait
 * des mutations en cours sur un etat qu'on ne pilote pas.
 *
 * Le refus est limite aux CAS CERTAINS (cluster actif, ou `WEB_CONCURRENCY`
 * explicitement superieure a 1). Une valeur illisible est signalee mais laisse
 * demarrer : arreter un service qui fonctionne sur une faute de frappe serait
 * un dommage plus certain que celui qu'on cherche a eviter.
 *
 * @param {{ log?: { error: Function, warn?: Function } }} [deps] injectable pour les tests
 */
export const assertSingleProcess = (deps = {}) => {
  const err = deps.log?.error || console.error;
  const warn = deps.log?.warn || console.warn;

  if (isMultiProcess()) {
    const message = 'Refus de demarrer : le serveur exige un processus unique.';
    err(message, {
      webConcurrency: process.env.WEB_CONCURRENCY ?? null,
      clusterWorker: isClusterWorker(),
      raison: "Deux instances partagent l'etat des joueurs en memoire et se",
      consequence:
        "ecrasent mutuellement sur le read-modify-write du payload complet (pertes d'argent silencieuses).",
      correctif: 'WEB_CONCURRENCY=1, ou un verrou distribue / OCC en base.',
    });
    throw new Error(message);
  }

  if (hasIllegibleConcurrencyConfig()) {
    warn(
      'WEB_CONCURRENCY est illisible : unicite du processus NON verifiee',
      {
        valeur: process.env.WEB_CONCURRENCY,
        impact:
          "Si le lancement est reellement multi-processus, l'ecrasement des mutations reste possible.",
        correctif: 'WEB_CONCURRENCY=1 (entier).',
      }
    );
  }
  return true;
};