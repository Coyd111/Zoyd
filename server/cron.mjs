/**
 * server/cron.mjs - Travaux de fond : archivage, cloture des inscriptions,
 * controle d'integrite, balayage des reglements et reconciliation des
 * retraits.
 *
 * `initCronJobs` est appele UNE SEULE FOIS, depuis realtime-server.mjs.
 *
 * INVARIANT : chaque job prend le MEME verrou que la route correspondante
 *   (`withMatchMutex`, `withLeagueMutex`, `withTournamentMutex`,
 *   `withBrLobbyMutex` pour les salons BR) : un job de fond et une route ne
 *   doivent jamais muter la meme collection en parallele. Les jobs
 *   `sweepPendingSettlements`, `sweepExpiredConfirmations`,
 *   `sweepPendingArbiterFees`, `sweepPendingBrSettlements` et
 *   `sweepStaleBrLobbies` sont exportes pour les tests de cablage, en plus
 *   d'etre branches sur leurs intervalles.
 * INVARIANT : les ecritures BR passent par `saveBrLobbies`, PAR ENTITE (C2) :
 *   le remplacement en bloc ecrasait les actions concurrentes d'autres salons
 *   et SUPPRIMAIT les entites absentes de l'instantane (passes bloques sans
 *   issue).
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
 *   VOLONTAIRE de verser. Un `'pending'` avec `confirmationDeadline` est
 *   une fenetre de contestation OUVERTE : regle ici seulement si le statut
 *   vaut `disputed` ET le litige est clos (C3 : le reglement de la
 *   resolution de litige est passe en echec — le match a une dette, pas un
 *   litige).
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
import { withMatchMutex, withLeagueMutex, withTournamentMutex, withBrLobbyMutex } from './mutex.mjs';
import { assignPlayersToDays, getStaleLeagueSeasonIds, cancelStaleLeagueSeasonOnServer, retryPendingLeagueRefunds, countPendingLeagueRefunds, countUncollectableLeagueRefunds, retryPendingLeaguePayouts, countPendingLeaguePayouts } from './league-engine.mjs';
import { getExpiredTournamentIds, cancelStaleTournamentOnServer, retryPendingTournamentRefunds, countPendingTournamentRefunds, countUncollectableTournamentRefunds, retryPendingTournamentPayouts, countPendingTournamentPayouts } from './tournament-engine.mjs';
import { settlePendingMatchResult, expireConfirmationsOnServer, countPendingArbiterFees, retryPendingArbiterFees } from './match-engine.mjs';
import { retryPendingBrSettlements, countStaleBrLobbies, getStaleBrLobbyIds, cancelStaleBrLobbyOnServer } from './br-engine.mjs';
import { reconcilePendingWithdrawals, refundRejectedWithdrawal } from './wallet-engine.mjs';
import { retrieveFedaPayPayout, payoutSucceeded, payoutFailed } from './payment-engine.mjs';
import { saveBrLobbies } from './state-helpers.mjs';
import { getNow } from './utils.mjs';

const log = createLogger('cron');

let arbiterFeeRetryRunning = false;
let pendingSettlementRunning = false;
let confirmationSweepRunning = false;

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

// ─── Matchs : reprise des reglements interrompus et fenetres expirees ───────

/**
 * Retente les reglements de match interrompus (60 s + au boot).
 *
 * Un règlement se fait en deux phases : le resultat est persiste d'abord, la
 * monnaie est verse ensuite. Un arret de processus entre les deux laissait un
 * match `'pending'` definitivement sans reprise. Ce job est ce retry.
 *
 * C3 (audit-2) — le filtre visait `pending && !confirmationDeadline`. Or
 * `resolveDisputeOnServer` laisse, en echec de reglement, un match
 * `disputed` AVEC deadline : repris par AUCUN des quatre filtres (le
 * present job exige l'absence de deadline, `sweepExpiredConfirmations`
 * exige `awaiting_confirmation`, l'automation saute `disputed`), son
 * sequestre restait bloque pour toujours.
 *
 * Desormais le job vise aussi les matchs `disputed` dont le litige est
 * CLOS : deadline maintenue ou non, la reprise devient possible. La garde
 * `settlePendingMatchResult` refuse toujours un litige OUVERT, et la
 * reprise est idempotente — les joueurs deja payes sont ignores.
 */
