/**
 * Conversion entre les taux du serveur (fractions de 1) et l affichage
 * joueur (pourcentages). ZD-17 : le formulaire BR melangeait les deux
 * unites dans la meme section.
 *
 * INVARIANT : le serveur recoit toujours des fractions (`BrPayout`) ;
 * seul l affichage et la saisie passent par des pourcentages.
 */
export const rateToPercent = (rate: number): number => Math.round(rate * 1000) / 10;

export const percentToRate = (percent: number): number => Math.round(percent * 10) / 1000;
