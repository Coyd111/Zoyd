/**
 * server/cron.mjs - Travaux de fond : archivage, cloture des inscriptions,
 * controle d'integrite, balayage des reglements et reconciliation des
 * retraits.
 *
 * `initCronJobs` est appele UNE SEULE FOIS, depuis realtime-server.mjs.
 *
 * INVARIANT : chaque job prend le MEME verrou que la route correspondante
 *   (`withMatchMutex`, `withLeagueMutex`, `withTournamentMutex`) : un job de
 *   fond et une route ne doivent jamais muter la meme collection en
 *   parallele.
 * INVARIANT : chaque job a une garde ANTI-CHEVAUCHEMENT : un tick lent est
 *   saute et journalise, il n'est jamais empile.
 * INVARIANT : les jobs ne tranchent jamais seuls : ils appellent les
 *   fonctions des moteurs, qui portent les invariants de l'argent.
 * INVARIANT : la reconciliation des retraits ne decide RIEN sur une erreur
 *   de lecture : le payout reste en `pending_review`.
 * PIEGE : `initCronJobs` ne doit etre appele QU'UNE fois : un second appel
 *   doublerait chaque intervalle.
 * PIEGE : les intervalles sont ecrits en dur dans le code : ils ne sont pas
 *   configurables par variable d'environnement.
 * PIEGE : l'archivage change le statut en `archived` (etat terminal) : ce job
 *   ne rembourse pas les passes.
 * PIEGE : le balayage des reglements ne reprend QUE les matchs dont
 *   `payoutDistributed` vaut `'pending'` : un `false` est un refus
 *   VOLONTAIRE de verser.
 * PIEGE : la cloture des inscriptions de ligue passe le statut de
 *   `registering` a `qualifying` et tire les journees : c'est le moment
 *   unique ou la repartition des joueurs est figee.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import {
  getStateCollection,
  replaceStateCollection,
  cleanupExpiredActivationCodes,
  cleanupExpiredPasswordResets,
  cleanupMemoryChatReads,
  cleanupMemoryNotifications,
  cleanupMemoryFriendRequests,
  verifyDataIntegrity,
  listUserIds,
  getUserById,
  tagWalletTransaction,
  forgetWithdrawalKey,
} from './persistence.mjs';
import { createLogger } from './logger.mjs';
import { withMatchMutex, withLeagueMutex, withTournamentMutex } from './mutex.mjs';
import { assignPlayersToDays, getStaleLeagueSeasonIds, cancelStaleLeagueSeasonOnServer, retryPendingLeagueRefunds, countPendingLeagueRefunds, countUncollectableLeagueRefunds, retryPendingLeaguePayouts, countPendingLeaguePayouts } from './league-engine.mjs';
import { getExpiredTournamentIds, cancelStaleTournamentOnServer, retryPendingTournamentRefunds, countPendingTournamentRefunds, countUncollectableTournamentRefunds, retryPendingTournamentPayouts, countPendingTournamentPayouts } from './tournament-engine.mjs';
import { settlePendingMatchResult, expireConfirmationsOnServer, countPendingArbiterFees, retryPendingArbiterFees } from './match-engine.mjs';
import { reconcilePendingWithdrawals } from './wallet-engine.mjs';
import { depositToWallet } from './wallet-engine.mjs';
import { retrieveFedaPayPayout, payoutSucceeded, payoutFailed } from './payment-engine.mjs';
import { getNow } from './utils.mjs';

const log = createLogger('cron');

let arbiterFeeRetryRunning = false;

/**
 * Reprise des commissions d'arbitre non versees.
 *
 * File DISTINCTE de celle des reglements interrompus. Un match dont le
 * versement de la commission a echoue est `finished` : les joueurs sont payes,
 * donc `payoutDistributed` vaut `true`, donc ce match n'entrait dans AUCUNE
 * file. La creance `pendingArbiterFee` etait ecrite, et jamais relue :
 * l'arbitre avait fait son travail et perdait 2 % du pot, sans que rien ne le
 * signale.
 *
 * 30 min et non 60 s : la commission n'est pas une cagnotte gelee, c'est un
 * versement attendu. Et un echec persistant ne doit pas remplir les logs
 * toutes les minutes.
 *
 * Cette fonction est exportee pour etre testee DIRECTEMENT. Une reprise qui
 * n'est appellee par personne a deja existee dans ce projet (V1) : un test
 * qui n'exerce que le moteur, sans le job, ne prouve rien.
 */
