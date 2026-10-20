# ZOYD — Référence API

> Ce document est le **catalogue de la surface HTTP** : convention de réponse,
> table des codes erreur, pipeline CSRF, sessions, et les 108 routes réparties
> sur 11 modules.
>
> Il ne décrit ni le fonctionnement interne du serveur (→ `01-architecture.md`),
> ni le modèle métier (→ `02-modele-metier.md`), ni les mesures de sécurité
> (→ `03-securite.md`), ni les invariants à ne pas casser (→ `05-invariants.md`).
> Le déploiement et l'exploitation sont dans `07-exploitation.md`.
>
> **Source :** lecture directe de `server/`. Les citations `fichier:ligne` renvoient
> à l'état du dépôt au moment de la rédaction.
> **Point d'entrée :** `server/realtime-server.mjs` (serveur `http` natif, pas
> Express — `docs/01-architecture.md:74-76`).

---

## 1. Conventions

### 1.1 Enveloppe de réponse

Deux formes, et deux seulement :

```json
{ "ok": true,  ...données }
{ "ok": false, "error": "<message FR>", "code": "<CODE_MACHINE>" }
```

| Champ | Type | Règle |
|---|---|---|
| `ok` | booléen | `true` = succès, `false` = échec. **Toujours présent.** |
| `error` | chaîne | Message **humain, en français**, affichable tel quel. |
| `code` | chaîne | Code **machine**, stable, à tester côté client. |

La production de l'enveloppe d'erreur est centralisée dans `respondMappedError`
(`server/http-utils.mjs:442-448`) : elle passe par `mapPersistenceError`
(`server/http-utils.mjs:303-435`) pour choisir le statut HTTP, puis écrit
`{ ok:false, error, code }`.

Deux exceptions à connaître :

- `GET /api/realtime/push/public-key` renvoie `{ publicKey }` **sans `ok`**
  (`server/routes/realtime.mjs:53`). Un intégrateur qui lit `body.ok` y trouve
  `undefined` — c'est un contrat distinct, pas un oubli de la part du serveur.
- `GET /metrics` n'est pas du JSON : `text/plain; version=0.0.4`
  (`server/routes/public.mjs:325-326`), et l'export admin CSV/JSON non plus
  (`server/routes/admin.mjs:379-396`).

**Invariant.** Toute erreur métier doit porter un `error.code`. Sans lui, elle
tombe dans le `default` de `mapPersistenceError` et devient un **500 à message
générique** `'Une erreur serveur est survenue.'` (`server/http-utils.mjs:432-434`).
C'est la cause n°1 de « 500 alors que c'est une faute de saisie ».

### 1.2 En-têtes

Posés à **chaque** réponse JSON par `respondJson` (`server/http-utils.mjs:110-131`) :

