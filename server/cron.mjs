import { getStateCollection, replaceStateCollection } from './persistence.mjs';

const getNow = () => new Date().toISOString();

export const initCronJobs = () => {
  console.log('[CRON] Service de tâches planifiées initialisé.');

  // Nettoyage des matchs inactifs — toutes les 6 heures
  setInterval(() => {
    try {
      console.log('[CRON] Démarrage du nettoyage des matchs inactifs...');
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

      console.log(`[CRON] Nettoyage terminé. ${archivedCount} matchs archivés.`);
    } catch (error) {
      console.error('[CRON] Erreur lors du nettoyage des matchs :', error);
    }
  }, 6 * 60 * 60 * 1000);
};
