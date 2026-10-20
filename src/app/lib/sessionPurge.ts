/**
 * sessionPurge - registre de purge des stores de session.
 *
 * Module SANS import : il stocke une fonction de purge que l'appelant
 * enregistre. Sert a purger l'etat quand une requete recoit un 401.
 *
 * INVARIANT : ce fichier ne doit JAMAIS importer un store. C'est tout son
 * interet : il casse le cycle apiClient -> sessionReset -> socketStore ->
 * socketConnectionStore -> realtimeClient -> apiClient.
 * INVARIANT : l'enregistrement se fait au CHARGEMENT du module qui connait
 * les stores (useAuthSessionBootstrap), donc avant le premier rendu et avant
 * toute requete. Une purge differee ouvrirait une fenetre ou une
 * reconnexion ecrirait ses donnees avant que celles de l'ancienne session
 * soient effacees.
 * PIEGE : purgeSessionStores est SILENCIEUX si aucun gestionnaire n'est
 * branche. Ne pas "corriger" ce silence par une exception : une purge ratee
 * ne doit jamais masquer la reponse d'origine.
 *
 * Voir aussi : docs/08-frontend.md - section 2 (L'arborescence de src/)
 */
// ─────────────────────────────────────────────────────────────────────────────
// Purge des stores de session — registre sans dépendance.
//
// Le client HTTP (`apiClient`) doit purger l'état de session quand une
// requête reçoit un 401 : sans cela, le solde, les matchs, le chat et les amis
// du compte précédent restent visibles pour le joueur qui se connecte ensuite.
//
// Le problème : la purge tire le store socket, qui tire `realtimeClient`, qui
// avait besoin de `getApiUrl`… et le cycle se refermait :
//
//   apiClient -> sessionReset -> socketStore -> socketConnectionStore
//             -> realtimeClient -> apiClient
//
// Un `import()` différé coupait le cycle, mais Vite signalait alors que le
// module est DÉJÀ statiquement importé ailleurs (`useAuthSessionBootstrap`)
// et que l'import dynamique ne le sortait donc pas dans un autre chunk :
// un avertissement permanent, monté pour rien.
//
// On passe donc par un registre : `apiClient` ne connaît plus que ce fichier,
// qui n'importe rien. Le vrai travail est enregistré au chargement de
// `useAuthSessionBootstrap` — appelé au top-level de `App.tsx`, donc avant
// le premier rendu et avant toute requête.
// ─────────────────────────────────────────────────────────────────────────────

type SessionPurgeHandler = () => void;

let purgeHandler: SessionPurgeHandler | null = null;

/**
 * Enregistre la purge effective. Appelée au chargement du module qui
 * possède la connaissance des stores.
 */
export const setSessionPurgeHandler = (handler: SessionPurgeHandler | null) => {
  purgeHandler = typeof handler === 'function' ? handler : null;
};

/**
 * Purge l'état de session. Silencieux si aucun gestionnaire n'est branché :
 * ne pas purger vaut mieux qu'une exception au milieu d'un 401.
 */
export const purgeSessionStores = (): void => {
  if (!purgeHandler) return;
  try {
    purgeHandler();
  } catch {
    // Une purge ratée ne doit jamais masquer la réponse d'origine.
  }
};