export const sweepPendingSettlements = async () => {
  if (pendingSettlementRunning) return;
  pendingSettlementRunning = true;
  try {
    await withMatchMutex(async () => {
      let list = getStateCollection('matches');
      const litigeOuvert = (m) => (m.disputes || [])
        .some((d) => d.status === 'open' || d.status === 'under_review');
      // Deux vagues, un seul balayage :
      //   1. reglement interrompu : `'pending'` sans fenetre de confirmation
      //      (une fenetre presente couvre la contestation du perdant ;
      //      `settlePendingMatchResult` refuse en outre un litige ouvert) ;
      //   2. litige CLOS restant `disputed` sur un reglement passe en echec
      //      (C3 ; desormais impossible via `resolveDisputeOnServer`, mais
      //      les etats historiques de la base recoivent cette deuxieme
      //      chance).
      const pending = list.filter(
        (m) => m.result?.payoutDistributed === 'pending'
          && !litigeOuvert(m)
          && (!m.confirmationDeadline || m.status === 'disputed'),
      );
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

/**
 * Ferme les fenetres de confirmation expirees (60 s + au boot).
 *
 * Un match en attente dont le delai est depasse est regle AUTOMATIQUEMENT :
 * sans ce job, un joueur absent gelerait la cagnotte indefiniment. Un
 * litige ouvert reste gele (c'est l'admin qui tranche via resolve-dispute).
 */
export const sweepExpiredConfirmations = async () => {
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

// ─── BR : reprise des reglements interrompus (sweepPendingBrSettlements) ────

let brSettlementRetryRunning = false;

/**
 * Reprise des reglements BR interrompus.
 *
 * C2 (audit-2) — le job ne prenait AUCUN verrou et reecrivait la collection
 * ENTIERE par-dessus un instantane : une presence cochee, ou un salon cree
 * entre la lecture et l'ecriture, disparaissait de la base (et de la memoire),
 * et les passes bloques n'avaient plus de chemin de sortie.
 *
 * Desormais, salon par salon :
 *   1. le meme verrou que la route d'action (`withBrLobbyMutex`) ;
 *   2. la collection EST RELITE dans le verrou ;
 *   3. l'ecriture passe par `saveBrLobbies`, PAR ENTITE — un salon dont le
 *      statut vient d'etre solde par la route, ou un salon concurrent, ne peut
 *      plus etre ecrase.
 *
 * Le verrou PAR SALON suffit depuis que l'ecriture ne touche plus que
 * l'entite modifiee : deux salons se reprennent en parallele sans s'ecraser.
 */
export const sweepPendingBrSettlements = async () => {
  if (brSettlementRetryRunning) {
    log.warn('Job reprise reglements BR deja en cours : tick saute.');
    return;
  }
  brSettlementRetryRunning = true;
  try {
    const ids = getStateCollection('brLobbies')
      .filter((l) => l && l.status === 'settling')
      .map((l) => l.id);
    if (ids.length === 0) return;

    let retried = 0;
    let remaining = 0;
    for (const lobbyId of ids) {
      const reprise = await withBrLobbyMutex(lobbyId, async () => {
        // On RELIT dans le verrou : l'instantane du dessus peut etre vieux.
        const fresh = getStateCollection('brLobbies');
        const cible = fresh.find((l) => l && l.id === lobbyId && l.status === 'settling');
        // Deja solde par la route (ou par un tick concurrent) : plus rien a faire.
        if (!cible) return { retried: false, remaining: false };
        const actor = cible.arbiterId ? getUserById(cible.arbiterId) : null;
        if (!actor) {
          log.error('Reglement BR non reprenable : arbitre introuvable', { lobbyId });
          return { retried: false, remaining: true };
        }
        try {
          // L'acteur du reglement est l'ARBITRE DU SALON : c'est lui que
          // `requireLobbyArbiter` verifie. La liste restreinte au salon
          // traite suffit : le moteur clone le tableau qui lui est donne.
          const outcome = await retryPendingBrSettlements([cible], {
            getActor: () => actor,
            onProgress: (progress) => saveBrLobbies(null, progress),
          });
          // L'ecriture EST dans le verrou du salon traite.
          await saveBrLobbies(null, outcome.lobbies);
          return { retried: outcome.retried > 0, remaining: outcome.remaining > 0 };
        } catch (error) {
          log.error('Reprise du reglement BR echouee', { lobbyId, error: error?.message });
          return { retried: false, remaining: true };
        }
      });
      if (reprise?.retried) retried += 1;
      if (reprise?.remaining) remaining += 1;
    }

    if (retried > 0) {
      log.warn('Reglements BR interrompus repris', { retried });
    }
    if (remaining > 0) {
      log.error('Reglements BR toujours en echec', { remaining });
    }
  } catch (error) {
    log.error('Erreur reprise des reglements BR', error);
  } finally {
    brSettlementRetryRunning = false;
  }
};

// ─── BR : annulation des salons programmes jamais lances (sweepStaleBrLobbies)

let staleBrLobbyRunning = false;

/**
 * Annule les salons BR programmes jamais lances, et rembourse chaque joueur.
 *
 * Le verrou est PAR SALON depuis le correctif initial ; l'ecriture passe
 * maintenant par `saveBrLobbies` (PAR ENTITE, C2) : un verrou par entite ne
 * protegait pas une ecriture DE COLLECTION — le traitement du salon A ecrasait
 * une action concurrente sur le salon B.
 */
export const sweepStaleBrLobbies = async () => {
  if (staleBrLobbyRunning) {
    log.warn('Job salons BR perimes deja en cours : tick saute.');
    return;
  }
  staleBrLobbyRunning = true;
  try {
    const lobbies = getStateCollection('brLobbies');
    const staleIds = getStaleBrLobbyIds(lobbies);
    if (staleIds.length === 0) return;

    let cancelled = 0;
    let refunded = 0;
    for (const lobbyId of staleIds) {
      // Verrou PAR SALON : c est le meme verrou que la route d'action, donc
      // un joueur qui se desinscrit en meme temps ne peut pas etre
      // rembourse deux fois.
      const outcome = await withBrLobbyMutex(lobbyId, async () => {
        // On RELIT dans le verrou : l'instantane initial peut etre vieux.
        const fresh = getStateCollection('brLobbies');
        // Liste RESTREINTE au salon traite : le diff d'ecriture ne portera
        // que lui ; un echec ne doit pas non plus empecher le suivant
        // (isolation par salon, comme pour les matchs en V6).
        const cible = fresh.find((l) => l && l.id === lobbyId);
        if (!cible) {
          // Annule ou change entre-temps : plus rien a faire pour ce salon.
          log.warn('Salon BR perime deja traite entre-temps', { lobbyId });
          return null;
        }
        const res = await cancelStaleBrLobbyOnServer([cible], lobbyId);
        if (res.cancelled || res.refunded > 0) {
          // Ecriture PAR ENTITE (C2), DANS le verrou du salon annule.
          await saveBrLobbies(null, res.lobbies);
        }
        return res;
      });
      if (!outcome) continue;
      if (outcome.cancelled) cancelled += 1;
      refunded += outcome.refunded;
      if (outcome.errors.length > 0) {
        log.error('Annulation de salon BR incomplete', {
          lobbyId,
          errors: outcome.errors.length,
        });
      }
    }

    if (cancelled > 0) {
      log.warn('Salons BR annules (jamais lances)', { cancelled, refunded });
    }
    const remaining = countStaleBrLobbies(getStateCollection('brLobbies'));
    if (remaining > 0) {
      log.error('Salons BR perimes toujours en echec', { remaining });
    }
  } catch (error) {
    log.error('Erreur balayage des salons BR perimes', error);
  } finally {
    staleBrLobbyRunning = false;
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

  // Tournois en sequestre sans issue — libere les passes bloques (toutes les
  // 6 h). Deux etats (C4, audit-2) : `recruiting` jamais lance a la date
  // prevue, et `live` lance puis jamais termine (arbitres disparus). Sans ca,
  // entryFee x teamSize restait en lockedEntries indefiniment.
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
            // Motif honnete selon l'etat reel du tournoi.
            const cible = updated.find((t) => t.id === id);
            const raison = cible?.status === 'live'
              ? 'Tournoi annule : bracket lance mais jamais termine.'
              : 'Tournoi annule : pas assez d inscriptions avant la date de debut.';
            const outcome = await cancelStaleTournamentOnServer(updated, id, raison);
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
  // Reprise des reglements de match interrompus — toutes les 60 s.
  //
  // Le reglement se fait en 2 phases : on persiste d'abord le resultat avec
  // `'pending'`, puis la monnaie. Un arret entre les deux laissait le match
  // sans reprise. La fonction est exportee (top-level, comme
  // `sweepPendingArbiterFees`) pour etre testee directement.
  setInterval(() => { void sweepPendingSettlements(); }, 60 * 1000);
  // Au boot : un redemarrage Render est justement le cas le plus probable.
  setTimeout(() => { void sweepPendingSettlements(); }, 15 * 1000);

  // Commission d'arbitre non versee : le job est defini au niveau module
  // (`sweepPendingArbiterFees`) pour etre testable directement.
  setInterval(() => { void sweepPendingArbiterFees(); }, 30 * 60 * 1000);
  setTimeout(() => { void sweepPendingArbiterFees(); }, 45 * 1000);

  // Reglements BR interrompus (5 min + au boot).
  //
  // Un salon BR reste `settling` tant que TOUT n'a pas ete verse. Le
  // mecanisme de reprise EXISTAIT deja — le salon `settling` est accepte, et
  // les joueurs deja payes sont sautes grace au drapeau `settled` — mais
  // PERSONNE ne rappelait la fonction de reglement. Un arret de processus au
  // milieu laissait donc le salon bloque pour toujours : prime jamais versee,
  // salon ni `live` ni `regle`, invisible des deux cotes.
  //
  // 5 min : un joueur a paye son pass et attend sa prime. C'est de l'argent
  // qui doit bouger, contrairement a une dette de commission d arbitre.
  setInterval(() => { void sweepPendingBrSettlements(); }, 5 * 60 * 1000);
  setTimeout(() => { void sweepPendingBrSettlements(); }, 60 * 1000);

  // Salons BR en sequestre sans issue (30 min + au boot).
  //
  // Deux etats (C4, audit-2) : programmes jamais lances, ou `live` lances
  // puis abandonnes par l'arbitre — dans les deux cas les passes des
  // participants restent bloques, l'argent ne sort jamais, et le salon n'a
  // ni issue ni signal.
  //
  // Aucun cron ne s'en occupait a l'origine : le cron nettoie les matchs,
  // les ligues et les tournois, pas les salons BR. Et un salon BR n'a pas
  // d'`expiresAt`, alors qu'un match en a un (14 jours).
  // 30 min : un salon programme expire 2 h apres son heure : pas urgent.
  setInterval(() => { void sweepStaleBrLobbies(); }, 30 * 60 * 1000);
  setTimeout(() => { void sweepStaleBrLobbies(); }, 90 * 1000);

  // Fin de fenetre de confirmation — toutes les 60 s.
  // La fonction est exportee (top-level) pour etre testee directement.
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
        // Le 5e argument est `getWallet`, PAS `listUserIds`. On passait la
        // liste des identifiants : `getWallet(userId)` renvoyait donc un TABLEAU,
        // `wallet.payoutsEnAttente` etait toujours undefined, et le job ne
        // trouvait JAMAIS aucun retrait en attente. C etait un no-op depuis
        // toujours : les retraits `pending_review` restaient debites, sans
        // refund ni alerte, et `/api/health` ne comptait pas ces dettes.
        () => listUserIds(),
        (userId) => getUserById(userId)?.wallet,
        (userId, txId, patch) => tagWalletTransaction(userId, txId, patch),
        // (was: `depositToWallet` nu, sans trace). Le remboursement passe par
        // un chemin IDEMPOTENT : la cle est tracee DANS le portefeuille au
        // moment du credit, dans la meme ecriture. Si le tag d'echec tombe
        // apres le remboursement, le cycle suivant rejoue ce callback — et la
        // trace present rend le rejeu SANS effet sur le solde.
        (userId, amount, extra) => refundRejectedWithdrawal(
          userId, amount,
          // Cle STABLE pour la meme dette, dans tous les cycles :
          // derivee de la cle d'idempotence du retrait quand elle existe,
          // du `payoutId` sinon.
          extra?.idempotencyKey
            ? `refund:${extra.idempotencyKey}`
            : (extra?.payoutId != null ? `refund:payout:${extra.payoutId}` : null),
          {
            description: 'Remboursement - retrait rejete par le prestataire',
            metadata: { reason: 'PAYOUT_REJECTED', payoutId: extra?.payoutId ?? null },
          },
        ),
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

  // Ligues en sequestre sans issue — libere les passes bloques (toutes les
  // 6 h + au boot). Deux etats (C4, audit-2) : `registering` jamais fermee
  // (moins de 10 inscrits, le cron de cloture n'a jamais tranche), et
  // `qualifying` demarree puis jamais aboutie. Sans ce sweep, l'entryFee de
  // chaque inscrit restait bloque dans lockedEntries indefiniment.
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
            // Motif honnete selon l'etat reel de la saison.
            const cible = seasons.find((s) => s.id === id);
            const raison = cible?.status === 'qualifying'
              ? 'Ligue annulee automatiquement : qualification abandonnee par les organisateurs.'
              : 'Ligue annulee automatiquement : pas assez d inscriptions avant la date de cloture.';
            const outcome = await cancelStaleLeagueSeasonOnServer(seasons, id, raison);
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
