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
 * ANTI-RÉCURRENCE (chunk périmé) : un chunk disparu après déploiement
 * déclenche un rechargement automatique avec contournement du cache au
 * lieu d'attendre un clic — l'utilisateur ne voit plus l'écran figé
 * « UNE MISE À JOUR EST ARRIVÉE » que s'il clique avant le compte à rebours.
 *
 * Voir aussi : docs/08-frontend.md - section 3.3 (Erreurs de route)
 */
import { useEffect, useState } from 'react';
import { useRouteError, isRouteErrorResponse, Link } from 'react-router';
import { isStaleChunkError, chunkRetryKey, reloadWithFreshBuild } from '../../lib/buildVersion';

export function RouteErrorBoundary() {
  const error = useRouteError();
  const stale = isStaleChunkError(error);
  const [countdown, setCountdown] = useState(2);

  // Chunk périmé : recharge automatique (1x) avec cache bypass. On ne
  // recharge pas en boucle : si le retry pour ce chunk a déjà été tenté,
  // on laisse l'écran avec ses boutons manuels.
  useEffect(() => {
    if (!stale) return;
    if (sessionStorage.getItem(chunkRetryKey(error))) return;
    sessionStorage.setItem(chunkRetryKey(error), '1');
    const tick = window.setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          window.clearInterval(tick);
          reloadWithFreshBuild();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [stale, error]);

  let title = 'Une erreur est survenue';
  let message = 'Recharge la page ou réessaye plus tard.';

  if (stale) {
    // Déploiement entre la première charge et le lazy-load : l'index en
    // mémoire pointe sur d'anciens chunks purgés par Vercel.
    title = 'Une mise à jour est arrivée';
    message = `Le site s\u2019est mis à jour pendant que tu jouais. Mise à jour automatique${countdown > 0 ? ` dans ${countdown} s` : ''}…`;
  } else if (isRouteErrorResponse(error)) {
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
        <p className="text-white/70 text-sm mb-6" role="status" aria-live="polite">{message}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reloadWithFreshBuild()}
            className="inline-block px-6 py-3 bg-white text-black font-display font-black text-xs uppercase tracking-widest hover:bg-zoyd-yellow transition-colors touch-target"
          >
            {stale ? 'Mettre à jour' : 'Réessayer'}
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