export const sweepPendingArbiterFees = async () => {
  if (arbiterFeeRetryRunning) return;
  arbiterFeeRetryRunning = true;
  try {
    await withMatchMutex(async () => {
      const matches = getStateCollection('matches');
      const outstanding = countPendingArbiterFees(matches);
      if (outstanding === 0) return;
      const outcome = await retryPendingArbiterFees(matches);
      if (outcome.retried > 0 || outcome.remaining !== outstanding) {
        await replaceStateCollection('matches', outcome.matches);
      }
      if (outcome.retried > 0) {
        log.warn('Commissions d arbitre rejouees', { retried: outcome.retried });
      }
      if (outcome.remaining > 0) {
        log.error('Commissions d arbitre toujours en echec', { remaining: outcome.remaining });
      }
    });
  } catch (error) {
    log.error('Erreur reprise des commissions d arbitre', error);
  } finally {
    arbiterFeeRetryRunning = false;
  }
};

export const initCronJobs = () => {
  log.info('Service de tâches planifiées initialisé.');

  // Gardes anti-chevauchement : un tick lent (Supabase) ne doit jamais
  // empiler le suivant — on saute le tick et on loggue.
  let matchCleanupRunning = false;
  let leagueCloseRunning = false;

  // Nettoyage des matchs inactifs — toutes les 6 heures
  setInterval(async () => {
    if (matchCleanupRunning) {
      log.warn('Nettoyage matchs sauté : tick précédent encore en cours.');
      return;
    }
    matchCleanupRunning = true;
    try {
      log.info('Démarrage du nettoyage des matchs inactifs...');
      await withMatchMutex(async () => {
        const matches = getStateCollection('matches');

        const fourteenDaysAgoDate = new Date();
        fourteenDaysAgoDate.setDate(fourteenDaysAgoDate.getDate() - 14);
        const fourteenDaysAgo = fourteenDaysAgoDate.toISOString();

        let archivedCount = 0;
        const updatedMatches = matches.map((match) => {
          const dateToCheck = match.updatedAt || match.createdAt;
          if (!dateToCheck) return match;

          const isStale = ['recruiting', 'full', 'check_in'].includes(match.status)
            && dateToCheck < fourteenDaysAgo;

          if (isStale) {
            archivedCount++;
            return {
              ...match,
              status: 'archived',
              updatedAt: getNow(),
              notes: 'Archivé automatiquement pour inactivité (plus de 14 jours).',
            };
          }
          return match;
        });

        if (archivedCount > 0) {
          await replaceStateCollection('matches', updatedMatches);
        }

        log.info(`Nettoyage terminé. ${archivedCount} matchs archivés.`);
      });
    } catch (error) {
      log.error('Erreur lors du nettoyage des matchs', error);
    } finally {
      matchCleanupRunning = false;
    }
  }, 6 * 60 * 60 * 1000);

  // Fermeture automatique des inscriptions ligue — toutes les heures
  setInterval(async () => {
    if (leagueCloseRunning) {
      log.warn('Fermeture ligue sautée : tick précédent encore en cours.');
      return;
    }
    leagueCloseRunning = true;
    try {
      await withLeagueMutex(async () => {
        const seasons = getStateCollection('leagues');
        const now = new Date();
        let changed = false;

        const updatedSeasons = seasons.map((season) => {
          if (season.status !== 'registering') return season;
          if (!season.schedule?.registrationCloses) return season;

          const closesAt = new Date(season.schedule.registrationCloses);
          if (now >= closesAt && season.registeredPlayers.length >= 10) {
            changed = true;
            const playerIds = season.registeredPlayers.map((p) => p.userId || p.id || p);
            const groups = assignPlayersToDays(playerIds);
            const qualificationGroups = {};
            for (const day of Object.keys(groups)) {
              qualificationGroups[day] = {
                players: groups[day],
                matchId: null,
                results: [],
                status: 'scheduled',
              };
            }
            const standings = season.registeredPlayers.map((p) => ({
              userId: p.userId || p.id || p,
              pseudo: p.pseudo,
              totalPoints: 0,
              bestPlacement: 0,
              matchesPlayed: 0,
              placements: [],
            }));
            return {
              ...season,
              status: 'qualifying',
              qualificationGroups,
              standings,
              schedule: {
                ...season.schedule,
                qualifyingStarts: getNow(),
              },
              updatedAt: getNow(),
            };
          }
          return season;
        });

        if (changed) {
          await replaceStateCollection('leagues', updatedSeasons);
          log.info('Inscriptions ligue fermées automatiquement.');
        }
      });
    } catch (error) {
      log.error('Erreur fermeture inscriptions ligue', error);
    } finally {
      leagueCloseRunning = false;
    }
  }, 60 * 60 * 1000);

  // Nettoyage mémoire — toutes les heures
  setInterval(() => {
    try {
      cleanupExpiredActivationCodes();
      cleanupExpiredPasswordResets();
      cleanupMemoryChatReads();
      cleanupMemoryNotifications();
      cleanupMemoryFriendRequests();
      log.info('Nettoyage mémoire terminé.');
    } catch (error) {
      log.error('Erreur nettoyage mémoire', error);
    }
  }, 60 * 60 * 1000);

  // Contrôle d'intégrité — toutes les heures.
  //
  // Le contrôle ne tournait qu'au démarrage : une divergence survenue ensuite
  // (batch `replaceStateCollection` interrompu, mise d'argent orpheline) ne
  // remontait que dans les logs, et le cache de 60 s rendait le démarrage trop
  // peu fréquent pour servir d'alerte. Le résultat est aussi exposé par
  // `getHealthInfo`, donc lisible via /api/health et les métriques.
  let integrityRunning = false;
  const runIntegrityCheck = async () => {
    if (integrityRunning) return;
    integrityRunning = true;
    try {
      const integrity = await verifyDataIntegrity();
      if (!integrity.ok) {
        log.error('Intégrité des données compromise', {
          memoryUsers: integrity.memoryUsers,
          dbUsers: integrity.dbUsers,
          stateMismatches: integrity.stateMismatches,
          walletIssueCount: (integrity.walletIssues || []).length,
          walletIssues: (integrity.walletIssues || []).slice(0, 10),
        });
      }
    } catch (error) {
      log.error('Erreur contrôle intégrité', error);
    } finally {
      integrityRunning = false;
    }
  };
  setInterval(() => { void runIntegrityCheck(); }, 60 * 60 * 1000);
  // Premier passage différé : le contrôle de démarrage vient de tourner, inutile de le refaire.
  setTimeout(() => { void runIntegrityCheck(); }, 30 * 1000).unref?.();

  // Tournois jamais démarrés — libère les passes bloqués (toutes les 6 h).
  // Sans ça, un tournoi resté 'recruiting' (pas assez d'arbitres/équipes)
  // gardait entryFee × teamSize en lockedEntries indefinement.
  let tournamentSweepRunning = false;
  setInterval(async () => {
    if (tournamentSweepRunning) {
      log.warn('Sweep tournois saute : tick precedent encore en cours.');
      return;
    }
    tournamentSweepRunning = true;
    try {
      await withTournamentMutex(async () => {
        const tournaments = getStateCollection('tournaments');
        const expiredIds = getExpiredTournamentIds(tournaments);
        if (expiredIds.length === 0) return;

        let updated = tournaments;
        let totalRefunded = 0;
        for (const id of expiredIds) {
          try {
            const outcome = await cancelStaleTournamentOnServer(
              updated,
              id,
              'Tournoi annule : pas assez d inscriptions avant la date de debut.'
            );
            updated = outcome.tournaments;
            totalRefunded += outcome.refunded;
          } catch (error) {
            log.error('Annulation tournoi expiree echouee', { tournamentId: id, error: error.message });
          }
        }
        if (updated !== tournaments) {
          await replaceStateCollection('tournaments', updated);
          log.warn('Tournois expires annules', { count: expiredIds.length, refunds: totalRefunded });
        }
      });
    } catch (error) {
      log.error('Erreur sweep tournois', error);
    } finally {
      tournamentSweepRunning = false;
    }
  }, 6 * 60 * 60 * 1000);

  // Reprise des reglements de match interrompus — toutes les 60 s.
  // Le reglement se fait en 2 phases : on persiste d'abord le resultat avec
  // payoutDistributed='pending', puis on credite les wallets. Si le process
  // meurt (redemarrage Render) ou si le batch Supabase echoue entre les deux,
  // le match reste 'pending' ET la cagnotte reste gelee DEFINITIVEMENT :
  // settlePendingMatchResult n'etait appele que par les 2 routes HTTP, donc
  // aucun retry n'existait. Ce job est ce retry.
  let pendingSettlementRunning = false;
  const sweepPendingSettlements = async () => {
    if (pendingSettlementRunning) return;
    pendingSettlementRunning = true;
    try {
      await withMatchMutex(async () => {
        let list = getStateCollection('matches');
        // ATTENTION : on ne retente QUE les règlements interrompus. Un
        // résultat 'pending' AVEC confirmationDeadline est en attente de
        // confirmation des équipes : le régler ici viderait la fenêtre que
        // le perdant a pour contester.
        const pending = list.filter((m) => m.result?.payoutDistributed === 'pending' && !m.confirmationDeadline);
        if (pending.length === 0) return;
        log.warn('Reglements de match interrompus : reprise.', { count: pending.length });
        for (const match of pending) {
          try {
            const settled = await settlePendingMatchResult(list, match.id);
            if (settled.match) list = settled.matches;
          } catch (error) {
            log.error('Reprise de reglement echouee', { matchId: match.id, error: error.message });
          }
        }
        await replaceStateCollection('matches', list);
      });
    } catch (error) {
      log.error('Erreur reprise des reglements', error);
    } finally {
      pendingSettlementRunning = false;
    }
  };
  setInterval(() => { void sweepPendingSettlements(); }, 60 * 1000);
  // Au boot : un redemarrage Render est justement le cas le plus probable.
  setTimeout(() => { void sweepPendingSettlements(); }, 15 * 1000);

  // Commission d'arbitre non versee : le job est defini au niveau module
  // (`sweepPendingArbiterFees`) pour etre testable directement.
  setInterval(() => { void sweepPendingArbiterFees(); }, 30 * 60 * 1000);
  setTimeout(() => { void sweepPendingArbiterFees(); }, 45 * 1000);

  // Fin de fenetre de confirmation — toutes les 60 s.
  // Un match en attente dont le delai est depasse est regle AUTOMATIQUEMENT :
  // sans ce job, un joueur absent gelerait la cagnotte indefiniment. Un
  // litige ouvert reste gele (c'est l'admin qui tranche via resolve-dispute).
  let confirmationSweepRunning = false;
  const sweepExpiredConfirmations = async () => {
    if (confirmationSweepRunning) return;
    confirmationSweepRunning = true;
    try {
      await withMatchMutex(async () => {
        const matches = getStateCollection('matches');
        const expiring = matches.filter(
          (m) => m.status === 'awaiting_confirmation'
            && m.confirmationDeadline
            && new Date(m.confirmationDeadline).getTime() <= Date.now(),
        );
        if (expiring.length === 0) return;
        const outcome = await expireConfirmationsOnServer(matches);
        if (outcome.settled.length > 0) {
          await replaceStateCollection('matches', outcome.matches);
          log.warn('Fenetres de confirmation expirees : gains liberes', {
            count: outcome.settled.length,
            failed: outcome.settled.filter((s) => !s.success).map((s) => s.id),
          });
        }
        // Les matchs que le reglement refuse (typiquement : pas d'arbitre)
        // sont isoles — ils ne bloquent plus les autres. Mais ils doivent
        // rester VISIBLES : un match qui ne peut pas etre regle est une
        // cagnotte qui reste gelee, et personne ne doit decouvrir cela en
        // attendant un retrait.
        if (outcome.failed.length > 0) {
          log.error('Reglements refuses a l expiration des confirmations', {
            count: outcome.failed.length,
            matches: outcome.failed.map((f) => `${f.id}:${f.code}`),
          });
        }
      });
    } catch (error) {
      log.error('Erreur expiration des confirmations', error);
    } finally {
      confirmationSweepRunning = false;
    }
  };
  setInterval(() => { void sweepExpiredConfirmations(); }, 60 * 1000);
  setTimeout(() => { void sweepExpiredConfirmations(); }, 25 * 1000);

  // Reprise des remboursements de tournoi restés en echec — toutes les 6 h +
  // au boot. Sans ce retry, un refund rate (utilisateur supprime, mutex, panne
  // Supabase) laissait entryFee x teamSize bloques dans lockedEntries SANS
  // aucun chemin pour les liberer : perte seche.
  let refundRetryRunning = false;
  const sweepPendingRefunds = async () => {
    if (refundRetryRunning) return;
    refundRetryRunning = true;
    try {
      await withTournamentMutex(async () => {
        const tournaments = getStateCollection('tournaments');
        const outstanding = countPendingTournamentRefunds(tournaments);
        if (outstanding === 0) return;
        const outcome = await retryPendingTournamentRefunds(tournaments);
        if (outcome.retried > 0 || outcome.remaining !== outstanding) {
          await replaceStateCollection('tournaments', outcome.tournaments);
        }
        if (outcome.retried > 0) {
          log.warn('Remboursements de tournoi rejoues', { retried: outcome.retried, remaining: outcome.remaining });
        }
        if (outcome.abandoned > 0) {
          // Capitaine supprime : dette close, signalee une fois puis sortie de la
          // file de reprise.
          log.error('Remboursements de tournoi abandonnes: compte supprime', {
            abandoned: outcome.abandoned,
            uncollectableTotal: countUncollectableTournamentRefunds(outcome.tournaments),
          });
        }
        if (outcome.remaining > 0) {
          // Ne subsiste que des echecs recuperables, qui meritent une alerte.
          log.error('Remboursements de tournoi toujours en echec', { remaining: outcome.remaining });
        }
      });
    } catch (error) {
      log.error('Erreur reprise des remboursements', error);
    } finally {
      refundRetryRunning = false;
    }
  };
  setInterval(() => { void sweepPendingRefunds(); }, 6 * 60 * 60 * 1000);
  setTimeout(() => { void sweepPendingRefunds(); }, 20 * 1000);

  // Gains de tournoi non verses (6 h + au boot).
  //
  // File DISTINCTE de celle des remboursements : les gains d'un tournoi clot et
  // d'un classement fige ne se rejouaient nulle part, alors que les
  // remboursements d'un tournoi annule avaient deja leur sweep. Sans ce bloc, un
  // capitaine dont le versement echouait perdait ses ZC sans qu'aucun code ne
  // les retrouve.
  let payoutRetryRunning = false;
  const sweepPendingTournamentPayouts = async () => {
    if (payoutRetryRunning) return;
    payoutRetryRunning = true;
    try {
      await withTournamentMutex(async () => {
        const tournaments = getStateCollection('tournaments');
        const outstanding = countPendingTournamentPayouts(tournaments);
        if (outstanding === 0) return;
        const outcome = await retryPendingTournamentPayouts(tournaments);
        if (outcome.retried > 0 || outcome.remaining !== outstanding) {
          await replaceStateCollection('tournaments', outcome.tournaments);
        }
        if (outcome.remaining > 0) {
          log.error('Gains de tournoi toujours en echec', { remaining: outcome.remaining });
        }
      });
    } catch (error) {
      log.error('Erreur reprise des gains de tournoi', error);
    } finally {
      payoutRetryRunning = false;
    }
  };
  setInterval(() => { void sweepPendingTournamentPayouts(); }, 6 * 60 * 60 * 1000);
  setTimeout(() => { void sweepPendingTournamentPayouts(); }, 25 * 1000);
  // Gains de ligue non verses (6 h + au boot).
  //
  // Les ligues avaient DEUX files de reprise (remboursements de saisons
  // annulees, saisons perimees) et AUCUNE pour les gains : c'etait le seul des
  // trois systemes de reglement du projet sans reprise des versements. Un gain
  // de ligue rate etait definitivement perdu.
  let leaguePayoutRetryRunning = false;
  const sweepPendingLeaguePayouts = async () => {
    if (leaguePayoutRetryRunning) return;
    leaguePayoutRetryRunning = true;
    try {
      await withLeagueMutex(async () => {
        const leagues = getStateCollection('leagues');
        const outstanding = countPendingLeaguePayouts(leagues);
        if (outstanding === 0) return;
        const outcome = await retryPendingLeaguePayouts(leagues);
        if (outcome.retried > 0 || outcome.remaining !== outstanding) {
          await replaceStateCollection('leagues', outcome.leagues);
        }
        if (outcome.remaining > 0) {
          log.error('Gains de ligue toujours en echec', { remaining: outcome.remaining });
        }
      });
    } catch (error) {
      log.error('Erreur reprise des gains de ligue', error);
    } finally {
      leaguePayoutRetryRunning = false;
    }
  };
  setInterval(() => { void sweepPendingLeaguePayouts(); }, 6 * 60 * 60 * 1000);
  setTimeout(() => { void sweepPendingLeaguePayouts(); }, 30 * 1000);

  // Retraits « peut-etre partis » : le payout peut avoir ete traite par FedaPay
  // alors que la reponse s est perdue. La route refuse alors de rembourser — a
  // raison, sinon double versement — et marque le retrait `pending_review`.
  //
  // Ce sweep va le relire aupres du prestataire. C est le SEUL endroit qui le
  // fait : sans lui, un retrait rejete apres coup laissait le joueur debite a
  // jamais, et le seul signe etait une ligne de log.
  let withdrawalReconcileRunning = false;
  const sweepPendingWithdrawals = async () => {
    if (withdrawalReconcileRunning) return;
    withdrawalReconcileRunning = true;
    try {
      const result = await reconcilePendingWithdrawals(
        payoutSucceeded,
        payoutFailed,
        retrieveFedaPayPayout,
        () => listUserIds(),
        () => listUserIds(),
        (userId, txId, patch) => tagWalletTransaction(userId, txId, patch),
        (userId, amount, extra) => depositToWallet(userId, amount, 'Remboursement', {
          type: 'refund',
          description: 'Remboursement - retrait rejete par le prestataire',
          metadata: { reason: 'PAYOUT_REJECTED', ...(extra || {}) },
        }),
        (userId, key) => forgetWithdrawalKey(userId, key),
        (message, detail) => log.warn(message, detail),
      );
      if (result.resolved > 0 || result.refunded > 0) {
        log.warn('Retraits reconcilies', {
          resolved: result.resolved, refunded: result.refunded, stillPending: result.stillPending,
        });
      }
      if (result.stillPending > 0) {
        log.error('Retraits toujours en attente de resolution', { count: result.stillPending });
      }
    } catch (error) {
      log.error('Erreur de reconciliation des retraits', error);
    } finally {
      withdrawalReconcileRunning = false;
    }
  };
  setInterval(() => { void sweepPendingWithdrawals(); }, 30 * 60 * 1000);
  setTimeout(() => { void sweepPendingWithdrawals(); }, 45 * 1000);

  // Ligues jamais lancees — libere les passes bloques (toutes les 6 h + au boot).
  // Sans ce sweep, une saison restee 'registering' faute d'avoir atteint
  // 10 inscrits (le cron de fermeture exige ce seuil) gardait l'entryFee de
  // chaque inscrit bloque dans lockedEntries indefiniment : le joueur ne
  // pouvait ni recuperer son argent ni quitter la ligue. C'etait la seule
  // perte seche du catalogue sans aucun chemin de sortie.
  let staleLeagueRunning = false;
  const sweepStaleLeagues = async () => {
    if (staleLeagueRunning) return;
    staleLeagueRunning = true;
    try {
      await withLeagueMutex(async () => {
        let seasons = getStateCollection('leagues');
        const staleIds = getStaleLeagueSeasonIds(seasons);
        if (staleIds.length === 0) return;

        let totalRefunded = 0;
        for (const id of staleIds) {
          try {
            const outcome = await cancelStaleLeagueSeasonOnServer(
              seasons,
              id,
              'Ligue annulee automatiquement : pas assez d inscriptions avant la date de cloture.',
            );
            seasons = outcome.seasons;
            totalRefunded += outcome.refunded;
          } catch (error) {
            log.error('Annulation de ligue expiree echouee', { seasonId: id, error: error.message });
          }
        }
        await replaceStateCollection('leagues', seasons);
        log.warn('Ligues expirees annulees', { count: staleIds.length, refunds: totalRefunded });
      });
    } catch (error) {
      log.error('Erreur sweep ligues', error);
    } finally {
      staleLeagueRunning = false;
    }
  };
  setInterval(() => { void sweepStaleLeagues(); }, 6 * 60 * 60 * 1000);
  setTimeout(() => { void sweepStaleLeagues(); }, 22 * 1000);

  // Reprise des remboursements de ligue restes en echec — toutes les 6 h + au
  // boot. Meme raison que les tournois : un refund rate (compte supprime,
  // mutex, panne Supabase) laissait l'argent bloque sans issue.
  let leagueRefundRetryRunning = false;
  const sweepPendingLeagueRefunds = async () => {
    if (leagueRefundRetryRunning) return;
    leagueRefundRetryRunning = true;
    try {
      await withLeagueMutex(async () => {
        const seasons = getStateCollection('leagues');
        const outstanding = countPendingLeagueRefunds(seasons);
        if (outstanding === 0) return;
        const outcome = await retryPendingLeagueRefunds(seasons);
        if (outcome.retried > 0 || outcome.remaining !== outstanding) {
          await replaceStateCollection('leagues', outcome.seasons);
        }
        if (outcome.retried > 0) {
          log.warn('Remboursements de ligue rejoues', { retried: outcome.retried, remaining: outcome.remaining });
        }
        if (outcome.abandoned > 0) {
          // Dettes closes : le compte du joueur a ete supprime, il n'y a plus
          // de portefeuille a crediter. Signale UNE fois, puis la ligne sort de
          // `pendingRefunds` — la boucle de WARN identiques est terminée.
          log.error('Remboursements de ligue abandons: compte supprime', {
            abandoned: outcome.abandoned,
            uncollectableTotal: countUncollectableLeagueRefunds(outcome.seasons),
          });
        }
        if (outcome.remaining > 0) {
          // Ne subsiste que des echecs RECUPERABLES : ceux-la meritent une alerte.
          log.error('Remboursements de ligue toujours en echec', { remaining: outcome.remaining });
        }
      });
    } catch (error) {
      log.error('Erreur reprise des remboursements de ligue', error);
    } finally {
      leagueRefundRetryRunning = false;
    }
  };
  setInterval(() => { void sweepPendingLeagueRefunds(); }, 6 * 60 * 60 * 1000);
  setTimeout(() => { void sweepPendingLeagueRefunds(); }, 24 * 1000);
};