| En-tête | Valeur |
|---|---|
| `Content-Type` | `application/json` |
| `Access-Control-Allow-Origin` | l'`Origin` si elle est sur la liste blanche, sinon `''` |
| `Access-Control-Allow-Credentials` | `true` |
| `Access-Control-Allow-Methods` | `GET,POST,PATCH,DELETE,OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type,Authorization` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Vary` | `Origin` |

Pas de `X-XSS-Protection` (déprécié, ignoré) ni de CSP : les deux sont
argumentés en `server/http-utils.mjs:118-130`. La CSP effective est celle de
`vercel.json` (`vercel.json:32`), sur les documents.

### 1.3 Corps de requête

| Contrainte | Valeur | Source |
|---|---|---|
| Taille maximale | **1 Mo** | `BODY_SIZE_LIMIT`, `server/http-utils.mjs:167` |
| Dépassement | socket coupé (`req.destroy()`), `code:'PAYLOAD_TOO_LARGE'` | `server/http-utils.mjs:180-186` |
| JSON invalide | `code:'INVALID_JSON'` | `server/http-utils.mjs:203` |
| Corps vide | traité comme `{}` | `server/http-utils.mjs:199` |
| Socket coupé par le client | `code:'CLIENT_ABORTED'` (≠ session invalide) | `server/http-utils.mjs:193-195` |

### 1.4 Pagination

`parseQueryParams` (`server/http-utils.mjs:148-154`) : `limit` borné à
**[1, 500]**, défaut **100** ; `offset ≥ 0`, défaut 0.
`paginate` renvoie `{ items, hasMore }` (`server/http-utils.mjs:161-164`).

Plafonds **spécifiques par route**, plus stricts que le global :

| Route | Plafond | Source |
|---|---|---|
| `GET /api/users/search` | 50 | `server/routes/public.mjs:422` |
| `GET /api/wallet/history` | 200 | `server/routes/wallet.mjs:64` |

---

## 2. Table des codes erreur → statut HTTP

Source unique : `mapPersistenceError` (`server/http-utils.mjs:303-435`).
`respondMappedError` (`server/http-utils.mjs:442-448`) **ne journalise en `error`
que le 500** — les 4xx ne sont pas logués comme erreur.

### 2.1 400 — Bad Request (41 codes)

Entrée invalide, sortie refusée, ou état métier non conforme. **Rejouable après
correction de la requête.**

| # | Code | Ligne | Origine typique |
|---|---|---|---|
| 1 | `INVALID_REGISTRATION` | `:307` | inscription |
| 2 | `IDEMPOTENCY_KEY_REQUIRED` | `:308` | `POST /api/wallet/withdraw` |
| 3 | `ACTIVE_WAGER` | `:309` | mise en cours |
| 4 | `INVALID_JSON` | `:311` | corps malformé, `tournamentId` non-UUID, `userId` absent |
| 5 | `PAYLOAD_TOO_LARGE` | `:312` | corps > 1 Mo |
| 6 | `INVALID_TRANSACTION_ID` | `:313` | `transactionId` FedaPay non numérique |
| 7 | `INVALID_AMOUNT` | `:314` | montant hors bornes |
| 8 | `WITHDRAWAL_MIN` | `:315` | sous le minimum de retrait |
| 9 | `MATCH_SEGMENT_MISMATCH` | `:316` | |
| 10 | `ROOM_INCOMPLETE` | `:317` | |
| 11 | `ROOM_TOO_EARLY` | `:318` | |
| 12 | `PROOFS_REQUIRED` | `:319` | |
| 13 | `DISPUTE_INCOMPLETE` | `:320` | |
| 14 | `MATCH_NOT_READY` | `:321` | |
| 15 | `CHECKIN_REQUIRED` | `:322` | |
| 16 | `INVALID_MATCH` | `:323` | |
| 17 | `NOT_ENOUGH_PLAYERS` | `:324` | |
| 18 | `QUALIFICATION_INCOMPLETE` | `:325` | |
| 19 | `REGISTRATION_CLOSED` | `:326` | |
| 20 | `NOT_JOINED` | `:327` | |
| 21 | `MATCH_ALREADY_LIVE` | `:328` | |
| 22 | `NO_PLAYERS` | `:329` | |
| 23 | `INVALID_DAY` | `:330` | |
| 24 | `INVALID_RESULTS` | `:331` | |
| 25 | `INVALID_ARBITER` | `:332` | |
| 26 | `INVALID_PAYOUT` | `:333` | |
| 27 | `INVALID_MODE` | `:334` | |
| 28 | `INVALID_MAP` | `:335` | |
| 29 | `INVALID_RANKING_MODE` | `:336` | |
| 30 | `INVALID_DATE` | `:337` | |
| 31 | `WEAK_PASSWORD` | `:348` | politique de mot de passe |
| 32 | `RESET_FAILED` | `:349` | code de réinitialisation invalide |
| 33 | `INVALID_EMAIL` | `:350` | |
| 34 | `INVALID_OPERATOR` | `:351` | opérateur de payout inconnu du pays |
| 35 | `INVALID_PHONE` | `:352` | |
| 36 | `INVALID_COUNTRY` | `:353` | pays de payout non supporté |
| 37 | `LEGAL_NOT_ACCEPTED` | `:354` | consentement 18+/CGU non coché |
| 38 | `INVALID_FORMAT` | `:355` | format de match hors 1VS1–5VS5 |
| 39 | `PAYMENT_NOT_CONFIGURED` | `:379` | `FEDAPAY_SECRET_KEY` absent |
| 40 | `TRANSACTION_NOT_APPROVED` | `:380` | FedaPay refuse la transaction |
| 41 | `FEDAPAY_API_ERROR` | `:381` | erreur amont FedaPay |

> `LEGAL_NOT_ACCEPTED` et `INVALID_FORMAT` ont été déplacés dans ce groupe
> précisément parce qu'ils tombaient dans le `default` → 500 pour une simple
> erreur de saisie côté client (`server/http-utils.mjs:344-347`).

### 2.2 401 — Unauthorized (2 codes mappés)

| Code | Ligne | Signification |
|---|---|---|
| `INVALID_CREDENTIALS` | `:339` | identifiant ou mot de passe faux |
| `UNAUTHORIZED` | `:340` | Bearer absent ou faux — **aussi utilisé par `/metrics`** (`server/routes/public.mjs:315`) |

### 2.3 403 — Forbidden (3 codes mappés)

| Code | Ligne | Signification |
|---|---|---|
| `FORBIDDEN` | `:357` | droit refusé |
| `TRANSACTION_NOT_OWNED` | `:358` | transaction FedaPay d'un autre compte |
| `ACCOUNT_NOT_ACTIVATED` | `:359` | compte non activé |

### 2.4 404 — Not Found (8 codes)

| Code | Ligne |
|---|---|
| `NOT_FOUND` | `:402` |
| `MATCH_NOT_FOUND` | `:403` |
| `TOURNAMENT_NOT_FOUND` | `:404` |
| `LEAGUE_NOT_FOUND` | `:405` |
| `CHANNEL_NOT_FOUND` | `:406` |
| `PLAYER_NOT_FOUND` | `:407` |
| `USER_NOT_FOUND` | `:408` |
| `LOBBY_NOT_FOUND` | `:409` |

### 2.5 409 — Conflict (38 codes)

**C'est le statut « l'état du monde n'est pas celui qu'on attend ».** Salons
pleins ou lancés, joueur déjà inscrit ou éliminé, clé d'idempotence déjà
consommée, transaction déjà traitée. Le commentaire du code le dit :
« 409 et non 400 : le client peut reessayer » (`server/http-utils.mjs:411-414`).

| # | Code | Ligne | | # | Code | Ligne |
|---|---|---|---|---|---|---|
| 1 | `DUPLICATE_PSEUDO` | `:361` | | 20 | `DISPUTE_NOT_FOUND` | `:394` |
| 2 | `DUPLICATE_EMAIL` | `:362` | | 21 | `DISPUTE_ALREADY_ESCALATED` | `:395` |
| 3 | `DUPLICATE_PHONE` | `:363` | | 22 | `ALREADY_FRIENDS` | `:396` |
| 4 | `DUPLICATE_GAME_ID` | `:364` | | 23 | `ACCOUNT_ALREADY_ACTIVE` | `:397` |
| 5 | `ALREADY_LOCKED` | `:365` | | 24 | `REQUEST_PENDING` | `:398` |
| 6 | `TRANSACTION_IN_PROGRESS` | `:366` | | 25 | `ALREADY_CONFIRMED` | `:399` |
| 7 | `INSUFFICIENT_FUNDS` | `:367` | | 26 | `INVALID_REQUEST` | `:400` |
| 8 | `DAILY_WITHDRAWAL_LIMIT` | `:368` | | 27 | `ALREADY_CHECKED_IN` | `:415` |
| 9 | `MATCH_CLOSED` | `:369` | | 28 | `ALREADY_LIVE` | `:416` |
| 10 | `MATCH_NOT_LIVE` | `:370` | | 29 | `ALREADY_ELIMINATED` | `:417` |
| 11 | `ALREADY_JOINED` | `:371` | | 30 | `ALREADY_FINISHED` | `:418` |
| 12 | `ROLE_CONFLICT` | `:372` | | 31 | `TEAM_FULL` | `:419` |
| 13 | `TRUST_REQUIRED` | `:373` | | 32 | `LOBBY_FULL` | `:420` |
| 14 | `NO_SLOT_AVAILABLE` | `:374` | | 33 | `LOBBY_CLOSED` | `:421` |
| 15 | `ARBITER_TAKEN` | `:375` | | 34 | `LOBBY_NOT_LIVE` | `:422` |
| 16 | `SELF_BLOCK` | `:376` | | 35 | `PLAYER_DEAD` | `:423` |
| 17 | `TRANSACTION_ALREADY_PROCESSED` | `:377` | | 36 | `PLAYER_ABSENT` | `:424` |
| 18 | `2FA_ALREADY_ENABLED` | `:387` | | 37 | `TOO_EARLY` | `:425` |
| 19 | `RESULT_NOT_FOUND` | `:391` | | 38 | `ARBITER_REQUIRED` / `NO_PRESENT` | `:429` / `:430` |

### 2.6 423 — Locked

| Code | Ligne | Signification |
|---|---|---|
| `ACCOUNT_LOCKED` | `:342` | verrouillage de connexion (durable via `login_attempts`) |

### 2.7 502 — Bad Gateway

| Code | Ligne | Signification |
|---|---|---|
| `PAYOUT_FAILED` | `:383` | FedaPay a refusé le virement. **Remboursement automatique si l'échec est certain** (`server/routes/wallet.mjs:279-365`) |

### 2.8 503 — Service Unavailable

| Code | Ligne | Signification |
|---|---|---|
| `SERVER_BUSY` | `:385` | base injoignable, ou écriture refusée |
| `DELETE_FAILED` | `:389` | suppression impossible |

### 2.9 500 — défaut

Tout code non listé → `{ status: 500, message: 'Une erreur serveur est survenue.' }`
(`server/http-utils.mjs:432-434`). Le `code` d'origine est **conservé** dans la
réponse, ce qui permet de le retrouver malgré le statut générique.

Exception hors mapping : le filet de sécurité global du serveur renvoie
`{ ok:false, error:'Erreur serveur inattendue.', code:'INTERNAL_ERROR' }`
(`server/realtime-server.mjs:271-276`).

### 2.10 Codes émis **directement** par les routes (hors table)

Ces codes ne passent **pas** par `mapPersistenceError` : le statut HTTP est
écrit à la main dans la route. Un intégrateur qui s'appuie uniquement sur la
table ci-dessus les manque.

| Statut | Codes | Rejetés par |
|---|---|---|
| **400** | `MISSING_FIELDS` | `auth.mjs:166,196,225,252,299,509` · `social.mjs:186` · `realtime.mjs:114,138` |
| | `INVALID_ENUM` | `auth.mjs:355,359,363` · `chat.mjs:89` |
| | `INVALID_PLAYER_ID` | `public.mjs:212` |
| | `ACTIVATION_FAILED` | `auth.mjs:173` |
| | `PSEUDO_REQUIRED` | `auth.mjs:397` |
| | `CONFIRM_REQUIRED` | `auth.mjs:551` |
| | `INVALID_TOURNAMENT_NAME` | `tournament.mjs:65` |
| | `INVALID_MAX_ENTRIES` | `tournament.mjs:73` |
| | `INVALID_ENTRY_FEE` | `tournament.mjs:77` · `match.mjs:63` |
| | `INVALID_LEAGUE_NAME` | `league.mjs:105,109` |
| | `INVALID_TEAM_SIZE` | `league.mjs:117` |
| | `INVALID_RESOLUTION` | `admin.mjs:219` |
| | `INVALID_WINNER` | `admin.mjs:550` |
| | `MFA_REQUIRED` | `admin.mjs:481,521` |
| | `MFA_INVALID` | `admin.mjs:495,531` |
| | `MFA_ALREADY_ACTIVE` | `admin.mjs:490` |
| | `MFA_NOT_ACTIVE` | `admin.mjs:526` |
| | `EMPTY_MESSAGE` | `chat.mjs:140` |
| | `PAYMENT_FAILED` | `wallet.mjs:440` (repli quand le code métier est absent) |
| **401** | `AUTH_REQUIRED` | **partout** — émis directement, absent de la table de mapping |
| **403** | `ACCOUNT_SANCTIONED` | `auth.mjs:121-135` (porte l'objet `sanction`) |
| | `WRONG_PASSWORD` | `auth.mjs:524` |
| | `PASSWORD_CONFIRMATION_REQUIRED` | `auth.mjs:429` |
| | `ADMIN_REQUIRED` | `admin-totp.mjs:162` |
| | `2FA_REQUIRED` | `admin-totp.mjs:167,171` (porte `requires2fa:true`) |
| | `INVALID_PASSWORD` | `admin.mjs:441` (setup 2FA) |
| | `ARBITER_REQUIRED` | `br.mjs:269` — **voir l'avertissement §5.4** |
| | `METRICS_DISABLED` | `public.mjs:309` |
| **404** | `SANCTION_NOT_FOUND` | `admin.mjs:320` |
| | `REPORT_NOT_FOUND` | `admin.mjs:243` |
| **409** | `ALREADY_REVIEWED` | `admin.mjs:238-246` |
| | `PAYOUT_PENDING_REVIEW` | `wallet.mjs:222-227` (porte `idempotencyKey`) |
| **415** | `UNSUPPORTED_MEDIA_TYPE` | `realtime-server.mjs:245` |
| **429** | `RATE_LIMITED` | `rate-limiter.mjs:209` (+ en-tête `Retry-After`) |
| **502** | `UPSTREAM_ERROR` | `public.mjs:150,233` |
| **500** | `INTERNAL_ERROR` | `realtime-server.mjs:274` |
| | `LOAD_ERROR` | `public.mjs:356,389,408` · `social.mjs:46,60` · `wallet.mjs:99` · `chat.mjs:42,71` · `tournament.mjs:46` · `league.mjs:64,87` |
| | `SEARCH_ERROR` | `public.mjs:433` |
| | `STORE_PROXY_ERROR` | `public.mjs:193` |
| | `PLAYER_PROXY_ERROR` | `public.mjs:301` |
| | `RELOAD_ERROR` | `admin.mjs:124` |
| | `COMMISSIONS_ERROR` | `admin.mjs:140` |
| | `REPORTS_ERROR` | `admin.mjs:194` |
| | `RESOLVE_ERROR` | `admin.mjs:263` |
| | `SANCTIONS_ERROR` | `admin.mjs:298` |
| | `REVOKE_ERROR` | `admin.mjs:329` |
| | `EXPORT_ERROR` | `admin.mjs:400` |
| | `SESSION_ERROR` | `realtime.mjs:44` |
| | `SUBSCRIPTION_ERROR` | `realtime.mjs:121,145` |
| | `PUSH_ERROR` | `realtime.mjs:172` |
| | `READ_ERROR` | `chat.mjs:192` |
| **503** | `PUSH_NOT_CONFIGURED` | `realtime.mjs:51` |

---

## 3. Pipeline CSRF

Implémenté dans `handleRequest` (`server/realtime-server.mjs:228-248`), **avant**
le dispatch des routes.

### 3.1 Périmètre

| Aspect | Règle | Source |
|---|---|---|
| Méthodes concernées | `POST`, `PATCH`, `PUT`, `DELETE` **uniquement** | `server/realtime-server.mjs:234` |
| Méthodes exclues | `GET`, `HEAD`, `OPTIONS` — **jamais** contrôlées | idem |
| Position | avant la boucle `ROUTE_MODULES` | `server/realtime-server.mjs:234-248` vs `:261` |

### 3.2 Ce qui est exigé

**Niveau 1 — `Origin` sur liste blanche.**

```js
const origin = req.headers.origin;
if (origin && !ALLOWED_ORIGINS.includes(origin)) → 403 CSRF_ORIGIN_REJECTED
```
(`server/realtime-server.mjs:235-240`)

Liste = `ZOYD_ALLOWED_ORIGINS` (CSV) **plus** les trois domaines de production
toujours ajoutés en dur : `https://zoyd.vercel.app`, `https://zoyd.africa`,
`https://www.zoyd.africa` (`server/http-utils.mjs:60-67`). En développement,
`http://localhost:5173` et `http://127.0.0.1:5173` sont ajoutés **seulement si**
`NODE_ENV !== 'production'` (`server/http-utils.mjs:59`).

