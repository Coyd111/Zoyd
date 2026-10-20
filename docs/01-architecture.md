# ZOYD — Architecture

> Ce document décrit **le cœur serveur** : point d'entrée, routage HTTP, temps réel,
> sérialisation, limitation de débit, verrous, journalisation, métriques, présence,
> chat, notifications push, tâches planifiées.
>
> Il complète `ARCHITECTURE.md` (racine) qui donne la vue d'ensemble en schémas :
> ici, on décrit **l'ordre exact** des gardes, les contrats internes et les points
> de rupture. Il ne décrit ni le modèle métier (→ `02-modele-metier.md`), ni la
> surface de sécurité complète (→ `03-securite.md`), ni le catalogue de routes
> détaillé champ par champ (→ `04-api.md`).

**Source :** cartographie établie par lecture directe du code serveur.
**Portée :** `server/` — 99 fichiers d'après `docs/00-INDEX.md:46`.
**Conventions de citation :** `fichier:ligne`. Les lignes sont celles du dépôt au
moment de la rédaction.

---

## 1. Vue d'ensemble

### 1.1 Forme générale

ZOYD est un **monolithe modulaire à processus unique** : un seul serveur Node.js
sert à la fois l'API REST et le WebSocket Socket.IO.

```
┌──────────────────────────────────────────────────────────┐
│   FRONT (Vercel) — React 18 + TS + Vite 6 + Zustand     │
│   routes.tsx (React Router v7) + realtimeClient.ts       │
└───────────────┬───────────────────────────┬──────────────┘
                │ REST (fetch + apiClient)   │ WebSocket (Socket.IO 4.8)
┌───────────────▼───────────────────────────▼──────────────┐
│   BACK (Render) — Node.js ESM + `http` natif             │
│                                                          │
│   realtime-server.mjs  ← point d'entrée unique           │
│   ├── http-utils.mjs        sérialisation / CORS / erreurs│
│   ├── rate-limiter.mjs      quotas par IP + groupe       │
│   ├── mutex.mjs             sérialisation des mutations  │
│   ├── logger.mjs            logs JSON structurés         │
│   ├── metrics.mjs           métriques Prometheus         │
│   ├── admin-totp.mjs        2FA admin (TOTP)             │
│   ├── channel-presence.mjs  présence par canal           │
│   ├── chat-helpers.mjs      canaux et diffusion chat      │
│   ├── state-helpers.mjs     persistance + diffusion état │
│   ├── push-notifications.mjs push Web Push (VAPID)       │
│   ├── cron.mjs              travaux de fond               │
│   ├── persistence.mjs       source de vérité (Supabase)  │
│   └── routes/               11 modules de routage        │
└───────────────┬───────────────────────────┬──────────────┘
                │                           │
      ┌─────────▼────────┐        ┌─────────▼─────────┐
      │ Supabase         │        │ FedaPay / web-push│
      │ (PostgreSQL)     │        │ (tiers externes)  │
      └──────────────────┘        └───────────────────┘
```

Cette forme est celle décrite par `ARCHITECTURE.md:95-120`. Elle n'a pas changé.

### 1.2 Rectificatif de nomenclature

Le point d'entrée est **`server/realtime-server.mjs`** (687 lignes). Trois fichiers
souvent cités n'existent pas :

| Fichier fréquemment cité | Réalité |
|---|---|
| `server/index.mjs` | **Absent** |
| `server/server.mjs` | **Absent** |
| `server/session*.mjs` | **Absent** — les sessions (auth + realtime) vivent dans `server/persistence.mjs:2982-3258` |

Preuve du point d'entrée : `package.json:13` (`"start": "node server/realtime-server.mjs"`),
`package.json:11` (`dev:realtime`), `render.yaml:7` (`startCommand: node server/realtime-server.mjs`).

Le backend est du **`http` natif**, pas Express. `docs/00-INDEX.md:45` annonce
« Back Node (Express) » : c'est inexact, `ARCHITECTURE.md:39` est correct
(« Node.js ESM (http natif) »).

### 1.3 Un seul processus, obligatoire

L'état des joueurs vit **en mémoire**, sous verrou de processus. Deux instances
seraient deux espaces mémoire disjoints : le verrou mutex ne serait alors protégé
par rien.

`server/single-process-guard.mjs:106` (`assertSingleProcess`) refuse de démarrer en
multi-processus, avant tout chargement d'état (`server/realtime-server.mjs:598`).
La détection repose sur `WEB_CONCURRENCY` : non défini ⇒ 1 worker ; multi-processus
détecté ⇒ `throw new Error('Refus de demarrer : le serveur exige un processus unique.')`
(`server/single-process-guard.mjs:110-121`). Une valeur non numérique produit un
avertissement mais **ne bloque pas** le démarrage (`server/single-process-guard.mjs:100-102`).

> « instance A : lit solde 1 000, retire 800 → ecrit solde 200 / instance B : lit solde 1 000,
> credite 500 → ecrit solde 1 500 / resultat : solde 1 500. Les 800 de A ont disparu.
> Aucun verrou ne l'empeche : ils sont dans deux espaces memoire differents. Et rien ne
> les remarque : `/api/health` reste vert, parce que chaque instance est individuellement
> coherente. » — `server/single-process-guard.mjs:10-21`

---

## 2. Séquence de démarrage

`start()` — `server/realtime-server.mjs:587-662`. L'ordre n'est pas décoratif : chaque
étape dépend de la précédente.

| # | Étape | Ligne | Rôle |
|---|---|---|---|
| 1 | `assertSingleProcess()` | `server/realtime-server.mjs:598` | Refuse le multi-processus **avant** tout chargement d'état |
| 2 | `await loadFromSupabaseWithRetry(3)` | `server/realtime-server.mjs:600` | Charge l'état ; **en cas d'échec, le serveur démarre quand même** mais `isStateTrusted() === false` → écritures refusées |
| 3 | `await loadAdminTotpSecrets()` | `server/realtime-server.mjs:613` | Remplit la Map `adminTotpSecrets` (`server/admin-totp.mjs:24`) |
| 4 | `await verifyDataIntegrity()` | `server/realtime-server.mjs:621` | Contrôle d'intégrité ; résultat **logué en `error`** si `!ok`, jamais bloquant |
| 5 | `ensureGlobalChatChannel()` + `syncMatchChatChannels(...)` | `server/realtime-server.mjs:626-627` | Crée le canal global + un canal par match |
| 6 | `hydrateWithdrawalKeys()` / `hydrateWinningsKeys()` | `server/realtime-server.mjs:632`, `:636` | Reconstruit les index d'idempotence |
| 7 | `initCronJobs()` | `server/realtime-server.mjs:638` | Démarre les travaux de fond (`server/cron.mjs:27`) |
| 8 | `setInterval` d'automatisation de matchs | `server/realtime-server.mjs:640-657` | Tick de **30 000 ms** (`server/match-engine.mjs:98`), sous `withMatchMutex`, garde anti-chevauchement `matchAutomationRunning` |
| 9 | `server.listen(PORT, ...)` | `server/realtime-server.mjs:659` | `PORT = process.env.PORT || ZOYD_REALTIME_PORT || 4001` (`server/realtime-server.mjs:197`) |

> « Refuse de booting en multi-processus AVANT de charger quoi que ce soit. […] Avec deux
> instances, deux mutations concurrentes lisent le meme instantane et la derniere ecrase
> la premiere : sur un portefeuille, c'est de l'argent perdu en silence. […] un serveur
> qui tourne en vendant ceScenario est pire qu'un serveur qui ne demarre pas, parce
> qu'il continue d'accepter des retraits. » — `server/realtime-server.mjs:588-597`

**Point dur.** Si le chargement Supabase échoue, le serveur écoute tout de même
(`server/realtime-server.mjs:600`). Le service répond, mais l'état n'est pas fiable :
`/api/health` renvoie 503 (`server/routes/public.mjs:64`) et les écritures sont
refusées. C'est un choix : mieux vaut un serveur audible et en lecture seule qu'un
processus muet.

---

## 3. Le pipeline de requête

C'est la mécanique centrale du service. `handleRequest` — `server/realtime-server.mjs:206-266`.

### 3.1 Ordre EXACT des gardes

```
1. !req.url                     → 404 {code:'NOT_FOUND'}             (:207-210)
2. getPathname(req)             → pathname                            (:212)
3. req._metricsStart            → startTimer()                        (:213)
   req._metricsPathname         → normalizePathForMetrics(pathname)   (:214)
4. res._req = req               → mémorisé pour respondJson          (:215)
5. log.debug('request')         → SAUF OPTIONS, /api/health, /metrics* (:218-221)
6. OPTIONS                      → 204 {}                              (:223-226)
7. CSRF (POST/PATCH/PUT/DELETE seulement)                            (:234-248)
     7a. Origin hors ALLOWED_ORIGINS → 403 CSRF_ORIGIN_REJECTED
     7b. Content-Type non JSON        → 415 UNSUPPORTED_MEDIA_TYPE
8. BOUCLE ROUTE_MODULES                                                    (:261-263)
9. Aucune route ne renvoie true  → 404 'Route introuvable.'                 (:265)
```

| Garde | Ligne | Méthodes concernées | Effet |
|---|---|---|---|
| URL absente | `server/realtime-server.mjs:207-210` | toutes | 404 `NOT_FOUND` |
| `pathname` | `server/realtime-server.mjs:212` | toutes | `new URL(req.url, 'http://'+host).pathname` (`server/http-utils.mjs:277`) |
| métriques | `server/realtime-server.mjs:213-214` | toutes | démarre le chronomètre + normalise le path pour les labels |
| log `debug` | `server/realtime-server.mjs:218-221` | toutes sauf OPTIONS, `/api/health`, `/metrics*` | trace d'entrée |
| preflight | `server/realtime-server.mjs:223-226` | OPTIONS | 204 court-circuit |
| CSRF — Origin | `server/realtime-server.mjs:236-240` | POST/PATCH/PUT/DELETE | 403 `CSRF_ORIGIN_REJECTED` |
| CSRF — Content-Type | `server/realtime-server.mjs:243-247` | POST/PATCH/PUT/DELETE | 415 `UNSUPPORTED_MEDIA_TYPE` |
| dispatch routes | `server/realtime-server.mjs:261-263` | toutes | court-circuit au premier module qui renvoie `true` |
| 404 final | `server/realtime-server.mjs:265` | toutes | `{"ok":false,"error":"Route introuvable.","code":"NOT_FOUND"}` |

### 3.2 Le garde CSRF en détail

> « Le cookie de session est SameSite=None (front Vercel → API Render) : sans ce garde,
> une page tierce peut POSTer /api/wallet/withdraw avec `mode:'no-cors'` et
> `Content-Type: text/plain` (requête simple, sans preflight) en profitant du cookie
> envoyé automatiquement. Défense à deux niveaux : Origin sur la liste blanche +
> Content-Type JSON obligatoire. » — `server/realtime-server.mjs:228-233`

> « text/plain échoue ici : c'est ce qui bloque le CSRF "simple request". Un client sans
> Content-Type (curl, e2e) reste accepté. » — `server/realtime-server.mjs:241-242`

Trois limites du garde, à connaître :

- Le CSRF ne s'applique **qu'aux méthodes mutatrices** (`server/realtime-server.mjs:234`).
  `GET` et `HEAD` ne sont jamais contrôlés.
- Le contrôle `Content-Type` n'est déclenché **que si un Content-Type est présent**
  (`if (contentType && ...)`, `server/realtime-server.mjs:244`). Un client sans
  Content-Type passe.
- Le contrôle `Origin` ne rejette **que si `origin` est présent**
  (`if (origin && !ALLOWED_ORIGINS.includes(origin))`, `server/realtime-server.mjs:236`).
  Une requête sans Origin (curl, E2E, serveur-à-serveur) passe le CSRF.

### 3.3 Filet de sécurité et erreurs globales

Une exception non rattrapée dans une route est convertie en 500 par le `catch` du
`http.createServer` (`server/realtime-server.mjs:268-277`) :

```json
{"ok": false, "error": "Erreur serveur inattendue.", "code": "INTERNAL_ERROR"}
```

Le `try/catch` autour du `respondJson` absorbe le cas `ERR_HTTP_HEADERS_SENT`.

Au niveau processus :

| Événement | Ligne | Comportement |
|---|---|---|
| `unhandledRejection` | `server/realtime-server.mjs:664-666` | `log.fatal(...)` — **le processus ne s'arrête pas** |
| `uncaughtException` | `server/realtime-server.mjs:667-670` | `log.fatal(...)` puis **`process.exit(1)`** |
| `SIGTERM` / `SIGINT` | `server/realtime-server.mjs:672-684` | `clearInterval` → `server.close()` → `io.close()` → `process.exit(0)`, **timeout 10 s** → `process.exit(1)` |

---

## 4. Le routage HTTP

### 4.1 Table des modules

`ROUTE_MODULES` — `server/realtime-server.mjs:28-42`. Dispatch en
`server/realtime-server.mjs:261-263`.

```js
for (const routeModule of ROUTE_MODULES) {
  if (await routeModule({ req, res, pathname, io })) return;
}
```

