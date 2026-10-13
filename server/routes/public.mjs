import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
import {
  getAuthenticatedAppSession,
  paginate,
  parseQueryParams,
  readBearerToken,
  respondJson,
  respondMappedError,
} from '../http-utils.mjs';
import {
  countPushSubscriptions,
  findUsersByPseudo,
  getAuthSession,
  getHealthInfo,
  getLeaderboard,
  getPublicStats,
  getPublicUserById,
  getStateCollection,
  getUserById,
  isReloadInProgress,
  sanitizeText,
} from '../persistence.mjs';
import { metricsToPrometheus, setGauge } from '../metrics.mjs';
import { channels } from '../channel-presence.mjs';
import {
  getStoredTournaments,
  sanitizeMatchForBroadcast,
  sanitizeTournamentForBroadcast,
} from '../state-helpers.mjs';
import { getPublicMatchesForUser } from '../match-engine.mjs';
import { getNow } from '../utils.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('public-routes');

export const handlePublicRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/health') {
  const health = getHealthInfo();
  // ok=false quand l'état mémoire n'est pas fiable : les écritures sont
  // refusées, un orchestrateur doit le savoir plutôt que de croire au vert.
  respondJson(res, health.stateTrusted ? 200 : 503, {
    ok: health.stateTrusted,
    service: 'zoyd-api',
    persistence: { ...health, reloadInProgress: isReloadInProgress() },
    timestamp: getNow(),
  });
  return true;
}

if (req.method === 'GET' && pathname === '/api/realtime/health') {
  respondJson(res, 200, {
    ok: true,
    service: 'zoyd-realtime',
    timestamp: getNow(),
  });
  return true;
}