**Niveau 2 — `Content-Type: application/json`.**

```js
const contentType = String(req.headers['content-type'] || '');
if (contentType && !contentType.includes('application/json'))
  → 415 UNSUPPORTED_MEDIA_TYPE
```
(`server/realtime-server.mjs:243-247`)

C'est ce niveau qui bloque le CSRF « simple request » : une requête
`mode:'no-cors'` avec `Content-Type: text/plain` n'atteint jamais la route.

> « Le cookie de session est SameSite=None (front Vercel → API Render) : sans ce
> garde, une page tierce peut POSTer /api/wallet/withdraw avec `mode:'no-cors'`
> et `Content-Type: text/plain` (requête simple, sans preflight) en profitant du
> cookie envoyé automatiquement. » — `server/realtime-server.mjs:228-233`

### 3.3 Ce qui passe malgré tout

Trois limites, à connaître avant de déboguer « mon POST passe sans token » :

| Ce qui passe | Pourquoi | Source |
|---|---|---|
| Requête **sans en-tête `Origin`** | le contrôle n'est déclenché que `if (origin && …)` — curl, E2E, serveur-à-serveur | `server/realtime-server.mjs:236` |
| Requête **sans en-tête `Content-Type`** | le contrôle n'est déclenché que `if (contentType && …)` | `server/realtime-server.mjs:244` |
| `GET` / `HEAD` | hors périmètre du garde | `server/realtime-server.mjs:234` |

En pratique : **un client navigateur (avec `Origin`) est toujours contrôlé**,
un client programme (curl, `fetch` Node sans `Origin`) ne l'est pas. Ce n'est
pas un défaut : la protection vise le scénario du navigateur tiers qui profits
du cookie `SameSite=None`.

---

## 4. Sessions et authentification

### 4.1 Le cookie `zoyd_auth`

Sérialisé par `serializeAuthCookie` (`server/http-utils.mjs:47-56`).

| Attribut | Production (`NODE_ENV=production`) | Développement |
|---|---|---|
| `HttpOnly` | oui | oui |
| `Secure` | **oui** | non |
| `SameSite` | **`None`** | `Lax` |
| `Path` | `/` | `/` |
| `Max-Age` | `21600` (**6 h**) | idem |

`SameSite=None` est **obligatoire** : le front (Vercel) et l'API (Render) sont
cross-origin, `Lax` empêcherait le cookie de partir (`server/http-utils.mjs:40-43`).

Le `Max-Age` est posé à **trois** endroits, toujours `6 * 60 * 60` :
- création de session à l'inscription (`server/routes/auth.mjs:82`)
- création de session à la connexion (`server/routes/auth.mjs:142`)
- rotation de session posée par `respondJson` (`server/http-utils.mjs:103`)

**Durée de vie côté serveur** (`server/persistence.mjs:2818-2840`) :

| Notion | Durée | Comportement |
|---|---|---|
| `SESSION_TTL_MS` | **6 h** | glissante : chaque rotation repart de +6 h |
| `SESSION_ABSOLUTE_LIFETIME_MS` | **30 j** | plafond de la famille de sessions, calculé une fois et hérité |

**Rotation.** `getAuthenticatedAppSession` passe `emitToken` à `getAuthSession`
(`server/http-utils.mjs:244-253`) : le nouveau jeton est déposé dans
`req._authRotation`, et `respondJson` le convertit en `Set-Cookie`
(`server/http-utils.mjs:100-108`) — **une seule tentative**, la rotation étant
asynchrone.

> **Piège.** La durée du cookie de rotation est **fixe à 6 h**, alors que la
> session mère peut avoir une `absoluteExpiresAt` plus courte
> (`server/http-utils.mjs:103` vs `server/persistence.mjs:3059-3066`). Le cookie
> peut donc survivre à la session. Voir `docs/01-architecture.md:1355-1360`.

### 4.2 L'alternative `Authorization: Bearer`

Deux notions de token coexistent. **Les confondre produit un 401 silencieux.**

| Token | Où il est lu | Priorité |
|---|---|---|
| **Token app** (cookie `zoyd_auth` **ou** Bearer) | `getAuthenticatedAppSession` (`server/http-utils.mjs:244-253`) | **Bearer d'abord**, sinon cookie |
| **Token realtime** (Bearer **uniquement**) | `getAuthenticatedRealtimeSession` (`server/http-utils.mjs:260-270`) | Bearer **exclusivement** |

> « L'en-tête Authorization d'abord, PAS `readBearerToken` : celui-ci privilégie le
> cookie `zoyd_auth`, qui n'est PAS un token realtime. »
> — `server/http-utils.mjs:261-266`

`readBearerToken` (`server/http-utils.mjs:212-229`) fait l'**inverse** : cookie
d'abord, puis Bearer. Il est utilisé par `POST /api/auth/logout`,
`POST /api/auth/change-password`, `DELETE /api/auth/me`, `GET /api/matches` et
`markAdmin2faVerified`.

| Qui | Comment s'authentifier |
|---|---|
| Navigateur (front Vercel) | cookie `zoyd_auth` + `credentials: 'include'` (`src/app/lib/apiClient.ts:180`) |
| Intégrateur serveur-à-serveur | `Authorization: Bearer <token>` |
| Routes realtime (bootstrap, push) | `Authorization: Bearer <token realtime>` obtenu via `POST /api/realtime/auth/session` |

### 4.3 Garde admin

`requireAdmin` (`server/admin-totp.mjs:129-141`) et `requireAdmin2fa`
(`server/admin-totp.mjs:152-175`).

| Condition | Réponse |
|---|---|
| Pas de session | `401 { error:'Session joueur requise.' }` — **sans `code`** pour `requireAdmin` (`:132`) |
| Rôle ≠ `admin` | `403 { code:'ADMIN_REQUIRED' }` (`requireAdmin2fa` `:162`) / `{ error:'Acces reserve aux administrateurs.' }` sans code (`requireAdmin` `:137`) |
| 2FA non activée | `403 { code:'2FA_REQUIRED', requires2fa:true }` (`:167`) |
| Fenêtre 2FA expirée | `403 { code:'2FA_REQUIRED', requires2fa:true }` (`:171`) |

> **Ces gardes écrivent la réponse eux-mêmes.** Le code appelant doit faire
> `if (!session) { return true; }` **et ne pas re-répondre**, sinon double
> écriture d'en-têtes avalée en `ERR_HTTP_HEADERS_SENT`
> (`server/routes/wallet.mjs:106-107`, `server/routes/admin.mjs:115-116`).

La fenêtre 2FA est de **5 minutes** (`server/persistence.mjs:3164`), ouverte par
`POST /api/admin/2fa/verify`.

---

## 5. Routes

**Rôles utilisés dans les tables :**

| Rôle | Signification |
|---|---|
| `public` | aucune session requise |
| `session` | `getAuthenticatedAppSession` → sinon `401 AUTH_REQUIRED` |
| `session+` | session requise, mais acceptée **ou non** (le contenu varie) |
| `realtime` | `getAuthenticatedRealtimeSession` (Bearer realtime) → sinon `401 AUTH_REQUIRED` |
| `admin` | `requireAdmin` (rôle admin, sans 2FA) |
| `admin2fa` | `requireAdmin2fa` (rôle admin **+** 2FA validée dans les 5 min) |
| `arbiter` | l'**arbitre du salon** ou son créateur |

**Rate limit** : nom du groupe de quota (→ §5.5). « — » = aucun quota.

---

### 5.1 Public — `server/routes/public.mjs` (11 routes)

Ce sont les routes qu'un intégrateur utilise **sans compte**. Elles sont
exhaustivement documentées ici.

| # | Méthode | Chemin | Rôle | Rate limit | Corps / query attendu | Erreurs pertinentes |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/health` | public | — | — | `200` si `stateTrusted`, **`503`** sinon (`server/routes/public.mjs:64`) |
| 2 | GET | `/api/realtime/health` | public | — | — | — (`server/routes/public.mjs:73-80`) |
| 3 | GET | `/api/codm/store` | **session** | `default` | `?country=XX` (défaut `BJ`) | `401 AUTH_REQUIRED` (`:92`), `502 UPSTREAM_ERROR` (`:150`), `500 STORE_PROXY_ERROR` (`:193`) |
| 4 | GET | `/api/codm/player/:id` | **session** | `default` | `:id` ∈ `^\d{1,20}$`, `?country=XX` | `401 AUTH_REQUIRED` (`:205`), `400 INVALID_PLAYER_ID` (`:212`), `404 PLAYER_NOT_FOUND` (`:254`,`:278`), `502 UPSTREAM_ERROR` (`:233`), `500 PLAYER_PROXY_ERROR` (`:301`) |
| 5 | GET | `/metrics` | Bearer `METRICS_TOKEN` | — | en-tête `Authorization: Bearer …` | `403 METRICS_DISABLED` si token non configuré (`:309`), `401 UNAUTHORIZED` sinon (`:315`) |
| 6 | GET | `/api/users/:id` | **session** | **—** | `:id` = UUID **ou** pseudo | `401 AUTH_REQUIRED` (`:333`), `404 USER_NOT_FOUND` (`:341`) |
| 7 | GET | `/api/leaderboard` | public | `default` | `?limit=&offset=` | — (`:349-359`) |
| 8 | GET | `/api/stats` | public | `default` | — | — (`:361-369`) |
| 9 | GET | `/api/matches` | public | `default` | `?limit=&offset=` | — (`:371-392`) |
| 10 | GET | `/api/tournaments` | public | `default` | `?limit=&offset=` | — (`:394-411`) |
| 11 | GET | `/api/users/search` | **session** | `social` | `?q=&limit=` (plafond **50**) | `401 AUTH_REQUIRED` (`:415`), `500 SEARCH_ERROR` (`:433`) |

