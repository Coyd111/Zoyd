# ZOYD — Les tests

> **Ce document ne fait pas l'apologie de la suite de tests.** Il décrit ce que
> la suite couvre, et — surtout — **ce qu'elle ne prouve pas**.
>
> Une suite verte prouve une chose très précise : *le code fait ce qu'on attend
> qu'il fasse*. Elle ne prouve **ni** que le produit est le bon produit, **ni**
> que la fonctionnalité est branchée en production, **ni** que le code testé
> est le code qui tourne.
>
> Ce document est lePendant de `docs/05-invariants.md` : celui-ci énonce les
> règles métier et signale celles qui sont violées ; celui-ci explique pourquoi
> **la suite de tests n'a pas détecté** ces violations.

**Source :** lecture directe du dépôt, plus une exécution réelle de la suite
le 2026-10-20 (dépôt local `E:\web_app\projrt\Z.O.Y.D\Zoyd`, commit de travail
`0328dc8` + correctifs de docs).

**Conventions de citation :** `fichier:ligne`. Les lignes renvoient à l'**état
du working tree au moment de la rédaction** (2026-10-20), pas au commit
`0328dc8` : le dépôt reçoit en parallèle l'insertion d'en-têtes
d'invariants en tête des fichiers `server/`, ce qui décale les numéros de
ligne de quelques dizaines. Chaque citation structurante est donc doublée du
**nom du symbole** cited, qui reste l'ancre stable.

---

## 1. Les trois niveaux

Il y a **trois** niveaux de validation, de natures très différentes. Les confondre
est la première source de mauvaise foi sur la qualité du projet.

| # | Niveau | Moteur | Portée | Réseau | Données | Où |
|---|---|---|---|---|---|---|
| 1 | **Unitaire** | Vitest 4.1.11 | Fonctions pures et modules serveur mockés | non | mocks en mémoire | `server/**/*.test.mjs` + `src/**/*.test.ts` |
| 2 | **E2E API** | Playwright 1.62 | Le vrai serveur HTTP, de bout en bout | local (localhost) | **mémoire** (`ZOYD_DISABLE_SUPABASE=true`) | `e2e/api/*.spec.ts` |
| 3 | **E2E live** | Playwright 1.62 | **la production** | `zoyd.onrender.com` / `zoyd.vercel.app` | **la base de production** | `e2e/live-api/`, `e2e/live-ui/` |

### 1.1 Niveau 1 — Vitest unitaire

**Configuration :** `vitest.config.ts`.

| Paramètre | Valeur | Ligne | Pourquoi |
|---|---|---|---|
| `include` | `server/**/*.{test,spec}.{js,mjs,cjs}` + `src/**/*.{test,spec}.{ts,tsx}` | `vitest.config.ts:11-14` | Lister les emplacements réels rend l'exclusion de `e2e/**` **implicite et infaillible** |
| `exclude` | `node_modules`, `dist`, `e2e`, `playwright-report`, `test-results` | `vitest.config.ts:15-21` | redondant, mais explicite |
| `environment` | **`node`** | `vitest.config.ts:39` | choix **délibéré** : `jsdom` n'est pas dans les dépendances |
| `testTimeout` | `20 000` ms | `vitest.config.ts:28` | les modules serveur font du `scrypt` au chargement |
| `globals` | `true` | `vitest.config.ts:30` | |
| `setupFiles` | `./src/test/setup.ts` | `vitest.config.ts:40` | mocks navigateur |
| `coverage` | v8, `text`/`json`/`html`, excludes `src/test/` | `vitest.config.ts:41-45` | |
| alias | `@` → `./src` | `vitest.config.ts:46-50` | |

