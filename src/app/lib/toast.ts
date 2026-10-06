import { useToastStore } from '../stores/toastStore';

/**
 * Adapter de notifications.
 *
 * L'app possede son propre systeme de toasts (`toastStore` +
 * `ToastContainer`, monte dans `RootLayout`). Plusieurs ecrans importaient
 * pourtant `toast` de `sonner`, alors qu'aucun `<Toaster />` n'est monte
 * dans l'application : ces ~180 appels ne s'affichaient donc jamais, et
 * l'utilisateur n'avait aucun retour sur une action reussie ou refusee.
 *
 * Plutot que d'introduire un second systeme cote concurrence, cet
 * adaptateur offre la meme surface d'appel (`toast.success(...)`,
 * `toast.error(..., { id, action })`, `toast.loading`, `toast.dismiss`)
 * sur le systeme reellement monte et thme.
 *
 * Utilisable hors composant : il passe par le store, pas par un hook.
 */

/** Options acceptees, alignees sur celles utilisees avec `sonner`. */
export interface ToastOptions {
  /** Sous-titre : remonte dans le champ `message` du toast. */
  description?: string;
  /**
   * Identifiant stable : un nouvel appel avec le meme `id` REMPLACE le
   * toast au lieu de s'empiler (utile pour une erreur qui se repete).
   */
  id?: string;
  /** Duree d'affichage en ms. `0` = ne disparait pas tout seul. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

const DEFAULT_SUCCESS_MS = 4500;
const ERROR_MS = 8000;

const push = (
  type: 'success' | 'error' | 'warning' | 'info',
  title: string,
  options: ToastOptions = {},
) => {
  const duration = options.duration ?? (type === 'error' ? ERROR_MS : DEFAULT_SUCCESS_MS);
  useToastStore.getState().addToast({
    type,
    title: String(title),
    message: options.description,
    action: options.action,
    id: options.id,
    duration,
  });
};

export const toast = {
  success: (title: string, options?: ToastOptions) => push('success', title, options),
  // Une erreur reste affichee plus longtemps : elle doit etre lisible.
  error: (title: string, options?: ToastOptions) => push('error', title, options),
  warning: (title: string, options?: ToastOptions) => push('warning', title, options),
  info: (title: string, options?: ToastOptions) => push('info', title, options),
  /** Attente en cours : pas d'auto-fermeture, a fermer via `dismiss()`. */
  loading: (title: string, options?: ToastOptions) =>
    push('info', title, { duration: 0, ...options }),
  /** Ferme le(s) toast(s) ouvert(s), comme `toast.dismiss()` de sonner. */
  dismiss: () => useToastStore.getState().clearAll(),
};