**Réponses de référence :**

- `GET /api/health` → `{ ok, service:'zoyd-api', persistence:{ …health, reloadInProgress }, timestamp }`.
  Le bloc `persistence` contient notamment `stateTrusted`, `integrity.ok`,
  `loginLockoutPersisted`, `sanctionsPersisted`, `deployedCommitShort`,
  `deployedBranch`, `pendingSettlementDebts` (`server/persistence.mjs:990-1038`).
  → voir `07-exploitation.md` §5 (runbook).
- `GET /api/leaderboard` → `{ ok, players, total, hasMore }`.
- `GET /api/matches` → `{ ok, matches, total, hasMore }`, chaque match passé par
  `sanitizeMatchForBroadcast(match, viewerId)` (`server/routes/public.mjs:383-386`) :
  **jamais de `userId`, jamais de `roomPassword`/`roomName`/`screenshots`**
  (`server/state-helpers.mjs:125-162`).
- `GET /api/tournaments` → `{ ok, tournaments, total, hasMore }`, sanitisés avec
  `isMe` calculé par `getAuthenticatedAppSession(req)?.userId`
  (`server/routes/public.mjs:403`).
- `GET /api/users/search` → `{ ok, users:[{ id, pseudo, avatar, country, trustScore, controllerType, isOnline }], total, hasMore }`
  (`server/routes/public.mjs:423-431`).

**Pièges :**

- Les deux proxies CODM exigent une session **alors qu'ils ne contiennent aucun
  secret**. Raison documentée : sans garde, le serveur devenait « un proxy
  Codashop gratuit pour tout Internet, sur le quota du forfait Render gratuit »
  (`server/routes/public.mjs:86-89`).
- `/api/codm/store` renvoie le catalogue **en INR** — l'API Codashop n'expose pas
  de devise locale, et le checkout Codashop facture dans la devise du pays du
  joueur (`server/routes/public.mjs:100-108`, `:178-182`). Le champ
  `priceIsLocal:false` le signale.
- `/api/users/:id` n'a **aucun rate limit** (`server/routes/public.mjs:330-347`).
- Le motif `/^\/api\/users\/([^/]+)$/` matche aussi `/api/users/search` : une
  garde explicite `pathname !== '/api/users/search'` le neutralise
  (`server/routes/public.mjs:331`). C'est le **seul** chevauchement connu
  (`server/realtime-server.mjs:250-260`).

### 5.2 Auth — `server/routes/auth.mjs` (12 routes)

**Ce sont les routes d'authentification. Le taux de 400 y est le plus élevé de
toute l'API.** Elles sont exhaustivement documentées ici.

| # | Méthode | Chemin | Rate limit | Corps attendu | Erreurs pertinentes |
|---|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | `auth` | 15 champs max (voir §5.2.1) | `400 INVALID_EMAIL` (`:60`), `400 WEAK_PASSWORD`, `400 LEGAL_NOT_ACCEPTED`, `409 DUPLICATE_PSEUDO/EMAIL/PHONE/GAME_ID` |
| 2 | POST | `/api/auth/login` | `auth` | `{ identifier, password }` | `401 INVALID_CREDENTIALS`, `403 ACCOUNT_SANCTIONED` (`:121`), `423 ACCOUNT_LOCKED` |
| 3 | POST | `/api/auth/activate` | `auth` | `{ email, code }` | `400 MISSING_FIELDS` (`:166`), `400 ACTIVATION_FAILED` (`:173`) |
| 4 | POST | `/api/auth/resend-code` | `auth` | `{ email }` | `400 MISSING_FIELDS` (`:196`) |
| 5 | POST | `/api/auth/activation-email` | `auth` | `{ oldEmail, newEmail }` | `400 MISSING_FIELDS` (`:225`) |
| 6 | POST | `/api/auth/forgot-password` | `auth` | `{ identifier }` | `400 MISSING_FIELDS` (`:252`) — **réponse identique** que le compte existe ou non |
| 7 | POST | `/api/auth/reset-password` | `auth` | `{ identifier, code, newPassword }` | `400 MISSING_FIELDS` (`:299`), `400 RESET_FAILED`, `400 WEAK_PASSWORD` |
| 8 | GET | `/api/auth/me` | **—** | — | `401 AUTH_REQUIRED` (`:316`) |
| 9 | PATCH | `/api/auth/me` | `auth` | 13 champs max (voir §5.2.2) | `401 AUTH_REQUIRED` (`:331`), `400 INVALID_ENUM` (`:355,359,363`), `400 INVALID_PHONE` (`:381`), `400 PSEUDO_REQUIRED` (`:397`), `400 INVALID_EMAIL` (`:415`), `409 DUPLICATE_EMAIL` (`:419`), `403 PASSWORD_CONFIRMATION_REQUIRED` (`:429`) |
| 10 | POST | `/api/auth/logout` | `auth_logout` | — | **jamais d'erreur** : répond `200` même sans session (`:492`) |
| 11 | POST | `/api/auth/change-password` | `auth` | `{ currentPassword, newPassword }` | `401 AUTH_REQUIRED` (`:502`), `400 MISSING_FIELDS` (`:509`), `400 WEAK_PASSWORD`, `404 USER_NOT_FOUND` (`:520`), `403 WRONG_PASSWORD` (`:524`) |
| 12 | DELETE | `/api/auth/me` | `auth` | `{ confirmForfeit: true }` | `401 AUTH_REQUIRED` (`:545`), `400 CONFIRM_REQUIRED` (`:551`) |

#### 5.2.1 `POST /api/auth/register`

Whitelist **stricte** de 15 champs (`server/routes/auth.mjs:65-70`) :
`pseudo`, `email`, `phone`, `password`, `gameId`, `controllerType`, `device`,
`levelCODM`, `rankMJ`, `rankBR`, `country`, `streamerMode`, `streamerPseudo`,
`acceptAdult`, `acceptTerms`, `acceptedAt`.

> Sans cette whitelist, un `POST {id, wallet, trustScore, stats}` écrasait un
> compte en RAM + base **et créditait un solde arbitraire**
> (`server/routes/auth.mjs:63-64`).

`pseudo`, `bio`, `streamerPseudo` passent par `sanitizeText`
(`server/routes/auth.mjs:75-77`).

**Réponse** : `201` + cookie `zoyd_auth` 6 h + `{ ok, user, expiresAt, message }`.
Le champ `token` n'est renvoyé **que si `ALLOW_DEBUG_CODES=true`**
(`server/routes/auth.mjs:89`).

> **V1 (décision 2026-09-18)** : le compte est **directement actif**, session
> immédiate, sans code d'activation (`server/routes/auth.mjs:79-80`). Les routes
> `activate` / `resend-code` / `activation-email` existent mais sont hors du
> parcours nominal.

#### 5.2.2 `PATCH /api/auth/me`

Whitelist **stricte** de 13 champs (`server/routes/auth.mjs:339-343`) :
`pseudo`, `avatar`, `bio`, `device`, `controllerType`, `country`, `streamerMode`,
`streamerPseudo`, `notifications`, `phone`, `levelCODM`, `rankMJ`, `rankBR`.

| Champ | Contrainte | Ligne |
|---|---|---|
| `controllerType` | `touch\|controller\|emulator\|pc\|other` | `:347` |
| `device` | `phone\|tablet\|pc\|other` | `:348` |
| `rankMJ`, `rankBR` | `Bronze\|Silver\|Gold\|Platinum\|Diamond\|Master\|Legendary\|Rookie` | `:350` |
| `levelCODM` | nombre fini, 1–150 | `:362` |
| `phone` | format d'un pays supporté, sinon `400 INVALID_PHONE` | `:378-385` |
| `bio` | **tronqué à 500 caractères** | `:386-388` |
| `pseudo` | **tronqué à 30 caractères**, ne peut pas être vide | `:389-399` |

**Changement d'email** : traité à part, car c'est l'identifiant du compte. Il
exige `currentPassword` ; sinon `403 PASSWORD_CONFIRMATION_REQUIRED`
(`server/routes/auth.mjs:404-433`).

Un changement de `pseudo` déclenche `refreshLiveMatchIdentities(io, …)` pour que
l'arbitre voie le nouveau nom sans attendre le prochain mouvement de match
(`server/routes/auth.mjs:443-452`). Un échec de diffusion est **journalisé mais
ne fait pas échouer la requête** (`:446-451`).

> **Piège historique.** `phone` n'est validé par **aucune** validation dans
> `STRING_FIELDS` : `normalizePhoneKey` ne garde que les chiffres, et la clé
> d'unicité `phone_key` en base n'est pas `NULL`. Un joueur pouvait poser
> `phone: ""` et occuper la clé **vide** de l'index ; le joueur suivant violait
> `phone_key UNIQUE`, ce qui faisait échouer son écriture et le renvoyait en
> 503 — donc un joueur pouvait casser la mise à jour de profil de tous les
> autres. Corrigé par `isAnySupportedPhone` (`server/routes/auth.mjs:366-385`).

#### 5.2.3 `POST /api/auth/forgot-password` — anti-énumération