| # | Module | Ligne | Domaine |
|---|---|---|---|
| 1 | `handlePublicRoutes` | `server/realtime-server.mjs:31` | Santé, catalogue CODM, métriques, profils, classements |
| 2 | `handleAuthRoutes` | `server/realtime-server.mjs:32` | Inscription, connexion, session, profil |
| 3 | `handleSocialRoutes` | `server/realtime-server.mjs:33` | Amis, blocages, signalements, notifications |
| 4 | `handleWalletRoutes` | `server/realtime-server.mjs:34` | Portefeuille, dépôts, retraits, FedaPay |
| 5 | `handleTournamentRoutes` | `server/realtime-server.mjs:35` | Tournois |
| 6 | `handleLeagueRoutes` | `server/realtime-server.mjs:36` | Ligues |
| 7 | `handleBrRoutes` | `server/realtime-server.mjs:37` | Battle Royale |
| 8 | `handleMatchRoutes` | `server/realtime-server.mjs:38` | Matchs 1v1–5v5 |
| 9 | `handleAdminRoutes` | `server/realtime-server.mjs:39` | Administration, 2FA, modération |
| 10 | `handleChatRoutes` | `server/realtime-server.mjs:40` | Chat |
| 11 | `handleRealtimeRoutes` | `server/realtime-server.mjs:41` | Bootstrap temps réel, push Web |

### 4.2 Sémantique de `return true`

| Valeur renvoyée | Signification | Effet |
|---|---|---|
| `true` | « j'ai traité la requête » — **la réponse a déjà été écrite** | la boucle `handleRequest` court-circuite (`server/realtime-server.mjs:262`) ; le 404 final n'est jamais atteint |
| `false` | « ce n'est pas ma route » | le module suivant est essayé |

`return false` est la dernière instruction de chaque module (ex. `server/routes/public.mjs:438`).

Deux conséquences pratiques :

1. Un module qui écrit une réponse **doit** renvoyer `true`. Le forgets, la requête
   tombe sur le 404 final après avoir déjà écrit des en-têtes → `ERR_HTTP_HEADERS_SENT`.
2. Les gardes qui écrivent eux-mêmes (`requireAdmin`, `requireAdmin2fa`) imposent au
   code appelant un `return true` immédiat, **sans re-répondre**
   (`server/routes/wallet.mjs:106-107`).

### 4.3 Règles d'ordre des gardes

**Entre modules de routes, l'ordre n'a AUCUNE portée sémantique.**

> « Chaque module reçoit la requête et renvoie `true` s'il l'a traitée.
> L'ordre n'a AUCUNE portée sémantique : une vérification sur les 27 routes
> restantes puis sur les 73 routes des modules a montré qu'aucune paire ne peut
> répondre à la même requête (un seul chevauchement existe, `/api/users/:id` face à
> `/api/users/search`, neutralisé par une garde explicite dans la route). On peut
> donc regrouper par domaine librement.
> Conséquence pratique : ajouter une route ne touche plus un `if` parmi 3100 lignes,
> mais le module de son domaine. » — `server/realtime-server.mjs:250-260`

**À l'intérieur d'une route, en revanche, l'ordre est porteur de sens.** Il n'est
pas cosmétique : il détermine *ce qui est déjà validé* quand une garde s'exécute, et
*ce qui a déjà été écrit* quand une garde échoue.

| Ordre imposé | Où | Raison |
|---|---|---|
| Rate limit **avant** lecture de token et avant `requireAdmin2fa` | toutes les routes admin (`server/routes/admin.mjs`, ordre systématique) | le quota doit protéger le garde, pas l'inverse |
| Rate limit avant le parse du corps | `POST /api/wallet/withdraw` (`server/routes/wallet.mjs:143` puis `:145-150`) | un corps de 1 Mo ne doit pas coûter un parse à quelqu'un qui a déjà dépassé son quota |
| Session **avant** la logique métier | `server/routes/wallet.mjs:138-142` | aucun effet de bord avant d'avoir su *qui* demande |
| Parsing **hors** du verrou | `server/routes/match.mjs:42` | « le mutex global ne doit couvrir que la mutation » |
| Clé d'idempotence validée **avant** le débit | `server/routes/wallet.mjs:174-181` | pas de debit sans clé |
| Lecture de l'état d'idempotence **à l'intérieur** du verrou | `server/routes/wallet.mjs:203-207` | sinon TOCTOU : deux requêtes lisent le même instantané |
| Verrou global **puis** verrou par entité | `server/routes/match.mjs:50` puis `:76` ; `server/routes/wallet.mjs:202` | ordre inverse = risque de deadlock (voir §8.3) |
| `requireAdmin2fa` **en plus** de l'autorité métier | `POST /api/br/lobbies/:id/finish` (`server/routes/br.mjs:168-173`) | l'arbitre du salon ne dispense pas de la 2FA |

---

## 5. Utilitaires HTTP (`server/http-utils.mjs`)

Centralise les conventions : cookies, en-têtes, réponse JSON, parsing, lecture de
token, résolution de session, mapping erreur → statut.

### 5.1 `respondJson` — `server/http-utils.mjs:91-142`

En-têtes posés à **chaque** réponse (`server/http-utils.mjs:110-131`) :

| En-tête | Valeur |
|---|---|
| `Content-Type` | `application/json` |
| `Access-Control-Allow-Origin` | `getCorsOrigin(effectiveReq)` — `''` si l'origin n'est pas whitelistée |
| `Access-Control-Allow-Credentials` | `true` |
| `Access-Control-Allow-Methods` | `GET,POST,PATCH,DELETE,OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type,Authorization` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Vary` | `Origin` |

Ni `X-XSS-Protection` ni CSP — décision argumentée dans `server/http-utils.mjs:118-130` :
l'en-tête `X-XSS-Protection` est déprécié et ignoré par les navigateurs modernes ; la CSP
apporte son effet **sur les documents**, pas sur une réponse JSON. Le travail réel est
fait par `vercel.json` côté front.

**Rotation de session** (`server/http-utils.mjs:95-108`) : si `req._authRotation` est
posé, `respondJson` écrit `Set-Cookie: zoyd_auth=<nouveau token>; Max-Age=21600`
**avant** `writeHead` — une seule tentative, la rotation étant asynchrone.

**Métriques** (`server/http-utils.mjs:134-141`) : `zoyd_http_requests_total{method,status}`,
`zoyd_http_request_duration_seconds{method,pathname}` (histogramme),
`zoyd_http_errors_total` si `statusCode >= 500`.

Deux routes contournent `respondJson` parce qu'elles ne renvoient pas du JSON :
`/metrics` écrit en `text/plain` via `res.writeHead` direct
(`server/routes/public.mjs:325-326`), l'export admin CSV/JSON également
(`server/routes/admin.mjs:379-396`).

### 5.2 Corps de requête, tokens et sessions

| Fonction | Ligne | Comportement |
|---|---|---|
| `parseRequestBody(req)` | `server/http-utils.mjs:174-205` | Limite **1 Mo** (`BODY_SIZE_LIMIT`, `server/http-utils.mjs:167`). Corps vide → `{}`. JSON invalide → `code:'INVALID_JSON'`. Trop volumineux → `req.destroy()` + `code:'PAYLOAD_TOO_LARGE'` |
| `readBearerToken(req)` | `server/http-utils.mjs:212-229` | **Cookie `zoyd_auth` d'abord**, puis `Authorization: Bearer` |
| `getAuthenticatedAppSession(req)` | `server/http-utils.mjs:244-253` | **Bearer d'abord**, sinon cookie — **priorités inversées** |
| `getAuthenticatedRealtimeSession(req)` | `server/http-utils.mjs:260-270` | **Bearer uniquement**, jamais le cookie |

> « L'en-tête Authorization d'abord, PAS readBearerToken : celui-ci privilegie le cookie
> zoyd_auth, qui n'est PAS un token realtime. Le front appelle ces routes sans
> `credentials: include` (cross-origin), donc ça marchait par chance ; le jour où le
> cookie est envoyé, getRealtimeSession(cookie) → null → 401 sur le bootstrap realtime
> (reconnexion en boucle) et push-subscribe echoué en silence. »
> — `server/http-utils.mjs:261-266`

Deux notions de token coexistent donc : **token app** (cookie `zoyd_auth` ou Bearer) et
**token realtime** (Bearer uniquement). Les confondre produit un 401 silencieux.

`parseRequestBody` coupe le socket sur dépassement de taille :

> « On coupe le socket : sans ca, le client continuait d'envoyer le corps et Node gardait
> le flux ouvert en memoire (le serveur pouvait etre sature par une seule requete de 1 Go). »
> — `server/http-utils.mjs:181-183`

Un socket coupé par le client en cours de lecture remonte `code:'CLIENT_ABORTED'`
(`server/http-utils.mjs:190-192`) — pas une invalidité de session.

### 5.3 Cookies, origins, pagination

| Élément | Ligne | Valeur |
|---|---|---|
| `serializeAuthCookie` | `server/http-utils.mjs:47-56` | **prod** : `HttpOnly; Secure; SameSite=None; Path=/` — **dev** : `HttpOnly; SameSite=Lax` |
| `ALLOWED_ORIGINS` | `server/http-utils.mjs:60-67` | `ZOYD_ALLOWED_ORIGINS` (CSV) ; en dev seulement, `localhost:5173` + `127.0.0.1:5173` ; toujours ajoutés `https://zoyd.vercel.app`, `https://zoyd.africa`, `https://www.zoyd.africa` |
| `ALLOW_DEBUG_CODES` | `server/http-utils.mjs:73` | `true` seulement si `ALLOW_DEBUG_CODES === 'true'`. **Fail-closed** : `NODE_ENV` absent = production |
| `parseQueryParams` | `server/http-utils.mjs:148-154` | `limit` borné **[1, 500]** (défaut 100), `offset` ≥ 0 |
| `paginate` | `server/http-utils.mjs:161-164` | `{ items, hasMore }` |
| `normalizePathForMetrics` | `server/http-utils.mjs:284-296` | UUID → `/*` ; segments `/M-*`, `/T-*`, `/FR-*`, `/BR-*`, `/LS-*`, `/NOTIF-*` |

> « Battle Royale : `BR-MUWJBH2Z-WI` et les ligues `LS-XXXX`. Sans ces motifs, chaque salon
> cree devenait une serie de metrique distincte : la cardinalite des labels explosait et
> les evictionenses de MAX_COUNTER_ENTRIES commencaient a perdre des compteurs. »
> — `server/http-utils.mjs:290-293`

### 5.4 Mapping erreur métier → statut HTTP

Convention de forme, uniforme sur tout le serveur :

```json
{ "ok": false, "error": "<message humain, FR>", "code": "<CODE_MACHINE>" }
```

`mapPersistenceError` — `server/http-utils.mjs:303-440`. `respondMappedError` —
`server/http-utils.mjs:442-448` : log `log.error('[HTTP] 500', …)` **uniquement pour le
500** (les 4xx ne sont pas logués en erreur).

| Statut | Codes |
|---|---|
| **400** | `INVALID_REGISTRATION`, `IDEMPOTENCY_KEY_REQUIRED`, `ACTIVE_WAGER`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `INVALID_TRANSACTION_ID`, `INVALID_AMOUNT`, `WITHDRAWAL_MIN`, `MATCH_SEGMENT_MISMATCH`, `ROOM_INCOMPLETE`, `ROOM_TOO_EARLY`, `PROOFS_REQUIRED`, `DISPUTE_INCOMPLETE`, `MATCH_NOT_READY`, `CHECKIN_REQUIRED`, `INVALID_MATCH`, `NOT_ENOUGH_PLAYERS`, `QUALIFICATION_INCOMPLETE`, `REGISTRATION_CLOSED`, `NOT_JOINED`, `MATCH_ALREADY_LIVE`, `NO_PLAYERS`, `INVALID_DAY`, `INVALID_RESULTS`, `INVALID_ARBITER`, `INVALID_PAYOUT`, `INVALID_MODE`, `INVALID_MAP`, `INVALID_RANKING_MODE`, `INVALID_DATE`, `WEAK_PASSWORD`, `RESET_FAILED`, `INVALID_EMAIL`, `INVALID_OPERATOR`, `INVALID_PHONE`, `INVALID_COUNTRY`, `LEGAL_NOT_ACCEPTED`, `INVALID_FORMAT`, `PAYMENT_NOT_CONFIGURED`, `TRANSACTION_NOT_APPROVED`, `FEDAPAY_API_ERROR` |
| **401** | `INVALID_CREDENTIALS`, `UNAUTHORIZED` |
| **403** | `FORBIDDEN`, `TRANSACTION_NOT_OWNED`, `ACCOUNT_NOT_ACTIVATED` |
| **404** | `NOT_FOUND`, `MATCH_NOT_FOUND`, `TOURNAMENT_NOT_FOUND`, `LEAGUE_NOT_FOUND`, `CHANNEL_NOT_FOUND`, `PLAYER_NOT_FOUND`, `USER_NOT_FOUND`, `LOBBY_NOT_FOUND` |
| **409** | `DUPLICATE_PSEUDO`, `DUPLICATE_EMAIL`, `DUPLICATE_PHONE`, `DUPLICATE_GAME_ID`, `ALREADY_LOCKED`, `TRANSACTION_IN_PROGRESS`, `INSUFFICIENT_FUNDS`, `DAILY_WITHDRAWAL_LIMIT`, `MATCH_CLOSED`, `MATCH_NOT_LIVE`, `ALREADY_JOINED`, `ROLE_CONFLICT`, `TRUST_REQUIRED`, `NO_SLOT_AVAILABLE`, `ARBITER_TAKEN`, `SELF_BLOCK`, `TRANSACTION_ALREADY_PROCESSED`, `2FA_ALREADY_ENABLED`, `RESULT_NOT_FOUND`, `RESULT_ALREADY_EXISTS`, `DISPUTE_ALREADY_OPEN`, `DISPUTE_NOT_FOUND`, `DISPUTE_ALREADY_ESCALATED`, `ALREADY_FRIENDS`, `ACCOUNT_ALREADY_ACTIVE`, `REQUEST_PENDING`, `ALREADY_CONFIRMED`, `INVALID_REQUEST`, `ALREADY_CHECKED_IN`, `ALREADY_LIVE`, `ALREADY_ELIMINATED`, `ALREADY_FINISHED`, `TEAM_FULL`, `LOBBY_FULL`, `LOBBY_CLOSED`, `LOBBY_NOT_LIVE`, `PLAYER_DEAD`, `PLAYER_ABSENT`, `TOO_EARLY`, `ARBITER_REQUIRED`, `NO_PRESENT` |
| **423** | `ACCOUNT_LOCKED` |
| **502** | `PAYOUT_FAILED` |
| **503** | `SERVER_BUSY`, `DELETE_FAILED` |
| **500** (défaut) | tout code non listé → message **générique** `'Une erreur serveur est survenue.'` |

