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
// Player data
// ---------------------------------------------------------------------------

export async function fetchCODMPlayer(userId: string, country = 'BJ'): Promise<CodashopPlayer | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(getApiUrl(`/api/codm/player/${encodeURIComponent(userId)}?country=${country}`), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return data.ok ? data.player : null;
  } catch {
    return null;
  }
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

/** Reprise pour compatibilite : ne retourne que la liste de bundles. */
export async function fetchCODMStoreBundles(country = 'BJ'): Promise<CodashopBundle[]> {
  return (await fetchCODMStore(country)).bundles;
}