La réponse est **identique** que le compte existe ou non : `{ ok:true, found:true, message }`
(`server/routes/auth.mjs:278-284`). Le champ `found` est conservé pour
compatibilité mais vaut **toujours `true`**.

> « La reponse disait `found: false` ET un message different […] C etait un
> oracle d enumeration gratuit : il suffisait de soumettre un email pour savoir
> s il etait inscrit. » — `server/routes/auth.mjs:264-277`

Le code de réinitialisation n'est retourné que si `ALLOW_DEBUG_CODES` **et**
compte existant (`server/routes/auth.mjs:283`).

#### 5.2.4 `POST /api/auth/logout`

- Rate limit **groupe dédié `auth_logout`** (60/1 min), pas `auth`
  (`server/routes/auth.mjs:475`).
- Le rate limit est posé **avant** toute lecture de token, et le token est
  **facultatif** : la route répond `200` quand même (`server/routes/auth.mjs:461-475`,
  `:492`).
- `getAuthSession(token, { skipRotation:true })` — sans quoi la rotation
  fire-and-forget insérait le nouveau token en mémoire **avant** que la route ne
  supprime l'ancien, laissant une session valide de 6 h après le logout
  (`server/routes/auth.mjs:477-481`).
- Supprime aussi les sessions realtime du compte (`deleteRealtimeSessionsForUser`).
- Vide le cookie (`Set-Cookie: zoyd_auth=; Max-Age=0`).

