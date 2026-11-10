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

/**
 * URL du chunk perime, extraite du message d'erreur de Vite.
 *
 * Vite leve « Failed to fetch dynamically imported module: <url> ». On vise
 * l'URL COMPLETE (avec son hash de contenu), pas le nom de fichier : deux
 * chunks d'une meme famille (CreateMatchPage / CreateTournamentPage) ne se
 * distinguent que par leur hash.
 */
const CHUNK_URL_PATTERN = /(https?:\/\/[^\s"']+?\.js|\/[^\s"']+?\.js)/;

/**
 * Hachage cyrb53 : 53 bits, deterministe et sans dependance.
 *
 * Suffisant pour une cle de sessionStorage, et surtout STABLE : la meme URL
 * doit produire la meme cle d'un build a l'autre, sinon le retry unique par
 * (build, chunk) ne serait jamais arme.
 */
function hashString(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Clé de session d'un retry : un retry par (build, chunk), pas par session.
 *
 * INVARIANT : la cle depend de l'URL COMPLETE du chunk, hassee. Tronquer le
 * message (avant : `message.slice(0, 80)`) ne laissait que ~36 caracteres
 * d'URL — le prefixe de Vite (« Failed to fetch dynamically imported
 * module: ») en consomme 44 — donc la cle ne dependait plus que des 4
 * premiers caracteres du nom de fichier. `CreateMatchPage-*.js` et
 * `CreateTournamentPage-*.js` produisaient donc la MEME cle : juste apres un
 * deploiement, le second chunk perime ne beneficiait pas du rechargement et
 * tombait sur l'ecran fige « UNE MISE A JOUR EST ARRIVEE ».
 */
export function chunkRetryKey(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");
  const chunkUrl = CHUNK_URL_PATTERN.exec(message)?.[1];
  // Sans URL identifiable (message « Failed to fetch » nu), on hashe le
  // message COMPLET : mieux vaut une cle un peu large qu'une cle identique
  // pour tous les chunks sans URL.
  const digest = hashString(chunkUrl ?? message);
  return `zoyd_chunk_retry_${CURRENT_BUILD_ID}_${digest}`;
}
