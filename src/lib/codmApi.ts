/**
 * codmApi - client du catalogue CODM (Codashop), via le proxy backend.
 *
 * Interroge le backend ZOYD, qui relaie Codashop : le navigateur ne doit
 * jamais appeler Codashop directement (CORS, quotas, cle d'API).
 *
 * INVARIANT : tous les appels passent par getApiUrl (apiClient.ts). Aucun
 * appel direct a codashop.net : le proxy est la seule voie supportee.
 * INVARIANT : les reponses du proxy sont normalisees ici, une fois. Ne pas
 * renormaliser dans chaque composant.
 * PIEGE : le proxy peut repondre en mode degrade (catalogue indisponible).
 * L'ecran doit distinguer ' pas de donnees ' de ' service indisponible '.
 * PIEGE : la route exige une session joueur. L'appel doit porter
 * `credentials: 'include'` (cookie httpOnly cross-origine) : sans lui, la
 * reponse est 401 et le catalogue revient vide, silencieusement.
 * PIEGE : ce catalogue est un CONTENU, pas une source de verite metier. Une
 * regle de jeu ne doit jamais dependre d'une reponse Codashop.
 * INVARIANT : un echec de chargement LEVE, il ne se degrade pas en
 * catalogue vide. Un 401 renvoye par la route doit atteindre
 * `handleAuthError` (apiClient) : c'est lui qui purge la session. Avaler le
 * 401 laissait le front convinced que la session est vivante, avec un
 * catalogue vide et un bouton « Reessayer » qui refaisait la meme requete
 * 401 en boucle.
 */

/**
 * Codashop / CODM API client — routes through the ZOYD backend proxy.
 * The backend handles CORS and upstream requests to Codashop.
 */

import { getApiUrl, readJson, ApiError } from '../app/lib/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodashopPlayer {
  nickname: string;
  picUrl: string;
  level: number;
  levelImage: string;
  rankClass: number;
  readableRank: string;
  rankImage: string;
  rating: number;
  shortId: string;
  country: string;
  countryId: number;
}

export interface CodashopBundle {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  bannerUrl: string;
  price: string;
  currency: string;
  isFree: boolean;
  isPopular: boolean;
  isLuckyDraw: boolean;
  tags: string[];
  category: string;
}

// ---------------------------------------------------------------------------
// Store bundles
// ---------------------------------------------------------------------------

/**
 * Reponse brute du proxy backend (`server/routes/public.mjs`).
 *
 * Le proxy repond 200 + `ok:true` meme quand le catalogue est vide (c'est un
 * catalogue VIDE cote serveur, pas une panne) et 502/500 quand l'amont
 * Codashop tombe. `ok:false` en 200 reste traite comme une panne.
 */
interface CodashopProxyResponse {
  ok?: boolean;
  bundles?: CodashopBundle[];
  catalogCurrency?: string;
  priceIsLocal?: boolean;
}

/**
 * Catalogue CODM via Codashop.
 *
 * Le proxy ZOYD retourne le catalogue INTERNATIONAL : l'API Codashop ignore
 * `shopLang` et `whitelabelId` pour la tarification (verifie le 04/10/2026 :
 * 14 whitelabels x 12 shopLang => toujours 17 groupes a 99.0 INR) et son
 * schema n'accepte pas `countryCode`. Aucun catalogue XOF n'est donc
 * disponible. Plutot que d'afficher un prix en INR comme s'il etait local,
 * on expose la devise reelle et `priceIsLocal: false` : l'UI precise que le
 * debit se fait sur Codashop, dans la devise du pays du joueur.
 */
export interface CodashopStoreResponse {
  bundles: CodashopBundle[];
  catalogCurrency: string;
  priceIsLocal: boolean;
}

/**
 * Charge le catalogue CODM.
 *
 * LEVE en cas d'echec (401 de session, 502 de l'amont, timeout reseau) : le
 * caller doit pouvoir distinguer « catalogue vide » (reponse 200 sans
 * bundle) de « chargement impossible » (exception).
 */
export async function fetchCODMStore(country = 'BJ'): Promise<CodashopStoreResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(getApiUrl(`/api/codm/store?country=${country}`), {
      // Cookie httpOnly cross-origine (Vercel -> Render) : indispensable.
      // La route `/api/codm/store` exige une session joueur
      // (`getAuthenticatedAppSession`). Sans `credentials`, le cookie n'est
      // pas envoye : la reponse est 401 et le catalogue arrive vide — sans
      // le moindre signe visible pour le joueur.
      credentials: 'include',
      signal: controller.signal,
    });
    // `readJson` fait le travail qu'il faut : il appelle `handleAuthError`
    // (purge de session sur un vrai 401) puis LEVE une ApiError typee.
    // Le `if (!response.ok) return { bundles: [] }` d'avant avalait le 401 :
    // aucune purge, aucune erreur, un catalogue vide a l'ecran et un
    // « Reessayer » qui rejouait la meme requete 401 en boucle.
    const data = await readJson<CodashopProxyResponse>(response);
    if (!data?.ok) {
      throw new ApiError(
        'Catalogue CODM indisponible.',
        'CODM_CATALOG_UNAVAILABLE',
        502
      );
    }
    return {
      bundles: Array.isArray(data.bundles) ? data.bundles : [],
      catalogCurrency: String(data.catalogCurrency || 'INR'),
      priceIsLocal: Boolean(data.priceIsLocal),
    };
  } catch (err) {
    // Timeout : on le traduit en ApiError explicite (comme apiClient) au
    // lieu de laisser remonter une DOMException brute.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'Delai depasse — le catalogue CODM ne repond pas.',
        'TIMEOUT',
        408
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