> « Sans LEGAL_NOT_ACCEPTED et INVALID_FORMAT dans ce groupe, ils tombaient dans le
> `default` → 500 "Erreur serveur inattendue" pour une simple erreur de saisie côté client
> (consentement 18+/CGU non coché, format de tournoi hors 1VS1-5VS5). »
> — `server/http-utils.mjs:344-347`

> « Conflits d'etat : le salon est deja plein/lance/regle, le joueur est deja inscrit ou
> elimine. 409 et non 400 : le client peut reessayer. » — `server/http-utils.mjs:411-414`

Toute erreur métier doit donc porter un `error.code`, sinon elle devient un 500
générique (`server/http-utils.mjs:432-434`).

---

## 6. Limitation de débit (`server/rate-limiter.mjs`)

### 6.1 Groupes et quotas

`RATE_LIMIT_CONFIG` — `server/rate-limiter.mjs:11-22`.

| Groupe | `max` | Fenêtre | Périmètre |
|---|---|---|---|
| `auth` | **50** | 15 min | Login, register, reset |
| `auth_logout` | **60** | 1 min | Groupe **dédié** |
| `social` | **30** | 1 min | Amis, signalements, recherche, création de match/tournoi |
| `wallet` | **20** | 10 min | Dépôts, retraits, vérification FedaPay |
| `chat` | **60** | 1 min | HTTP chat **et** événements socket de présence/typing |
| `admin` | **20** | 5 min | Routes admin + `finish` BR + paiements de ligue |
| `default` | **60** | 1 min | Repli |

> « `logout` est appelable sans session et ne prouve rien. Le partager avec `auth`
> permettait a n'importe qui de verrouiller la connexion de tous les utilisateurs d'une
> IP partagee pendant 15 minutes. » — `server/rate-limiter.mjs:13-15`

> « Sur le groupe `auth`, 50 appels suffisaient a renvoyer 429 sur TOUTES les routes
> d'authentification pendant 15 minutes […] Derriere un CGNAT mobile, ou une IP
> d'entreprise partagee, tous les utilisateurs de cette IP ne pouvaient plus se connecter
> du tout. Un deni de connexion de masse, gratuit. » — `server/routes/auth.mjs:460-475`

**Groupe `'match'` — piège :** il est utilisé une seule fois
(`server/routes/br.mjs:80`, `POST /api/br/lobbies`) mais **absent de
`RATE_LIMIT_CONFIG`** → `checkRateLimit` retombe silencieusement sur `default`
(60/min) via `RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default`
(`server/rate-limiter.mjs:74`).

### 6.2 Algorithme et mémoire

- Clé de bucket : `` `${ip}|${group}` `` (`server/rate-limiter.mjs:75`) — les quotas sont
  indépendants par groupe pour une même IP.
- Fenêtre glissante simplifiée : compteur remis à zéro au-delà de `windowMs`
  (`server/rate-limiter.mjs:78-86`).
- Seuil inclusif : `allowed = record.attempts <= config.max` (`server/rate-limiter.mjs:88`)
  → la N-ième requête passe, la N+1 est refusée.
- `retryAfter` = secondes restantes de fenêtre, arrondi au supérieur (`server/rate-limiter.mjs:89`).
- Plafond mémoire : `MAX_RATE_LIMIT_BUCKETS = 50 000` (`server/rate-limiter.mjs:8`) ;
  à saturation, éviction du plus ancien (`server/rate-limiter.mjs:80-83`).
- Nettoyage toutes les 60 s (`server/rate-limiter.mjs:94-102`).

### 6.3 Résolution de l'IP — `getClientIp`

`server/rate-limiter.mjs:180-195`.

1. `peer = req.socket?.remoteAddress`.
2. `X-Forwarded-For` n'est lu **que si le pair direct est un proxy de confiance**
   (`isTrustedProxyPeer`, `server/rate-limiter.mjs:151-161` : loopback, `10.`, `192.168.`,
   `172.16-31`, `fc`/`fd`, ou `TRUST_PROXY=true`).
3. On prend la **DERNIÈRE** valeur du XFF, pas la première.
4. Repli : `peer || '127.0.0.1'`.

> « ⚠️ On prend la DERNIÈRE valeur de X-Forwarded-For, pas la première. Un proxy n'efface
> pas l'en-tête : il APPENDA son IP. Un client peut donc envoyer
> `X-Forwarded-For: 1.2.3.4` et le proxy produit `1.2.3.4, <IP reelle du client>`. Lire
> `[0]` rendait cette valeur entièrement contrôlable par l'appelant : il suffisait de
> changer d'en-tête à chaque requête pour obtenir un bucket neuf et contourner
> complètement le rate-limit (donc le anti-bruteforce des 50 essais / 15 min). La
> dernière valeur est celle qu'a posée le proxy de confiance, donc la seule que l'appelant
> ne contrôle pas. » — `server/rate-limiter.mjs:166-175`

`isValidIp` (`server/rate-limiter.mjs:115-140`) valide IPv4 (4 octets ≤ 255) et IPv6
(hexets, `::` unique, IPv4 terminal, zone `%eth0`).

### 6.4 Sémantique du garde — piège de convention

`rateLimitGuard(res, ip, group)` — `server/rate-limiter.mjs:205-213` :
renvoie **`true` si la requête est autorisée**, `false` si refusée (la 429 est déjà écrite).

> ⚠️ Convention **opposée** à `requireAdmin` / `requireAdmin2fa`, qui renvoient `null`
> = refusé. D'où deux styles d'appel coexistant dans le code :
> `if (!rateLimitGuard(res, ip, group)) { return true; }` (style dominant) et
> `if (!rateLimitGuard(res, ip, group)) return true;` (style compact, `server/routes/admin.mjs`).

Réponse 429 : en-tête `Retry-After: <retryAfter>` +
`{"ok":false,"error":"Trop de requetes. Reessayez plus tard.","code":"RATE_LIMITED"}`.

### 6.5 Relâchement « tests uniquement »

Trois conditions **cumulatives** (`server/rate-limiter.mjs:24-65`) : `NODE_ENV === 'test'`
**ET** `ALLOW_DEBUG_CODES === 'true'` **ET** `ZOYD_DISABLE_SUPABASE === 'true'`.

> « Troisieme condition, et SEULE qui compte vraiment : un service connecte a une base
> reelle ne peut pas se mettre en mode detendu, meme si NODE_ENV et ALLOW_DEBUG_CODES se
> retrouvaient poses par megarde. Sans cela, une seule variable erronee neutralise TOUS
> les garde-fous anti-bruteforce — auth, retraits, signalements — sans le moindre signal
> dans les logs. » — `server/rate-limiter.mjs:42-51`

---

## 7. Journalisation et métriques

### 7.1 `server/logger.mjs`

Logger JSON structuré, sans dépendance externe.

- API : `createLogger(module) → { debug, info, warn, error, fatal }` (`server/logger.mjs:62-68`) ;
  export par défaut `log = createLogger('server')` (`server/logger.mjs:71-72`).
- Signature : `log.<niveau>(msg: string, extra?: object | Error)`.
- Niveaux : `LEVELS = { debug:10, info:20, warn:30, error:40, fatal:50 }` (`server/logger.mjs:4`) ;
  seuil piloté par `LOG_LEVEL` (défaut `info`, `server/logger.mjs:5`).
- Format : JSON une ligne sur stdout en production (`server/logger.mjs:58`) ; préfixe ANSI
  coloré + `JSON.stringify(extra)` en dev (`server/logger.mjs:48-56`).
- Structure d'entrée : `{ time, level, module, msg, ...extra }`.

Les champs de structure ne sont jamais écrasables par `extra` :
`RESERVED_KEYS = new Set(['time','level','module','msg'])` (`server/logger.mjs:16`) ; les
clés réservées fournies dans `extra` sont déplacées sous `entry.data`
(`server/logger.mjs:36-38`). Un `extra` de type `Error` est sérialisé en
`{ message, stack, code }` (`server/logger.mjs:29-30`).

### 7.2 `server/metrics.mjs`

Compteurs, jauges et histogrammes en mémoire, exposés en format texte Prometheus sur
`GET /metrics`.

| Élément | Ligne |
|---|---|
| `incCounter` | `server/metrics.mjs:23` |
| `setGauge` / `incGauge` / `decGauge` | `server/metrics.mjs:32` / `:43` / `:57` |
| `observeHistogram` | `server/metrics.mjs:85` |
| `startTimer` / `endTimer` | `server/metrics.mjs:97` / `:99` (`process.hrtime.bigint()`) |
| `metricsToPrometheus` | `server/metrics.mjs:114` |
| `collectServerMetrics` | `server/metrics.mjs:172` |

Plafonds : `MAX_COUNTER_ENTRIES = 5000` (`server/metrics.mjs:10`),
`MAX_GAUGE_ENTRIES = 5000` (`server/metrics.mjs:30`),
`MAX_HISTOGRAM_ENTRIES = 500` (`server/metrics.mjs:64`),
`MAX_OBSERVATIONS = 1000` (`server/metrics.mjs:83`).
Buckets d'histogramme (secondes) : `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`
(`server/metrics.mjs:62`).
Tâches de fond : collecte toutes les 15 s (`server/metrics.mjs:198`), nettoyage toutes les
5 min (`server/metrics.mjs:200`).

Métriques applicatives émises :

| Métrique | Origine |
|---|---|
| `zoyd_http_requests_total`, `zoyd_http_request_duration_seconds`, `zoyd_http_errors_total` | `server/http-utils.mjs:134-141` |
| `zoyd_socket_connections_total`, `zoyd_socket_disconnects_total`, `zoyd_socket_connections` | `server/realtime-server.mjs:403-404`, `:582-583` |
| `zoyd_channels`, `zoyd_push_subscriptions`, `zoyd_stored_matches`, `zoyd_stored_tournaments`, `zoyd_stored_leagues`, `zoyd_stored_users` | `server/routes/public.mjs:318-323` |
| `zoyd_uptime_seconds`, `zoyd_node_heap_used_bytes`, `zoyd_node_heap_total_bytes`, `zoyd_node_rss_bytes`, `zoyd_node_external_bytes` | `server/metrics.mjs:172-178` |

L'accès à `/metrics` exige un Bearer `METRICS_TOKEN` : 403 `METRICS_DISABLED` si le token
n'est pas configuré, 401 `UNAUTHORIZED` sinon (comparaison en temps constant sur hachages
SHA-256, `server/routes/public.mjs:53-57`).

---

## 8. Verrous (`server/mutex.mjs`)

Sérialisation des sections lecture-modification-écriture sur l'état en mémoire.
Mécanisme : `async-mutex` (`package.json:53`), `Mutex` par clé, `acquire()` / `release()`.
Signature commune `async (fn) => Promise<R>` ; la valeur de retour de `fn` est propagée et
le verrou relâché dans un `finally`.

### 8.1 Granularités

| Export | Ligne | Granularité | Structure |
|---|---|---|---|
| `withMatchMutex(fn)` | `server/mutex.mjs:17-24` | **GLOBALE** (tous les matchs) | `Mutex` unique |
| `withTournamentMutex(fn)` | `server/mutex.mjs:26-33` | **GLOBALE** (tous les tournois) | `Mutex` unique |
| `withLeagueMutex(fn)` | `server/mutex.mjs:35-42` | **GLOBALE** (toutes les ligues) | `Mutex` unique |
| `withBrLobbyMutex(lobbyId, fn)` | `server/mutex.mjs:88-99` | **PAR SALON BR** | `Map<lobbyId, Mutex>` |
| `withWalletMutex(userId, fn)` | `server/mutex.mjs:101-112` | **PAR PORTEFEUILLE** | `Map<userId, Mutex>` |
| `withUserMutex(userId, fn)` | `server/mutex.mjs:114-125` | **PAR UTILISATEUR** | `Map<userId, Mutex>` |
| `withChannelMutex(channelId, fn)` | `server/mutex.mjs:127-138` | **PAR CANAL** | `Map<channelId, Mutex>` |

