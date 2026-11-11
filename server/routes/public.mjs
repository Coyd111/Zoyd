/**
 * server/routes/public.mjs - Domaine PUBLIC : sante, proxy CODM, metriques,
 * profils, classement, statistiques, listes de matchs et de tournois, recherche
 * de joueurs.
 *
 * Renvoie `true` des qu'il a ecrit la reponse (route traitee), `false`
 * sinon - le dernier `return false` laisse la main au module suivant.
 *
 * Ordre des gardes, par route : session (401 `AUTH_REQUIRED`) -> rate limit ->
 * traitement. Exceptions : `/api/health` et `/api/realtime/health` n'ont
 * AUCUNE garde (la sante doit repondre meme quand l'etat est casse) et
 * `/metrics` repond 403 `METRICS_DISABLED` si `METRICS_TOKEN` n'est pas
 * configure, puis 401 sur un jeton errone (comparaison de hachages SHA-256).
 *
 * INVARIANT : le module repond `true` aussitot qu'il a ecrit, et `false` a la
 *   fin : le dispatcheur s'arrete au premier `true`.
 * INVARIANT : `/api/health` repond 503 quand l'etat n'est pas fiable : un
 *   orchestrateur doit savoir que les ecritures sont refusees.
 * INVARIANT (P4 C3 audit-3) : `persistence.pendingWithdrawals` est le
 *   miroir exact de ce que `reconcilePendingWithdrawals` relira a la
 *   reprise — file dediee + historique de tx, dedoublonne par payoutId.
 *   La sante ne re-invente pas la regle, elle compte par le module qui
 *   recouvre, et n'expose qu'un TOTAL anonyme (ni identifiant, ni montant).
 * INVARIANT (audit-3 C7) : `persistence.pendingSettlements` applique la
 *   meme regle aux dettes de reglement (matchs, tournois, ligues, salons
 *   BR, commissions d'arbitre) : compteurs existants uniquement, totaux
 *   anonymes, aucune ecriture — l'etat reste lisible meme casse.
 * INVARIANT : `/metrics` n'est PAS une route JSON : elle ecrit du
 *   `text/plain` en `res.writeHead`, donc elle echappe aux en-tetes et aux
 *   metriques de `respondJson`.
 * INVARIANT : le jeton des metriques est compare en temps CONSTANT
 *   (`secretsEqual` sur les hachages SHA-256, donc de taille fixe).
 * INVARIANT : les proxies CODM (store, player) exigent une session : sans
 *   elle, le serveur serait un proxy Codashop gratuit pour tout Internet,
 *   sur le quota du forfait Render gratuit.
 * INVARIANT : les listes sont SANITISEES avec leSPECTATEUR en argument
 *   (`sanitizeMatchForBroadcast` / `sanitizeTournamentForBroadcast`), pour
 *   que `isMe` soit calcule.
 * PIEGE : `map(sanitizeMatchForBroadcast)` passerait l'INDEX comme
 *   `viewerId` et `isMe` serait toujours faux, sans lever la moindre
 *   erreur : la fleche `(m) => sanitize...(m, viewerId)` est obligatoire.
 * PIEGE : le classement et les statistiques sont caches 60 s dans la couche
 *   de persistance : un changement n'est pas immediat.
 * PIEGE : la pagination borne le `limit` a [1, 500] : en demander 10 000 ne
 *   renvoie pas plus.
 */

import { getClientIp, rateLimitGuard } from '../rate-limiter.mjs';
// P9 C3 (audit-3) : import EXPLICITE - `crypto.randomUUID()` marchait par
// le global WebCrypto de Node >= 19 (engines : 22.13, verifie), mais la
// dependance n'etait declaree nulle part : un downgrade de runtime aurait
// leve un ReferenceError a chaque proxy CODM et message de chat.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
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
  listUserIds,
  sanitizeText,
} from '../persistence.mjs';
// Les compteurs de dettes (matchs/tournois/ligues/BR) et le resume finance
// vivent derriere `/api/admin/finance/debts` (requireAdmin2fa) et
// `/metrics` (jeton). `/api/health` ne les scanne plus (audit securite).
import { getPublicMatchesForUser } from '../match-engine.mjs';
// La finance reste exposee sur `/metrics` (jeton), pas sur la sante.
import { collectFinanceDebts } from '../finance-observability.mjs';
import { metricsToPrometheus, setGauge, clearStaleFinanceTypeGauges } from '../metrics.mjs';
import { channels } from '../channel-presence.mjs';
import {
  getStoredTournaments,
  sanitizeMatchForBroadcast,
  sanitizeTournamentForBroadcast,
} from '../state-helpers.mjs';
import { getNow } from '../utils.mjs';
import { createLogger } from '../logger.mjs';

