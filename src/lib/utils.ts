import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatZC(amount: number): string {
  return `${amount.toFixed(1)} ZC`;
}

export function formatFCFA(amount: number): string {
  return `${(amount * 10).toLocaleString()} FCFA`;
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

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Sanitize user input to prevent XSS attacks
 * Removes HTML tags, javascript: protocols, and event handlers
 */
export function sanitizeText(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(/<[^>]*>/g, '')           // Remove HTML tags
    .replace(/javascript:/gi, '')       // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '')        // Remove event handlers like onclick=
    .replace(/data:/gi, '')             // Remove data: protocol
    .trim()
    .slice(0, 5000);                    // Limit length
}