> **Pourquoi un groupe dédié.** Sur le groupe `auth` (50/15 min), n'importe qui
> pouvait verrouiller la connexion de **tous** les utilisateurs d'une IP
> partagée (CGNAT mobile, IP d'entreprise) pendant 15 minutes — un déni de
> connexion de masse, gratuit. (`server/routes/auth.mjs:460-474`)

### 5.3 Social — `server/routes/social.mjs` (12 routes)

| # | Méthode | Chemin | Rôle | Rate limit | Corps attendu | Erreurs pertinentes |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/social/friends` | session | **—** | `?limit=&offset=` | `401 AUTH_REQUIRED` (`:39`) |
| 2 | GET | `/api/social/pending` | session | **—** | `?limit=&offset=` | `401 AUTH_REQUIRED` (`:53`) |
| 3 | POST | `/api/social/request` | session | `social` | `{ targetId, message? }` | `409 ALREADY_FRIENDS`, `409 REQUEST_PENDING` |
| 4 | POST | `/api/social/accept` | session | `social` | `{ requestId }` | `404` si requête inconnue |
| 5 | POST | `/api/social/decline` | session | `social` | `{ requestId }` | — |
| 6 | DELETE | `/api/social/friends/:id` | session | `social` | — | — |
| 7 | POST | `/api/social/block` | session | `social` | `{ targetId }` | `409 SELF_BLOCK` |
| 8 | POST | `/api/social/unblock` | session | `social` | `{ targetId }` | — |
| 9 | POST | `/api/social/report` | session | `social` | `{ targetId, reason, description? }` | `400 MISSING_FIELDS` (`:186`), **`503 SERVER_BUSY`** si l'écriture est refusée (`:230-237`), sinon `201` |
| 10 | POST | `/api/notifications/read` | session | `default` | `{ notificationId }` | — |
| 11 | POST | `/api/notifications/read-all` | session | `default` | — | — |
| 12 | GET | `/api/notifications` | session | **—** | — | `401 AUTH_REQUIRED` (`:274`) |

Toutes les mutations passent par `withUserMutex(session.user.id, …)`.

> **`POST /api/social/report` : écriture `await`ée, pas `sbFire`.** En
> best-effort la route répondait `201` **avant** que l'écriture aboutisse : si
> la table manquait ou la base était indisponible, le joueur lisait « Signalement
> envoyé » et le signalement disparaissait. Un signalement perdu, c'est un joueur
> qui continue à harceler en croyant avoir été écouté.
> (`server/routes/social.mjs:199-209`)

### 5.4 Wallet — `server/routes/wallet.mjs` (5 routes)

| # | Méthode | Chemin | Rôle | Rate limit | Corps attendu | Erreurs pertinentes |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/wallet/history` | session | `default` | `?limit=` (plafond **200**) | `401 AUTH_REQUIRED` (`:59`) |
| 2 | GET | `/api/wallet/me` | session | `default` | — | `401 AUTH_REQUIRED` (`:75`) |
| 3 | POST | `/api/wallet/deposit` | **admin2fa** | `wallet` | `{ userId, amount, method? }` | `400 INVALID_JSON` (`:115`,`:123`), `400 INVALID_AMOUNT` (`:119`) |
| 4 | POST | `/api/wallet/withdraw` | session | `wallet` | voir §5.4.1 | voir §5.4.1 |
| 5 | POST | `/api/wallet/verify-fedapay` | session | `wallet` | `{ transactionId }` (numérique) | `400 INVALID_TRANSACTION_ID` (`:401`), `409 TRANSACTION_ALREADY_PROCESSED`, `409 TRANSACTION_IN_PROGRESS`, `400 PAYMENT_NOT_CONFIGURED` |

`GET /api/wallet/me` renvoie **aussi la politique de retrait publiée par le
serveur** (`server/routes/wallet.mjs:86-96`) : `{ feeRate, minAmount, dailyLimit,
dailyWindowHours: 24, remainingToday }`. Le front ne doit plus coder `0.02` en dur.

`POST /api/wallet/deposit` est un **crédit manuel d'administration** : en
production, les dépôts passent par `POST /api/wallet/verify-fedapay`
(`server/routes/wallet.mjs:105`).

#### 5.4.1 `POST /api/wallet/withdraw` — la route la plus sensible

Garde, dans l'**ordre exact** (`server/routes/wallet.mjs:138-181`) :

| # | Vérification | Ligne | Erreur |
|---|---|---|---|
| 1 | Session | `:138-142` | `401 AUTH_REQUIRED` |
| 2 | Rate limit `wallet` | `:143` | `429 RATE_LIMITED` |
| 3 | Parse du corps | `:145-150` | `400 INVALID_JSON` |
| 4 | `MIN_WITHDRAWAL_ZC ≤ amount ≤ 100 000` | `:152-155` | `400 INVALID_AMOUNT` |
| 5 | Pays : `body.country`, sinon profil, sinon `'bj'` ; non supporté → refus | `:156-164` | `400 INVALID_COUNTRY` |
| 6 | Opérateur présent dans `countryCfg.operators` | `:165-168` | `400 INVALID_OPERATOR` |
| 7 | `parsePhoneForFedaPay` | `:169-173` | `400 INVALID_PHONE` |
| 8 | **Clé d'idempotence obligatoire** (`body.idempotencyKey` ou en-tête `x-idempotency-key`) | `:174-181` | `400 IDEMPOTENCY_KEY_REQUIRED` |

Déroulement en 4 phases :

| Phase | Contenu | Ligne |
|---|---|---|
| **1 — débit** | sous `withWalletMutex` ; relecture de l'historique **à l'intérieur** du verrou (anti-TOCTOU) ; 3 cas : payout **confirmé** → `200 { duplicate:true }` ; payout **ambigu** → **`409 PAYOUT_PENDING_REVIEW`** ; clé **nouvelle** → débit + `trackWithdrawalKey` | `:202-244` |
| **2 — payout** | appel FedaPay **hors mutex** | `:266-278` |
| **3 — échec** | `payoutMaybeSent === true` → **aucun remboursement**, marquage `pending_review` (réconciliation manuelle) ; sinon remboursement sous mutex (`type:'refund'`) + `payoutStatus:'failed'` | `:279-365` |
| **4 — tag** | `payoutId` best-effort, puis `200 { ok, wallet, user, payoutId, …buildWithdrawalAmounts(amount) }` | `:367-382` |

> **Idempotence obligatoire.** Sans clé, un double-clic ou un retry réseau
> débitait deux fois et déclenchait deux payouts FedaPay.
> (`server/routes/wallet.mjs:174-175`)

> **Ne jamais rembourser sur un échec incertain.** `sendNow` peut avoir été
> traité par FedaPay alors que la réponse s'est perdue. Rembourser dans ce cas
> donnait au joueur son remboursement **et** son virement — un gain net sur la
> plateforme. Le moteur remonte `payoutMaybeSent` ; on ne rembourse que sur une
> certitude d'absence d'envoi. (`server/routes/wallet.mjs:280-289`)

**Montants retournés** : `buildWithdrawalAmounts(amount)` (`server/routes/wallet.mjs:260`, `:381`)
donne au client les montants **autoritaires** — le client ne doit plus refaire
le calcul de la commission, sinon le « net » affiché peut différer du verse.

#### 5.4.2 `POST /api/wallet/verify-fedapay`

- `transactionId` accepte `number` ou `string`, mais doit matcher `^\d{1,20}$`
  (`server/routes/wallet.mjs:396-403`).
- Le crédit se fait sous `withWalletMutex` (`server/routes/wallet.mjs:394`).
- Le code métier est **préservé** : `respondMappedError` est appelé si
  `error.code` existe, sinon repli en `400 PAYMENT_FAILED`
  (`server/routes/wallet.mjs:433-442`).
- Une notification de dépôt est envoyée ; son échec **ne fait jamais échouer le
  crédit** (`server/routes/wallet.mjs:421-425`).

### 5.5 Tournois — `server/routes/tournament.mjs` (9 routes)

> Le détail des moteurs est dans `docs/01-architecture.md:993-1017` et
> `docs/02-modele-metier.md`. Colonnes *rôle* et *rate limit* ci-dessous sont
> vérifiées dans le code.

| # | Méthode | Chemin | Rôle | Rate limit | Erreurs pertinentes |
|---|---|---|---|---|---|
| 1 | GET | `/api/tournaments/:id` | public | `default` | `404 TOURNAMENT_NOT_FOUND` (`:41`) |
| 2 | POST | `/api/tournaments` | session | `default` | `400 INVALID_TOURNAMENT_NAME` (`:65`), `400 INVALID_FORMAT` (`:69`), `400 INVALID_MAX_ENTRIES` (`:73`), `400 INVALID_ENTRY_FEE` (`:77`) |
| 3 | POST | `/api/tournaments/:id/register` | session | `default` | `409 ALREADY_JOINED`, `409 REGISTRATION_CLOSED`, `409 INSUFFICIENT_FUNDS` |
| 4 | POST | `/api/tournaments/:id/leave` | session | `default` | `409 NOT_JOINED` |
| 5 | POST | `/api/tournaments/:id/arbiter` | session | **—** | `409 ARBITER_TAKEN` |
| 6 | POST | `/api/tournaments/:id/start` | session | **—** | `400 NOT_ENOUGH_PLAYERS` |
| 7 | POST | `/api/tournaments/:id/matches/:mid/room` | session | **—** | `400 ROOM_INCOMPLETE`, `400 ROOM_TOO_EARLY` |
| 8 | POST | `/api/tournaments/:id/matches/:mid/live` | session | **—** | `400 MATCH_NOT_READY` |
| 9 | POST | `/api/tournaments/:id/matches/:mid/result` | session | `default` | `400 INVALID_RESULTS`, `400 INVALID_ARBITER` |

Toutes les mutations passent par `withTournamentMutex` puis `saveTournaments(io, …)`
(diffusion socket `state:tournaments`).

`entryFee` est **arrondi à 2 décimales avant tout calcul de pot**
(`server/routes/tournament.mjs:80-90`) : le pot est un produit, l'argent bloqué
est une somme d'arrondis ; au-delà de 2 décimales, le règlement crée ou détruit
de la monnaie.

### 5.6 Ligues — `server/routes/league.mjs` (15 routes)

| # | Méthode | Chemin | Rôle | Rate limit | Erreurs pertinentes |
|---|---|---|---|---|---|
| 1 | GET | `/api/leagues` | **session** | `default` | `401 AUTH_REQUIRED` (`:47`) |
| 2 | GET | `/api/leagues/:id` | **session** | `default` | `401 AUTH_REQUIRED` (`:74`), `404 LEAGUE_NOT_FOUND` (`:82`) |
| 3 | POST | `/api/leagues` | session | **—** | `400 INVALID_LEAGUE_NAME` (`:105`), `400 INVALID_FORMAT` (`:113`), `400 INVALID_TEAM_SIZE` (`:117`) |
| 4 | POST | `/api/leagues/:id/join` | session | **—** | `409 ALREADY_JOINED`, `409 INSUFFICIENT_FUNDS` |
| 5 | POST | `/api/leagues/:id/leave` | session | **—** | `409 NOT_JOINED` |
| 6 | POST | `/api/leagues/:id/start-qualification` | session | **—** | `400 QUALIFICATION_INCOMPLETE` |
| 7 | POST | `/api/leagues/:id/days/:dayId/start` | session | **—** | `400 NOT_ENOUGH_PLAYERS` |
| 8 | POST | `/api/leagues/:id/days/:dayId/results` | session | **—** | `400 INVALID_RESULTS` |
| 9 | POST | `/api/leagues/:id/advance-to-final` | session | **—** | `400 INVALID_MATCH` |
| 10 | POST | `/api/leagues/:id/final-results` | session | **—** | `400 INVALID_RESULTS` |
| 11 | GET | `/api/leagues/:id/leaderboard` | **public** | `default` | — (`:299-309`) |
| 12 | PATCH | `/api/leagues/:id` | session | **—** | `400 INVALID_FORMAT`, `400 INVALID_TEAM_SIZE` |
| 13 | POST | `/api/leagues/:id/reassign` | session | **—** | `404` si joueur absent |
| 14 | POST | `/api/leagues/:id/refund/:userId` | **admin2fa** | **—** | `403 ADMIN_REQUIRED` / `403 2FA_REQUIRED` |
| 15 | GET | `/api/leagues/:id/payments` | **admin2fa** | `admin` | `403 …`, `404 LEAGUE_NOT_FOUND` |

> `GET /api/leagues` et `GET /api/leagues/:id` exigent une session **et**
> retirent les `playerId` des membres (`server/routes/league.mjs:46-61`,
> `:55-60`). Raison : la saison était renvoyée en clair, avec le `userId` de
> chaque inscrit — une carte sociale des adversaires livrée à tout Internet.

> `POST /api/leagues/:id/refund/:userId` **déplace de l'argent**. Elle exige la
> 2FA, comme la lecture des paiements ; elle n'exigeait que le rôle admin, ce
> qui suffisait à vider les portefeuilles avec un compte admin compromis.
> (`server/routes/league.mjs:356-359`)

> `POST /api/leagues/:id/join` **compense le verrou orphelin** : si `saveLeagues`
> échoue après le blocage du pass, le pass est remboursé sous
> `withWalletMutex` avant de propager l'erreur
> (`server/routes/league.mjs:140-162`). Sans cela, les ZC restaient bloqués
> chez un joueur absent de la liste persistée, définitivement.

### 5.7 Battle Royale — `server/routes/br.mjs` (6 entrées, 11 verbes)

| # | Méthode | Chemin | Rôle | Rate limit | Erreurs pertinentes |
|---|---|---|---|---|---|
| 1 | GET | `/api/br/config` | public | **—** | — (`:45-58`) |
| 2 | GET | `/api/br/lobbies` | public | `default` | — (`:60-72`) |
| 3 | POST | `/api/br/lobbies` | session | **`match` → repli `default`** | `400 INVALID_MODE`, `400 INVALID_MAP`, `400 INVALID_RANKING_MODE` (`:74-105`) |
| 4 | POST | `/api/br/lobbies/:id/{join\|leave\|checkin\|start\|eliminate\|finish}` | session | `admin` pour `finish`, `default` sinon | `400 INVALID_JSON` (`:157`) si `eliminate` sans `userId` ; `403 ADMIN_REQUIRED`/`2FA_REQUIRED` sur `finish` (`:172`) |
| 5 | GET | `/api/br/lobbies/:id` | public | `default` | `404 LOBBY_NOT_FOUND` (`:223`) |
| 6 | GET | `/api/br/lobbies/:id/arbiter` | **arbiter** | `default` | `404 LOBBY_NOT_FOUND` (`:260`), **`403 ARBITER_REQUIRED`** (`:269`) |

**Le créateur d'un salon en devient l'**arbitre**, pas un joueur** : il ne paie
aucun pass et ne figure pas dans le roster (`server/routes/br.mjs:88-93`).

`GET /api/br/lobbies/:id/arbiter` est **la seule vue qui rend les `userId`**
(`server/routes/br.mjs:242-249`). Le roster public les masque
(`server/state-helpers.mjs:260-276`).

Toutes les actions de salon sont sérialisées par `withBrLobbyMutex(lobbyId)`, et le
snapshot est **relu à l'intérieur** du verrou (`server/routes/br.mjs:126-139`).

> **`finish` exige `requireAdmin2fa` EN PLUS de l'autorité d'arbitre**
> (`server/routes/br.mjs:168-173`). L'arbitre du salon ne dispense pas de la 2FA.

#### 5.7.1 Le piège `ARBITER_REQUIRED`

Le même code est émis avec **deux statuts différents** :

| Contexte | Statut | Source |
|---|---|---|
| `GET /api/br/lobbies/:id/arbiter`, lecteur non autorisé | **403** | `server/routes/br.mjs:268-273` |
| Table de mapping `mapPersistenceError` | **409** | `server/http-utils.mjs:429-431` |

Un client qui traite `ARBITER_REQUIRED` comme « à réessayer plus tard » (409)
prendra une mauvaise décision sur le 403. **Tester le statut HTTP, pas seulement
le code.**

### 5.8 Matchs 1v1–5v5 — `server/routes/match.mjs` (13 routes)

**Toutes exigent une session** (401 `AUTH_REQUIRED`).

| # | Méthode | Chemin | Rate limit | Corps attendu | Erreurs pertinentes |
|---|---|---|---|---|---|
| 1 | POST | `/api/matches` | `social` | `{ format:'1VS1'…'5VS5', entryFee?, tournamentId?, … }` | `400 INVALID_JSON` (`:52`), `400 INVALID_FORMAT` (`:59`), `400 INVALID_ENTRY_FEE` (`:63`) |
| 2 | POST | `/api/matches/:id/join` | `social` | `{ team? }` | `409 ALREADY_JOINED`, `409 INSUFFICIENT_FUNDS`, `409 MATCH_CLOSED` |
| 3 | POST | `/api/matches/:id/arbiter` | `social` | — | `409 ARBITER_TAKEN` |
| 4 | POST | `/api/matches/:id/check-in` | `social` | — | `400 CHECKIN_REQUIRED` |
| 5 | POST | `/api/matches/:id/ready` | `social` | — | `409 MATCH_NOT_LIVE` |
| 6 | POST | `/api/matches/:id/schedule` | **—** | `{ scheduledAt }` | `400 INVALID_DATE` |
| 7 | POST | `/api/matches/:id/room` | **—** | `{ roomName, roomPassword }` | `400 ROOM_INCOMPLETE`, `400 ROOM_TOO_EARLY` |
| 8 | POST | `/api/matches/:id/launch` | **—** | — | `400 MATCH_NOT_READY` |
| 9 | POST | `/api/matches/:id/result` | **—** | `{ winnerTeam, scores, proofs, screenshots, resolutionType, arbiterNotes }` | `400 MATCH_SEGMENT_MISMATCH`, `400 INVALID_RESULTS` |
| 10 | POST | `/api/matches/:id/confirm` | **—** | — | `409 ALREADY_CONFIRMED`, `409 RESULT_ALREADY_EXISTS` |
| 11 | POST | `/api/matches/:id/disputes` | **—** | corps libre | `400 DISPUTE_INCOMPLETE`, `409 DISPUTE_ALREADY_OPEN` |
| 12 | POST | `/api/matches/:id/dispute/evidence` | **—** | `{ evidence }` | `400 PROOFS_REQUIRED` |
| 13 | POST | `/api/matches/:id/dispute/escalate` | **—** | — | `409 DISPUTE_ALREADY_ESCALATED` |

`POST /api/matches/:id/result` **persiste le résultat mais ne verse pas** : le
match passe en `awaiting_confirmation`, les deux équipes doivent confirmer (ou
la fenêtre de 30 min expire via cron) avant que la cagnotte parte. Réponse :
`200 { …payload, awaitingConfirmation:true, confirmationDeadline }`
(`server/routes/match.mjs:261-283`). Whitelist stricte de 7 champs, anti
mass-assignment sur `match.result` (`server/routes/match.mjs:266-276`).

Le parsing du corps est **hors** du verrou global (`server/routes/match.mjs:42`) :
« le mutex global ne doit couvrir que la mutation ».

### 5.9 Administration — `server/routes/admin.mjs` (14 routes)

**Règle de groupe :** toutes les routes admin appliquent `rateLimitGuard(…, 'admin')`
**avant** `requireAdmin2fa` — l'ordre est systématique dans tout le fichier
(`server/routes/admin.mjs:114-116`, `:133-135`, …).

| # | Méthode | Chemin | Garde | Erreurs pertinentes |
|---|---|---|---|---|
| 1 | POST | `/api/admin/reload` | admin2fa | `500 RELOAD_ERROR` (`:124`) |
| 2 | GET | `/api/admin/commissions` | admin2fa | `500 COMMISSIONS_ERROR` (`:140`) |
| 3 | GET | `/api/admin/reports` | admin2fa | `503 SERVER_BUSY` (`:174`), `500 REPORTS_ERROR` (`:194`) |
| 4 | POST | `/api/admin/reports/:id/resolve` | admin2fa | `400 INVALID_RESOLUTION` (`:219`), `409 ALREADY_REVIEWED`, `404 REPORT_NOT_FOUND` (`:237`) |
| 5 | GET | `/api/admin/sanctions` | admin2fa | `500 SANCTIONS_ERROR` (`:298`) |
| 6 | POST | `/api/admin/sanctions/:id/revoke` | admin2fa | `404 SANCTION_NOT_FOUND` (`:320`), `500 REVOKE_ERROR` (`:329`) |
| 7 | GET | `/api/admin/matches/export` | admin2fa | `503 SERVER_BUSY` (`:358`, `:368`), `500 EXPORT_ERROR` (`:400`) |
| 8 | GET | `/api/admin/2fa/status` | **admin** (sans 2FA) | — |
| 9 | POST | `/api/admin/2fa/setup` | **admin** | `403 INVALID_PASSWORD` (`:441`), `409 2FA_ALREADY_ENABLED` (`:454`) |
| 10 | POST | `/api/admin/2fa/enable` | **admin** | `400 MFA_REQUIRED` (`:481`), `400 MFA_ALREADY_ACTIVE` (`:490`), `400 MFA_INVALID` (`:495`) |
| 11 | POST | `/api/admin/2fa/verify` | **admin** | `400 MFA_REQUIRED` (`:521`), `400 MFA_NOT_ACTIVE` (`:526`), `400 MFA_INVALID` (`:531`) |
| 12 | POST | `/api/admin/matches/:id/award` | admin2fa | `400 INVALID_WINNER` (`:550`) |
| 13 | POST | `/api/admin/matches/:id/resolve-dispute` | admin2fa | `400` si `action` invalide |
| 14 | POST | `/api/admin/matches/:id/cancel` | admin2fa | — |

`GET /api/admin/matches/export` renvoie du **CSV par défaut** (avec BOM UTF-8) ou
du JSON si `?format=json` (`server/routes/admin.mjs:345-397`). Ce sont les deux
seules réponses non-JSON de l'API, avec `/metrics`.

`GET /api/admin/reports` renvoie un champ `degraded` explicite
(`server/routes/admin.mjs:190`) : il distingue « table absente » de « file vide ».

`POST /api/admin/matches/:id/award` est un règlement **en deux phases** :
`deferSettlement: true` + `saveMatches`, puis `settlePendingMatchResult` +
`saveMatches` (`server/routes/admin.mjs:565-579`).

`POST /api/admin/2fa/setup` exige le **mot de passe admin** (`403 INVALID_PASSWORD`).
Sans cette exigence, un attaquant disposant du seul mot de passe admin
s'auto-enrôlait un code TOTP valide — accès financier complet
(`server/routes/admin.mjs:421-446`).

### 5.10 Chat — `server/routes/chat.mjs` (5 routes)

| # | Méthode | Chemin | Rôle | Rate limit | Corps attendu | Erreurs pertinentes |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/chat/bootstrap` | session | `chat` | — | `401 AUTH_REQUIRED` (`:35`) |
| 2 | GET | `/api/chat/channels/:id` | session | **—** | — | `404 CHANNEL_NOT_FOUND` (`:57`) |
| 3 | POST | `/api/chat/channels` | session | `chat` | `{ type, name?, participants? }` | `400 INVALID_ENUM` (`:89`) |
| 4 | POST | `/api/chat/channels/:id/messages` | session | `chat` | `{ text, replyTo? }` | `404 CHANNEL_NOT_FOUND` (`:134`), `400 EMPTY_MESSAGE` (`:140`) |
| 5 | POST | `/api/chat/channels/:id/read` | session | `chat` | — | `404 CHANNEL_NOT_FOUND` (`:182`), `500 READ_ERROR` (`:192`) |

`GET /api/chat/bootstrap` renvoie 50 canaux (non-lus d'abord, puis `updatedAt`
décroissant) et les messages des 10 canaux les plus actifs
(`server/chat-helpers.mjs:62-83`).

`GET /api/chat/channels/:id` renvoie **150 messages** (`server/routes/chat.mjs:68`).

Le texte est `sanitizeText(...)` puis **tronqué à 2000 caractères**
(`server/routes/chat.mjs:138`).

> **Un canal inaccessible renvoie 404, pas 403** — anti-énumération délibérée
> (`server/routes/chat.mjs:56-59`, `:133-135`, `:181-184`).

### 5.11 Temps réel — `server/routes/realtime.mjs` (6 routes)

| # | Méthode | Chemin | Rôle | Rate limit | Corps attendu | Erreurs pertinentes |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/realtime/auth/session` | **session app** | `auth` | — | `401 AUTH_REQUIRED` (`:32`), `500 SESSION_ERROR` (`:44`) |
| 2 | GET | `/api/realtime/push/public-key` | public | **—** | — | `503 PUSH_NOT_CONFIGURED` (`:51`) |
| 3 | GET | `/api/realtime/state/bootstrap` | **realtime** | **—** | — | `401 AUTH_REQUIRED` (`:61`) |
| 4 | POST | `/api/realtime/push/subscribe` | **realtime** | **—** | `{ subscription: { endpoint, … } }` | `400 MISSING_FIELDS` (`:114`), `500 SUBSCRIPTION_ERROR` (`:121`) |
| 5 | POST | `/api/realtime/push/unsubscribe` | **realtime** | **—** | `{ endpoint }` | `400 MISSING_FIELDS` (`:138`), `500 SUBSCRIPTION_ERROR` (`:145`) |
| 6 | POST | `/api/realtime/push/test` | **realtime** | **—** | `{ title?, body?, url?, tag? }` | `500 PUSH_ERROR` (`:172`) |

**Les routes 3→6 exigent un token realtime en `Authorization: Bearer`**, pas le
cookie `zoyd_auth` (`server/http-utils.mjs:260-270`). Le client l'obtient via
`buildAuthHeaders()` (`src/app/lib/realtimeClient.ts:266-271`), qui appelle
`POST /api/realtime/auth/session`.

`GET /api/realtime/state/bootstrap` renvoie 100 derniers matchs, 50 derniers
tournois, amis, demandes, bloqués et notifications non lues
(`server/routes/realtime.mjs:66-81`).

> `POST /api/realtime/state/sync` a été **supprimé** : elle ne pouvait rien
> accepter (409 sur les tournois, 400 sinon) et son appelant client n'était
> appelé par personne. La synchronisation passe par les routes API dédiées ; le
> socket ne transporte que des deltas. (`server/routes/realtime.mjs:88-100`)

### 5.12 Quotas de limitation de débit

`RATE_LIMIT_CONFIG` (`server/rate-limiter.mjs:11-22`). Clé de bucket :
`` `${ip}|${group}` `` (`server/rate-limiter.mjs:75`) — les quotas sont
indépendants par groupe pour une même IP.

| Groupe | `max` | Fenêtre | Périmètre |
|---|---|---|---|
| `auth` | **50** | 15 min | login, register, reset, activate, resend, activation-email, PATCH me, change-password, DELETE me, realtime/auth/session |
| `auth_logout` | **60** | 1 min | logout seul |
| `social` | **30** | 1 min | amis, blocages, signalements, recherche, création de match |
| `wallet` | **20** | 10 min | dépôts, retraits, vérification FedaPay |
| `chat` | **60** | 1 min | chat HTTP **et** événements socket de présence/typing |
| `admin` | **20** | 5 min | routes admin + `finish` BR + paiements de ligue |
| `default` | **60** | 1 min | repli |

**Le seuil est inclusif** : `allowed = record.attempts <= config.max`
(`server/rate-limiter.mjs:88`) ⇒ la N-ième requête passe, la N+1 est refusée.

**Réponse 429** : en-tête `Retry-After: <secondes>` +
`{ ok:false, error:'Trop de requetes. Reessayez plus tard.', code:'RATE_LIMITED' }`
(`server/rate-limiter.mjs:205-213`).

**Résolution de l'IP** (`server/rate-limiter.mjs:180-195`) : `X-Forwarded-For` n'est
lu que si le pair TCP est un proxy de confiance (`isTrustedProxyPeer`,
`:151-161`), et on prend la **dernière** valeur du XFF — la première est
contrôlable par l'appelant. **Derrière le LB Render, il faut `TRUST_PROXY=true`**
(`render.yaml:30-31`) : sinon tous les utilisateurs partagent un seul bucket.

> **Groupe `'match'` — piège.** `POST /api/br/lobbies` utilise le groupe
> `'match'` (`server/routes/br.mjs:80`), **absent de `RATE_LIMIT_CONFIG`**. Le
> repli silencieux `RATE_LIMIT_CONFIG[group] || RATE_LIMIT_CONFIG.default`
> (`server/rate-limiter.mjs:74`) applique donc **60/min** au lieu du quota prévu.
> Aucun log, aucune erreur.

---

## 6. Métriques

`GET /metrics` (`server/routes/public.mjs:306-328`) — **ce n'est pas du JSON**.

| Aspect | Valeur | Source |
|---|---|---|
| Authentification | `Authorization: Bearer <METRICS_TOKEN>` | `server/routes/public.mjs:312-317` |
| Token non configuré | **`403 METRICS_DISABLED`** | `server/routes/public.mjs:308-311` |
| Token absent/faux | **`401 UNAUTHORIZED`** | `server/routes/public.mjs:314-317` |
| Comparaison | SHA-256 + `timingSafeEqual` | `server/routes/public.mjs:53-57` |
| Format de sortie | `text/plain; version=0.0.4; charset=utf-8` | `server/routes/public.mjs:325` |
| Normalisation des paths | UUID → `/*` ; `/M-*`, `/T-*`, `/FR-*`, `/BR-*`, `/LS-*`, `/NOTIF-*` | `server/http-utils.mjs:284-296` |

**Métriques exposées :**

| Métrique | Origine |
|---|---|
| `zoyd_http_requests_total{method,status}` | `server/http-utils.mjs:138` |
| `zoyd_http_request_duration_seconds{method,pathname}` | `server/http-utils.mjs:139` |
| `zoyd_http_errors_total` (status ≥ 500) | `server/http-utils.mjs:140` |
| `zoyd_channels`, `zoyd_push_subscriptions`, `zoyd_stored_matches`, `zoyd_stored_tournaments`, `zoyd_stored_leagues`, `zoyd_stored_users` | `server/routes/public.mjs:318-323` |
| `zoyd_uptime_seconds`, `zoyd_node_heap_used_bytes`, `zoyd_node_heap_total_bytes`, `zoyd_node_rss_bytes`, `zoyd_node_external_bytes` | `server/metrics.mjs:172-178` |
| `zoyd_socket_connections_total`, `zoyd_socket_disconnects_total`, `zoyd_socket_connections` | `server/realtime-server.mjs:403-404`, `:582-583` |

> **Sans `METRICS_TOKEN` configuré, la route répond 403** — tout le système de
> métriques est alors inexploitable en production, alors qu'il existe et tourne
> (`render.yaml:72-75`).

---

## 7. Erreurs à ne pas confondre

C'est la source d'erreur classique côté client. Le client du dépôt lui-même pose
la règle : **un 401 purge l'état, un 403 non** (`src/app/lib/apiClient.ts:36-52`).

### 7.1 401 — la session est absente ou expirée

**Sens :** « je ne sais pas qui tu es ». **Action client :** re-authentifier,
purger l'état local.

| Cas | Code |
|---|---|
| Aucun cookie, aucun Bearer | `AUTH_REQUIRED` |
| Session expirée (TTL 6 h glissant, plafond 30 j) | `AUTH_REQUIRED` |
| Token realtime absent ou invalide | `AUTH_REQUIRED` |
| Bearer `METRICS_TOKEN` faux | `UNAUTHORIZED` |
| Identifiants de login faux | `INVALID_CREDENTIALS` |

> `AUTH_REQUIRED` est émis **directement** par les gardes : il n'est **pas** dans
> `mapPersistenceError`. Le chercher dans la table §2.1–2.9 est une perte de
> temps.

### 7.2 403 — la session est valide, le droit est refusé

**Sens :** « je sais qui tu es, et tu n'as pas le droit ». **Action client :
afficher le refus, ne surtout pas déconnecter.**

| Cas | Code | Particularité |
|---|---|---|
| Rôle ≠ admin | `ADMIN_REQUIRED` | `requireAdmin2fa` (`admin-totp.mjs:162`) |
| 2FA non activée ou fenêtre expirée | `2FA_REQUIRED` | porte `requires2fa:true` (`admin-totp.mjs:167,171`) |
| Mot de passe actuel faux (changement d'email / setup 2FA) | `PASSWORD_CONFIRMATION_REQUIRED` / `WRONG_PASSWORD` / `INVALID_PASSWORD` | |
| Compte banni ou suspendu | `ACCOUNT_SANCTIONED` | porte l'objet `sanction` (`auth.mjs:121-135`) |
| Transaction FedaPay d'un autre compte | `TRANSACTION_NOT_OWNED` | |
| Lecteur non-autorisé de la vue arbitre BR | `ARBITER_REQUIRED` | **403 ici, 409 dans la table** (§5.7.1) |
| Origine hors liste blanche (CSRF) | `CSRF_ORIGIN_REJECTED` | |

**Le client du dépôt respecte cette distinction** :
`const isAuthFailure = status === 401 || (status === 403 && code === 'AUTH_REQUIRED')`
(`src/app/lib/apiClient.ts:40`). Seuls ces cas purgent le store et déconnectent.

### 7.3 409 — conflit d'état, **rejouable**

**Sens :** « ta demande est correcte, mais le monde n'est pas dans l'état que
tu supposes ». **Action client :** recharger l'état, puis réessayer ou proposer
une action alternative.

| Cas | Code |
|---|---|
| Salon déjà plein / lancé / réglé | `LOBBY_FULL`, `LOBBY_CLOSED`, `LOBBY_NOT_LIVE`, `ALREADY_LIVE`, `ALREADY_FINISHED` |
| Joueur déjà inscrit / éliminé / check-in | `ALREADY_JOINED`, `ALREADY_ELIMINATED`, `ALREADY_CHECKED_IN` |
| Identité déjà prise | `DUPLICATE_PSEUDO`, `DUPLICATE_EMAIL`, `DUPLICATE_PHONE`, `DUPLICATE_GAME_ID` |
| Retrait déjà engagé, transfert non confirmé | **`PAYOUT_PENDING_REVIEW`** |
| Transaction FedaPay déjà traitée / en cours | `TRANSACTION_ALREADY_PROCESSED`, `TRANSACTION_IN_PROGRESS` |
| Litige déjà ouvert / déjà escaladé | `DISPUTE_ALREADY_OPEN`, `DISPUTE_ALREADY_ESCALATED` |
| Signalement déjà traité | `ALREADY_REVIEWED` |
| Solde insuffisant / plafond quotidien | `INSUFFICIENT_FUNDS`, `DAILY_WITHDRAWAL_LIMIT` |

> « Conflits d'etat : le salon est deja plein/lance/regle, le joueur est deja
> inscrit ou elimine. 409 et non 400 : le client peut reessayer. »
> — `server/http-utils.mjs:411-414`

### 7.4 Ce qui n'est dans aucune des trois cases

| Statut | Signification opérationnelle |
|---|---|
| **400** | la **requête** est mal formée. Corriger et renvoyer. Jamais un retry à l'identique. |
| **404** | la ressource n'existe pas **ou** n'est pas visible par vous (canal inaccessible, ressource non Ownership). Un 404 ne prouve pas l'absence. |
| **415 / 429 / 500 / 502 / 503** | infrastructure. 429 → respecter `Retry-After`. 503 → réessayer plus tard, l'état peut être en lecture seule. |
| **423** `ACCOUNT_LOCKED` | verrouillage durable. Ce n'est **pas** un 403 : l'état du compte est temporairement interdit, pas le droit. |

---

## 8. Ce qui n'est pas établi par ce document

| Sujet | État |
|---|---|
| Comportement exact de `GET /api/leagues/:id/leaderboard` sans session | La route **ne demande pas de session** (`server/routes/league.mjs:299-309`) mais renvoie `getLeagueLeaderboard(...)`, dont le contenu n'est pas vérifié ici. **Non vérifié** : le classement expose-t-il des `playerId` ? |
| Charge réelle sur les quotas | Les quotas sont dimensionnés par IP ; derrière un CGNAT mobile, un déni de connexion de masse est possible. **Non mesuré.** |
| Cardinalité des labels Prometheus en régime nominal | La normalisation existe ; l'explosion constatée est corrigée, pas mesurée. **Non mesuré.** |
| Contrat exact des réponses `buildMatchActionPayload` / `buildTournamentActionPayload` / `buildLeagueActionPayload` | Vérifiés comme *nom de fonction* et comme source de la diffusion socket, mais **le corps champ par champ n'est pas documenté ici** — voir `docs/01-architecture.md` §10.4. |
| Comportement de `POST /api/auth/activate` et `resend-code` en production | Le parcours V1 crée un compte **directement actif** (`server/routes/auth.mjs:79-80`). Ces routes sont donc **inutilisées** dans le parcours nominal ; leur comportement réel en base n'est pas vérifié. |

---

*Fin du document. Source : lecture directe de `server/` et de `src/app/lib/`.
Toute affirmation non sourcée est signalée comme « non vérifié » (§8).*
