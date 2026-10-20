/**
 * RouteErrorBoundary - ecran d'erreur d'une ROUTE (React Router).
 *
 * Utilise par `errorElement` sur chaque branche protegee de routes.tsx.
 * Distingue une 404 d'une autre erreur et propose un retour.
 *
 * INVARIANT : chaque branche protegee de routes.tsx doit porter un
 * `errorElement`. Sans lui, une exception de chargement de page affiche un
 * ecran vide.
 * INVARIANT : l'ecran doit proposer une issue (retour a l'accueil) : une
 * erreur sans sortie oblige l'utilisateur a changer d'URL a la main.
 * PIEGE : le composant ne doit pas utiliser le routeur pour se navigate
 * lui-meme (il s'execute quand le routeur est deja en erreur) : preferer un
 * lien simple vers une route statique.
 *
 * Voir aussi : docs/08-frontend.md - section 3.3 (Erreurs de route)
 */
import { useRouteError, isRouteErrorResponse, Link } from 'react-router';

export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = 'Une erreur est survenue';
  let message = 'Recharge la page ou réessaye plus tard.';

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Page introuvable';
      message = 'Cette page n\'existe pas ou a été déplacée.';
    } else {
      title = `Erreur ${error.status}`;
      message = error.statusText || message;
    }
  }

  return (
    <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-display font-black uppercase mb-4">{title}</h2>
        <p className="text-white/70 text-sm mb-6">{message}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-block px-6 py-3 bg-white text-black font-display font-black text-xs uppercase tracking-widest hover:bg-zoyd-yellow transition-colors touch-target"
          >
            Réessayer
          </button>
          <Link
            to="/"
            className="inline-block px-6 py-3 border border-white/20 font-display font-black text-xs uppercase tracking-widest hover:border-white transition-colors touch-target"
          >
            Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
