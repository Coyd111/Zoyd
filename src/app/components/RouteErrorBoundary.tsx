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
        <p className="text-white/40 text-sm mb-6">{import.meta.env.DEV ? message : 'Une erreur inattendue s\'est produite.'}</p>
        <Link
          to="/"
          className="inline-block px-6 py-3 bg-white text-black font-display font-black text-xs uppercase tracking-widest hover:bg-zoyd-yellow transition-colors"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