`withChannelMutex` n'est utilisé par aucun module de routes ; il l'est par la couche
persistance (`server/persistence.mjs:3347`, `:3380`).

### 8.2 Pourquoi le verrou existe

> « Les actions de salon (`join`, `leave`, `checkin`, `start`, `eliminate`, `finish`) font
> toutes un read-modify-write sur la collection `brLobbies`. Sans sérialisation, deux
> requêtes simultanées lisent le même instantané : les deux modifient le même clone, et
> seule la dernière écriture est conservée.
> Sur `finish`, cela ne perdait pas qu'un joueur : les deux appels passaient le garde
> `status === 'settling'` — evalue sur le clone, jamais persiste — et versaient donc la
> cagnotte DEUX FOIS. Le rate limiter (20 requêtes / 5 min) laisse largement passer un
> double-clic.
> Le verrou est PAR SALON, et non global comme `withMatchMutex` : deux salons distincts
> peuvent regler en meme temps, ce qui est le cas normal. » — `server/mutex.mjs:72-87`

### 8.3 Ordre global → local (invariants)

Les verrous globaux sont presque toujours acquis **avant** les verrous par entité :
`server/routes/match.mjs:50` puis `:76` ; `server/routes/wallet.mjs:202`.
**L'ordre inverse créerait un risque de deadlock.** L'ordre global→local est constant
sur les modules de routes.

Deux invariants voisins, à ne pas confondre :

- **Débit sous verrou, paiement hors verrou.** `POST /api/wallet/withdraw` débite sous
  `withWalletMutex` (`server/routes/wallet.mjs:202-244`) puis appelle FedaPay **en
  dehors** du verrou (`server/routes/wallet.mjs:266-278`). L'inverse = double paiement
  possible.
- **Règlement admin en deux phases.** `deferSettlement: true` puis
  `settlePendingMatchResult` (`server/routes/admin.mjs:556-579`) : créditer avant la
  persistance laissait l'argent parti sans trace en cas de crash.

### 8.4 Éviction des verrous inactifs

`evictOldestMutex` — `server/mutex.mjs:44-70`.

- Plafond `MUTEX_MAX_SIZE = 10 000` par map (`server/mutex.mjs:11`).
- On n'évince **que les mutex non verrouillés** (`mutex.isLocked()`), sinon l'exclusion
  mutuelle serait perdue.
- Nettoyage toutes les 5 min (`server/mutex.mjs:141-171`) : suppression des verrous
  inactifs depuis > `WALLET_MUTEX_MAX_AGE` = **30 min** (`server/mutex.mjs:10`), uniquement
  s'ils ne sont pas verrouillés.

> « Un mutex VERROILLE est expressement ecarte. Supprimer celui d'un joueur en cours
> d'operation creeait un nouveau Mutex au prochain appel : deux ecritures concurrentes sur
> le meme portefeuille — exactement ce que le mutex doit empecher (double debit, double
> credit). » — `server/mutex.mjs:46-51`

---

## 9. Le temps réel

### 9.1 Serveur Socket.IO

`server/realtime-server.mjs:279-308` — Socket.IO v4 (`package.json:67`).

```js
const io = new SocketIOServer(server, {
  pingInterval: 20_000,
  pingTimeout: 10_000,
  allowRequest: (req, callback) => { /* filtre l'upgrade WebSocket */ },
  cors: { origin: (origin, callback) => { /* whitelist */ }, methods: ['GET','POST'], credentials: true },
});
```

`pingInterval`/`pingTimeout` servent à la « détection rapide des connexions mortes
(sleep Render, réseau mobile) » (`server/realtime-server.mjs:280-281`).

> « Le cookie de session est en SameSite=None (cross-site Vercel→Render), il part donc
> aussi sur le handshake WebSocket. Or `cors.origin` ne s'applique qu'au transport polling :
> une page tierce pouvait ouvrir un socket authentifié avec le cookie de la victime
> (usurpation de présence, écoute des events). `allowRequest` filtre l'upgrade WebSocket
> aussi. » — `server/realtime-server.mjs:283-287`

### 9.2 Authentification des sockets — `io.use`

`server/realtime-server.mjs:360-398`. Ordre exact :

| # | Étape | Ligne |
|---|---|---|
| 1 | Rate limit de connexion : **10 connexions / 60 s par IP** (Map `socketConnectionCounts`) | `server/realtime-server.mjs:319-321`, `:366-376` |
| 2 | Token `auth.token` → `getRealtimeSession(socket.handshake.auth?.token)` | `server/realtime-server.mjs:378` |
| 3 | Repli cookie `/zoyd_auth=([^;]+)/` → `getAuthSession(cookie, {skipRotation:true})` → `getOrCreateRealtimeSessionForUser(...)` | `server/realtime-server.mjs:381-388` |
| 4 | Échec → `next(new Error('unauthorized'))` | `server/realtime-server.mjs:391-394` |
| 5 | Succès → `socket.data.session = session; next();` | `server/realtime-server.mjs:396-397` |

L'IP est résolue avec les mêmes règles que le HTTP (`getClientIp` appliqué à un objet
`{ socket, headers }` minimal, `server/realtime-server.mjs:323-332`) :

> « Même résolution que le rate-limit HTTP : derrière le LB Render, le peer TCP est l'IP
> du load balancer, pas celle du joueur. Compter par `peer` faisait partager UN SEUL
> compteur à toute la plateforme (10 connexions / min au total), et le 11e visiteur se
> faisait refuser. » — `server/realtime-server.mjs:361-364`

Plafond mémoire `MAX_SOCKET_CONNECTION_ENTRIES = 10 000` (`server/realtime-server.mjs:338`),
éviction + purge toutes les 5 min (`server/realtime-server.mjs:340-358`).

Côté client : `src/app/lib/realtimeClient.ts:124-136, 182-204` —
`io(getBaseUrl(), { path:'/socket.io', transports:['websocket','polling'], autoConnect:false,
withCredentials:true })`, puis `socket.auth = { token: session.token }`. Sur `connect_error`
contenant `unauthorized`, le client régénère la session et reconnecte
(`src/app/lib/realtimeClient.ts:159-169`).

### 9.3 Rooms

| Room | Contenu | Création |
|---|---|---|
| `user:<userId>` | **Tous les onglets** d'un compte | `server/realtime-server.mjs:402` |
| `<channelId>` | Salon de chat / match | `server/channel-presence.mjs:189`, `server/realtime-server.mjs:479` |

### 9.4 Événements émis par le serveur

| Événement | Payload | Émetteur | Ligne |
|---|---|---|---|
| `server:hello` | `{socketId, serverTime, userId}` | `server/realtime-server.mjs` | `:406-410` |
| `presence:snapshot` | `{channelId, members, seen}` | `server/channel-presence.mjs` | `:118` |
| `typing:snapshot` | `{channelId, members}` | `server/channel-presence.mjs` | `:119` |
| `notification:deliver` | notification persistée | `server/push-notifications.mjs` | `:70` |
| `wallet:update` | `{wallet}` | `server/realtime-server.mjs` | `:315` |
| `state:matches` | `{items}` | `server/state-helpers.mjs` | `:86` |
| `state:tournaments` | `{items}` | `server/state-helpers.mjs` | `:49` |
| `state:leagues` | `{items}` | `server/push-notifications.mjs` | `:81` |
| `state:brLobbies` | `{items}` | `server/push-notifications.mjs` | `:81` |
| `chat:channel` | `{channel}` | `server/chat-helpers.mjs` | `:94`, `:98` |
| `chat:message` | `{channel, message}` | `server/chat-helpers.mjs` | `:113`, `:118`, `:122` |
| `chat:read` | `{channelId, userId, readAt}` | `server/chat-helpers.mjs` | `:134` |
| `error` | `{message:'Rate limit exceeded'}` | `server/realtime-server.mjs` | `:416`, `:444`, `:489`, `:501`, `:521`, `:551` |
| `server:error` | `{error:'Access denied to this channel.'}` | `server/realtime-server.mjs` | `:426`, `:454` |

### 9.5 Événements reçus par le serveur

| Événement | Payload | Rate limit | Ligne |
|---|---|---|---|
| `presence:join` | `{channelId, userId?, pseudo?, role?, team?, isCheckedIn?, isReady?}` | `chat` | `server/realtime-server.mjs:412-438` |
| `presence:update` | idem | `chat` | `server/realtime-server.mjs:440-483` |
| `presence:leave` | `{channelId}` | `chat` | `server/realtime-server.mjs:485-495` |
| `channel:seen` | `{channelId}` | `chat` | `server/realtime-server.mjs:497-515` |
| `typing:update` | `{channelId, isTyping}` | `chat` | `server/realtime-server.mjs:517-545` |
| `notification:push` | `{targetUserId, title, body, url, tag, requireInteraction}` | `default` | `server/realtime-server.mjs:547-574` |
| `disconnect` | — | — | `server/realtime-server.mjs:576-584` |

**Traitement des payloads de présence.** L'identité est **écrasée** par la session :

```js
const safePayload = { ...payload, userId: session.userId, pseudo: session.pseudo };
```

(`server/realtime-server.mjs:430-434`, `:458-462`) — le client ne peut pas usurper
`userId` ni `pseudo`. En revanche le `role` de canal est **accepté depuis le client**,
mais borné par une whitelist (`player|arbiter|spectator`, `server/realtime-server.mjs:471`),
et `team` est borné à `0|1` (`server/realtime-server.mjs:472`).

Le contrôle d'accès au canal est `canAccessChatChannel(channel, user)`
(`server/chat-helpers.mjs:52-53` — admin, canal public, ou participant), appliqué sur
`presence:join` (`server/realtime-server.mjs:425`), `presence:update` (`:453`),
`channel:seen` (`:510`), `typing:update` (`:530`).

### 9.6 Les trois notions de « rôle »

| Rôle | Portée | Temps réel | Source |
|---|---|---|---|
| **Rôle de canal** (`player`/`arbiter`/`spectator`) | présence | **propagé en direct** via `presence:snapshot` | `server/realtime-server.mjs:482`, `server/channel-presence.mjs:118` |
| **Rôle de compte** (`admin`/`player`) | autorisation | **relu à chaque résolution de session** côté persistance (`server/persistence.mjs:3205-3221`), mais **figé sur la socket** (`socket.data.session`, `server/realtime-server.mjs:396`) | voir §16.4 |
| **Rôle d'arbitre** de match/tournoi | état | propagé par `state:matches` / `state:tournaments` (émis socket par socket) | `server/state-helpers.mjs:125-162`, `:193-220` |

> « Le role est RELU, pas reutilise depuis la session. `role` etait fige a la creation de la
> session temps reel. Une session vit 6 h : un administrateur retrograde gardait donc
> `role === 'admin'` sur toutes ses sockets pendant toute cette duree. »
> — `server/persistence.mjs:3205-3221`

---

## 10. Présence, chat, push, diffusion d'état

### 10.1 Présence par canal (`server/channel-presence.mjs`)

Quatre maps en mémoire :

| Map | Ligne | Clé |
|---|---|---|
| `channels` | `server/channel-presence.mjs:5` | channelId → (userId → member) |
| `channelsBySocket` | `server/channel-presence.mjs:8` | socketId → Set\<channelId\> |
| `seenByChannel` | `server/channel-presence.mjs:11` | channelId → (userId → seen info) |
| `typingByChannel` | `server/channel-presence.mjs:14` | channelId → (userId → typing info) |

`MAX_ACTIVE_CHANNELS = 500` (`server/channel-presence.mjs:17`). Nettoyage toutes les
10 min (`server/channel-presence.mjs:20-49`) : canaux vides supprimés, `seen`/`typing`
purgés, canaux de chat inactifs depuis > 24 h supprimés **sauf `global`**
(`server/channel-presence.mjs:32-46`).

Diffusion (`emitChannelSnapshots`, `server/channel-presence.mjs:109-120`) : deux événements
à la room du canal — `presence:snapshot` `{channelId, members, seen}` et
`typing:snapshot` `{channelId, members}`.

`publicMember` (`server/channel-presence.mjs:93-102`) expose `userId`, `pseudo`, `role`,
`team`, `isCheckedIn`, `isReady`, `isOnline` (= `socketIds.size > 0`), `lastActiveAt`.

Cycle de vie d'un membre (`upsertChannelMember`, `server/channel-presence.mjs:161-191`) :
la clé est le **`userId`**, pas le socket ; `socketIds` est un `Set` ⇒ **plusieurs onglets
= un seul membre**. À la déconnexion (`server/channel-presence.mjs:201-225`), si le membre
n'a plus de socket **et** `role === 'spectator'` il est **supprimé** ; sinon il est
**conservé mais marqué hors ligne**.

### 10.2 Logique chat (`server/chat-helpers.mjs`)

