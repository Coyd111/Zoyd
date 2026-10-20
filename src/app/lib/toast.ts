/**
 * toast - adaptateur d'API toast, au-dessus du store maison.
 *
 * Offre la meme surface d'appel que `sonner` (toast.success, toast.error,
 * toast.loading, toast.dismiss) mais ecrit dans toastStore, qui est le seul
 * systeme reellement monte dans l'application.
 *
 * INVARIANT : passer par le store, pas par un composant. Cet adaptateur est
 * utilisable hors composant React (dans un store, un service).
 * PIEGE : aucun <Toaster /> n'est monte dans l'app. Les ~180 appels directs a
 * `toast` de `sonner` ne s'affichaient donc jamais : le joueur n'avait aucun
 * retour sur une action reussie ou refusee.
 * PIEGE : le second argument accepte une chaine ET un objet d'options. La
 * chaine est le raccourci `{ description }` : c'est l'usage dominant, ne pas
 * le retirer sans migrer tous les appelants.
 * PIEGE : un `id` stable remplace le toast au lieu de l'empiler.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
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

/**
 * Second argument des toasts.
 *
 * La forme `string` est un raccourci pour `{ description }`. Elle est
 * ACCEPTEE parce que c'est l'usage dominant : presque tous les appels Provide
 * ecrivent `toast.error('Titre', 'Que s'est-il passe ?')`. Sans elle, chacun
 * devait ecrire `{ description: '...' }`, et une chaine passee directement
 * dehors compilait en erreur.
 */
export type ToastSecondArg = ToastOptions | string;

const normalizeToastOptions = (options?: ToastSecondArg): ToastOptions => {
  if (typeof options === 'string') return { description: options };
  return options ?? {};
};

const push = (
  type: 'success' | 'error' | 'warning' | 'info',
  title: string,
  options?: ToastSecondArg,
) => {
  const opts = normalizeToastOptions(options);
  const duration = opts.duration ?? (type === 'error' ? ERROR_MS : DEFAULT_SUCCESS_MS);
  useToastStore.getState().addToast({
    type,
    title: String(title),
    message: opts.description,
    action: opts.action,
    id: opts.id,
    duration,
  });
};

export const toast = {
  success: (title: string, options?: ToastSecondArg) => push('success', title, options),
  // Une erreur reste affichee plus longtemps : elle doit etre lisible.
  error: (title: string, options?: ToastSecondArg) => push('error', title, options),
  warning: (title: string, options?: ToastSecondArg) => push('warning', title, options),
  info: (title: string, options?: ToastSecondArg) => push('info', title, options),
  /** Attente en cours : pas d'auto-fermeture, a fermer via `dismiss()`. */
  loading: (title: string, options?: ToastSecondArg) =>
    push('info', title, { duration: 0, ...normalizeToastOptions(options) }),
  /** Ferme le(s) toast(s) ouvert(s), comme `toast.dismiss()` de sonner. */
  dismiss: () => useToastStore.getState().clearAll(),
};