// ─── CODM STORE PROXY ────────────────────────────────────────────────────
// Proxies requests to the Codashop GraphQL API to avoid CORS issues.
// GET /api/codm/store?country=IN
//
// Session obligatoire : ces endpoints ne contiennent aucun secret, mais
// sans garde le serveur devenait un proxy Codashop gratuit pour tout
// Internet, sur le quota du forfait Render gratuit. L'usage metier est de
// rattacher le compte CODM d'un JOUEUR a son profil : un compte suffit.
if (req.method === 'GET' && pathname === '/api/codm/store') {
  if (!getAuthenticatedAppSession(req)) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const storeUrl = new URL(req.url, 'http://localhost');
    const rawCountry = (storeUrl.searchParams.get('country') || '').toUpperCase();
    const country = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : 'BJ';
    // LIMITE CONNUE DE L'API CODASHOP (verifiee le 04/10/2026) :
    // `getDynamicSkuInfo` renvoie le CATALOGUE INTERNATIONAL en INR quel que
    // soit `shopLang` (fr_bj, en_ng, en_za... => 17 groupes, 99.0 INR) et quel
    // que soit `whitelabelId` (1 a 14 => identique). Le schema GraphQL
    // n'accepte aucun argument `countryCode`, et `api.codashop.com` ne repond
    // pas. Donc pas de catalogue XOF disponible de ce cote : on ne pretend pas
    // l'inverse, la page affiche la devise reelle (INR) et renvoie vers le
    // checkout Codashop, qui facture dans la devise du pays du joueur.
    // `country` est conserve : il sera utile des que Codashop l'exposera.
    const shopLang = 'fr_bj';
    const deviceId = crypto.randomUUID();

    const graphqlBody = {
      operationName: 'GetDynamicSkuInfo',
      variables: {
        deviceId,
        whitelabelId: 1,
        userId: '',
        serverId: '',
        characterId: '',
        worldId: '',
        lvtId: 11347,
        shopLang,
      },
      extensions: {
        clientLibrary: { name: '@apollo/client', version: '4.0.9' },
      },
      query: `query GetDynamicSkuInfo($shopLang: String!, $lvtId: Int!, $serverId: String, $userId: String, $worldId: String, $characterId: String, $deviceId: String, $whitelabelId: Int) {
getDynamicSkuInfo(shopLang: $shopLang, serverId: $serverId, lvtId: $lvtId, userId: $userId, worldId: $worldId, characterId: $characterId, deviceId: $deviceId, whitelabelId: $whitelabelId) {
  denominationGroups {
    tags dynamicSkuToken denomCategoryId denomDetailsImageUrl denomDetailsTitle denomImageUrl bannerImageUrl isHighlighted displayId displayText skuTitle skuSubTitle hasStock isVariableDenom isPopular isLuckyDraw originalSku sortOrderId status strikethroughPrice voucherId webStoreExclusive isPackage
    pricePoints { bestdeal hasDiscount discountAmount id isEnabled price { amount currency } pricingEngineToken }
    pricingScheme endTime userLimit userLimitRemaining promoId statusSubtype
  }
  denominationCategories { title imageUrl description id name sortOrder }
}
}`,
    };

    const upstream = await fetch('https://api-sa.codashop.com/spring/api/graphql', {
      method: 'POST',
      headers: {
        accept: '*/*,application/json',
        'content-type': 'application/json',
      },
      referrer: 'https://store.callofdutymobile.com/',
      body: JSON.stringify(graphqlBody),
    });

    if (!upstream.ok) {
      respondJson(res, 502, { ok: false, error: 'Upstream API error.', code: 'UPSTREAM_ERROR' }, req);
      return true;
    }

    const data = await upstream.json();
    const groups = data?.data?.getDynamicSkuInfo?.denominationGroups || [];
    const categories = data?.data?.getDynamicSkuInfo?.denominationCategories || [];

    const bundles = groups.map((g) => {
      const firstPrice = g.pricePoints?.[0];
      const amount = firstPrice?.price?.amount ?? '0';
      const currency = firstPrice?.price?.currency ?? 'USD';
      return {
        id: String(g.voucherId || g.dynamicSkuToken || ''),
        title: String(g.skuTitle || g.denomDetailsTitle || ''),
        subtitle: String(g.skuSubTitle || ''),
        imageUrl: String(g.denomImageUrl || ''),
        bannerUrl: String(g.bannerImageUrl || ''),
        price: amount,
        currency,
        isFree: amount === '0.0' || amount === '0',
        isPopular: Boolean(g.isPopular),
        isLuckyDraw: Boolean(g.isLuckyDraw),
        tags: Array.isArray(g.tags) ? g.tags.map(String) : [],
        category: String(g.denomCategoryId || ''),
      };
    });

    // La devise du catalogue est celle reellement servie par Codashop
    // (toujours INR aujourd'hui, cf. limite documentee plus haut). On la
    // renvoie explicitement pour que le front affiche la bonne devise et
    // n'impose pas une devise locale que l'API ne fournit pas.
    const catalogCurrency = bundles.find((b) => !b.isFree)?.currency || 'INR';
    respondJson(res, 200, {
      ok: true,
      bundles,
      categories,
      catalogCurrency,
      priceIsLocal: false,
      requestedCountry: country,
    }, req);
  } catch (err) {
    log.error('codm store proxy error', { message: err.message });
    respondJson(res, 500, { ok: false, error: 'Failed to fetch store data.', code: 'STORE_PROXY_ERROR' }, req);
  }
  return true;
}