| Export | Ligne | Rôle |
|---|---|---|
| `buildMatchChatChannel` | `server/chat-helpers.mjs:16-34` | canal `type:'match'`, participants = joueurs + arbitre, `scope` = `public` si `match.visibility === 'public'` sinon `participants` |
| `syncMatchChatChannels` | `server/chat-helpers.mjs:41-44` | assure le canal global + un canal par match |
| `canAccessChatChannel` | `server/chat-helpers.mjs:52-53` | `user.role === 'admin' \|\| channel.scope === 'public' \|\| channel.participants.includes(user.id)` |
| `buildChatBootstrapPayload` | `server/chat-helpers.mjs:62-83` | canaux triés (non-lus d'abord, puis `updatedAt` desc.), **50 canaux**, **10 canaux actifs × 20 messages** |
| `broadcastChatChannel` | `server/chat-helpers.mjs:90-100` | `io.emit` si `inbox==='all'`, sinon `io.to('user:'+pid).emit(...)` par participant |
| `broadcastChatMessage` | `server/chat-helpers.mjs:108-124` | `global` ⇒ `io.emit` ; `scope==='public'` ⇒ `io.to(channel.id)` ; + push dans la room de chaque participant |
| `broadcastChatRead` | `server/chat-helpers.mjs:133-135` | `io.to('user:'+userId).emit('chat:read', ...)` |

### 10.3 Notifications push (`server/push-notifications.mjs`)

| Export | Ligne | Rôle |
|---|---|---|
| `sendPushToUser(userId, payload)` | `server/push-notifications.mjs:25` | Web Push VAPID ; supprime les souscriptions mortes (HTTP 404/410) (`server/push-notifications.mjs:40-42`) |
| `deliverNotification(io, targetUserId, payload)` | `server/push-notifications.mjs:56` | crée la notification en base, émet `notification:deliver` sur `user:<id>`, puis envoie le push |
| `broadcastStateSnapshot(io, kind, items)` | `server/push-notifications.mjs:80` | `io.emit('state:' + kind, { items })` — diffusion **globale**, non ciblée |
| `notifyAllAdmins(io, payload)` | `server/push-notifications.mjs:89` | itère sur `getAdminIds()`, isole les erreurs par admin (`server/push-notifications.mjs:94-97`) |

### 10.4 Diffusion d'état (`server/state-helpers.mjs`)

| Fonction | Événement | Cible |
|---|---|---|
| `saveMatches(io, matches, changedMatch=null)` (`server/state-helpers.mjs:18-29`) | `state:matches` | **socket par socket** (`server/state-helpers.mjs:79-90`) |
| `saveTournaments(io, tournaments, changedTournament=null)` (`server/state-helpers.mjs:43-54`) | `state:tournaments` | **socket par socket** (`server/state-helpers.mjs:47-52`) |
| `saveLeagues(io, seasons)` (`server/state-helpers.mjs:316-321`) | `state:leagues` | `io.emit` global |
| `saveBrLobbies(io, lobbies)` (`server/state-helpers.mjs:303-308`) | `state:brLobbies` | `io.emit` global, **après sanitisation** (`toPublicBrLobby`) |

> « Diffuser les matchs en calculant `isMe` POUR CHAQUE socket. Un `io.emit` global ne peut
> pas porter un `isMe` different par destinataire. On emet donc par socket : le nombre de
> sockets connectes est de l'ordre de la grandeur du jeu, et un match ne change que
> quelques fois par minute. » — `server/state-helpers.mjs:72-77`

> « Le roster public ne doit JAMAIS contenir d'identifiant joueur. `userId` (et `killedBy`,
> qui en est un) sont retires, ainsi que `arbiterId` et `creatorId` […] Ces fonctions
> servent DEUX sorties : la reponse HTTP ET la diffusion socket. C'etait le defaut avant :
> `saveBrLobbies` diffusait l'etat brut via `io.emit`, donc la sanitisation HTTP ne
> protegeait rien. » — `server/state-helpers.mjs:260-276`

`sanitizeMatchForBroadcast(match, viewerId)` (`server/state-helpers.mjs:125-162`) retire
`roomPassword`, `roomName`, `screenshots`, `result.confirmedByTeams`, `result.proofs`,
retire les `userId` des joueurs et de l'arbitre, **ajoute** `isMe`, `hasConfirmed`,
`gameId`, recalcule `projectedPayouts` (`server/state-helpers.mjs:149`), et met
`submittedBy` à `null` pour `system-no-show` / `admin-dashboard`
(`server/state-helpers.mjs:150-152`).

L'identité live est figée à la soumission du résultat
(`LIVE_IDENTITY_STATUSES = { recruiting, full, check_in, ready, in_progress }`,
`server/state-helpers.mjs:102-104`) : le `pseudo` affiché est relu sur le compte tant
que le match n'est pas figé (`server/state-helpers.mjs:92-101`).

---

## 11. Tâches planifiées (`server/cron.mjs`)

`initCronJobs()` — `server/cron.mjs:27`, appelé **une seule fois** depuis
`server/realtime-server.mjs:638`.

| Intervalle | Tâche | Ligne |
|---|---|---|
| 6 h | Archivage des matchs inactifs (> 14 j) | `server/cron.mjs:36-82` |
| 1 h | Fermeture des inscriptions de ligue | `server/cron.mjs:85` |
| 1 h | Contrôle d'intégrité des données | `server/cron.mjs:192` |
| **60 s** | Balayage des règlements en attente | `server/cron.mjs:276` |
| **60 s** | Expiration des fenêtres de confirmation | `server/cron.mjs:312` |
| 6 h | Reprise des remboursements | `server/cron.mjs:354` |
| 6 h | Paiements de tournois en attente | `server/cron.mjs:387` |
| 6 h | Paiements de ligues en attente | `server/cron.mjs:418` |
| 30 min | Réconciliation des retraits | `server/cron.mjs:462` |
| 6 h | Ligues périmées | `server/cron.mjs:504` |
| 6 h | Remboursements de ligues | `server/cron.mjs:546` |

Chaque job utilise les **mêmes verrous** que les routes (`withMatchMutex`,
`withLeagueMutex`, `withTournamentMutex`) et possède une **garde anti-chevauchement**
(`server/cron.mjs:31-33`, `:37-41`, `:86-90`). Deux jobs de fond et une route ne peuvent
donc pas muter la même collection en parallèle.

---

## 12. Table exhaustive des routes HTTP

**Conventions communes.** Succès : `{"ok": true, …}`. Erreur :
`{"ok": false, "error": "<message FR>", "code": "<CODE>"}`.
Garde session : `getAuthenticatedAppSession(req)` → 401 `AUTH_REQUIRED`.
Garde admin : `requireAdmin2fa(req, res)` → 401/403 **écrit par le garde lui-même**.

108 entrées de route réparties sur 11 modules (une ligne regroupe 6 verbes BR).

### 12.1 `server/routes/public.mjs` — `handlePublicRoutes` (`server/routes/public.mjs:59-439`)

| # | Méthode | Chemin | Garde | Rate limit | Comportement |
|---|---|---|---|---|---|
| 1 | GET | `/api/health` | public | — | `getHealthInfo()` ; **200 si `stateTrusted`, 503 sinon** (`server/routes/public.mjs:64`) ; body `{ok, service:'zoyd-api', persistence:{...health, reloadInProgress}, timestamp}` |
| 2 | GET | `/api/realtime/health` | public | — | 200 `{ok:true, service:'zoyd-realtime', timestamp}` (`server/routes/public.mjs:73-80`) |
| 3 | GET | `/api/codm/store?country=` | session | `default` | Proxy GraphQL Codashop ; 502 `UPSTREAM_ERROR` si l'amont échoue, 500 `STORE_PROXY_ERROR` si exception ; catalogue en **INR** (`server/routes/public.mjs:100-108`) |
| 4 | GET | `/api/codm/player/:id?country=` | session | `default` | `id` doit matcher `^\d{1,20}$` sinon 400 `INVALID_PLAYER_ID` ; 404 `PLAYER_NOT_FOUND` |
| 5 | GET | `/metrics` | Bearer `METRICS_TOKEN` | — | 403 `METRICS_DISABLED` si token absent ; 401 `UNAUTHORIZED` sinon ; sortie `text/plain; version=0.0.4` (`server/routes/public.mjs:53-57`) |
| 6 | GET | `/api/users/:id` | session | `default` | Profil par UUID **ou pseudo** ; 404 `USER_NOT_FOUND` ; **garde explicite `pathname !== '/api/users/search'`** (`server/routes/public.mjs:331`) |
| 7 | GET | `/api/leaderboard` | public | `default` | `{ok, players, total, hasMore}` |
| 8 | GET | `/api/stats` | public | `default` | `{ok, stats}` — **ne contient pas** les commissions (`server/routes/admin.mjs:129-131`) |
| 9 | GET | `/api/matches` | public (token optionnel) | `default` | filtrage par visibilité via `getPublicMatchesForUser(...)` |
| 10 | GET | `/api/tournaments` | public | `default` | `{ok, tournaments, total, hasMore}` |
| 11 | GET | `/api/users/search?q=` | session | `social` | `limit` plafonné à 50 (`server/routes/public.mjs:422`) |

> « Session obligatoire : ces endpoints ne contiennent aucun secret, mais sans garde le
> serveur devenait un proxy Codashop gratuit pour tout Internet, sur le quota du forfait
> Render gratuit. L'usage metier est de rattacher le compte CODM d'un JOUEUR a son profil :
> un compte suffit. » — `server/routes/public.mjs:86-89`

> « Arrow explicite : `Array.map` passe (element, index, array), donc
> `map(sanitizeMatchForBroadcast)` aurait passe l'INDEX comme viewerId et `isMe` aurait
> toujours ete false sans lever la moindre erreur. » — `server/routes/public.mjs:380-382`

### 12.2 `server/routes/auth.mjs` — `handleAuthRoutes` (`server/routes/auth.mjs:52-570`)

| # | Méthode | Chemin | Rate limit | Comportement |
|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | `auth` | **Whitelist stricte de 15 champs** (`server/routes/auth.mjs:65-74`) ; `pseudo`/`bio`/`streamerPseudo` via `sanitizeText` ; compte **directement actif** (V1, `server/routes/auth.mjs:79-80`) ; 201 + cookie `zoyd_auth` 6 h ; `token` en réponse **uniquement si `ALLOW_DEBUG_CODES`** |
| 2 | POST | `/api/auth/login` | `auth` | `authenticateUserAccount({identifier, password})` ; **sanction bloquante → 403 `ACCOUNT_SANCTIONED`** avec objet `sanction {kind, expiresAt, reason, issuedAt}` (`server/routes/auth.mjs:115-137`) ; 200 + cookie 6 h |
| 3 | POST | `/api/auth/activate` | `auth` | `verifyActivationCode(email, code)` ; 400 `ACTIVATION_FAILED` |
| 4 | POST | `/api/auth/resend-code` | `auth` | régénère + livre le code ; `delivery: 'sent' \| 'pending-provider'` |
| 5 | POST | `/api/auth/activation-email` | `auth` | `changeActivationEmail(oldEmail, newEmail)` puis livraison du code au **nouveau** mail |
| 6 | POST | `/api/auth/forgot-password` | `auth` | **anti-énumération** : réponse identique que le compte existe ou non (`found: true` systématique, `server/routes/auth.mjs:278-284`) ; code retourné seulement si `ALLOW_DEBUG_CODES` **et** compte existant |
| 7 | POST | `/api/auth/reset-password` | `auth` | `resetPasswordWithCode(identifier, code, newPassword)` |
| 8 | GET | `/api/auth/me` | *aucun* | `{ok, user, expiresAt}` — **pas de rate limit** |
| 9 | PATCH | `/api/auth/me` | `auth` | whitelist stricte de 13 champs (`server/routes/auth.mjs:339-343`) + énumérations `controllerType`/`device`/`RANK_VALUES` + `levelCODM` 1-150 + `phone` validé + `bio` ≤ 500 + `pseudo` ≤ 30 ; **changement d'email ⇒ reauthentification par mot de passe** (403 `PASSWORD_CONFIRMATION_REQUIRED`) ; unicité sous `withRegistrationMutex` ; si `pseudo` change → `refreshLiveMatchIdentities(io, ...)` |
| 10 | POST | `/api/auth/logout` | `auth_logout` | `getAuthSession(token, {skipRotation:true})` + `deleteAuthSession(token)` + `deleteRealtimeSessionsForUser(userId)` + cookie vidé ; **répond 200 même sans session** |
| 11 | POST | `/api/auth/change-password` | `auth` | `assertStrongPassword` ; vérif du mot de passe actuel (403 `WRONG_PASSWORD`) ; **révoque TOUTES les sessions** ; cookie vidé |
| 12 | DELETE | `/api/auth/me` | `auth` | exige `confirmForfeit === true` (400 `CONFIRM_REQUIRED`) ; `deleteUserAccount` → `{ok, message}` mentionnant le solde forfaité |

> « Le rate limit est pose AVANT toute lecture de token, et le token est facultatif : sans
> session, la route repond quand meme 200. […] Sur le groupe `auth`, 50 appels suffisaient
> a renvoyer 429 sur TOUTES les routes d'authentification pendant 15 minutes […] Un deni
> de connexion de masse, gratuit. » — `server/routes/auth.mjs:460-475`