const log = createLogger('public-routes');

/**
 * Comparaison de secrets en temps constant.
 *
 * `a !== b` s'arrete au premier caractere different : le temps de reponse
 * depend donc du nombre de caracteres corrects, ce qui constitue un canal
 * temporel. Sur un jeton de 256 bits, l'exploiter reellement demanderait de
 * mesurer des centaines de requetes a travers un reseau — c'est peu probable,
 * mais la correction coute trois lignes et supprime la classe de probleme.
 *
 * `timingSafeEqual` exige deux tampons de meme taille : on compare donc des
 * hachages de longueur fixe, ce qui evite aussi de fuiter la taille du secret.
 *
 * @param {string} a - Valeur fournie par l'appelant
 * @param {string} b - Valeur attendue
 * @returns {boolean}
 */
const secretsEqual = (a, b) => {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};

export const handlePublicRoutes = async ({ req, res, pathname, io }) => {
if (req.method === 'GET' && pathname === '/api/health') {
  // Santé minimisée (audit sécurité 2026-11-08) : la sonde publique
  // ne doit ni coûter un balayage complet ni fuiter l'état financier.
  // Avant, chaque hit appelait collectFinanceDebts + compteurs sur
  // matches/tournois/ligues/salons+users (O(n)), donc un curl en boucle
  // devenait un DoS CPU déguisé, et les totaux partaient en clair.
  // Maintenant : lectures mémoire pures (tailles de Maps via getHealthInfo)
  // + rate-limit `default`. Les agrégats finance vivent derrière
  // `/api/admin/finance/debts` (requireAdmin2fa) et `/metrics` (jeton).
  if (!rateLimitGuard(res, getClientIp(req), 'default')) { return true; }
  const health = getHealthInfo();
  respondJson(res, health.stateTrusted ? 200 : 503, {
    ok: health.stateTrusted,
    service: 'zoyd-api',
    persistence: {
      stateTrusted: health.stateTrusted,
      deployedCommitShort: health.deployedCommitShort || null,
      // Identite de l instance qui repond. Pendant un deploiement, Render
      // fait coexister l ancienne et la nouvelle instance : deux identites
      // sur la sonde = fenetre multi-instance ouverte, visible.
      instanceId: health.instanceId || null,
      processStartedAt: health.processStartedAt || null,
      // Derniere ecriture d etat impossible : signale une base momentanement
      // injoignable (le rechargement est automatique apres trois echecs).
      stateWriteError: health.stateLoadError || null,
      // SONDES DE SECURITE — des BOOLEENS, rien de financier.
      //
      // La minimisation ci-dessus visait les AGREGATS (totaux de cagnotte,
      // compteurs) : ils coutaient un balayage O(n) et fuyaient l etat
      // financier. Ces booleens-la ne coutent RIEN (ils sont deja calculees
      // en memoire) et ne revelent rien : ils disent SEULEMENT si un
      // garde-fou est en place.
      //
      // Sans eux, la sonde publique etait incapable de dire qu une fenetre
      // etait ouverte, alors que le code affirme partout que « /api/health
      // suffit » a verifier une migration sans connexion SQL :
      //   - `stateRevisionColumn` false = la migration
      //     `state_snapshots.revision` n est pas jouee : les ecritures des
      //     collections ne sont plus conditionnelles et la fenetre
      //     multi-instance qui ecrase les mutations de portefeuille est
      //     OUVERTE — sans aucun signal ;
      //   - `occRevisionColumn` false = meme chose pour les portefeuilles ;
      //   - `loginLockoutPersisted` false = le verrouillage de connexion ne
      //     survit pas a un redemarrage ;
      //   - `adminTotpPersisted` false = les secrets 2FA des admins ne
      //     survivent pas au redemarrage ;
      //   - `sanctionsPersisted` false = les bannissements ne survivent pas ;
      //   - `integrityOk` false = l etat diverge de la base ;
      //   - `cronLeaseAvailable` false = les jobs de fond ne sont PAS
      //     proteges contre l execution en double (migration
      //     `supabase/migrate-cron-leases.sql` non jouee).
      // null = pas encore sonde (le demarrage vient de commencer).
      occRevisionColumn: health.occRevisionColumn ?? null,
      stateRevisionColumn: health.stateRevisionColumn ?? null,
      loginLockoutPersisted: health.loginLockoutPersisted ?? null,
      adminTotpPersisted: health.adminTotpPersisted ?? null,
      sanctionsPersisted: health.sanctionsPersisted ?? null,
      integrityOk: health.integrity ? health.integrity.ok : null,
      // Bail distribue des jobs de fond : false = la table
      // `cron_leases` manque, donc deux instances peuvent lancer le meme
      // balayage en parallele (l appel FedaPay part deux fois, les
      // compteurs avancent deux fois). L argent reste protege par les cles
      // d idempotence, mais le journal et les appels externes mentent.
      cronLeaseAvailable: health.cronLease ? health.cronLease.available : null,
      // COMPTEURS du bail : ils disent si la protection FONCTIONNE, ce que
      // le seul booleen ne dit pas.
      //
      // En production, la table etait visible (`available: true`) alors que
      // chaque INSERT echouait sur un BIGINT : le bail n etait JAMAIS pris,
      // et la protection promise n existait pas. Un operateur qui lisait
      // seulement le booleen croyait le contraire.
      //
      //   - `cronLeaseAcquis`  : bails obtenueS (jobs executes sous bail) ;
      //   - `cronLeaseRefuses` : bails detenus par une autre instance (jobs
      //     sautes) — c'est le comportement ATTENDU en multi-instance ;
      //   - `cronLeaseErrors`  : la base a refuse le bail (jobs executes
      //     SANS protection). Doit rester a ZERO en regime normal ;
      //   - `cronLeaseDegraded` : jobs executes sans protection (table
      //     absente ou panne de base).
      //
      // Ces compteurs sont ceux du PROCESSUS : ils repartent a zero au
      // redemarrage de l instance.
      cronLeaseAcquired: health.cronLease ? health.cronLease.acquis : null,
      cronLeaseRefused: health.cronLease ? health.cronLease.refuses : null,
      cronLeaseErrors: health.cronLease ? health.cronLease.erreurs : null,
      cronLeaseDegraded: health.cronLease ? health.cronLease.degrades : null,
      // L historique DURABLE des bails (table `cron_lease_audit`). false =
      // migration `supabase/migrate-cron-lease-audit.sql` non jouee : les
      // baux fonctionnent, mais rien n est conserve — c est ce qui manquait
      // pour constater qu un job a tourne SANS protection.
      cronLeaseAuditAvailable: health.cronLeaseAudit ? health.cronLeaseAudit.available : null,
    },
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
    const deviceId = randomUUID();

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
    const deviceId = randomUUID();

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
  if (!secretsEqual(provided, metricsToken)) {
    respondJson(res, 401, { ok: false, error: 'Unauthorized.', code: 'UNAUTHORIZED' });
    return true;
  }
  setGauge('zoyd_channels', channels.size);
  setGauge('zoyd_push_subscriptions', countPushSubscriptions());
  setGauge('zoyd_stored_matches', getStateCollection('matches').length);
  setGauge('zoyd_stored_tournaments', getStoredTournaments().length);
  setGauge('zoyd_stored_leagues', getStateCollection('leagues').length);
  setGauge('zoyd_stored_users', getStateCollection('users')?.length || 0);
  // P0 observabilite argent : jauges anonymes pour alerter (compteurs + ZC
  // + age). Aucun label par entite : cardinalite bornee a 7 series.
  {
    const finance = collectFinanceDebts({
      matches: getStateCollection('matches'),
      tournaments: getStoredTournaments(),
      leagues: getStateCollection('leagues'),
      brLobbies: getStateCollection('brLobbies'),
      listUserIds,
      getWallet: (userId) => getUserById(userId)?.wallet,
      nowMs: Date.now(),
    }).summary;
    setGauge('zoyd_finance_total_debts', finance.totalDebts);
    setGauge('zoyd_finance_total_zc', finance.totalZC);
    setGauge('zoyd_finance_oldest_age_seconds', finance.oldestAgeMs == null ? 0 : finance.oldestAgeMs / 1000);
    setGauge('zoyd_finance_stale_debts', finance.staleCount);
    setGauge('zoyd_finance_critical_debts', finance.criticalCount);
    setGauge('zoyd_finance_uncollectable_debts', finance.uncollectableCount);
    for (const [type, n] of Object.entries(finance.byType || {})) {
      setGauge('zoyd_finance_debts_by_type', n, { type });
    }
    // Purge des séries résolues : sans cela, `zoyd_finance_debts_by_type`
    // reste figé à l'ancienne valeur après résolution (alerte qui ne
    // se résout jamais).
    clearStaleFinanceTypeGauges(finance.byType || {});
  }
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
