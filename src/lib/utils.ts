/**
 * utils.ts - utilitaires de formatage partages par tout le front.
 *
 * Regroupe `cn` (fusion de classes Tailwind), le formatage des montants en
 * ZC, l'arrondi des montants, et quelques helpers de temps et de texte.
 *
 * INVARIANT : `cn` = twMerge(clsx(...)). C'est la SEULE facon de composer
 * des classes Tailwind dans l'application : c'est elle qui resout les
 * conflits (une classe du appelant doit ecraser la variante).
 * INVARIANT : tout montant affichable passe par formatZC, et tout montant
 * calcule par roundAmount. Un montant non arrondi affiche des centimes
 * fantomes ; un arrondi fait a l'affichage fausse les totaux.
 * PIEGE : ce module est feuille : il ne doit importer aucun store ni
 * aucune API. Une dependance ici se propage partout.
 * PIEGE : le formatage des montants est en ZC (monnaie du jeu), pas en
 * FCFA : ne pas melanger les deux dans le meme ecran.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatZC(amount: number): string {
  const rounded = Math.round(amount * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${display} ZC`;
}

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

// Audit-4 INFO : le taux 1 ZC = 10 FCFA etait re-encode a la main dans
// chaque page (WalletPage) et cote serveur (payment-engine.mjs:298).
// La constante est la source unique front ; le site serveur reste son
// miroir declare : changer un seul des deux rend la conversion
// silencieusement fausse.
export const ZC_TO_FCFA = 10;

export function formatFCFA(amount: number): string {
  return `${(amount * ZC_TO_FCFA).toLocaleString('fr-FR')} FCFA`;
}

export function getRelativeTime(date: Date | string): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'À l\'instant';
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  return past.toLocaleDateString('fr-FR');
}

export function getCountdownDisplay(targetDate: Date | string): string {
  const now = new Date();
  const target = new Date(targetDate);
  const diffMs = target.getTime() - now.getTime();
  
  if (diffMs <= 0) return '00:00:00';
  
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Sanitize user input to prevent XSS attacks
 * Removes HTML tags, javascript: protocols, and event handlers
 */
export function sanitizeText(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data:/gi, '')
    .trim()
    .slice(0, 5000);
}
