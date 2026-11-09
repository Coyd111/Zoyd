/**
 * buildVersion - identifiant du bundle déployé et récupération chunk périmé.
 *
 * Le problème : l'index.html en mémoire pointe sur des chunks hashés
 * (ex. CreateMatchPage-abc123.js). Vercel purge l'ancien build à chaque
 * déploiement ; un onglet resté ouvert plus d'un déploiement télécharge
 * dans le vide → l'écran « UNE MISE À JOUR EST ARRIVÉE ».
 *
 * La parade (avant : 1 retry par session, donc l'écran dès le 2e déploiement) :
 * - le build injecte __ZOYD_BUILD_ID__ (commit Vercel ou horodatage) et
 *   produit dist/version.json servi sans cache ;
 * - versionWatcher compare le bundle en mémoire à /version.json et recharge
 *   en silence avant que l'utilisateur ne clique un lazy-load périmé ;
 * - lazyWithRetry recharge par chunk écarté (clé = build + chunk), pas une
 *   seule fois par session.
 *
 * Voir aussi : routes.tsx (lazyWithRetry), RouteErrorBoundary, versionWatcher.
 */

declare const __ZOYD_BUILD_ID__: string;

export const CURRENT_BUILD_ID: string =
  typeof __ZOYD_BUILD_ID__ === "string" && __ZOYD_BUILD_ID__
    ? __ZOYD_BUILD_ID__
    : "dev";

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /chunk|dynamically imported|Failed to fetch/i.test(message);
}

/** Construit l'URL de recharge avec contournement du cache (sans boucler). */
export function reloadWithFreshBuild(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("__zoyd_reload", CURRENT_BUILD_ID);
  url.searchParams.delete("__zoyd_v");
  window.location.assign(url.toString());
}

/** Clé de session d'un retry : un retry par (build, chunk), pas par session. */
export function chunkRetryKey(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");
  const digest = message.slice(0, 80).replace(/\W/g, "");
  return `zoyd_chunk_retry_${CURRENT_BUILD_ID}_${digest}`;
}
