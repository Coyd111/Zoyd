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
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatZC(amount: number): string {
  // MIROIR de `formatZcForNotification` (server/utils.mjs).
  //
  // PIEGE : les deux versions doivent produire EXACTEMENT la meme chaine.
  // Celle du serveur renvoyait '0 ZC' pour un montant non fini ; celle-ci
  // renvoyait 'NaN ZC' - donc l'ecran affichait « NaN ZC » a un joueur dont
  // le solde n'etait pas un nombre. L'invariant « les deux formats doivent
  // rester identiques » etait donc viole d'un cote, et rien ne le verifiait :
  // les deux implémentations vivaient dans deux langages, sans test commun.
  const rounded = Math.round(Number(amount) * 10) / 10;
  if (!Number.isFinite(rounded)) return '0 ZC';
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${display} ZC`;
}

export function roundAmount(value: number): number {
  // MIROIR de `roundAmount` (server/utils.mjs) : un montant non fini y
  // vaut 0, pas NaN. Sans ce garde, `roundAmount(undefined)` renvoyait
  // NaN, qui se propageait dans tous les totaux calcules ensuite.
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100 || 0;
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
