import { getStateCollection, replaceStateCollection, cleanupExpiredActivationCodes, cleanupMemoryChatReads, cleanupMemoryNotifications, cleanupMemoryFriendRequests } from './persistence.mjs';
import { createLogger } from './logger.mjs';
import { withMatchMutex, withLeagueMutex } from './mutex.mjs';
import { assignPlayersToDays } from './league-engine.mjs';
import { getNow } from './utils.mjs';

const log = createLogger('cron');

export const initCronJobs = () => {
  log.info('Service de tâches planifiées initialisé.');

  // Nettoyage des matchs inactifs — toutes les 6 heures
  setInterval(async () => {
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
          replaceStateCollection('matches', updatedMatches);
        }

        log.info(`Nettoyage terminé. ${archivedCount} matchs archivés.`);
      });
    } catch (error) {
      log.error('Erreur lors du nettoyage des matchs', error);
    }
  }, 6 * 60 * 60 * 1000);

  // Fermeture automatique des inscriptions ligue — toutes les heures
  setInterval(async () => {
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
          replaceStateCollection('leagues', updatedSeasons);
          log.info('Inscriptions ligue fermées automatiquement.');
        }
      });
    } catch (error) {
      log.error('Erreur fermeture inscriptions ligue', error);
    }
  }, 60 * 60 * 1000);

  // Nettoyage mémoire — toutes les heures
  setInterval(() => {
    try {
      cleanupExpiredActivationCodes();
      cleanupMemoryChatReads();
      cleanupMemoryNotifications();
      cleanupMemoryFriendRequests();
      log.info('Nettoyage mémoire terminé.');
    } catch (error) {
      log.error('Erreur nettoyage mémoire', error);
    }
  }, 60 * 60 * 1000);
};