> « skipRotation: sans ça, getAuthSession déclenche une rotation fire-and-forget qui
> INSÈRE le nouveau token en mémoire de façon synchrone AVANT que la route ne supprime
> l'ancien => une session serveur valide de 6h survivait au logout (poste partagé). »
> — `server/routes/auth.mjs:477-481`

> « `normalizePhoneKey` ne garde que les chiffres, et la cle d'unicité `phone_key` en base
> n'est PAS NULL. Un joueur pouvait donc poser `phone: ""` […] et occuper la cle VIDE de
> l'index. Le joueur suivant qui tentait la meme chose violait `phone_key UNIQUE`, ce qui
> faisait echouer son ecriture et le renvoyait en 503 : DEFINITIVEMENT. Un joueur pouvait
> donc casser la mise a jour de profil de tous les autres, sans etre administrateur. »
> — `server/routes/auth.mjs:366-377`

### 12.3 `server/routes/social.mjs` — `handleSocialRoutes` (`server/routes/social.mjs:36-285`)

| # | Méthode | Chemin | Rate limit | Comportement |
|---|---|---|---|---|
| 1 | GET | `/api/social/friends` | *aucun* | session requise |
| 2 | GET | `/api/social/pending` | *aucun* | filtre `status === 'pending'` |
| 3 | POST | `/api/social/request` | `social` | `withUserMutex`, notification push à la cible |
| 4 | POST | `/api/social/accept` | `social` | `withUserMutex`, notification |
| 5 | POST | `/api/social/decline` | `social` | `withUserMutex` |
| 6 | DELETE | `/api/social/friends/:id` | `social` | `withUserMutex` |
| 7 | POST | `/api/social/block` | `social` | `withUserMutex` |
| 8 | POST | `/api/social/unblock` | `social` | `withUserMutex` |
| 9 | POST | `/api/social/report` | `social` | **écriture `await`ed** (`sbUpsert('user_reports', …)`, `server/routes/social.mjs:210`) ; 201 ; 503 `SERVER_BUSY` si `written === false` |
| 10 | POST | `/api/notifications/read` | `default` | session requise |
| 11 | POST | `/api/notifications/read-all` | `default` | session requise |
| 12 | GET | `/api/notifications` | *aucun* | session requise |

> « Ecriture AWAITEE, pas `sbFire`. En best-effort, la route repondait 201 AVANT que
> l'ecriture n'aboutisse : si la table manquait ou si la base etait indisponible, le joueur
> lisait "Signalement envoye" et le signalement disparaitait. Or c'est une information de
> moderation — un signalement perdu, c'est un joueur qui continue a harceler en croyant
> avoir ete ecoute. » — `server/routes/social.mjs:199-209`

### 12.4 `server/routes/wallet.mjs` — `handleWalletRoutes` (`server/routes/wallet.mjs:55-447`)

| # | Méthode | Chemin | Garde | Rate limit | Comportement |
|---|---|---|---|---|---|
| 1 | GET | `/api/wallet/history` | session | `default` | `limit` plafonné à 200 (`server/routes/wallet.mjs:64`) |
| 2 | GET | `/api/wallet/me` | session | `default` | renvoie aussi la **politique de retrait publiée par le serveur** (`feeRate`, `minAmount`, `dailyLimit`, `dailyWindowHours: 24`, `remainingToday`) |
| 3 | POST | `/api/wallet/deposit` | **`requireAdmin2fa`** | `wallet` | amount ∈ (0, 5 000 000] ; `userId` requis ; crédit sous `withWalletMutex(body.userId)` |
| 4 | POST | `/api/wallet/withdraw` | session | `wallet` | voir §12.4.1 |
| 5 | POST | `/api/wallet/verify-fedapay` | session | `wallet` | `transactionId` numérique (`^\d{1,20}$`) ; crédit sous `withWalletMutex` ; notification push non bloquante |

#### 12.4.1 `POST /api/wallet/withdraw` — la route la plus sensible du serveur

Garde, dans l'ordre exact :

1. Session requise (`server/routes/wallet.mjs:138-142`) → 401 `AUTH_REQUIRED`.
2. Rate limit `wallet` (`server/routes/wallet.mjs:143`).
3. Parse du corps (`server/routes/wallet.mjs:145-150`) → 400 `INVALID_JSON`.
4. Montant `MIN_WITHDRAWAL_ZC ≤ amount ≤ 100_000` (`server/routes/wallet.mjs:152-155`) → 400 `INVALID_AMOUNT`.
5. Pays : `body.country` explicite, sinon `session.user.country`, sinon `'bj'` ;
   `normalizePayoutCountry` ; pays non supporté → 400 `INVALID_COUNTRY`
   (`server/routes/wallet.mjs:157-164`) — **pas de repli silencieux**.
6. Opérateur présent dans `countryCfg.operators` → 400 `INVALID_OPERATOR` (`server/routes/wallet.mjs:165-168`).
7. Téléphone via `parsePhoneForFedaPay` → 400 `INVALID_PHONE` (`server/routes/wallet.mjs:169-173`).
8. Clé d'idempotence (`body.idempotencyKey` ou en-tête `x-idempotency-key`) →
   **obligatoire**, sinon 400 `IDEMPOTENCY_KEY_REQUIRED` (`server/routes/wallet.mjs:174-181`).

Déroulement en quatre phases :

| Phase | Ligne | Contenu |
|---|---|---|
| **1 — débit** | `server/routes/wallet.mjs:202-244` | sous `withWalletMutex` ; relecture de l'historique **à l'intérieur** du verrou (anti-TOCTOU, `:203-207`) ; 3 cas : payout **confirmé** → 200 `{duplicate:true}` (`:233-235`, `:252-263`) ; payout **ambigu** (débit fait, aucun `payoutId`, `payoutStatus !== 'failed'`) → 409 `PAYOUT_PENDING_REVIEW` + drapeau `abandonner = true` (`:221-232`) ; clé **nouvelle** → `withdrawFromWallet(...)` + `trackWithdrawalKey` (`:238-243`) |
| **2 — payout** | `server/routes/wallet.mjs:266-278` | appel FedaPay **hors mutex** — le portefeuille n'est plus bloqué pendant l'appel réseau |
| **3 — échec** | `server/routes/wallet.mjs:279-365` | `payoutMaybeSent === true` → **aucun remboursement automatique**, marquage `pending_review`, réconciliation manuelle (`:290-313`) ; sinon remboursement sous `withWalletMutex` (`type:'refund'`, `:317-327`) + `payoutStatus:'failed'` + `forgetWithdrawalKey` dans un `finally` (`:338-362`) |
| **4 — tag** | `server/routes/wallet.mjs:367-382` | `payoutId` best-effort, puis 200 `{ok, wallet, user, payoutId, ...buildWithdrawalAmounts(amount)}` |

> « Idempotence : OBLIGATOIRE. Sans clé, un double-clic ou un retry réseau débitait deux
> fois et déclenchait deux payouts FedaPay. » — `server/routes/wallet.mjs:174-175`

> « `sendNow` peut avoir ete traite par FedaPay alors que la reponse s'est perdue (timeout,
> 502, coupure reseau). L'argent est alors REELLEMENT parti alors que l'appel echoue.
> Rembourser dans ce cas donnait au joueur son remboursement ET son virement : un gain net
> sur la plateforme. Le moteur remonte desormais `payoutMaybeSent`. On ne rembourse que si
> l'echec est survenu AVANT toute creation de payout — donc sur une certitude d'absence
> d'envoi. » — `server/routes/wallet.mjs:280-289`

### 12.5 `server/routes/tournament.mjs` — `handleTournamentRoutes` (`server/routes/tournament.mjs:31-267`)

| # | Méthode | Chemin | Rate limit | Comportement |
|---|---|---|---|---|
| 1 | GET | `/api/tournaments/:id` | `default` | public ; 404 `TOURNAMENT_NOT_FOUND` |
| 2 | POST | `/api/tournaments` | `default` | session ; `name` ≥ 3 car., `format` requis, `maxEntries` ∈ [2,256], `entryFee` arrondi à 2 décimales |
| 3 | POST | `/api/tournaments/:id/register` | `default` | session |
| 4 | POST | `/api/tournaments/:id/leave` | `default` | session |
| 5 | POST | `/api/tournaments/:id/arbiter` | *aucun* | session |
| 6 | POST | `/api/tournaments/:id/start` | *aucun* | session ; notifie tous les participants |
| 7 | POST | `/api/tournaments/:id/matches/:mid/room` | *aucun* | session |
| 8 | POST | `/api/tournaments/:id/matches/:mid/live` | *aucun* | session |
| 9 | POST | `/api/tournaments/:id/matches/:mid/result` | `default` | session |

Toutes les mutations passent par `withTournamentMutex` + `saveTournaments(io, …)`
(diffusion `state:tournaments`).

> « Le mutex serialise les tournois entre eux mais ne limite rien dans le temps : sans ce
> garde, un joueur authentifie cree des tournois en boucle et chaque creation immobilise le
> mutex pour tous les autres. » — `server/routes/tournament.mjs:52-54`

> « La cagnotte est calculee sur un PRODUIT (entryFee x entrees x taille), alors que
> l'argent reellement bloque est une SOMME d'arrondis par equipe. Les deux coincident tant
> que le tarif n'a pas plus de 2 decimales — au-dela, le produit et la somme divergent de
> quelques centimes, et le reglement cree ou detruit de la monnaie. » — `server/routes/tournament.mjs:80-87`

### 12.6 `server/routes/league.mjs` — `handleLeagueRoutes` (`server/routes/league.mjs:34-392`)

| # | Méthode | Chemin | Garde | Rate limit |
|---|---|---|---|---|
| 1 | GET | `/api/leagues` | session | `default` — `playerId` des membres retirés (`server/routes/league.mjs:55-61`) |
| 2 | GET | `/api/leagues/:id` | session | `default` — 404 `LEAGUE_NOT_FOUND` |
| 3 | POST | `/api/leagues` | session | *aucun* — `name`/`format`/`teamSize` **optionnels** |
| 4 | POST | `/api/leagues/:id/join` | session | *aucun* — **compensation d'un verrou orphelin** si `saveLeagues` échoue |
| 5 | POST | `/api/leagues/:id/leave` | session | *aucun* |
| 6 | POST | `/api/leagues/:id/start-qualification` | session | *aucun* |
| 7 | POST | `/api/leagues/:id/days/:dayId/start` | session | *aucun* — notifie les inscrits |
| 8 | POST | `/api/leagues/:id/days/:dayId/results` | session | *aucun* |
| 9 | POST | `/api/leagues/:id/advance-to-final` | session | *aucun* |
| 10 | POST | `/api/leagues/:id/final-results` | session | *aucun* |
| 11 | GET | `/api/leagues/:id/leaderboard` | public | `default` |
| 12 | PATCH | `/api/leagues/:id` | session | *aucun* |
| 13 | POST | `/api/leagues/:id/reassign` | session | *aucun* |
| 14 | POST | `/api/leagues/:id/refund/:userId` | **`requireAdmin2fa`** | *aucun* — **déplace de l'argent** |
| 15 | GET | `/api/leagues/:id/payments` | **`requireAdmin2fa`** | `admin` |

> « La page `/br-league` est deja derriere `AppLayout`, qui redirige vers la connexion :
> aucun visiteur anonyme ne peut la consulter. En revanche la reponse renvoyait la saison
> EN CLAIR, avec le `userId` de chaque joueur inscrit. L'anonymat ne servait donc a rien
> sinon a livrer a tout internet la liste des-inscriptions d'une ligue (une carte sociale
> de tes adversaires, pseudo -> identifiant de compte). » — `server/routes/league.mjs:36-45`

> « Cette route DEPLACE DE L'ARGENT (remboursement d'un pass de ligue). Elle n'exigeait que
> le rôle admin, alors que la lecture de la liste des paiements exigeait la 2FA : un compte
> admin compromis suffisait a vider les portefeuilles. Aligne sur les autres operations
> financieres. » — `server/routes/league.mjs:356-359`

### 12.7 `server/routes/br.mjs` — `handleBrRoutes` (`server/routes/br.mjs:44-297`)

| # | Méthode | Chemin | Garde | Rate limit | Comportement |
|---|---|---|---|---|---|
| 1 | GET | `/api/br/config` | public | *aucun* | maps, modes, modes de classement, `prizedPlaces` (5), `arbiterMaxRate` (0.05) |
| 2 | GET | `/api/br/lobbies` | public | `default` | roster **sans `userId`** |
| 3 | POST | `/api/br/lobbies` | session | **`'match'` → repli `default`** | le créateur devient l'**arbitre** |
| 4 | POST | `/api/br/lobbies/:id/{join\|leave\|checkin\|start\|eliminate\|finish}` | session | `admin` pour `finish`, `default` sinon | **sérialisé par `withBrLobbyMutex(lobbyId)`** |
| 5 | GET | `/api/br/lobbies/:id` | public | `default` | `ranking`, `projectedPayouts` |
| 6 | GET | `/api/br/lobbies/:id/arbiter` | **arbitre du salon ou créateur** | `default` | **seule route qui rend les `userId`** ; 403 `ARBITER_REQUIRED` sinon |

