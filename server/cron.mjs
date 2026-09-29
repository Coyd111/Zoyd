import { getStateCollection, replaceStateCollection, cleanupExpiredActivationCodes, cleanupExpiredPasswordResets, cleanupMemoryChatReads, cleanupMemoryNotifications, cleanupMemoryFriendRequests } from './persistence.mjs';
import { createLogger } from './logger.mjs';
import { withMatchMutex, withLeagueMutex, withTournamentMutex } from './mutex.mjs';
import { assignPlayersToDays } from './league-engine.mjs';
import { getExpiredTournamentIds, cancelStaleTournamentOnServer, retryPendingTournamentRefunds, countPendingTournamentRefunds } from './tournament-engine.mjs';
import { settlePendingMatchResult, expireConfirmationsOnServer } from './match-engine.mjs';
import { getNow } from './utils.mjs';

const log = createLogger('cron');

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
        if (outcome.remaining > 0) {
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
};
