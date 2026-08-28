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

export async function fetchCODMPlayer(userId: string, country = 'IN'): Promise<CodashopPlayer | null> {
  try {
    const response = await fetch(getApiUrl(`/api/codm/player/${encodeURIComponent(userId)}?country=${country}`));
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

export async function fetchCODMStoreBundles(country = 'IN'): Promise<CodashopBundle[]> {
  try {
    const response = await fetch(getApiUrl(`/api/codm/store?country=${country}`));
    if (!response.ok) return [];
    const data = await response.json();
    return data.ok ? data.bundles : [];
  } catch {
    return [];
  }
}
