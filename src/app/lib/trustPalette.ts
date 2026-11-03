/**
 * trustPalette - correspondance couleur/libelle du score de confiance.
 *
 * Extrait de stores/trustScoreStore.ts (P3-8, audit UI) : des fonctions
 * PURES de presentation n'ont rien a faire dans un store Zustand — le
 * fichier importait `create` pour trois helpers sans etat, et toute page
 * non connectee au score finissait par importer un store pour une couleur.
 * Les consommateurs continuent d'importer via trustScoreStore (re-export),
 * l'API publique ne change pas ; les imports directs ICI sont réservés aux
 * acteurs qui n'ont aucune autre raison d'ouvrir le store.
 *
 * INVARIANT : source de verite PARTAGEE — ClassementsPage, PublicClassementsPage
 * et TrustScoreBadge lisent les MEMES seuils ; recopier un seuil local
 * casserait la coherence des couleurs entre ecrans (PIEGE deja documente
 * dans EarningsDashboard : les seuils locaux 90/75/50 ont ete retires au
 * profit de getTrustLabel).
 * PIEGE : les seuils (90 / 80 / 50 / 30) sont des REGLES DE DESIGN. Les
 * modifier change le libelle affiche partout en un coup. Les couleurs
 * green/yellow/orange/red seraient a re-resynchroniser avec le theme.css
 * si les tokens changent.
 */

export function getTrustColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 50) return 'text-zoyd-yellow';
  if (score >= 30) return 'text-orange-400';
  return 'text-red-400';
}

export function getTrustBg(score: number): string {
  if (score >= 80) return 'bg-green-400';
  if (score >= 50) return 'bg-zoyd-yellow';
  if (score >= 30) return 'bg-orange-400';
  return 'bg-red-400';
}

export function getTrustLabel(score: number): string {
  if (score >= 90) return 'VÉRIFIÉ ZOYD';
  if (score >= 80) return 'EXEMPLAIRE';
  if (score >= 50) return 'FIABLE';
  if (score >= 30) return 'À SURVEILLER';
  return 'RISQUÉ';
}
