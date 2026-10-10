// ─────────────────────────────────────────────────────────────────────────────
// Resolution de l'URL du backend — module FEUILLE, sans aucun import.
//
// Pourquoi ce fichier existe : `getBaseUrl`/`getApiUrl` vivaient dans
// `apiClient.ts`, qui importe `sessionReset` pour purger les stores sur
// expiration de session. Or `sessionReset` tire le store socket, qui tire
// `realtimeClient`, qui avait besoin de `getApiUrl`… et le cercle se
// refermait :
//
//   apiClient -> sessionReset -> socketStore -> socketConnectionStore
//             -> realtimeClient -> apiClient
//
// Rollup signalait alors « circular dependency between chunks / likely to
// break execution order » : selon le chunk chargé en premier, `getBaseUrl`
// pouvait ne pas encore exister au moment où `realtimeClient` l'appelle.
//
// Ces deux fonctions n'ont besoin de rien (ni store, ni réseau) : les
// mettre à la racine casse le cycle au bon endroit, plutot que de
// contourner le symptôme chez chaque appelant.
// ─────────────────────────────────────────────────────────────────────────────

// M-01: Named VITE_REALTIME_URL because backend serves both REST API and Socket.io (realtime).
// This is the single backend URL for all communication.
export const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_REALTIME_URL;
  if (typeof envUrl === 'string' && envUrl.length > 0) {
    return envUrl;
  }

  return window.location.origin;
};

export const getApiUrl = (path: string) => `${getBaseUrl()}${path}`;