Pièges :

- Le snapshot des lobbies est **relu à l'intérieur** du verrou
  (`server/routes/br.mjs:138-139`) — sinon le second appel partirait de l'instantané
  d'avant le premier.
- `eliminate` exige `body.userId` **string** (400 `INVALID_JSON` sinon).
- `finish` exige `requireAdmin2fa` **en plus** de l'autorité d'arbitre
  (`server/routes/br.mjs:168-173`) ; le garde écrit la réponse lui-même, donc la route
  renvoie `{aborted: true}` puis `if (outcome.aborted) return true;`
  (`server/routes/br.mjs:173`, `:197`).

> « `join`/`leave` touchent l'argent MAIS restent sur le quota general : les mettre dans
> `wallet` (20 requetes / 10 min, partage avec les depots/retraits) rendait le produit
> inutilisable — un joueur qui s'inscrit puis se desinscrit de 3 salons epuisait le quota
> avant meme de pouvoir retirer ses gains. `finish` est reserve a l'arbitre et tire de
> l'argent : quota admin. » — `server/routes/br.mjs:117-123`

> « Vue ARBITRE : la seule qui rend les `userId`. L'arbitre doit designer qui est elimine et
> par qui, et `eliminate` exige des `userId`. Les identifiers ne sont donc pas devines ni
> reconstruits depuis le roster public (qui les masque) : cette route est verifiee cote
> serveur, et refuse tout autre lecteur. » — `server/routes/br.mjs:242-249`

### 12.8 `server/routes/match.mjs` — `handleMatchRoutes` (`server/routes/match.mjs:33-421`)

**Toutes les routes exigent une session** (401 `AUTH_REQUIRED`). Toutes les mutations
passent par `withMatchMutex` puis `saveMatches(io, outcome.matches, outcome.match)`
(diffusion `state:matches`).

| # | Méthode | Chemin | Rate limit | Comportement |
|---|---|---|---|---|
| 1 | POST | `/api/matches` | `social` | `tournamentId` doit être un UUID ; `format` = `NVSN` avec N ∈ [1,5] (400 `INVALID_FORMAT`) ; `entryFee` arrondi à 2 décimales ; création sous `withWalletMutex(userId)` |
| 2 | POST | `/api/matches/:id/join` | `social` | |
| 3 | POST | `/api/matches/:id/arbiter` | `social` | notifie l'arbitre |
| 4 | POST | `/api/matches/:id/check-in` | `social` | |
| 5 | POST | `/api/matches/:id/ready` | `social` | |
| 6 | POST | `/api/matches/:id/schedule` | *aucun* | |
| 7 | POST | `/api/matches/:id/room` | *aucun* | |
| 8 | POST | `/api/matches/:id/launch` | *aucun* | |
| 9 | POST | `/api/matches/:id/result` | *aucun* | **`deferSettlement: true`** → état `awaiting_confirmation` ; whitelist stricte de 7 champs |
| 10 | POST | `/api/matches/:id/confirm` | *aucun* | notifie les équipes en attente |
| 11 | POST | `/api/matches/:id/disputes` | *aucun* | notifie l'adversaire |
| 12 | POST | `/api/matches/:id/dispute/evidence` | *aucun* | |
| 13 | POST | `/api/matches/:id/dispute/escalate` | *aucun* | `notifyAllAdmins` |

> « Parsing hors lock : le mutex global ne doit couvrir que la mutation. »
> — `server/routes/match.mjs:42`

> « On PERSISTE le résultat mais on NE VERSE PAS : le match passe en
> 'awaiting_confirmation'. Les deux équipes doivent confirmer (ou la fenêtre de 30 min expire
> via cron) avant que la cagnotte parte. C'est la seule fenêtre où le perdant peut encore
> ouvrir un litige. Whitelist stricte : le body est du JSON client, on ne persiste que les
> champs attendus (anti mass-assignment sur match.result). » — `server/routes/match.mjs:261-267`

### 12.9 `server/routes/admin.mjs` — `handleAdminRoutes` (`server/routes/admin.mjs:111-649`)

> « EXTRAIT DE `realtime-server.mjs` SANS MODIFICATION DE LOGIQUE. Le bloc original
> (lignes 2751-2998) est reproduit tel quel ; seule la frontiere de la fonction change.
> `handleAdminRoutes` renvoie `true` quand elle a traite la requete, ce qui remplace les
> `return;` de fin de bloc. L'ordre des routes est preserve […] Toute operation financiere
> passe par `requireAdmin2fa` : c'est la garantie principale de ce fichier, et elle est
> verifiee par les E2E admin. » — `server/routes/admin.mjs:1-15`

**Règle de groupe :** toutes les routes admin appliquent `rateLimitGuard(..., 'admin')`
**avant** `requireAdmin2fa` — l'ordre est systématique dans tout le fichier.

| # | Méthode | Chemin | Garde | Comportement |
|---|---|---|---|---|
| 1 | POST | `/api/admin/reload` | `requireAdmin2fa` | `forceReloadFromSupabase()` → `{ok, persistence}` ; 500 `RELOAD_ERROR` |
| 2 | GET | `/api/admin/commissions` | `requireAdmin2fa` | `{ok, commissions}` ; 500 `COMMISSIONS_ERROR` |
| 3 | GET | `/api/admin/reports` | `requireAdmin2fa` | filtres `status`, `targetId`, `limit`, `offset` ; 503 `SERVER_BUSY` si base injoignable ; champ `degraded` explicite |
| 4 | POST | `/api/admin/reports/:id/resolve` | `requireAdmin2fa` | `resolution` doit être un `isSanctionKind` valide (400 `INVALID_RESOLUTION`) ; 409 `ALREADY_REVIEWED`, 404 `REPORT_NOT_FOUND` |
| 5 | GET | `/api/admin/sanctions` | `requireAdmin2fa` | `userId` optionnel ; `targetPseudo` résolu côté serveur |
| 6 | POST | `/api/admin/sanctions/:id/revoke` | `requireAdmin2fa` | 404 `SANCTION_NOT_FOUND` si inconnue ou déjà levée |
| 7 | GET | `/api/admin/matches/export` | `requireAdmin2fa` | CSV (défaut) ou JSON (`?format=json`) ; `Content-Disposition: attachment` ; **BOM UTF-8** sur le CSV ; 503 `SERVER_BUSY` si base absente |
| 8 | GET | `/api/admin/2fa/status` | **`requireAdmin`** (sans 2FA) | `{ok, enabled, serverTime, period}` |
| 9 | POST | `/api/admin/2fa/setup` | `requireAdmin` | **mot de passe admin obligatoire** (403 `INVALID_PASSWORD`) ; 409 `2FA_ALREADY_ENABLED` ; renvoie `otpauthUrl` |
| 10 | POST | `/api/admin/2fa/enable` | `requireAdmin` | vérifie le TOTP ; 400 `MFA_INVALID` / `MFA_ALREADY_ACTIVE` / `MFA_REQUIRED` |
| 11 | POST | `/api/admin/2fa/verify` | `requireAdmin` | ouvre une fenêtre de 5 min via `markAdmin2faVerified(readBearerToken(req))` |
| 12 | POST | `/api/admin/matches/:id/award` | `requireAdmin2fa` | **en deux phases** : `deferSettlement:true` + `saveMatches`, puis `settlePendingMatchResult` + `saveMatches` |
| 13 | POST | `/api/admin/matches/:id/resolve-dispute` | `requireAdmin2fa` | `action` explicite obligatoire pour mouvement d'argent |
| 14 | POST | `/api/admin/matches/:id/cancel` | `requireAdmin2fa` | annulation par modération |

> « Avant, cette route n'exigeait qu'une session. Son garde anti-takeover reposait sur
> `adminTotpSecrets`, un Map EN MEMOIRE : si la ligne `admin_2fa_secrets` manquait […] le
> garde voyait `undefined`, renvoyait un nouveau secret, et un attaquant disposant du seul
> mot de passe admin s'auto-enrolait un code valide. Acces financier complet. »
> — `server/routes/admin.mjs:420-432`

> « Décision de modération = décision finale […] MAIS en DEUX PHASES, comme le chemin
> joueur. `deferSettlement: true` persiste d'abord `payoutDistributed: 'pending'`, et le
> versement a lieu ensuite. Avec `false`, les portefeuilles étaient crédités AVANT
> `saveMatches` : un crash ou un 503 d'écriture Supabase entre les deux laissait l'argent
> parti sans trace, et l'admin pouvait attribuer une seconde fois. »
> — `server/routes/admin.mjs:556-564`

### 12.10 `server/routes/chat.mjs` — `handleChatRoutes` (`server/routes/chat.mjs:31-199`)

| # | Méthode | Chemin | Rate limit | Comportement |
|---|---|---|---|---|
| 1 | GET | `/api/chat/bootstrap` | `chat` | `buildChatBootstrapPayload(user.id)` — 50 canaux, messages des 10 plus actifs |
| 2 | GET | `/api/chat/channels/:id` | *aucun* | 404 `CHANNEL_NOT_FOUND` si canal absent **ou inaccessible** ; 150 messages |
| 3 | POST | `/api/chat/channels` | `chat` | `type` ∈ `private\|match\|team\|dm` (400 `INVALID_ENUM`) ; participants filtrés sur les users existants ; id `CH-<type>-<base36>` ; 201 |
| 4 | POST | `/api/chat/channels/:id/messages` | `chat` | `sanitizeText` + **slice 2000** ; 400 `EMPTY_MESSAGE` ; 201 + `broadcastChatMessage` |
| 5 | POST | `/api/chat/channels/:id/read` | `chat` | `markChatChannelRead` + `broadcastChatRead` ; 500 `READ_ERROR` |

Piège : l'accès au canal est vérifié **après** la lecture du canal ; un canal inaccessible
renvoie **404** et non 403 (anti-énumération délibérée, `server/routes/chat.mjs:56-59`).

### 12.11 `server/routes/realtime.mjs` — `handleRealtimeRoutes` (`server/routes/realtime.mjs:27-178`)

| # | Méthode | Chemin | Garde | Rate limit | Comportement |
|---|---|---|---|---|---|
| 1 | POST | `/api/realtime/auth/session` | **session app** (`getAuthenticatedAppSession`) | `auth` | crée une session realtime → `{ok, session}` ; 500 `SESSION_ERROR` |
| 2 | GET | `/api/realtime/push/public-key` | public | *aucun* | 503 `PUSH_NOT_CONFIGURED` si pas de VAPID ; sinon `{publicKey}` (**sans `ok`**) |
| 3 | GET | `/api/realtime/state/bootstrap` | **session realtime** (`getAuthenticatedRealtimeSession`) | *aucun* | 100 derniers matchs + 50 derniers tournois + amis + demandes + bloqués + notifications non lues |
| 4 | POST | `/api/realtime/push/subscribe` | **session realtime** | *aucun* | `subscription.endpoint` requis (400 `MISSING_FIELDS`) |
| 5 | POST | `/api/realtime/push/unsubscribe` | **session realtime** | *aucun* | `endpoint` requis |
| 6 | POST | `/api/realtime/push/test` | **session realtime** | *aucun* | envoie une notification de test |

Les routes 3→6 exigent un **token realtime en `Authorization: Bearer`**, pas le cookie
`zoyd_auth` (voir §5.2). Le client utilise `buildAuthHeaders()`
(`src/app/lib/realtimeClient.ts:266-271`), qui appelle `/api/realtime/auth/session` pour
obtenir ce token.

> « `POST /api/realtime/state/sync` a ete SUPPRIME. Cette route ne pouvait rien accepter :
> les tournois repondaient 409, tout le reste 400. […] Elle avait surtout un cout invisible :
> la fonction client ressemblait a un appel qui marche. Un developpeur pouvait la
> rebrancher, decouvrir un 400 en production, et perdre du temps a comprendre pourquoi — le
> serveur ne signalait rien. La synchronisation d'etat passe par les routes API dediees, et
> le socket ne transporte que des deltas, fusionnes par `hydrateFromServer`. »
> — `server/routes/realtime.mjs:88-100`

### 12.12 Administration et 2FA (`server/admin-totp.mjs`)

| Élément | Ligne | Valeur |
|---|---|---|
| `TOTP_DIGITS` | `server/admin-totp.mjs:10` | 6 |
| `TOTP_PERIOD` | `server/admin-totp.mjs:13` | 30 s |
| `TOTP_ALGORITHM` | `server/admin-totp.mjs:16` | `sha1` |
| `TOTP_WINDOW_STEPS` | `server/admin-totp.mjs:64` | **0** — le code n'est accepté que pendant son pas de 30 s |
| `verifyTotp` | `server/admin-totp.mjs:72` | comparaison en temps constant (`server/admin-totp.mjs:93-97`) + type strict avant comparaison (`server/admin-totp.mjs:83-87`) |
| `requireAdmin` | `server/admin-totp.mjs:129-141` | 401 sans session ; 403 si `role !== 'admin'` ; log `warn('Unauthorized admin attempt', …)` |
| `requireAdmin2fa` | `server/admin-totp.mjs:152-175` | 401 ; 403 `ADMIN_REQUIRED` ; 403 `2FA_REQUIRED` + `requires2fa:true` si 2FA inactive ou fenêtre expirée |

