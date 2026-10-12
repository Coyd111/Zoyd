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