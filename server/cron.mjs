import { getStateCollection, replaceStateCollection } from './persistence.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('cron');
const getNow = () => new Date().toISOString();

export const initCronJobs = () => {
  log.info('Service de tâches planifiées initialisé.');

  // Nettoyage des matchs inactifs — toutes les 6 heures
  setInterval(() => {
    try {
      log.info('Démarrage du nettoyage des matchs inactifs...');
      const matches = getStateCollection('matches');

      const fourteenDaysAgoDate = new Date();
      fourteenDaysAgoDate.setDate(fourteenDaysAgoDate.getDate() - 14);
      const fourteenDaysAgo = fourteenDaysAgoDate.toISOString();

      let archivedCount = 0;
      const updatedMatches = matches.map((match) => {
        const dateToCheck = match.updatedAt || match.createdAt;
        if (!dateToCheck) return match;

        const isStale = ['open', 'recruiting', 'scheduled'].includes(match.status)
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
    } catch (error) {
      log.error('Erreur lors du nettoyage des matchs', error);
    }
  }, 6 * 60 * 60 * 1000);

  // Fermeture automatique des inscriptions ligue — toutes les heures
  setInterval(() => {
    try {
      const seasons = getStateCollection('leagues');
      const now = new Date();
      let changed = false;

      const updatedSeasons = seasons.map((season) => {
        if (season.status !== 'registering') return season;
        if (!season.schedule?.registrationCloses) return season;

        const closesAt = new Date(season.schedule.registrationCloses);
        if (now >= closesAt && season.registeredPlayers.length >= 10) {
          changed = true;
          return {
            ...season,
            status: 'qualifying',
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
    } catch (error) {
      log.error('Erreur fermeture inscriptions ligue', error);
    }
  }, 60 * 60 * 1000);
};