Fenêtre 2FA : **5 minutes** (`server/persistence.mjs:3164`).

---

## 13. Ce que le client NE protège pas

Les gardes côté client sont du **confort**, pas une sécurité. Le front peut être
contourné en une requête `curl` ; seule la vérification serveur fait autorité.

| Garde client | Emplacement | Ce qu'il fait | Ce qu'il ne fait pas |
|---|---|---|---|
| `AppLayout` : redirection si non authentifié | `src/app/layouts/AppLayout.tsx:31-33` | redirige vers `/auth/login` | n'empêche **aucun** appel API anonyme |
| `AppLayout` : redirection si non-admin | `src/app/layouts/AppLayout.tsx:35-37` | redirige vers `/mj` | n'empêche **aucun** accès aux routes admin |
| `AppLayout requireAdmin` sur `/admin` | `src/app/routes.tsx:217` | masque l'onglet admin | le rôle vient du store client (`user?.role === 'admin'`, `src/app/layouts/AppLayout.tsx:19`), donc falsifiable en `localStorage` |
| `AppLayout` sur les pages métier | `src/app/routes.tsx:106`, `:147`, `:158`, `:168`, `:175`, `:185`, `:191`, `:202`, `:212` | cadre l'UI | n'est pas une autorisation |
| Pages légales hors `AppLayout` | `src/app/routes.tsx:79-103` | publiques par choix | sans rapport avec l'API |

**L'autorisation réelle est entièrement serveur** :

- Session applicative : `getAuthenticatedAppSession(req)` (`server/http-utils.mjs:244-253`)
  → 401 `AUTH_REQUIRED`.
- Rôle admin : `requireAdmin` / `requireAdmin2fa` (`server/admin-totp.mjs:129-175`).
- Rôle de compte **relu** à chaque résolution de session
  (`server/persistence.mjs:3205-3221`).
- Accès à un canal : `canAccessChatChannel` (`server/chat-helpers.mjs:52-53`).

Conséquence pratique : un utilisateur qui édite son `localStorage` pour se donner
`role: 'admin'` voit s'afficher l'onglet admin, mais **toutes** ses requêtes
`/api/admin/*` recevront 403 `FORBIDDEN` ou 403 `2FA_REQUIRED`
(`server/admin-totp.mjs:129-175`). Inversement, un garde place uniquement côté client
serait une faille : c'est exactement le reproche formulé dans
`server/routes/league.mjs:36-45`, où la protection réelle apportée par la route est
serveur (session requise + retrait des `playerId`), et non le `AppLayout` cité.

Le `AppLayout` est donc à lire comme une **ergonomie** : il évite d'afficher un écran
qu'on ne pourrait pas charger. Il ne remplace aucun garde serveur et ne doit jamais être
cité comme une mesure de sécurité.

---

## 14. Pièges et fragilités

### 14.1 `return true` dans un callback de mutex ne sort PAS de la requête

**Le piège.** `withWalletMutex(userId, fn)` renvoie la valeur de retour de `fn`. Un
`return true` écrit **dans** le callback sort du callback, pas de la route : la
requête continue son exécution après le bloc.

**Conséquence réelle.** Sur `POST /api/wallet/withdraw`, la branche « payout ambigu »
répondait 409 dans le mutex, puis l'exécution tombait sur `initiateFedaPayPayout` —
un **deuxième** vrai transfert Mobile Money, après avoir répondu « contacte le support ».
Le joueur recevait à la fois la mise en garde et l'argent.

> « `return true` DANS le callback ne sort PAS de la requete : le mutex renvoie la valeur
> du callback, mais la route l'ignore et l'execution se poursuit apres le bloc.
> Consequence sur la branche 409 : ni `isDuplicate` ni `debitedWallet` n'etaient
> positionnes, donc le code tombait ensuite sur `initiateFedaPayPayout` — un SECOND vrai
> transfert Mobile Money, apres avoir repondu "contacte le support". Le joueur recevait a la
> fois la mise en garde et l'argent. » — `server/routes/wallet.mjs:188-199`

**Le correctif** est un drapeau explicite : `abandonner` (`server/routes/wallet.mjs:200`),
positionné à `server/routes/wallet.mjs:230`, testé à `server/routes/wallet.mjs:251`
(`if (abandonner) return true;`).

**Règle.** Tout `return` à l'intérieur d'un callback de mutex doit être accompagné d'un
drapeau testé **après** le bloc verrouillé. Le `return true` utile est celui du
niveau route.

### 14.2 Chevauchement `/api/users/:id` vs `/api/users/search`

Le motif `/^\/api\/users\/([^/]+)$/` (`server/routes/public.mjs:330`) matche aussi
`/api/users/search`. Comme `handlePublicRoutes` est le **premier** module de
`ROUTE_MODULES` (`server/realtime-server.mjs:31`), la route profil aurait capté
`/api/users/search` avant que la route recherche ne soit atteinte.

Neutralisation : garde explicite dans la condition
`pathname !== '/api/users/search'` (`server/routes/public.mjs:331`).

C'est **le seul** chevauchement connu sur les ~100 routes, d'après la vérification
documentée dans `server/realtime-server.mjs:250-260`. Toute nouvelle route paramétrée
doit être confrontée aux motifs déjà présents : l'ordre des modules n'a aucune portée
sémantique, donc le seul frein est le chevauchement de motif.

### 14.3 Référence `io` déclarée après usage

`handleRequest` utilise `io` (`server/realtime-server.mjs:262`) alors que
`const io = new SocketIOServer(server, …)` est déclaré **plus bas**
(`server/realtime-server.mjs:279`).

C'est sûr à l'exécution : la fermeture résout `io` au moment de l'appel, et l'appel n'a
lieu qu'après `server.listen` (`server/realtime-server.mjs:659`). Mais c'est un **ordre
fragile** : tout élément qui ferait appeler `handleRequest` avant `listen` — ou un
réordonnancement du fichier — provoquerait un `ReferenceError` au pire moment. À
documenter, pas à corriger à l'aveugle.

### 14.4 Ordre global → local des verrous

Les verrous globaux (`withMatchMutex`, `withTournamentMutex`, `withLeagueMutex`) doivent
être acquis **avant** les verrous par entité (`withWalletMutex`, `withUserMutex`,
`withBrLobbyMutex`). Exemples : `server/routes/match.mjs:50` puis `:76` ;
`server/routes/wallet.mjs:202`.

L'ordre inverse créerait un risque de deadlock. L'ordre global→local est constant sur
les modules de routes aujourd'hui ; c'est un invariant **à préserver**, pas un accident.

Deux invariants voisins à ne pas confondre :

- **Débit sous verrou, payout hors verrou** (`server/routes/wallet.mjs:202` vs `:266-278`).
  Inverser = double paiement possible.
- **Règlement admin en deux phases** (`deferSettlement` puis `settlePendingMatchResult`,
  `server/routes/admin.mjs:556-579`). Inverser = argent parti sans trace.

### 14.5 Groupe de rate limit `'match'` non déclaré

`POST /api/br/lobbies` utilise le groupe `'match'` (`server/routes/br.mjs:80`), absent de
`RATE_LIMIT_CONFIG` (`server/rate-limiter.mjs:11-22`). Le repli silencieux
`RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default` (`server/rate-limiter.mjs:74`)
applique donc 60/min au lieu du quota prévu. **Aucun log, aucune erreur** : le quota
attendu n'est jamais appliqué.

### 14.6 Deux conventions opposées pour « refusé »

| Garde | Valeur sur refus |
|---|---|
| `rateLimitGuard` (`server/rate-limiter.mjs:205-213`) | `false` (la 429 est déjà écrite) |
| `requireAdmin` / `requireAdmin2fa` (`server/admin-totp.mjs:129-175`) | `null` (la 401/403 est déjà écrite) |

Les deux styles d'appel coexistent dans le code, ce qui rend la relecture coûteuse et
les erreurs silencieuses.

### 14.7 `requireAdmin` / `requireAdmin2fa` écrivent la réponse eux-mêmes

Le code appelant doit faire `if (!session) { return true; }` et **ne pas re-répondre**,
sous peine de double écriture d'en-têtes avalée en `ERR_HTTP_HEADERS_SENT`
(`server/routes/wallet.mjs:106-107`).

### 14.8 `respondJson` appelé avant `res._req = req`

La 404 de `server/realtime-server.mjs:208` est émise **avant** l'affectation
`res._req = req` (`server/realtime-server.mjs:215`). Dans ce cas `effectiveReq` est
`undefined` et l'Origin CORS retombe sur `ALLOWED_ORIGINS[0]`. Sans impact pratique
majeur, mais c'est une exception à la règle générale.

### 14.9 Priorités opposées cookie / Bearer

`readBearerToken` privilégie le **cookie** (`server/http-utils.mjs:212-229`) ;
`getAuthenticatedAppSession` privilégie le **Bearer** (`server/http-utils.mjs:244-253`).
Même fonction appelée par deux chemins, deux sémantiques : source classique de confusion
et de 401 « inexplicables ».

### 14.10 Durée de vie du cookie de rotation

Le `Set-Cookie` de rotation posé par `respondJson` utilise une durée **fixe de 6 h**
(`server/http-utils.mjs:103`), alors que la session mère peut avoir une
`absoluteExpiresAt` plus courte (`server/persistence.mjs:3059-3066`). Le cookie peut
donc survivre à la session.

### 14.11 Imports après déclarations

`server/routes/tournament.mjs:32-33` et `server/routes/admin.mjs:42-45` contiennent des
imports **après** des déclarations. Légal en ESM (hoisting), trompeur à la lecture.

---

## 15. Ce qui n'est pas établi par ce document

Par honnêteté methodologique, sont explicitement **non vérifié** ou hors périmètre :

| Sujet | État |
|---|---|
| Rôle figé sur une socket déjà ouverte | Le test `server/realtime-privilege-revocation.test.mjs:107-123` valide `getRealtimeSession`, mais **ne couvre pas** la copie figée `socket.data.session` (`server/realtime-server.mjs:396`). **Non vérifié** par les tests. |
| Comportement de `withChannelMutex` en concurrence réelle | Utilisé uniquement par la couche persistance (`server/persistence.mjs:3347`, `:3380`) ; aucun module de routes ne l'utilise. Comportement en charge : **non vérifié**. |
| Répartition de charge réelle derrière le LB Render | Les quotas (`50/15 min` sur `auth`, `10/60 s` par IP en socket) sont dimensionnés par IP. Derrière un CGNAT mobile, le déni de connexion de masse est possible : le comportement en production n'est pas mesuré ici. **Non vérifié**. |
| Cardinalité des labels Prometheus en regime nominal | Les motifs de normalisation existent (`server/http-utils.mjs:284-296`) ; l'explosion constatée est corrigée, pas mesurée. **Non vérifié**. |
| Rôle de `verifyDataIntegrity()` | Son résultat est logué mais jamais bloquant (`server/realtime-server.mjs:621`) ; la liste exacte de ses contrôles n'est pas décrite ici. **Hors périmètre**. |

---

## 16. Index des invariants à ne pas casser

Liste de contrôle dérivée de ce document. Chaque ligne est un point où une régression
aurait un effet direct sur l'argent ou la sécurité.

1. Un seul processus (`server/single-process-guard.mjs:106`).
2. Verrou global avant verrou par entité (`server/routes/match.mjs:50`, `:76`).
3. Débit sous verrou, payout hors verrou (`server/routes/wallet.mjs:202`, `:266-278`).
4. Règlement en deux phases (`deferSettlement` puis `settlePendingMatchResult`).
5. Clé d'idempotence obligatoire sur `/api/wallet/withdraw`
   (`server/routes/wallet.mjs:174-181`).
6. Jamais de remboursement sur échec incertain (`payoutMaybeSent`,
   `server/routes/wallet.mjs:290-313`).
7. `return true` de mutex ⇒ drapeau testé après le bloc
   (`server/routes/wallet.mjs:188-199`, `:251`).
8. Toute opération financière admin passe par `requireAdmin2fa`
   (`server/routes/admin.mjs:1-15`).
9. Rôle de compte relu à chaque résolution de session
   (`server/persistence.mjs:3205-3221`).
10. Identité de présence écrasée par la session (`server/realtime-server.mjs:430-434`).
11. Roster public sans `userId` (`server/state-helpers.mjs:260-276`).
12. Erreur métier ⇒ `error.code` obligatoire, sinon 500 générique
    (`server/http-utils.mjs:432-434`).
13. Sanitisation avant diffusion socket **et** réponse HTTP
    (`server/state-helpers.mjs:260-276`).
14. `withdrawalKey` oubliée en cas d'échec de marquage = retrait bloqué
    (`server/routes/wallet.mjs:344-353`).
15. `phone_key` non nul et unique (`server/routes/auth.mjs:366-377`).

---

*Fin du document. Source : cartographie du noyau serveur établie par lecture directe du
code. Les citations `fichier:ligne` renvoient à l'état du dépôt au moment de la
rédaction ; toute affirmation non sourcée est signalée comme « non vérifié » (§15).*