// ─── CODM PLAYER PROXY ───────────────────────────────────────────────────
// Proxies player lookup to the Codashop validation API.
// GET /api/codm/player/:id?country=IN
if (req.method === 'GET' && pathname.startsWith('/api/codm/player/')) {
  // Meme garde que le proxy store : la verification d'un UID CODM est un
  // acte de compte (rattacher son profil), pas une API publique.
  if (!getAuthenticatedAppSession(req)) {
    respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }, req);
    return true;
  }
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const userId = pathname.split('/api/codm/player/')[1];
    if (!userId || !/^\d{1,20}$/.test(userId)) {
      respondJson(res, 400, { ok: false, error: 'ID joueur invalide.', code: 'INVALID_PLAYER_ID' }, req);
      return true;
    }

    const storeUrl = new URL(req.url, 'http://localhost');
    const country = (storeUrl.searchParams.get('country') || 'IN').replace(/[^A-Z]/g, '').slice(0, 2);
    const deviceId = crypto.randomUUID();

    const upstream = await fetch('https://order-sg.codashop.com/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        country,
        voucherTypeName: 'CALL_OF_DUTY_MOBILE_WL',
        whiteLabelId: '1',
        deviceId,
        userId,
      }),
    });

    if (!upstream.ok) {
      respondJson(res, 502, { ok: false, error: 'Upstream API error.', code: 'UPSTREAM_ERROR' }, req);
      return true;
    }

    const data = await upstream.json();

    // Handle country redirect
    if (data.errorCode === -200 && data.homeBaseCountry2Name) {
      const redirectUpstream = await fetch('https://order-sg.codashop.com/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: data.homeBaseCountry2Name,
          voucherTypeName: 'CALL_OF_DUTY_MOBILE_WL',
          whiteLabelId: '1',
          deviceId,
          userId,
        }),
      });
      const redirectData = await redirectUpstream.json();
      if (!redirectData.success || !redirectData.result) {
        respondJson(res, 404, { ok: false, error: 'Joueur introuvable.', code: 'PLAYER_NOT_FOUND' }, req);
        return true;
      }
      const r = redirectData.result;
      respondJson(res, 200, {
        ok: true,
        player: {
          nickname: sanitizeText(r.nickname),
          picUrl: sanitizeText(r.picUrl),
          level: r.level,
          levelImage: r.customLevelImageUrl,
          rankClass: r.rankClass,
          readableRank: r.customReadableMpRank,
          rankImage: r.customMpRankImageUrl,
          rating: r.rating,
          shortId: r.shortId,
          country: data.homeBaseCountry2Name,
          countryId: r.countryId,
        },
      }, req);
      return true;
    }

    if (!data.success || !data.result) {
      respondJson(res, 404, { ok: false, error: 'Joueur introuvable.', code: 'PLAYER_NOT_FOUND' }, req);
      return true;
    }

    const r = data.result;
    respondJson(res, 200, {
      ok: true,
      player: {
        nickname: sanitizeText(r.nickname),
        picUrl: sanitizeText(r.picUrl),
        level: r.level,
        levelImage: r.customLevelImageUrl,
        rankClass: r.rankClass,
        readableRank: r.customReadableMpRank,
        rankImage: r.customMpRankImageUrl,
        rating: r.rating,
        shortId: r.shortId,
        country,
        countryId: r.countryId,
      },
    }, req);
  } catch (err) {
    log.error('codm player proxy error', { message: err.message });
    respondJson(res, 500, { ok: false, error: 'Failed to fetch player data.', code: 'PLAYER_PROXY_ERROR' }, req);
  }
  return true;
}

if (req.method === 'GET' && pathname === '/metrics') {
  const metricsToken = process.env.METRICS_TOKEN;
  if (!metricsToken) {
    respondJson(res, 403, { ok: false, error: 'Metrics désactivé (METRICS_TOKEN non configuré).', code: 'METRICS_DISABLED' });
    return true;
  }
  const authHeader = req.headers.authorization || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (provided !== metricsToken) {
    respondJson(res, 401, { ok: false, error: 'Unauthorized.', code: 'UNAUTHORIZED' });
    return true;
  }
  setGauge('zoyd_channels', channels.size);
  setGauge('zoyd_push_subscriptions', countPushSubscriptions());
  setGauge('zoyd_stored_matches', getStateCollection('matches').length);
  setGauge('zoyd_stored_tournaments', getStoredTournaments().length);
  setGauge('zoyd_stored_leagues', getStateCollection('leagues').length);
  setGauge('zoyd_stored_users', getStateCollection('users')?.length || 0);
  const body = metricsToPrometheus();
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  res.end(body);
  return true;
}

const userProfileMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
if (req.method === 'GET' && userProfileMatch && pathname !== '/api/users/search') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  try {
    const identifier = userProfileMatch[1];
    let targetUser = getPublicUserById(identifier);
    if (!targetUser) {
      const byPseudo = findUsersByPseudo(identifier, 1);
      if (byPseudo.length) targetUser = getPublicUserById(byPseudo[0].id);
    }
    if (!targetUser) { respondJson(res, 404, { ok: false, error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' }); return true; }
    respondJson(res, 200, { ok: true, user: targetUser });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/leaderboard') {    if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const leaderboard = getLeaderboard();
    const { limit, offset } = parseQueryParams(req.url);
    const { items: players, hasMore } = paginate(leaderboard, { limit, offset });
    respondJson(res, 200, { ok: true, players, total: leaderboard.length, hasMore });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement du classement.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/stats') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    respondJson(res, 200, { ok: true, stats: getPublicStats() });
  } catch (error) {
    respondMappedError(res, error);
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/matches') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const token = readBearerToken(req);
    const matchSession = token ? getAuthSession(token) : null;
    const matchCurrentUser = matchSession?.user ? getUserById(matchSession.user.id) : null;
    const allMatches = getStateCollection('matches');
    const visibleMatches = getPublicMatchesForUser(allMatches, matchCurrentUser);
    const { limit, offset } = parseQueryParams(req.url);
    // Arrow explicite : `Array.map` passe (element, index, array), donc
    // `map(sanitizeMatchForBroadcast)` aurait passe l'INDEX comme viewerId
    // et `isMe` aurait toujours ete false sans lever la moindre erreur.
    const { items: matches, hasMore } = paginate(
      visibleMatches.map((match) => sanitizeMatchForBroadcast(match, matchCurrentUser?.id || null)),
      { limit, offset }
    );
    respondJson(res, 200, { ok: true, matches, total: visibleMatches.length, hasMore });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des matchs.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/tournaments') {
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  try {
    const { limit, offset } = parseQueryParams(req.url);
    const all = getStoredTournaments();
    const { items: tournaments, hasMore } = paginate(
      // `session` n'existait pas ici : le `isMe` des membres/arbitres de
      // tournois n'etait donc jamais calcule. ReferenceError capture par le
      // `catch` => 500 des que la liste contient un tournoi.
      all.map((t) => sanitizeTournamentForBroadcast(t, getAuthenticatedAppSession(req)?.userId || null)),
      { limit, offset }
    );
    respondJson(res, 200, { ok: true, tournaments, total: all.length, hasMore });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors du chargement des tournois.', code: 'LOAD_ERROR' });
  }
  return true;
}

if (req.method === 'GET' && pathname === '/api/users/search') {
  const session = getAuthenticatedAppSession(req);
  if (!session) { respondJson(res, 401, { ok: false, error: 'Session joueur requise.', code: 'AUTH_REQUIRED' }); return true; }
  if (!rateLimitGuard(res, getClientIp(req), 'social')) { return true; }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get('q') || '';
    const { limit, offset } = parseQueryParams(req.url);
    const allMatches = findUsersByPseudo(q).filter((u) => u.id !== session.user.id);
    const { items: matches, hasMore } = paginate(allMatches, { limit: Math.min(limit, 50), offset });
    respondJson(res, 200, {
      ok: true,
      users: matches.map((u) => ({
        id: u.id, pseudo: u.pseudo, avatar: u.avatar, country: u.country,
        trustScore: u.trustScore, controllerType: u.controllerType, isOnline: u.isOnline,
      })),
      total: allMatches.length,
      hasMore,
    });
  } catch (error) {
    respondJson(res, 500, { ok: false, error: 'Erreur lors de la recherche.', code: 'SEARCH_ERROR' });
  }
  return true;
}

  return false;
};
