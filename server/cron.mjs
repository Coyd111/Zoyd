import { getStateCollection, replaceStateCollection, cleanupExpiredActivationCodes, cleanupExpiredPasswordResets, cleanupMemoryChatReads, cleanupMemoryNotifications, cleanupMemoryFriendRequests } from './persistence.mjs';
import { createLogger } from './logger.mjs';
import { withMatchMutex, withLeagueMutex, withTournamentMutex } from './mutex.mjs';
import { assignPlayersToDays } from './league-engine.mjs';
import { getExpiredTournamentIds, cancelStaleTournamentOnServer } from './tournament-engine.mjs';
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
};
