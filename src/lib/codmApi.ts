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
 * PIEGE : ce catalogue est un CONTENU, pas une source de verite metier. Une
 * regle de jeu ne doit jamais dependre d'une reponse Codashop.
 *
 * Voir aussi : docs/08-frontend.md - section 10.1 (Pages de src/app/pages/)
 */

/**
 * Codashop / CODM API client — routes through the ZOYD backend proxy.
 * The backend handles CORS and upstream requests to Codashop.
 */

import { getApiUrl } from '../app/lib/apiClient';

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

export async function fetchCODMStore(country = 'BJ'): Promise<CodashopStoreResponse> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(getApiUrl(`/api/codm/store?country=${country}`), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { bundles: [], catalogCurrency: 'INR', priceIsLocal: false };
    const data = await response.json();
    if (!data?.ok) return { bundles: [], catalogCurrency: 'INR', priceIsLocal: false };
    return {
      bundles: Array.isArray(data.bundles) ? data.bundles : [],
      catalogCurrency: String(data.catalogCurrency || 'INR'),
      priceIsLocal: Boolean(data.priceIsLocal),
    };
  } catch {
    return { bundles: [], catalogCurrency: 'INR', priceIsLocal: false };
  }
}