> « Un `include: **/*.spec.*` + `exclude: e2e/**` collectait quand même les
> specs Playwright (`exclude` n'était pas appliqué) et faisait échouer
> `pnpm test:run` — donc la CI — en 7 "suites failed" sans qu'un seul test
> n'ait été exécuté. » — `vitest.config.ts:5-9`

Le commentaire de `vitest.config.ts:31-38` est important et va à l'encontre
d'une superstition répandue :

> « Cette ligne annoncait `jsdom`, mais jsdom n'est pas dans les dependances.
> Vitest retombait silencieusement sur `node`, donc les 500+ tests passaient
> dans un environnement qui n'existait pas dans la config. Une config qui
> decrit un environnement faux est pire qu'une config honnete : on croit
> couvrir le DOM alors qu'on ne le couvre pas. Les stores client sont du
> zustand pur, sans DOM, et le build + les 41 tests Playwright UI sont la vraie
> couverture navigateur. »

**Conséquence à retenir :** le niveau 1 ne teste **aucun DOM**. Les stores
Zustand sont testés comme du JavaScript pur. La couverture navigateur réelle,
c'est le niveau 2/3 (Playwright `ui`) et le build.

`src/test/setup.ts` installe malgré tout des mocks navigateur — `window.matchMedia`
(`:11-23`), `IntersectionObserver` (`:26-30`), `ResizeObserver` (`:32-37`) — et
un `cleanup()` RTL après chaque test (`:6-8`). Ce fichier se charge sans
erreur en environnement `node` (vérifié : 846 tests verts), mais **aucun de
ces mocks n'est réellement nécessaire** : aucun test du dépôt n'exerce de
composant React monté. C'est un vestige d'une configuration `jsdom` abandonnée.

### 1.2 Niveau 2 — Playwright E2E API

**Configuration :** `playwright.config.ts`, projet `api` (`:64-68`).

| Paramètre | Valeur | Ligne |
|---|---|---|
| `testDir` | `./e2e/api` | `playwright.config.ts:66` |
| `baseURL` | `http://localhost:4001` | `playwright.config.ts:67` |
| `workers` | **1** | `playwright.config.ts:6` |
| `retries` | 1 | `playwright.config.ts:5` |
| `timeout` | 60 000 ms (projet `ui` : 120 000) | `playwright.config.ts:4`, `:84` |
| `reporter` | `list` | `playwright.config.ts:7` |

Le serveur de test est déclaré en `webServer` (`playwright.config.ts:13-55`) :
`node server/realtime-server.mjs` sur le port 4001, avec un environnement
**hermétique** :

| Variable | Valeur | Ligne | Rôle |
|---|---|---|---|
| `ALLOW_DEBUG_CODES` | `true` | `playwright.config.ts:35` | le token n'est renvoyé dans le body que si ce drapeau est posé (`:23-28`) |
| `NODE_ENV` | `test` | `playwright.config.ts:36` | |
| `ZOYD_DISABLE_SUPABASE` | `true` | `playwright.config.ts:37` | **mode mémoire** : pas de réseau, pas de données réelles, écritures autorisées |
| `ZOYD_ALLOWED_ORIGINS` | dev + prod | `playwright.config.ts:44` | sans ça, les specs `ui` échouent en CORS (`.env.server` écrase les origines de dev) |
| `ZOYD_ADMIN_PASSWORD` | `ZoydE2E!Admin2026` par défaut | `playwright.config.ts:47` | le compte de contrôle doit passer la politique de mot de passe fort, sinon le serveur ne démarre pas |
| `ZOYD_BR_START_EARLY_MS` | `48 * 3600 * 1000` | `playwright.config.ts:53` | sans cette surcharge, aucun salon BR créé par API n'est démarrable : le cycle `démarrage → éliminations → versement` ne serait testable qu'en unitaire |

> « Sans ça, TOUTES les assertions de token échouent en 401 et l'E2E ne
> testait plus rien — en silence, car la CI ne lance pas Playwright. »
> — `playwright.config.ts:24-28`

**Le harnais** est `e2e/api/support/harness.ts` (367 lignes). Ce n'est **pas**
un fichier de test : Vitest ne l'inclut pas (`vitest.config.ts:11-14`) et
`tsc -p tsconfig.app.json` ne le type-check pas (`harness.ts:3-7`). Il fournit :

| Export | Rôle |
|---|---|
| `call(actor, method, route, data?)` | appel JSON typé sur la session d'un acteur (`:76-90`) |
| `callAnonymous(...)` | appel sans session |
| `registerPlayer(prefix)` | crée un joueur jetable (pseudo, email, téléphone) |
| `openAdminSession()` | ouvre une session admin **avec 2FA vérifiée** |
| `loginAdminWithout2fa()` | ouvre une session admin **sans** 2FA vérifiée |
| `creditWallet(admin, userId, amount)` | crédite un joueur via `POST /api/wallet/deposit` |
| `disposeActors()` | ferme les contextes (`:60-63`) |

Trois raisons d'être du harnais (`harness.ts:9-22`) :

1. `POST /api/wallet/deposit` est **admin + 2FA** (`requireAdmin2fa`) : aucun
   endpoint de test ne permet de créditer un joueur autrement.
2. Le secret TOTP admin n'est renvoyé qu'**une seule fois** par
   `/api/admin/2fa/setup` ; ensuite `/setup` répond 409 `2FA_ALREADY_ENABLED`
   et aucun endpoint de désactivation n'existe. Sans un cache partagé entre
   `wallet.spec.ts` et `match.spec.ts`, le second fichier ne pourrait plus
   jamais financer de joueur sur le même process serveur.
3. Chaque acteur a son **propre** `APIRequestContext` (= son propre cookie
   jar) : `readBearerToken()` privilégie le cookie `zoyd_auth` sur l'en-tête
   `Authorization` (`server/http-utils.mjs:250-267`), donc un contexte partagé
   résoudrait les requêtes Bearer d'un joueur avec la session d'un autre.

### 1.3 Niveau 3 — Playwright live (api + ui)

**La protection est structurelle, et c'est le point important.**

`playwright.config.ts:109-137` : les projets `live-api` et `live-ui` **n'existent
pas dans la configuration** tant que `ZOYD_ALLOW_LIVE_TESTS !== '1'`. Ce n'est
pas un `skip` : ce sont des projets absents de la liste `projects`.

> « Avec ces projets dans la liste, `playwright test` sans `--project` suffisait
> a polluer la base de production — c'est arrivé pendant la session : la suite
> complete a ete lancee sans y penser, et les tests live ont echoue sur un DNS
> instable. Ils s'executaient quand meme. La protection est donc STRUCTURELLE :
> sans `ZOYD_ALLOW_LIVE_TESTS=1`, ces projets n'EXISTENT PAS dans la
> configuration. » — `playwright.config.ts:101-108`

Une **seconde** barrière, dans le fichier lui-même : `e2e/live-api/live-full.spec.ts:40-48`
lève une erreur explicite en `beforeAll` si la variable n'est pas à `1`.

| Projet | `testDir` | `baseURL` | `retries` | Lignes |
|---|---|---|---|---|
| `live-api` | `./e2e/live-api` | `https://zoyd.onrender.com` | **0** | `playwright.config.ts:111-124` |
| `live-ui` | `./e2e/live-ui` | `https://zoyd.vercel.app` | 1 (hérité) | `playwright.config.ts:125-135` |

`retries: 0` en live est **obligatoire** (`playwright.config.ts:114-117`) : chaque
retry rejoue le `beforeAll`, qui **inscrit un compte**. Avec `retries: 1`, un
seul test en échec laissait deux comptes dans la base de production.

Le fichier live se décrit lui-même (`live-full.spec.ts:1-26`) : volet **public**
sans création (health, CSRF, CORS, 404, rate-limits) et volet **authentifié**
qui crée un compte jetable et le supprime (`DELETE /api/auth/me`). Aucun dépôt
ni retrait : ces chemins passent par FedaPay (widget sandbox / vrai payout) et
**ne sont pas testés automatiquement**.

---

## 2. L'arborescence des tests

### 2.1 Où sont les tests

```
Zoyd/
├── server/                         ← 61 fichiers *.test.mjs (niveau 1, serveur)
│   ├── match-engine.test.mjs
│   ├── wallet-engine.test.mjs
│   ├── arbiter-required.test.mjs
│   ├── arbiter-sweep.test.mjs
│   ├── admin-totp-guard.test.mjs
│   ├── encoding-integrity.test.mjs
│   └── … (61 au total)
├── src/                            ← 14 fichiers *.test.ts (niveau 1, front)
│   ├── app/stores/                 ← 9 fichiers .test.ts (authStore, walletStore,
│   │                                  matchStore, tournamentStore, leagueStore,
│   │                                  chatStore, friendsStore, presenceStore,
│   │                                  notificationStore, toastStore, socketConnectionStore)
│   ├── app/lib/                    ← sessionPurge.test.ts, apiClient.payoutReason.test.ts
│   └── lib/                        ← payoutOperators.test.ts
├── e2e/
│   ├── api/                        ← niveau 2 : 11 fichiers *.spec.ts + support/harness.ts
│   ├── ui/                         ← niveau 2/3 : 6 fichiers *.spec.ts + globalSetup.ts
│   ├── live-api/                   ← niveau 3 : 1 fichier *.spec.ts
│   └── live-ui/                    ← niveau 3 : 1 fichier *.spec.ts
└── scripts/
    └── cleanup-live-e2e.sql         ← supprime les comptes ZOYDLIVE* laissés par un run interrompu
```

**Comptage vérifié :**

| Emplacement | Fichiers |
|---|---|
| `server/**/*.test.mjs` | 61 |
| `src/**/*.test.ts` | 14 |
| `e2e/api/*.spec.ts` | 11 (+ `support/harness.ts`, non-test) |
| `e2e/ui/*.spec.ts` | 6 (+ `globalSetup.ts`, non-test) |
| `e2e/live-api/*.spec.ts` | 1 |
| `e2e/live-ui/*.spec.ts` | 1 |

### 2.2 Conventions de nommage

| Niveau | Extension | Emplacement | Nommage |
|---|---|---|---|
| 1 — serveur | `.test.mjs` | à côté du module testé, `server/<module>.test.mjs` | le nom reprend le sujet : `arbiter-required`, `arbiter-sweep`, `wallet-engine`, `settlement-idempotence`, `withdrawal-daily-cap` |
| 1 — front | `.test.ts` | à côté du store ou du module, `src/app/stores/<store>.test.ts` | idem : `matchStore.test.ts`, `socketConnectionStore.test.ts` |
| 2 — API | `.spec.ts` | `e2e/api/<domaine>.spec.ts` | un fichier par domaine : `auth`, `wallet`, `match`, `br`, `social`, `public-read`, `admin-reports`, `profile-email`, `profile-pseudo`, `match-export`, `auth-hardening` |
| 2 — UI | `.spec.ts` | `e2e/ui/<sujet>.spec.ts` | `landing`, `auth-flow`, `layout`, `br`, `withdrawal-fees`, `accessibility` |
| 3 — live | `.spec.ts` | `e2e/live-api/`, `e2e/live-ui/` | `live-full`, `live-site` |

**Règle de séparation stricte :** `.test.mjs` (Vitest) vs `.spec.ts` (Playwright).
Vitest collecte `**/*.{test,spec}.*` (`vitest.config.ts:12-13`), donc un `.spec.ts`
placé dans `server/` ou `src/` serait collecté par Vitest — et un `.test.mjs`
placé dans `e2e/` serait exclu. La convention n'est pas arbitraire : elle évite
le recouvrement.

**Interdiction de `harness.ts` comme fichier de test :** Playwright ne collecte
que `**/*.@(spec|test).*` et Vitest n'inclut que `server/**` et `src/**`
(`harness.ts:3-7`).

### 2.3 Ce que Vitest collecte — et ce qu'il ne collecte pas

Point vérifié sur la session du 2026-10-20 :

```
Test Files  75 passed (75)
     Tests  846 passed | 2 skipped (848)
```

75 fichiers = 61 serveur + 14 front. Les **2 tests sautés** sont
`server/withdrawal-double-payout.test.mjs:150` et `:160` : tous deux exigent
FedaPay configuré (« exige FedaPay configure » dans leur titre).

Ce que Vitest ne collecte **pas**, et qui est facile de croire couvert :

| Ce qui n'est PAS collecté | Pourquoi |
|---|---|
| `e2e/**` | exclu (`vitest.config.ts:18`) |
| `e2e/api/support/harness.ts` | ni `*.test.*` ni `*.spec.*` |
| `e2e/ui/globalSetup.ts` | idem |
| `dist/**` | exclu (`vitest.config.ts:17`) |
| Les scripts `scripts/*.cjs`, `scripts/*.mjs` | hors `include` |
| `server/*.mjs` non-`*.test.*` en tant que sujet | ce sont des *sujets*, pas des tests |

### 2.4 Ce que Playwright collecte

Vérifié avec `npx playwright test --list` :

| Projet | Tests | Fichiers |
|---|---|---|
| `api` | **158** | 11 |
| `ui` | **48** | 6 |
| `live-api` + `live-ui` | **38** | 2 |
| **total** | **244** | 19 |

> **Attention.** Le commentaire de la CI dit encore « Les 38 tests d'interface ne
> tournaient nulle part » (`.github/workflows/ci.yml:116`) : le nombre est
> **périmé**. La suite `ui` en compte **48** aujourd'hui. Le commentaire
> datait du moment où la suite en comptait 38.

Le projet `ui` a un `globalSetup` qui **préchauffe Vite** avant les tests
(`e2e/ui/globalSetup.ts:43-47`) : sans lui, le premier `page.goto` paie le
pre-bundling esbuild et expire son propre budget — le test échoue en
« Timeout » **sans qu'une seule assertion n'ait été évaluée**.

---

## 3. Catalogue des tests d'argent

Ce sont les tests qui touchent à de l'argent. Ils sont les plus importants et
les plus trompeurs : un test d'argent vert donne une confiance qui n'est pas
toujours justifiée.

### 3.1 `server/arbiter-required.test.mjs` — 145 lignes, 6 tests

**Ce qu'il prouve :** qu'un match ne peut pas être soldé sans arbitre, et que
**l'administrateur n'est pas une voie de contournement**.

| Test | Ligne | Ce qui est vérifié |
|---|---|---|
| « un joueur NE PEUT PAS valider le score quand il n y a pas d arbitre » | `:82` | perdant **et** gagnant sont refusés en `ARBITER_REQUIRED` |
| « un tiers qui ne joue pas ne peut PAS valider non plus » | `:96` | un non-participant ne peut pas non plus |
| « ni l administrateur ni personne ne peut regler sans arbitre » | `:103` | **l'admin est refusé aussi** |
| « un joueur ne peut toujours pas valider quand un arbitre EST assigne » | `:115` | la garde n'est pas « ajoutée » mais « substituée » |
| « l arbitre designe peut valider » | `:125` | **cas positif** : sans lui, le fichier garantirait n'importe quoi |
| « le reglement refuse de distribuer un pot sans arbitre » | `:132` | le chemin de **reprise** (`settlePendingMatchResult`) est gardé séparément |

Le test est **mocké** : `persistence.mjs` et `wallet-engine.mjs` sont entièrement
mockés (`arbiter-required.test.mjs:6-26`). `lockEntryFee`, `releaseWalletWinnings`
et `settleMatchLossWallet` sont des `vi.fn()` **sans effet**.

> **Ce que ce test ne prouve pas :** qu'aucun argent ne bouge. Il prouve que
> la fonction **lève** au bon endroit. Un mock de `releaseWalletWinnings` ne
> créditerait rien, même si le garde était absent.

### 3.2 `server/arbiter-sweep.test.mjs` — 107 lignes, 6 tests

**Ce qu'il prouve :** que la fonction `sweepMatchesWithoutArbiter` rembourse
comme prévu **quand on l'appelle**.

| Test | Ligne | Ce qui est vérifié |
|---|---|---|
| « rembourse un match sans arbitre au-dela du delai » | `:39` | `refunded = [{ matchId, reason: 'NO_ARBITER' }]`, les deux joueurs remboursés, statut `cancelled` |
| « respecte le delai : un match recent n est pas touche » | `:50` | un match de 30 min n'est pas touché |
| « un arbitre en poste qui ne lance pas est rembourse au-dela de 2 h » | `:59` | phase A, raison `ARBITER_TIMEOUT` |
| « un arbitre qui ne tranche pas est rembourse apres lancement » | `:68` | phase B (match `in_progress`, cagnotte gelée) |
| « ne touche ni un litige ouvert, ni un match deja solde » | `:82` | les deux cas sont exclus |
| « NE CLOT PAS si un remboursement echoue » | `:93` | si un remboursement échoue, le match reste `check_in` — pas de séquestre sans trace |

> **Ce que ce test ne prouve pas :** que cette fonction **tourne en
> production**. C'est le sujet de la §4.1 — et c'est le cas le plus important
> de tout ce document.

### 3.3 `server/wallet-engine.test.mjs` — 17 989 octets, 30 tests

**Ce qu'il prouve :** les règles arithmétiques du portefeuille.

| Famille | Lignes | Ce qui est vérifié |
|---|---|---|
| Deposit | `:18-46` | refus du montant 0, code d'erreur correct, arrondi |
| Withdraw | `:48-109` | minimum 150 ZC, fonds insuffisants, **commission 2 %** (`:90`) |
| Lock Entry Fee | `:111-198` | insuffisance, débit cash, débit bonus si cash insuffisant, **répartition cash/bonus** (`:180`) |
| Refund Locked Entry | `:200-247` | pas de réservation ⇒ portefeuille inchangé, restitution cash **et** bonus |
| Settle Match Loss | `:249-339` | pas de réservation ⇒ inchangé, **consommation sans remboursement** (`:269`), et surtout le test de **réconciliation du grand livre** (`:300`) : `Σ(transactions) === variation des soldes` |
| Release Winnings | `:341-455` | crédit cash, **pas de blanchiment d'une mise 100 % bonus en cash** (`:379`), gain sans réservation, refus des montants négatifs |
| Double-lock | `:457-476` | `ALREADY_LOCKED` sur le même `matchId` (`:462`) |
| `roundAmount` | `:478-...` | protection contre `NaN` |

Le test de réconciliation (`:300`) est le plus valuable du fichier : il ne teste
pas une garde, il teste une **cohérence comptable**. Il est de la même famille
que `server/data-integrity.test.mjs` (`:222`, `:231`, `:239`, `:340-358`).

> **Ce que ce test ne prouve pas :** que les soldes réels sont corrects. Il
> appelle le moteur avec des données d'entrée ; la chaîne complète
> *route → persistance → base* n'est pas exercée.

### 3.4 `e2e/api/wallet.spec.ts` — 381 lignes, 21 tests

**Ce qu'il prouve :** le contrat HTTP réel du portefeuille, de bout en bout.

La suite est en `mode: 'serial'` (`:36`) avec un `beforeAll` qui enregistre un
joueur et ouvre une session admin (`:41-44`).

| Bloc | Lignes | Ce qui est vérifié |
|---|---|---|
| `GET /api/wallet/me` | `:50-69` | 200 + structure du wallet ; 401 `AUTH_REQUIRED` sans session |
| `POST /api/wallet/deposit` | `:71-156` | 403 pour un joueur (admin-only), 403 `2FA_REQUIRED` sans TOTP vérifié, **200 + crédit** avec admin+TOTP, accumulation des crédits, 400 `INVALID_AMOUNT` / `INVALID_JSON`, 404 `USER_NOT_FOUND` |
| `GET /api/wallet/history` | `:158-166` | les crédits sont tracés |
| `POST /api/wallet/withdraw` — refus | `:168-277` | 401 sans session ; 400 `INVALID_AMOUNT` (149 et 100 001) ; 400 `INVALID_OPERATOR` ; 400 `INVALID_PHONE` ; 400 `IDEMPOTENCY_KEY_REQUIRED` ; 400 `INVALID_COUNTRY` ; **409 `INSUFFICIENT_FUNDS` sans rien débiter** (`:253-277`, avec relecture du wallet avant/après) |
| Politique de retrait | `:279-288` | le serveur publie `feeRate = 0.02` et `minAmount = 150` |
| `GET /api/admin/commissions` | `:290-334` | 401/403 sans rôle ; agrégation des frais ; **le revenu est la commission de retrait, PAS les parts d'arbitre** (`:322`) ; plus de champ `total` ambigu (`:333`) |
| `verify-fedapay` | `:336-358` | 401 sans session ; 400 `INVALID_TRANSACTION_ID` sur deux formes |

Le test `:253-277` est un modèle : il relit le solde **avant** l'appel plutôt
que de comparer à une constante.

> « Solde AVANT, plutôt que la constante EXPECTED_BALANCE : ce test doit dire
> "le refus n'a rien débité", pas "le joueur a 800 ZC". Sinon il ne tourne
> qu'après les tests de dépôt, et `--grep` le fait échouer pour une raison
> sans rapport avec ce qu'il vérifie. » — `e2e/api/wallet.spec.ts:254-257`

> **Ce que ce test ne prouve pas :** qu'un retrait **réussi** verse le bon
> montant. Le chemin « retrait réussi » déclenche un payout FedaPay réel et
> n'est pas testable hors-ligne (`wallet.spec.ts:24-27`). Les tests couvrent
> **toutes les gardes qui s'exécutent avant l'appel réseau**, plus le refus pour
> solde insuffisant.

### 3.5 Le reste de la famille argent

| Fichier | Tests | Ce qu'il couvre |
|---|---|---|
| `server/settlement-idempotence.test.mjs` | 4+ | un règlement rejoué ne crédite rien (`:80`), pas de trace fantôme (`:94`), gain et commission distincts (`:110`) |
| `server/withdrawal-daily-cap.test.mjs` | 6 | plafond cumulé 24 h (`:62`, `:72`, `:82`, `:95`, `:110`, `:126`) |
| `server/withdrawal-double-payout.test.mjs` | 1 actif + **2 sautés** | un retrait en revue ne déclenche aucun payout (`:123`) ; les deux témoins FedaPay sont **sautés** (`:150`, `:160`) |
| `server/withdrawal-reconciliation.test.mjs` | 4 | un payout rejeté rembourse enfin le joueur (`:77`) |
| `server/withdrawal-replay-outside-window.test.mjs` | 5 | un retrait rejoué hors fenêtre ne déclenche rien |
| `server/payment-engine.test.mjs` | 4 | transaction d'un autre compte refusée (`:136`), collision par suffixe de téléphone refusée (`:150`) |
| `server/feda-claim-idempotence.test.mjs` | 4 | une transaction déjà traitée est refusée |
| `server/roundings-and-realtime-sanctions.test.mjs` | 3 | un tarif à plus de 2 décimales fait diverger pot et argent bloqué (`:39`) |
| `server/data-integrity.test.mjs` | 7+ | intégrité des portefeuilles |
| `server/settlement-stats-and-lock.test.mjs` | 4 | un règlement rejoué ne recompte pas les stats |
| `server/br-engine.test.mjs` | — | la cagnotte BR ne verse jamais plus que son pot (`:617`), commission arbitre en plus (`:648`) |
| `server/league-podium-guards.test.mjs` | — | unicité des joueurs et des places (`:57`, `:71`, `:83`, `:95`) |
| `e2e/api/wallet.spec.ts` | 21 | cf. §3.4 |
| `e2e/api/match.spec.ts` | — | la cagnotte verrouillée est distribuée, pas la nominale (`:447`) ; le perdant est débité, pas remboursé (`:460`) |

---

## 4. CE QUE LES TESTS NE PROUVENT PAS

> **C'est la section la plus importante du document.** Chaque point a été
> revérifié dans le code ou par exécution, pas recopié d'un rapport antérieur.

### 4.1 Le sweep d'arbitre : un test vert sur du code mort — **CORRIGÉ**

> **Statut : corrigé.** Le balayage est branché sur le tick d'automatisation de
> 30 s, et `server/arbiter-sweep-wiring.test.mjs` couvre désormais le **chemin
> complet**. Ce qui suit est conservé tel quel : c'est le raisonnement, et il
> vaut pour n'importe quelle fonction exportée de ce dépôt.

**Le fait (au moment de la rédaction) :** `sweepMatchesWithoutArbiter` était
définie, documentée, testée — et **jamais exécutée** en production. C'est le
constat **V1** de `docs/05-invariants.md:498`.

**La preuve (re-vérifiée le 2026-10-20) :** occurrences *complètes* de
`sweepMatchesWithoutArbiter` dans tout le dépôt :

| Emplacement | Nature |
|---|---|
| `server/match-engine.mjs:78` | définition (`export const`) |
| `server/match-engine.mjs:351` | commentaire (« voir `sweepMatchesWithoutArbiter` ») |
| `server/arbiter-sweep.test.mjs:21, 41, 52, 62, 76, 85, 101` | **les tests** |
| `docs/05-invariants.md`, `docs/02-modele-metier.md` | documentation |

Aucun appelant. En particulier :

- `server/cron.mjs:53` n'importe de `match-engine.mjs` que
  `settlePendingMatchResult` et `expireConfirmationsOnServer` ; les 12 balayages
  du cron ne l'appellent pas.
- `server/routes/*.mjs` : aucune occurrence.
- `server/realtime-server.mjs` : aucune occurrence.

**Pourquoi c'est un piège, et non un simple oubli.**

Le test `server/arbiter-sweep.test.mjs` **appelle la fonction directement**
(`:41`, `:52`, `:62`, `:76`, `:85`, `:101`). Il est donc vert, et il le restera
tant que la fonction existera — même si on la supprime du code de production,
même si on la renomme, même si on la laisse dormir dans un module que personne
n'importe.

> « Un test "qui appelle la fonction" ne prouve pas qu'elle est branchée. »
> — `docs/05-invariants.md:945`

**Le test manquait de nature.** Pour prouver le branchement, il fallait un test
qui vérifie *l'effet en production* : « un tick passe et rembourse un match sans
arbitre ». Aucun test de ce type n'existait. Un test qui **liste** les jobs du
cron et vérifie que `sweepMatchesWithoutArbiter` figure dans la liste aurait
été possible — il était **absent**.

**Ce que le joueur perdait.** Le seul mécanisme actif était
`processMatchAutomationOnServer` (tick 30 s), qui ne compare qu'à
`scheduledAt` et à `expiresAt` (14 jours). Un match sans `scheduledAt` — le cas
le plus courant — restait `recruiting` / `awaiting_arbiter` / `check_in` et **le
passe restait bloqué jusqu'à 14 jours** au lieu des 2 h promises. Le joueur ne
pouvait ni récupérer son argent, ni rejouer (`lockEntryFee` renverrait
`ALREADY_LOCKED`).

**Le correctif, et ce qu'il a fallu inventer pour le prouver.**

Le balayage a été enchaîné à l'automatisation dans une fonction unique,
`runMatchAutomationOnServer` (`server/match-engine.mjs`), appelée par le tick de
30 s de `server/realtime-server.mjs`. L'ordre est délibéré : le balayage
s'applique sur le **résultat** de l'automatisation, donc un match que
l'automatisation vient d'annuler est déjà en `cancelled` et le balayage
l'ignore. Aucun double remboursement n'est possible même en cas d'échec
partiel : `refundLockedEntry` est idempotent (sans réservation, elle ne crédite
rien).

`server/arbiter-sweep-wiring.test.mjs` est le test qui manquait. Il ne
teste plus la fonction : il teste le **tick complet**, et il vérifie
explicitement que l'automatisation *seule* ne touche pas un match sans arbitre
ni horaire — c'est ce qui prouve que c'est bien le balayage qui agit, et pas
un effet de bord.

**La preuve que ce test-là mord.** Balayage débranché
(`swept = { matches: automated.matches, refunded: [] }`), la suite tombe à
**2 échecs sur 6**. C'est la recette appliquée au garde admin
(§5) : un test qui reste vert quand on casse le code ne prouve rien.

**Règle générale.** Un test unitaire d'une fonction exportée prouve que la
**fonction** est correcte. Il ne prouve pas que la fonction est **branchée**.
La seule preuve du branchement est un test qui traverse le **chemin de
production** (route, cron, tick) — ou une assertion explicite sur le
câblage.

### 4.2 Un test peut figer le bug au lieu de le couvrir

Cas frère du précédent, documenté en **V5** (`docs/05-invariants.md:693-736`).

`server/match-engine.test.mjs:389-402` s'intitule « should split the winner pot
across the players of the winning team » et asserte
`expect(projection.perWinner).toBe(490)` pour 4 joueurs et 1 960 ZC — soit
1 960 / 4.

Or le règlement réel verse 980 par gagnant (1 960 / 2) : il divise par
`winnerIds.size`, le nombre de **gagnants**
(`server/match-engine.mjs:401-402`), alors que la projection divise par
`match.players.length`, le nombre total de joueurs
(`server/match-engine.mjs:224-226`).

> « Un test vert ne prouve donc **rien** ici : il certifie le comportement
> faux. C'est un cas d'école de la règle "un test qui reste vert après avoir
> cassé le code ne prouve rien". » — `docs/05-invariants.md:727-729`

**Le test n'est pas seulement muet : il est faux.** Un test qui asserte une
valeur fausse n'est pas neutre — il **protège** le bug.

### 4.3 Le test de garde admin : ce qu'il prouve, et sa recette de mutation

`server/admin-totp-guard.test.mjs` (131 lignes) est le **seul** test du dépôt
dont la **mutation-testabilité** a été vérifiée. C'est le modèle à copier.

**Pourquoi il teste le garde, et non le routeur**
(`admin-totp-guard.test.mjs:5-23`) : tester `server/routes/admin.mjs` aurait
embarqué `push-notifications.mjs`, qui valide une clé VAPID **à l'import**.
`server/admin-totp.mjs` n'importe que trois modules — c'est ce qui rend le
test direct possible. Les dépendances sont mockées (`:25-41`) ; `respondJson`
est une **copie locale** qui observe les statuts sans rejouer la logique.

**Ce qu'il couvre :**

| Porte | Test | Ligne du test | Attendu |
|---|---|---|---|
| — | « refuse une requete sans session » | `:67-71` | 401 |
| `requireAdmin` — rôle | « refuse un joueur connecte » | `:73-78` | 403 |
| `requireAdmin` — **cas positif** | « laisse passer un admin » | `:80-85` | session renvoyée, 200 |
| `requireAdmin2fa` — session | « refuse sans session » | `:89-93` | 401 |
| `requireAdmin2fa` — rôle | « refuse un joueur et renvoie ADMIN_REQUIRED » | `:95-101` | 403 + `ADMIN_REQUIRED` |
| `requireAdmin2fa` — 2FA activée | « refuse un admin qui n'a pas active la 2FA » | `:103-109` | 403 + `2FA_REQUIRED` |
| `requireAdmin2fa` — vérifiée | « refuse un admin dont la 2FA est active mais non verifiee » | `:111-116` | 403 + `2FA_REQUIRED` |
| `requireAdmin2fa` — expirée | « refuse une 2FA verifiee mais expiree » | `:118-124` | 403 + `2FA_REQUIRED` |
| `requireAdmin2fa` — **cas positif** | « laisse passer un admin avec 2FA active ET verifiee » | `:126-130` | session renvoyée |

Le cas positif est le plus important, et le fichier le dit
(`admin-totp-guard.test.mjs:19-22`) :

> « une suite composée uniquement de rejets passe aussi bien avec `() => null`.
> Sans cas positif, ce fichier garantirait n'importe quoi — y compris une
> fonction morte. »

**La recette de mutation est donnée en §5. Elle a été appliquée et chaque
mutation a bien fait tomber le test.**

### 4.4 `server/encoding-integrity.test.mjs` — ce que c'est, ce que ce n'est pas

84 lignes, 2 tests.

**Ce qu'il prouve :** qu'aucun fichier source (`.mjs`, `.ts`, `.tsx`, `.js`,
`.sql`) ne contient de double encodage UTF-8 (mojibake). La détection repose
sur une **liste de signatures** (`encoding-integrity.test.mjs:27`) : la double
lettre `A-accent` suivie d'un caractère de Latin-1, le BOM `ï»¿`, et les
séquences dOpening/closing quotes décodées une fois.

| Test | Ligne | Ce qui est vérifié |
|---|---|---|
| « aucun fichier source ne contient de double encodage » | `:43-64` | parcours récursif de `.` (`:29-40`), exclusion de `node_modules`, `.git`, `dist`, `test-results` ; le fichier se **signale lui-même** et est donc exclu explicitement (`:50-53`) |
| « les sources critiques sont bien en UTF-8 lisible » | `:66-83` | `server/persistence.mjs`, `server/wallet-engine.mjs`, `server/routes/wallet.mjs`, `supabase/schema.sql` doivent contenir au moins un accent UTF-8 réel (`:81`) |

**Pourquoi ce test existe.** Le fichier explique la cause exacte
(`encoding-integrity.test.mjs:6-24`) : deux fois pendant la session de travail,
un fichier source a été relu avec `Get-Content -Raw` — qui décode avec la page
de code ANSI — puis réécrit en UTF-8. Les accents devenaient « Ã¨ » / « Â§ ».
Le fichier passait encore `node --check` **et les tests**, et l'erreur
n'apparaissait qu'au lint, sous le nom opaque « irregular whitespace ».

> « Pire : le contenu devient illisible pour l'auteur, donc les commentaires
> qui expliquent les invariants cessent d'expliquer quoi que ce soit. Sur ce
> dépôt, les commentaires portent une partie de la charge — plusieurs
> corrections n'ont de sens que parce qu'on lit pourquoi. »

**Ce que ce test ne prouve pas :**

1. **Ce n'est pas un test de sécurité.** C'est un test d'**intégrité
   documentary**. Il ne dit rien du comportement du code.
2. **Sa portée est limitée aux extensions listées** (`:44`). Le `.gitignore`
   du dépôt est lui-même corrompu (les mots accentués y sont en double
   encodage) — il n'est simplement pas couvert. Même limite pour `.md`,
   `.json`, `.yml`.
3. **Il ne couvre pas `dist/`** (`:31`) : un build corrompu passe.
4. **La regex est un ensemble de signatures**, pas une preuve d'absence de
   corruption. Un mojibake qui ne correspond à aucune signature passe.

**Point important.** `server/encoding-integrity.test.mjs` est le test qui a
**protégé les invariants** : parce que les commentaires des moteurs portent la
justification des gardes, un fichier corrompu ne corrompt pas seulement le
texte — il corrompt **la continuité** du raisonnement.

### 4.5 La garde anti-production des tests live

Déjà détaillé en §1.3, mais l'essentiel mérite d'être isolé :

- `playwright.config.ts:109` — les projets live **n'existent pas** sans
  `ZOYD_ALLOW_LIVE_TESTS=1`. La protection est **structurelle**, pas
  conventionnelle.
- `e2e/live-api/live-full.spec.ts:40-48` — **seconde** garde, dans le fichier.
- `playwright.config.ts:114-117` — `retries: 0` en live, sinon chaque retry
  inscrive un compte de plus.

**Ce que cela ne protège pas :** le `webServer` global (`playwright.config.ts:13-62`)
démarre un serveur **local** — il ne touche pas la production. Le risque
résiduel est humain : un `ZOYD_ALLOW_LIVE_TESTS=1` posé par erreur dans un
`.env` ou un shell profile. Le compte créé est traçable (pseudo `ZOYDLIVE`,
email `@e2e-live`) et `scripts/cleanup-live-e2e.sql` permet de nettoyer.

### 4.6 Les deux tests sautés

`server/withdrawal-double-payout.test.mjs:150` et `:160` sont `it.skip`, avec
la raison en clair dans leur titre : « exige FedaPay configure ».

Le test actif (`:123`) vérifie qu'un retrait en attente de revue **ne déclenche
aucun payout** (`initiateFedaPayPayout` n'est pas appelé, `:145-147`). Les deux
témoins qui prouveraient le **contraire** (un retrait normal déclenche *un*
payout ; un doublon strict n'en déclenche pas *deux*) sont **sautés**.

> « Sans ce temoin, le test ci-dessus pourrait passer pour une raison
> orthographique (route qui ne ferait jamais de payout). »
> — `server/withdrawal-double-payout.test.mjs:151-152`

**Un test d'argent dont le témoin est désactivé prouve la moitié des choses.**
Le risque de double versement — le pire incident possible sur ce produit — n'est
donc pas couvert de bout en bout.

### 4.7 Les mocks qui neutralisent l'argent

C'est le point le plus sous-estimé du dépôt. Plusieurs tests de moteur
mockent `lockEntryFee`, `releaseWalletWinnings` et `settleMatchLossWallet` avec
des `vi.fn()` **sans effet**. Le test passe, mais **aucun solde ne bouge
jamais** dans la suite.

Cas documenté : **V7** (`docs/05-invariants.md:781-819`). Dans
`server/br-engine.test.mjs:375` — « squad : refuse une 5e personne dans la meme
equipe (teamSize 4) », qui rejette bien sur l'équipe complète — le cas
`TEAM_FULL` est couvert. Mais `lockEntryFee` y est un `vi.fn()` **sans effet**
(`br-engine.test.mjs:9-14`) : le test **ne peut pas, par construction**,
détecter qu'un joueur a été débité pour une inscription qui a échoué.

> « Le test ne peut pas, par construction, détecter un problème de solde. »
> — `docs/05-invariants.md:815`

**Règle :** un test de moteur qui ne touche pas au grand livre prouve des
**contrôles**, pas des **mouvements d'argent**. Pour prouver un mouvement
d'argent, il faut soit le grand livre (`server/wallet-engine.test.mjs:300`),
soit un test HTTP (`e2e/api/wallet.spec.ts`).

### 4.8 Ce que 846 + 158 ne prouvent pas

**Les chiffres, mesurés le 2026-10-20 :** 846 tests unitaires verts (75
fichiers, 2 sautés) + 158 tests E2E API verts (11 fichiers) + 48 tests UI + 38
tests live. *(Ces nombres sont un instantané — voir la réserve du §8.)*

Ce que cet ensemble prouve :

> « Le code fait ce qu'on attend qu'il fasse. »

Ce qu'il **ne** prouve **pas**, point par point :

| Ce qui n'est **pas** prouvé | Pourquoi |
|---|---|
| **Que le produit est le bon produit** | Aucun test ne dit s'il faut d'un arbitre payé à 2 %, si le seuil de retrait de 150 ZC est le bon, si le joueur comprend le différend entre `br` et `br-league`. Les tests figent des décisions, ils ne les valident pas. |
| **Que la fonctionnalité est branchée** | V1 : le sweep d'arbitre est vert et absent de la production. |
| **Que le code testé est le code déployé** | Aucune vérification de parité entre le commit local et l'image Docker/Render/Vercel. |
| **Que les soldes réels ne dérivent pas** | Les tests de moteur sont mockés (§4.7) ; l'OCC est testée **sur la source** (`server/occ-revision-invariant.test.mjs`), pas sur un vrai déploiement à deux instances - et la colonne `revision` peut être absente d'une base créée avant le DDL provisionné (V9 — la déclaration est désormais verrouillée par `schema-coverage.test.mjs:121-126`, et l'état réel est exposé dans `/api/health`). |
| **Que le chemin FedaPay fonctionne** | Aucun test automatique ne va jusqu'au bout d'un dépôt FedaPay réel (`e2e/api/wallet.spec.ts:24-27`). Les deux témoins de double-payout sont sautés (§4.6). |
| **Que la production est saine** | Les 38 tests live ne tournent **que sur demande explicite** (§4.5). Le niveau 2 tourne en **mode mémoire**, sur une base vide. |
| **Que le DOM est correct** | `environment: 'node'` (§1.1). La couverture navigateur, c'est 48 tests UI + le build. |
| **Que le bundle est à jour** | Un test qui passe sur la source ne prouve rien du `dist/`. Voir §6. |
| **Que la prod est en multi-instance sûre** | `server/single-process-guard.mjs` refuse de démarrer en multi-processus : c'est un garde de **déploiement**, pas un test. |

**Formulation honnête à retenir :** la suite est **solide sur le « comment le
code se comporte »** et **muette sur le « est-ce qu'on veut ce comportement »**
et sur le « est-ce que c'est déployé ».

---

## 5. Mutation testing — la recette

### 5.1 Principe

> « Pour un test : **mue-le**. Un test qui reste vert après avoir cassé le code
> ne prouve rien. » — `docs/00-INDEX.md:123`

Une mutation est une modification **délibérée et minimale** du code, dont le
seul but est de vérifier que le test **tombe**. Si le test reste vert, il ne
couvre pas ce qu'il prétend couvrir — ou il couvre un chemin mort.

### 5.2 La recette appliquée (procédure exacte)

Recette appliquée et vérifiée le **2026-10-20** sur
`server/admin-totp-guard.test.mjs` (mutation M2 de la table §5.3, exécutée
pour de vrai : le test est bien tombé, puis est repassé au vert après
restauration).

**Étape 0 — état de départ.**

```powershell
cd "E:\web_app\projrt\Z.O.Y.D\Zoyd"
npx vitest run server/admin-totp-guard.test.mjs
```

Résultat attendu : **9 tests verts**.

**Étape 1 — neutraliser UNE porte.** Exemple : porte « rôle » de
`requireAdmin2fa` (`server/admin-totp.mjs:189-195`).

```js
// server/admin-totp.mjs, AVANT (requireAdmin2fa, ligne 189)
if (session.user.role !== 'admin') {
  log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id });
  respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.', code: 'ADMIN_REQUIRED' }, req);
  return null;
}

// APRÈS (mutation) — la porte disparaît
if (false) {
  log.warn('Unauthorized admin attempt', { user: session.user.pseudo, userId: session.user.id });
  respondJson(res, 403, { ok: false, error: 'Acces reserve aux administrateurs.', code: 'ADMIN_REQUIRED' }, req);
  return null;
}
```

**Étape 2 — purger le cache de dépendances.**

```powershell
Remove-Item -Recurse -Force node_modules\.vite
```

Pourquoi cette étape est obligatoire : Vitest et Vite mettent en cache la
transformation des modules dans `node_modules/.vite`. Sans la purge, un module
déjà chargé peut être servi depuis le cache, la mutation n'est pas visible, et
le test **reste vert** — conclusion fausse (« le test ne couvre rien ») alors
que le cache est en cause. *(Le répertoire `node_modules/.vite` existe bien
sur ce dépôt : il contient `deps/` et `vitest/`.)*

**Étape 3 — relancer le test ciblé.**

```powershell
npx vitest run server/admin-totp-guard.test.mjs
```

**Résultat attendu :** le test doit **échouer**. Sortie **observée** le
2026-10-20 :

```
 ❯ server/admin-totp-guard.test.mjs (9 tests | 1 failed) 70ms
 FAIL  server/admin-totp-guard.test.mjs > requireAdmin2fa — la porte financiere
       > refuse un joueur et renvoie ADMIN_REQUIRED
 AssertionError: expected '2FA_REQUIRED' to be 'ADMIN_REQUIRED'
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

C'est exactement le test attendu : « refuse un joueur et renvoie
`ADMIN_REQUIRED` » (`admin-totp-guard.test.mjs:95-101`). Les 8 autres passent :
la mutation n'a neutralisé **qu'une** porte, comme prévu.

**Étape 4 — inspecter le message d'échec.** Il doit nommer l'assertion qui a
cédée. Ici, c'est bien le cas : l'échec porte sur le **code** renvoyé
(`2FA_REQUIRED` au lieu de `ADMIN_REQUIRED`), ce qui prouve que le chemin a
été parcouru. Si le test échouait pour une autre raison (import cassé, timeout,
mock non résolu), la mutation n'aurait pas réellement été exercée : il faut
recommencer.

**Étape 5 — restaurer le code et re-vérifier.**

```powershell
# Restaurer le bloc à l'identique.
#
# NE PAS utiliser `git checkout -- server/admin-totp.mjs` si le fichier
# porte des modifications non commitées : cela les effacerait. Sur ce dépôt,
# les fichiers `server/` reçoivent des en-têtes d'invariants non commités.
git diff server/admin-totp.mjs     # vérifier que la mutation a bien disparu

Remove-Item -Recurse -Force node_modules\.vite
npx vitest run server/admin-totp-guard.test.mjs
```

→ **9 tests verts** (observé le 2026-10-20). Si le test est rouge après
restauration, le dépôt était déjà cassé.

### 5.3 Les six mutations de référence

`requireAdmin2fa` (`server/admin-totp.mjs:183-206`) a **quatre** portes ;
`requireAdmin` (`:160-172`) en a **deux**.

La mutation **M2** ci-dessous a été **ré-exécutée et vérifiée le 2026-10-20**
(voir §5.2 : le test est tombé, puis est repassé au vert après restauration).
Les cinq autres ont été neutralisées une par une lors de la session qui a
créé le fichier (`docs/00-INDEX.md:125-126`, `docs/03-securite.md` §3.3) :
chacune a été détectée.

| # | Porte neutralisée | Emplacement à muter | Test qui **doit** tomber |
|---|---|---|---|
| M1 | **session** (pas de session ⇒ refus) | `server/admin-totp.mjs:185-188` | `admin-totp-guard.test.mjs:89-93` |
| M2 | **rôle** (`role !== 'admin'`) | `server/admin-totp.mjs:189-195` | `admin-totp-guard.test.mjs:95-101` |
| M3 | **2FA activée** (`totpEntry?.enabled`) | `server/admin-totp.mjs:196-200` | `admin-totp-guard.test.mjs:103-109` |
| M4 | **2FA vérifiée / expirée** (`admin2faVerified`) | `server/admin-totp.mjs:201-204` | `admin-totp-guard.test.mjs:111-116` **et** `:118-124` |
| M5 | **garde mort** (`return null` au lieu de `return session`) | `server/admin-totp.mjs:205` | `admin-totp-guard.test.mjs:126-130` |
| M6 | **rôle de `requireAdmin`** | `server/admin-totp.mjs:166-170` | `admin-totp-guard.test.mjs:73-78` |

La mutation **M5** est la plus instructive : c'est elle qui distingue un
« test de rejet » (qui passe avec `() => null`) d'un « test de barrière ». Sans
le cas positif `:126-130`, les cinq autres mutations seraient… invisibles,
puisque la fonction ne laisserait jamais passer personne et que tous les tests
attendraient un refus.

**Corollaire.** Un test d'argent dont tous les cas sont des refus ne prouve que
la moitié : il faut au moins un cas positif, sinon il est compatible avec une
fonction morte.

### 5.4 Comment appliquer la recette à un autre test

1. Choisir une **porte unique** et lisible (un `if` qui porte un code métier).
2. La neutraliser en `if (false) { … }` — ne pas supprimer le bloc, pour que
   l'échec soit un **échec d'assertion** et non une erreur d'import.
3. Purger `node_modules\.vite`.
4. Relancer **le seul fichier** de test.
5. Vérifier que l'échec nomme l'assertion attendue.
6. Restaurer, purger, relancer, re-vérifier le vert.

**Ce que la recette a permis de conclure sur ce dépôt :** le test de garde
admin est **constituant** — il couvre chacune des 4 portes séparément et le
chemin heureux. C'est le seul fichier du dépôt dans ce cas. Partout ailleurs,
la couverture est **présente** mais la **mutation-testabilité n'est pas
démontrée**.

---

## 6. La leçon du bundling

### 6.1 Le fait

`pnpm build` produit **44 chunks `.js`** + 1 `.css` dans `dist/assets/`
(45 fichiers). Le découpage est piloté par `manualChunks` dans
`vite.config.ts:67-92` :

| Chunk | Contenu | Ligne de `vite.config.ts` |
|---|---|---|
| `vendor-react` | react, react-dom, react-router | `:68-70` |
| `vendor-state` | zustand | `:71-73` |
| `vendor-motion` | motion / framer | `:74-77` |
| `vendor-icons` | lucide-react | `:78-81` |
| `vendor-utils` | clsx, tailwind-merge, react-is | `:86-88` |
| `vendor-charts` | recharts | `:89-91` |
| *(le reste)* | un chunk par page et par module partagé | — |

Le découpage est **délibéré**, et le commentaire de `vite.config.ts:80-85`
l'explique : `clsx` est partagé entre l'entrée et recharts ; Rollup le rangeait
dans `vendor-charts`, donc l'entrée importait statiquement 364 kB de graphiques
pour disposer d'un utilitaire d'1 kB.

### 6.2 Le faux positif

**La règle du dépôt (`docs/00-INDEX.md:122`) :** « Vérifie les **chunks**, pas
seulement le bundle principal (le front est découpé) ».

**Ce qu'il advient quand on ne le fait pas.** Chercher un marqueur dans
`dist/assets/index-*.js` — le bundle d'entrée — alors qu'il vit dans un autre
chunk donne un résultat **faux** : le marqueur est absent → on conclut « le
build est périmé » → on rebuild, on cherche encore dans `index-*.js` → rien ne
change → on conclut que le correctif n'a pas été appliqué.

**Exemple vérifié le 2026-10-20** dans le build présent (`dist/assets/`) :

| Marqueur recherché | Où il est **vraiment** | Searching dans `index-*.js` seul |
|---|---|---|
| `hover:border-zoyd-yellow/50` | **`Card-DgtkzJh4.js`** | **absent** → faux « build périmé » |
| `hover:border-zoyd-yellow-50` (ancienne classe invalide) | **absent partout** | absent (correct) |
| `selection:bg-zoyd-yellow` | `index-CPMSP_XE.js` | présent (correct) |
| `projectedPayouts` | `MatchDetailPage-*.js`, `BrLobbyDetailPage-*.js`, `AdminDashboardPage-*.js`, `matchPayout-*.js` | **absent** → faux « build périmé » |
| `getWinnerPayoutPerPlayer` | **absent partout** (élagué par Rollup) | absent |

Deux lessons en une seule observation :

1. La classe corrigée (`hover:border-zoyd-yellow/50`) est bien **dans le build**,
   mais **dans `Card-DgtkzJh4.js`**, pas dans `index-CPMSP_XE.js`. Un lecteur
   qui ne regarde que le bundle d'entrée conclut à tort que la correction n'est
   pas passée. (L'ancienne classe `hover:border-zoyd-yellow-50` est bien
   **absente partout** : la correction a réellement supprimé l'ancienne.)
2. `getWinnerPayoutPerPlayer` est **absent de tout le build** : Rollup l'a
   éliminé parce que personne ne l'importe. C'est la **preuve mécanique** que
   c'est du code mort (voir §8 de `docs/08-frontend.md`).

### 6.3 La bonne procédure

```powershell
# 1. Chercher dans TOUT le repertoire d'assets, pas seulement l'entrée
Get-ChildItem dist\assets -Filter *.js | Select-String -SimpleMatch 'le-marqueur'

# 2. Lister les chunks produits
Get-ChildItem dist\assets -File | Select-Object Name, Length
```

Règle : **un marqueur absent de `index-*.js` n'est pas absent du build.** Il
faut chercher dans `dist/assets/`, et consulter `dist/index.html` pour savoir
quel fichier est l'entrée réelle (le nom est haché : `index-CPMSP_XE.js`, pas
`index.js`).

Corollaire de la même règle : **un test qui passe sur la source ne prouve rien
du `dist/`**. Les deux sont des artefacts distincts, et le build peut être
périmé sans que la suite le remarque.

---

## 7. Lancer chaque niveau

### 7.1 Commandes exactes

| Niveau | Commande | Effet |
|---|---|---|
| 1 — unitaire (une fois) | `pnpm test:run` | exécute Vitest une fois et sort |
| 1 — unitaire (watch) | `pnpm test` | mode watch |
| 1 — couverture | `pnpm test:coverage` | v8 → `text`/`json`/`html` |
| 1 — un fichier | `npx vitest run server/admin-totp-guard.test.mjs` | ciblage |
| 1 — par motif | `npx vitest run -t "arbitre"` | filtre sur le nom du test |
| 2 — E2E API | `pnpm test:e2e --project=api` | 158 tests contre le serveur local |
| 2 — E2E UI | `pnpm test:e2e --project=ui` | 48 tests Chromium contre Vite |
| 2 — les deux | `pnpm test:e2e` | |
| 2 — interface | `pnpm test:e2e:ui` | mode `--ui` de Playwright |
| 3 — live API | `ZOYD_ALLOW_LIVE_TESTS=1 pnpm test:e2e:live` | **38 tests contre la production** |
| 3 — live UI | `ZOYD_ALLOW_LIVE_TESTS=1 pnpm test:e2e:live-ui` | |
| 3 — live complet | `ZOYD_ALLOW_LIVE_TESTS=1 pnpm test:e2e:live-all` | |
| — build | `pnpm build` | Vite → `dist/` |
| — typecheck | `pnpm typecheck` | `tsc --noEmit -p tsconfig.app.json` |
| — lint | `pnpm lint` | ESLint `src server e2e`, `--max-warnings 0` |

> Sous PowerShell, la variable d'environnement se pose **avant** la commande :
> `$env:ZOYD_ALLOW_LIVE_TESTS='1'; pnpm test:e2e:live` puis
> `Remove-Item Env:\ZOYD_ALLOW_LIVE_TESTS`.

### 7.2 Le piège `pnpm install` sous Windows

**Le dépôt est sur un volume exFAT.** Vérifié sur cette machine :
`fsutil fsinfo volumeinfo E:` → `Nom du systeme de fichiers : exFAT`.

| Symptôme | Cause | Correctif |
|---|---|---|
| `pnpm install` échoue (symlinks impossibles) | pnpm utilise par défaut le linker **isolated**, qui crée des liens symboliques dans `node_modules`. **exFAT ne supporte pas les liens symboliques.** | `pnpm install --config.node-linker=hoisted` |
| Idem, avec l'environnement de CI | le mode CI change certains comportements | `CI=true pnpm install --config.node-linker=hoisted` |
| `pnpm install` bloque sur les scripts d'installation | pnpm 11 exige une décision explicite pour les paquets qui exécutent un script d'installation | `allowBuilds` dans `pnpm-workspace.yaml:5-8` (`@tailwindcss/oxide`, `esbuild`) |

**Le correctif est déjà dans le dépôt**, à deux endroits :

- `.npmrc` (racine) : `node-linker=hoisted` — c'est la configuration par défaut
  du dépôt, donc un `pnpm install` nu fonctionne.
- `DEPLOYMENT.md:442` : « `pnpm install` échoue sur exFAT →
  `CI=true pnpm install --config.node-linker=hoisted` ».

**Le piège subtil** : `.npmrc` n'est lu par pnpm que s'il est dans le
répertoire **courant ou un parent**. Depuis un autre répertoire, le `.npmrc` du
dépôt est ignoré et `pnpm install` retombe sur le linker isolated → échec.
C'est aussi pourquoi `render.yaml:6` et `vercel.json:2` repassent le paramètre
en ligne de commande.

**Autre avertissement Windows** : `npm` (et non `pnpm`) lit `.npmrc` et
avertit « Unknown project config "node-linker" » — inoffensif, mais le message
apparaît à chaque invocation de `npx`. C'est `npx` qui est utilisé par les
scripts Playwright (`package.json:19-23`), pas `pnpm exec`.

**Contrainte de version** : `package.json:6` fixe `packageManager: pnpm@11.0.8`,
`package.json:99-101` exige `node >= 22.13`, `.nvmrc` demande Node 22. La CI
utilise `pnpm/action-setup@v4` avec `version: 11.0.8`
(`.github/workflows/ci.yml:15-17`).

### 7.3 Ce que la CI exécute réellement

| Job | Commande | Lignes |
|---|---|---|
| `test` | `pnpm test:run` | `ci.yml:23` |
| `build` | `pnpm build` | `ci.yml:38` |
| `typecheck` | `pnpm typecheck` | `ci.yml:57` — **bloquant** depuis le 2026-09-29 |
| `lint` | `pnpm lint` | `ci.yml:80` — **bloquant** depuis le 2026-10-04 |
| `e2e` | `pnpm test:e2e --project=api` | `ci.yml:103` |
| `e2e-ui` | `pnpm test:e2e --project=ui` | `ci.yml:131` |

**Les tests live ne sont pas en CI** — et c'est le comportement voulu : ils
inscrivent des comptes en production.

Deux commentaires de la CI méritent d'être lus (`ci.yml:62-69`, `ci.yml:84-91`) :
le job `lint` a été rendu bloquant parce qu'il laissait passer deux
`ReferenceError` en production (`GET /api/tournaments` → 500, `POST
/api/admin/matches/:id/award` → payload vide) ; et le job `e2e` a été ajouté
parce que les specs Playwright n'avaient **jamais** été exécutées — `pnpm
test:run` les collectait via Vitest et échouait en 7 « suites failed » sans un
seul test exécuté.

---

## 8. État mesuré au moment de la rédaction

Mesures exécutées le **2026-10-20** sur le dépôt local.

| Mesure | Commande | Résultat |
|---|---|---|
| Tests unitaires | `npx vitest run` | **846 passés**, 2 sautés, **75 fichiers**, 83 s |
| Tests E2E API | `npx playwright test --project=api --list` | **158 tests**, 11 fichiers |
| Tests E2E UI | `npx playwright test --project=ui --list` | **48 tests**, 6 fichiers |
| Tests live | `ZOYD_ALLOW_LIVE_TESTS=1 npx playwright test --project=live-api --project=live-ui --list` | **38 tests**, 2 fichiers |
| Chunks JS produits | `Get-ChildItem dist\assets -Filter *.js` | **44** (+ 1 CSS) |

Les deux tests sautés : `server/withdrawal-double-payout.test.mjs:150` et `:160`
(« exige FedaPay configure »).

> **Attention — ces chiffres sont un instantané, pas une garantie.** Le dépôt est
> travaillé en parallèle : pendant la rédaction de ce document, des en-têtes
> d'invariants ont été insérés en tête de 30+ fichiers `server/` et des
> correctifs de code ont été appliqués. Une seconde exécution, dix minutes
> plus tard, a donné **845 passés / 1 échec** : `server/match-engine.test.mjs`
> échoue parce que `server/match-engine.mjs` importe désormais
> `DEFAULT_TRUST_SCORE` de `server/persistence.mjs`, export que le mock
> `./persistence.mjs` du test ne fournit pas encore.
>
> **La leçon :** un chiffre de suite verte n'est un fait que pour l'instant où
> il a été mesuré. C'est exactement la règle du §4.8 appliquée à la suite
> elle-même.

---

## 9. Recette de validation avant commit

L'ordre est important : le rapide d'abord, le lent ensuite.

```powershell
# 1. Typecheck — le plus rapide, bloque la CI
pnpm typecheck

# 2. Lint — bloque la CI
pnpm lint

# 3. Unitaires — la masse de la couverture
pnpm test:run

# 4. E2E API — le contrat HTTP réel
pnpm test:e2e --project=api

# 5. E2E UI — uniquement si le front a changé
pnpm test:e2e --project=ui

# 6. Build — obligatoire si le front a changé
pnpm build
```

**Et si le commit touche de l'argent** : appliquer la recette de mutation
(§5) sur le garde concerné. Un test d'argent qui n'a pas été muté n'est pas
un test d'argent — c'est un test qui n'a pas encore échoué.

---

## 10. Voir aussi

| Document | Sujet |
|---|---|
| `docs/00-INDEX.md` | point d'entrée ; la règle « mue-le » (§6, étape 5) |
| `docs/01-architecture.md` | le serveur, ses gardes, ses verrous |
| `docs/03-securite.md` | `requireAdmin2fa`, CSRF, rate limiter, OCC — et la mutation-testabilité du garde admin (§3.3) |
| `docs/05-invariants.md` | les 54 invariants, les 15 violations V1–V15, et sa propre §6 « Ce que les tests ne prouvent pas » |
| `docs/08-frontend.md` | le front : routeur, stores, temps réel, SEO, `matchPayout.ts` |
