import { useToastStore } from '../stores/toastStore';

/**
 * Adapter de notifications.
 *
 * L'app a son propre systeme de toasts (`toastStore` + `ToastContainer`, monte
 * dans `RootLayout`). Plusieurs ecrans importent pourtant `toast` de `sonner`,
 * alors qu'aucun `<Toaster />` n'est monte dans l'application : ces appels ne
 * s'affichaient donc jamais. Plutot que d'ajouter un second systeme cote
 * concurrence, cet adaptateur offre la meme API (`toast.success(...)`) sur le
 * systeme reellement monte.
 *
 * Utilisable hors composant : il passe par le store, pas par un hook.
 */
type ToastKind = 'success' | 'error' | 'warning' | 'info';

const push = (type: ToastKind, title: string) => {
  // `duration: 0` = pas d'auto-fermeture, pour les erreurs : un message
  // d'erreur doit rester lisible jusqu'a ce que l'utilisateur le comprenne.
  useToastStore.getState().addToast({ type, title, duration: type === 'error' ? 8000 : 4500 });
};

export const toast = {
  success: (title: string) => push('success', title),
  error: (title: string) => push('error', title),
  warning: (title: string) => push('warning', title),
  info: (title: string) => push('info', title),
};
