# ZOYD — Le front

> **Ce document décrit l'application React** : arborescence, routeur, stores,
> client temps réel, design system, SEO, inventaire des pages.
>
> Il ne décrit ni le modèle métier (→ `docs/02-modele-metier.md`), ni la
> surface de sécurité (→ `docs/03-securite.md`), ni les invariants d'argent
> (→ `docs/05-invariants.md`), ni les tests (→ `docs/06-tests.md`).
>
> **Portée :** `src/` — 197 fichiers (mesuré le 2026-10-20).

**Source :** lecture directe du code. Base : dépôt local
`E:\web_app\projrt\Z.O.Y.D\Zoyd`, commit de travail `0328dc8`.

**Conventions de citation :** `fichier:ligne`. Les lignes renvoient à l'**état
du working tree au moment de la rédaction** (2026-10-20), pas au commit
`0328dc8` : le dépôt reçoit en parallèle l'insertion d'en-têtes d'invariants
en tête des fichiers `server/`, ce qui décale les numéros de ligne de quelques
dizaines. Les citations `server/` sont donc doublées du **nom du symbole**,
qui reste l'ancre stable.

---

## 1. Vue d'ensemble

| Élément | Valeur | Source |
|---|---|---|
| Framework | React 18.3 + TypeScript 5.6 | `package.json:61`, `:90` |
| Build | Vite 6.3.5 | `package.json:91` |
| Routeur | React Router 7 (`react-router`, pas `react-router-dom`) | `package.json:65` |
| État | Zustand 5 | `package.json:73` |
| Temps réel | socket.io-client 4.8 | `package.json:68` |
| Styles | Tailwind CSS 4 + `@tailwindcss/vite` | `package.json:89`, `:78` |
| Composants UI | Radix UI (primitives) + `class-variance-authority` + `tailwind-merge` | `package.json:27-51`, `:54`, `:69` |
| Animation | `motion` 12 (ex-Framer Motion) | `package.json:59` |
| Graphiques | Recharts 2 | `package.json:66` |
| SEO | `react-helmet-async` | `package.json:63` |
| Formulaires | `react-hook-form` 7 + Zod 4 | `package.json:64`, `:72` |
| Tests unitaires front | Vitest (environnement `node`) + Testing Library | `package.json:92`, `:80` |

**Point d'entrée :** `src/main.tsx:39-45` — `createRoot(#root)` dans un
`<StrictMode>` enveloppé d'un `RootErrorBoundary` (`:7-37`). Le boundary racine
est en styles inline (pas de Tailwind) pour rester affichable même si le CSS
n'est pas chargé.

**Racine de l'application :** `src/app/App.tsx:25-50`. Elle monte, dans cet
ordre :

1. `useServiceWorker()` — `:26`
2. `useAuthSessionBootstrap()` — `:27`
3. `useChatSessionBootstrap()` — `:28`
4. `useWalletSessionBootstrap()` — `:29`
5. `ErrorBoundary` → `HelmetProvider` → `MotionConfig reducedMotion="user"` →
   `RouterProvider` — `:31-48`

> « `theme.css` neutralise deja les animations CSS sous
> `prefers-reduced-motion`. Mais 26 composants sont animes par `motion`, en
> JavaScript : cette preference ne les atteint pas, et Framer Motion ignore le
> reglage systeme par defaut. » — `src/app/App.tsx:33-43`

`MotionPreferenceReporter` (`src/app/App.tsx:17-23`) publie la préférence
résolue sur `<html>` (`data-reduced-motion`) : le test d'accessibilité vérifie
le **comportement constaté**, pas la configuration déclarée.

---

## 2. L'arborescence de `src/`

Mesuré le 2026-10-20 (197 fichiers).

```
src/                                    2   main.tsx, vite-env.d.ts
├── app/                                2   App.tsx, routes.tsx
│   ├── components/                     7   MatchCard, SEOHead, ErrorBoundary,
│   │   │                                   RouteErrorBoundary, EmptyPanel,
│   │   │                                   CountdownTimer, LiveTicker
│   │   ├── components/admin/            6   AdminOverviewTab, AdminMatchesTab,
│   │   │                                   AdminUsersTab, AdminReportsTab,
│   │   │                                   AdminUrgencyTab, AdminTabShared
│   │   ├── components/ui/              42   40 composants + use-mobile.ts + utils.ts
│   │   ├── components/layout/           3   Navbar, Sidebar, BottomNav
│   │   ├── components/notifications/    3   NotificationDropdown, ToastContainer,
│   │   │                                   NotificationSettingsModal
│   │   ├── components/profile/          1   ProfileView
│   │   ├── components/social/           1   FriendsWidget
│   │   ├── components/trust/            1   TrustScoreBadge
│   │   ├── components/wallet/           1   WithdrawalFeesNotice
│   │   ├── components/branding/         1   ZoydLogo
│   │   └── components/figma/            1   ImageWithFallback
│   ├── layouts/                        3   RootLayout, AppLayout, AuthLayout
│   ├── pages/                         15   (voir §10)
│   ├── pages/auth/                     4   Login, Register, Activate, ForgotPassword
│   ├── pages/legal/                    7   LegalLayout + 6 pages
│   ├── pages/mj/                       3   HubMJPage, CreateMatchPage, CreateTournamentPage
│   ├── stores/                        25   14 modules + 11 tests
│   ├── lib/                           20   18 modules + 2 tests
│   └── hooks/                          7   (voir §6.1)
├── features/                          27
│   ├── match/                          8   MatchDetailPage + 7 composants
│   ├── tournament/                     8   TournoisPage, TournamentBracketPage + 6 composants
│   ├── league/                         7   LeaguePage, LeagueSeasonPage + 5 composants
│   └── br/                             4   BrPage, BrLobbyDetailPage + 2 composants
├── lib/                               10   9 modules + 1 test
├── styles/                             4   index.css, tailwind.css, theme.css, fonts.css
└── test/                               1   setup.ts
```

**La règle de dépendance qui tient tout :**

```
src/lib/**         ← aucune dépendance à src/app/**
src/app/lib/**     ← dépend de src/lib/** et src/app/stores/**
src/app/stores/**  ← dépend de src/app/lib/**
src/app/components|features|pages ← dépendent de tout ce qui précède
```

Elle est explicitement upheld par `src/app/lib/apiUrl.ts:1-20` : `getBaseUrl`
et `getApiUrl` vivent dans un **module feuille** (aucun import) précisément
pour casser le cycle
`apiClient → sessionReset → socketStore → socketConnectionStore → realtimeClient → apiClient`.
Rollup signalait « circular dependency between chunks / likely to break
execution order » (`apiUrl.ts:14-15`). Le même cycle est résolu **deux fois**,
par deux mécanismes distincts :

| Cycle | Résolution | Fichier |
|---|---|---|
| `apiClient → sessionReset → socketStore → … → apiClient` | module feuille `apiUrl.ts` | `src/app/lib/apiUrl.ts:24-33` |
| `apiClient → sessionReset → socketStore → … → apiClient` | **registre** de purge (`setSessionPurgeHandler`) | `src/app/lib/sessionPurge.ts:25-48` |

Le registre est branché au chargement de `useAuthSessionBootstrap`
(`src/app/hooks/useAuthSessionBootstrap.ts:19`), appelé au top-level de
`App.tsx:27` — donc **garanti avant le premier rendu et avant toute requête
réseau** (`useAuthSessionBootstrap.ts:14-18`).

---

## 3. Le routeur — `src/app/routes.tsx`

`createBrowserRouter` (`src/app/routes.tsx:43`). **35 entrées de route** :
34 URLs feuilles (chacune rend un écran) + le parent `/auth`, qui n'a pas
d'`index` et ne rend donc qu'un `<Outlet />` vide.

### 3.1 Inventaire

| # | URL | Écran | Ligne | Chargement |
|---|---|---|---|---|
| 1 | `/` | `RootIndexPage` | `:49-52` | **synchrone** |
| 2 | `/auth` | `AuthLayout` (vide — **pas d'index**) | `:53-74` | statique |
| 3 | `/auth/login` | `LoginPage` | `:57-60` | statique |
| 4 | `/auth/register` | `RegisterPage` | `:61-64` | statique |
| 5 | `/auth/activate` | `ActivatePage` | `:65-68` | statique |
| 6 | `/auth/forgot` | `ForgotPasswordPage` | `:69-72` | statique |
| 7 | `/mode` | `ModeSelectionPage` | `:75-78` | `lazy` `:22` |
| 8 | `/conditions` | `ConditionsPage` | `:80-83` | statique |
| 9 | `/reglement-litiges` | `LitigesPage` | `:84-87` | statique |
| 10 | `/anti-fraude` | `AntiFraudePage` | `:88-91` | statique |
| 11 | `/confidentialite` | `ConfidentialitePage` | `:92-95` | statique |
| 12 | `/mentions` | `MentionsPage` | `:96-99` | statique |
| 13 | `/jeu-responsable` | `JeuResponsablePage` | `:100-103` | statique |
| 14 | `/mj` | `HubMJPage` | `:109-112` | `lazy` `:23` |
| 15 | `/mj/creer` | `CreateMatchPage` | `:113-116` | `lazy` `:24` |
| 16 | `/mj/match/:id` | `MatchDetailPage` | `:117-120` | `lazy` `:32` |
| 17 | `/mj/tournois` | `TournoisPage` | `:121-124` | `lazy` `:33` |
| 18 | `/mj/tournois/creer` | `CreateTournamentPage` | `:125-128` | `lazy` `:25` |
| 19 | `/mj/créer` | → `/mj/creer` | `:129-133` | `Navigate` |
| 20 | `/mj/tournois/créer` | → `/mj/tournois/creer` | `:134-137` | `Navigate` |
| 21 | `/mj/tournois/:id` | `TournamentBracketPage` | `:138-141` | `lazy` `:34` |
| 22 | `/wallet` | `WalletPage` | `:146-154` | `lazy` `:26` |
| 23 | `/earnings` | `EarningsDashboard` | `:156-161` | `lazy` `:31` |
| 24 | `/classements` | `ClassementsPage` | `:162-167` | `lazy` `:28` |
| 25 | `/chat` | `ChatPage` | `:168-173` | `lazy` `:29` |
| 26 | `/profil` | `ProfilPage` | `:174-182` | `lazy` `:27` |
| 27 | `/profil/:id` | `PublicProfilPage` | `:179-181` | `lazy` `:41` |
| 28 | `/parametres` | `ParametresPage` | `:183-188` | `lazy` `:30` |
| 29 | `/br-league` | `LeaguePage` | `:189-197` | `lazy` `:35` |
| 30 | `/br-league/:seasonId` | `LeagueSeasonPage` | `:194-196` | `lazy` `:36` |
| 31 | `/br` | `BrPage` | `:201-208` | `lazy` `:37` |
| 32 | `/br/:lobbyId` | `BrLobbyDetailPage` | `:205-207` | `lazy` `:38` |
| 33 | `/infos` | `LeaksPage` | `:209-214` | `lazy` `:39` |
| 34 | `/admin` | `AdminDashboardPage` | `:215-220` | `lazy` `:40` (`adminLoader`) |
| 35 | `*` | `NotFoundPage` | `:221-224` | statique |

**Deux points d'attention vérifiés :**

- **La route 2 `/auth` n'a pas d'`index`.** `AuthLayout` ne rend qu'un `<Outlet />`
  (`src/app/layouts/AuthLayout.tsx:4-7`) : visiting `/auth` affiche donc une
  **page vide**. C'est un trou d'UX, pas une faille (aucune donnée n'y est
  exposée).
- **Les routes 19 et 20 sont des redirects de compatibilité** pour les URLs
  accentuées partagées avant le renommage (`routes.tsx:129-137`).

### 3.2 Chargement statique vs `lazy`

Le commentaire de `routes.tsx:7` est explicite : « Critical pages loaded
synchronously (landing + auth) ». Sont **statiques** : `RootIndexPage`,
les 4 pages d'auth, les 6 pages légales, `NotFoundPage` — 12 écrans.

Tout le reste passe par un **loader paresseux** : `const xxxLoader = async () => { const { default: Component } = await import('…'); return { Component }; }` (`routes.tsx:22-41`). Vingt loaders, un par écran non critique.

### 3.3 Erreurs de route

Chaque branche protégée a son `errorElement: <RouteErrorBoundary />`
(`routes.tsx:47`, `:107`, `:148`, `:159`, `:165`, `:171`, `:177`, `:186`,
`:192`, `:203`, `:213`, `:218`). La route racine également (`:47`).

---

## 4. Les layouts

| Layout | Fichier | Rôle |
|---|---|---|
| `RootLayout` | `src/app/layouts/RootLayout.tsx` | coquille globale : `ScrollToTop`, `<Outlet />`, `ToastContainer` (`:80-87`) ; charge matchs et tournois au démarrage et au retour de connexion (`:22-78`) |
| `AuthLayout` | `src/app/layouts/AuthLayout.tsx` | `<Outlet />` seul (`:4-7`) — aucune chrome |
| `AppLayout` | `src/app/layouts/AppLayout.tsx` | chrome applicative : `Navbar`, `Sidebar`, `BottomNav`, saut de contenu, `useRealtimeHeartbeat` |

**`AppLayout`** (`src/app/layouts/AppLayout.tsx:14-57`) :

| Élément | Ligne | Détail |
|---|---|---|
| `requireAdmin` (prop) | `:9-12`, `:35-37` | redirection vers `/mj` si `user.role !== 'admin'` |
| garde d'authentification | `:31-33` | `<Navigate to="/auth/login" replace />` si `!isAuthenticated` |
| chargement | `:23-29` | spinner pendant `isLoading` |
| lien d'évitement | `:41-43` | `<a href="#main-content">` — accessibilité |
| zone principale | `:50` | `min-w-0` + `overflow-x-clip` (sinon le min-content des descendants étire `main` au-delà du viewport) |
| `useRealtimeHeartbeat` | `:21` | branché au montage du layout |

**`RootLayout`** charge les données au démarrage (`RootLayout.tsx:22-35`) puis
**bascule en polling** si le socket n'est pas connecté (`:37-52`, `:54-78`) :

> « Polling only when socket is NOT connected (realtime via socket when
> connected) » — `RootLayout.tsx:40`

---

## 5. Les gardes client : de l'UX, pas de la sécurité

**C'est le point à ne pas rater.** Le front a **trois** gardes, et **aucun**
n'est une barrière.

| Garde | Emplacement | Ce qu'il fait | Ce qu'il ne fait pas |
|---|---|---|---|
| `requireAdmin` (prop de `AppLayout`) | `src/app/layouts/AppLayout.tsx:35-37` | redirige vers `/mj` si le rôle n'est pas `admin` | **n'intercepte aucune requête** ; contournable en éditant le store |
| `adminLoader` (loader de route) | `src/app/routes.tsx:40` | charge `AdminDashboardPage` paresseusement | **ne vérifie rien** : c'est un simple `import()` |
| non-authentification | `src/app/layouts/AppLayout.tsx:31-33` | redirige vers `/auth/login` | un appel `curl` sur l'API n'est pas bloqué |

**La seule barrière réelle est côté serveur** : `requireAdmin` et
`requireAdmin2fa` (`server/admin-totp.mjs:160-172` et `:183-206`), appliqués
aux routes `/api/admin/*`.

> « Un garde CLIENT ne protege d'ailleurs rien — n'importe qui peut appeler
> `/api/admin/*` sans navigateur, sans React. »
> — `server/admin-totp-guard.test.mjs:9-12`

**La règle de lecture** (détaillée dans `docs/03-securite.md` §4) : devant un
garde client, se demander « si j'efface le navigateur et que j'appelle l'URL
avec `curl`, qu'est-ce qui m'arrête ? ». Si la réponse est « rien », le garde
est de l'UX.

**Conséquence pratique pour le front :** ne jamais traiter
`AppLayout requireAdmin` comme une autorisation. Une route `/api/admin/*` doit
être pensée comme accessible jusqu'à preuve du contraire — et c'est le serveur
qui décide.

---

## 6. Les stores Zustand

`src/app/stores/` — 14 modules, ré-exportés par `src/app/stores/index.ts:1-55`.

| Store | Fichier | Ce qu'il détient |
|---|---|---|
| `useAuthStore` | `authStore.ts` | `user`, `isAuthenticated`, `isLoading`, `expiresAt` (`:65-76`). **Cookie-only** : le token vit dans le cookie httpOnly `zoyd_auth`, jamais en JS (`:86-88`) |
| `useWalletStore` | `walletStore.ts` | `cashBalance`, `bonusBalance`, `lockedBalance`, `pendingWinnings`, `transactions`, `lockedEntries`, politique de retrait (`:40-72`) |
| `useMatchStore` | `matchStore.ts` | `matches`, filtres, projections `projectedPayouts` portées depuis M1 (`:186`, `:454-527`), `ACTIVE_STATUSES` (`:29`) |
| `useTournamentStore` | `tournamentStore.ts` | tournois, brackets, `callerEntryByTournament`, `callerArbiterSlotByTournament`, `openArbiterSlotsByTournament` |
| `useLeagueStore` | `leagueStore.ts` | saisons, classements, joueurs de ligue |
| `useChatStore` | `chatStore.ts` | canaux, messages, non-lus |
| `useFriendsStore` | `friendsStore.ts` | amis, demandes, blocages, signalements |
| `useNotificationStore` | `notificationStore.ts` | notifications, déduplication par `dedupeKey` |
| `usePresenceStore` | `presenceStore.ts` | présence par canal (`roomPresence`), saisie en cours (`typingByChannel`), `seenByChannel` (`:168-191`) |
| `useTrustScoreStore` | `trustScoreStore.ts` | score de confiance et son historique (`:12-30`) |
| `useToastStore` | `toastStore.ts` | toasts (`:14-28`) |
| `useSocketConnectionStore` | `socketConnectionStore.ts` | état de connexion, snapshots distants, `dirtySinceDisconnect` (`:83-99`) |
| `useSocketStore` | `socketStore.ts` | **simple ré-export** : `export { useSocketConnectionStore as useSocketStore }` (`:1`) + `usePresenceStore` (`:3`) |
| *(interne)* | `index.ts` | barrel de ré-exports (`:1-55`) |

### 6.1 Les hooks de session

| Hook | Fichier | Rôle |
|---|---|---|
| `useAuthSessionBootstrap` | `hooks/useAuthSessionBootstrap.ts` | revalide la session au chargement via `GET /api/auth/me` (`:39`) ; ne purge que sur un **401** (`:52-54`), pas sur un timeout ou un 502 — un cold-start Render ne doit pas éjecter l'utilisateur (`:48-51`) |
| `useWalletSessionBootstrap` | `hooks/useWalletSessionBootstrap.ts` | hydrate le portefeuille, avec **backoff** 2 s → 5 s → 10 s → 20 s (`:5`) ; passe le `userId` attendu pour ne pas écrire le solde d'un autre compte (`:41-44`) |
| `useChatSessionBootstrap` | `hooks/useChatSessionBootstrap.ts` | hydrate canaux + messages (`:23-27`) |
| `useRealtimeHeartbeat` | `hooks/useRealtimeHeartbeat.ts` | connecte le socket, bootstrap, synchronise toutes les 15 s (`:7`, `:56`) |
| `useServiceWorker` | `hooks/useServiceWorker.ts` | enregistre `/sw.js` (`:10`), gère la mise à jour, souscrit au push |
| `useLogout` | `hooks/useLogout.ts` | déconnexion propre |
| `useDebounce` | `hooks/useDebounce.ts` | utilitaire |

### 6.2 Le cycle de synchronisation socket

Le cycle complet, en cinq temps :

```
1. useRealtimeHeartbeat (AppLayout)          → socketStore.connect(user)
2. connectRealtimeSocket(user)                → session realtime + socket.connect()
3. bindRealtimeHandlers({...})                → 13 événements branchés
4. bootstrapServerState(user)                 → GET /api/realtime/state/bootstrap
5. bootstrapReady = true                      → les deltas fluents sont appliqués
```

**1 — Connexion.** `useRealtimeHeartbeat` (`hooks/useRealtimeHeartbeat.ts:25-61`)
dépend de `user?.id`, **pas** de l'objet `user` :

> « Dependre de l'OBJET user était une boucle : chaque updateUser créait un
> nouvel objet → disconnect/connect + bootstrap, y compris à chaque
> hydrateFromServer du wallet. » — `hooks/useRealtimeHeartbeat.ts:10-12`

**2 — Session temps réel.** `connectRealtimeSocket`
(`src/app/lib/realtimeClient.ts:182-204`) appelle `ensureRealtimeSession`
(`:90-122`), qui POST `/api/realtime/auth/session` **avec le cookie**
(`credentials: 'include'`, `:103`) — le token temps réel est un Bearer, jamais
le cookie app (cf. `docs/01-architecture.md` §5.2).

**3 — Handlers.** `bindRealtimeHandlers` (`realtimeClient.ts:138-180`) retire
puis rebranche **13** événements. `on('connect_error')` (`:159-169`) régénère la
session et retente si le message contient `unauthorized` — c'est le chemin de
sortie du « sleep Render ».

**4 — Bootstrap.** `bootstrapServerState`
(`src/app/stores/socketConnectionStore.ts:352-380`) appelle
`fetchRealtimeBootstrap` (`realtimeClient.ts:273-336`) et hydrate les stores
amis, notifications, matchs, tournois. En cas d'échec : `serverConnected =
false` (`:374-379`).

**5 — Deltas.** `onMatchesSnapshot` / `onTournamentsSnapshot` alimentent
`remoteMatchSnapshots` / `remoteTournamentSnapshots`
(`socketConnectionStore.ts:168-173`), réinjectés par
`useRealtimeHeartbeat:63-71` via `hydrateFromServer` — **pas** `replaceFromServer` :

> « Le socket diffuse des DELTAS (le match modifié), pas la collection
> complete. Il faut donc FUSIONNER (hydrateFromServer) — replaceFromServer
> effacerait tous les autres matchs de la liste. »
> — `src/app/hooks/useRealtimeHeartbeat.ts:15-17`

### 6.3 Ce qui se passe hors ligne

Le socket diffuse **des deltas** et n'envoie aucun état initial à la connexion
(seulement `server:hello`, `server/realtime-server.mjs:446-450`). Tout ce qui
s'est passé pendant la coupure est **perdu**. D'où le drapeau
`dirtySinceDisconnect` (`socketConnectionStore.ts:90`) et la resynchronisation :

> « Sans cette resynchronisation, l'interface affiche "live" en vert tout en
> servant un etat perime — le joueur croit que tout va bien alors que l'etat
> affiche est faux. » — `socketConnectionStore.ts:144-147`

| Situation | Comportement | Ligne |
|---|---|---|
| Coupure réseau | `serverConnected = false`, `connectionLabel = 'syncing'`, `dirtySinceDisconnect = true` | `socketConnectionStore.ts:152-159` |
| Retour de la connexion | si `dirtySinceDisconnect && bootstrapReady` → `bootstrapServerState(user)` | `socketConnectionStore.ts:148-150` |
| Socket jamais connecté | **polling** HTTP des matchs et tournois | `src/app/layouts/RootLayout.tsx:41`, `:65` |
| Échec du bootstrap | `bootstrapReady` reste `false`, `dirtySinceDisconnect` remis à `false` (`:372`), nouvelle tentative au prochain montage (`useRealtimeHeartbeat.ts:41-45`) |
| Serveur Render en veille | le 1ᵉʳ appel timeout (30 s) puis le 2ᵉ passe — message dédié | `src/app/lib/apiClient.ts:190-195` |

**La purge de session hors ligne.** Un 401 purge l'état (solde, matchs, chat,
amis) pour qu'un compte connecté ensuite ne voie pas les données du précédent
(`src/app/lib/sessionReset.ts:13-19`). `handleAuthError`
(`src/app/lib/apiClient.ts:36-53`) ne purge que sur un **401**, ou sur un
**403 `AUTH_REQUIRED`** — jamais sur un 403 métier (2FA, mot de passe actuel
faux, transaction d'un autre compte).

---

## 7. Le client temps réel — `src/app/lib/realtimeClient.ts`

414 lignes. Module **feuille** côté imports : il n'importe que le client
socket.io et des **types** (`realtimeClient.ts:2-13`). Il n'importe **jamais**
`apiClient` — c'est `apiUrl.ts` qu'il utilise, précisément pour ne pas
refermer le cycle (`realtimeClient.ts:4-6`).

### 7.1 La connexion

| Élément | Valeur | Ligne |
|---|---|---|
| `path` | `/socket.io` | `realtimeClient.ts:127` |
| `transports` | `['websocket', 'polling']` | `:128` |
| `autoConnect` | **false** | `:129` |
| `withCredentials` | **true** | `:131` |

`autoConnect: false` est nécessaire : le socket ne doit se connecter qu'après
l'obtention d'une session temps réel valide.

`getRealtimeSocket()` (`:124-136`) crée le socket **une seule fois** (module
singleton, `:78`). `bindRealtimeHandlers` (`:138-180`) fait `off()` sur les 13
événements avant de les rebrancher — sans cela, un remontage de composant
empilerait les handlers.

### 7.2 Les 13 événements branchés

| Événement serveur | Handler front | Ligne client | Effet sur les stores |
|---|---|---|---|
| `connect` | `onConnect` | `:155` | `serverConnected = true`, `connectionLabel = 'live'`, resync si `dirtySinceDisconnect` |
| `disconnect` | `onDisconnect` | `:156` | `serverConnected = false`, `dirtySinceDisconnect = true` |
| `connect_error` | *(inline)* | `:159-169` | régénère la session si `unauthorized` |
| `presence:snapshot` | `onPresenceSnapshot` | `:170` | `usePresenceStore.applyServerPresenceSnapshot` |
| `typing:snapshot` | `onTypingSnapshot` | `:171` | `usePresenceStore.applyServerTypingSnapshot` |
| `notification:deliver` | `onPushDelivery` | `:172` | `useNotificationStore.addNotification` (`:64-79`) |
| `state:matches` | `onMatchesSnapshot` | `:173` | `remoteMatchSnapshots` |
| `state:tournaments` | `onTournamentsSnapshot` | `:174` | `remoteTournamentSnapshots` |
| `state:leagues` | `onLeaguesSnapshot` | `:175` | `useLeagueStore.hydrateFromServer` |
| `wallet:update` | `onWalletUpdate` | `:176` | `useWalletStore.applyRemoteWallet` (soldes seuls) |
| `chat:channel` | `onChatChannel` | `:177` | `useChatStore.upsertServerChannel` |
| `chat:message` | `onChatMessage` | `:178` | `upsertServerChannel` + `receiveServerMessage` |
| `chat:read` | `onChatRead` | `:179` | `useChatStore.applyServerRead` |

**Garde multi-compte sur `wallet:update`** (`socketConnectionStore.ts:180-183`) :

> « L'événement peut arriver après un logout suivi d'une autre connexion. Sans
> ce contrôle, le solde du compte précédent s'écrirait dans le wallet du
> nouveau joueur. »

### 7.3 Les émissions (client → serveur)

| Émetteur | Événement | Ligne |
|---|---|---|
| `emitPresenceJoin` | `presence:join` | `:214-224` |
| `emitPresenceUpdate` | `presence:update` | `:226-236` |
| `emitPresenceLeave` | `presence:leave` | `:238-240` |
| `emitChannelSeen` | `channel:seen` | `:242-244` |
| `emitTypingUpdate` | `typing:update` | `:246-253` |
| `emitPushNotification` | `notification:push` | `:255-264` |

**Le client n'est pas maître de son identité.** Le serveur écrase
`userId` et `pseudo` par la session
(`server/realtime-server.mjs:470-474`, `:498-502`) ; le `role` de canal est
accepté depuis le client mais borné à `player|arbiter|spectator`
(`server/realtime-server.mjs:511`) et `team` à `0|1` (`:512`).

### 7.4 Le push Web

`subscribeToRealtimePush` (`realtimeClient.ts:367-395`) : récupère la clé
VAPID publique, souscrit le `PushManager`, puis POST `/api/realtime/push/subscribe`
avec un Bearer temps réel (`:382-392`). `unsubscribeFromRealtimePush` (`:397-414`)
fait l'inverse. L'abonnement est déclenché par `useServiceWorker` quand la
permission est déjà accordée (`useServiceWorker.ts:86-93`).

### 7.5 Une route supprimée, documentée

`realtimeClient.ts:338-342` conserve la trace de `syncRealtimeState` et de la
route `/api/realtime/state/sync` :

> « Le serveur refusait tout (409 pour les tournois, 400 sinon), et rien ne
> l'appelait. La fonction avait l'air de fonctionner, ce qui en faisait un
> piege : la rebrancher produisait un 400 sans explication. »

Le même raisonnement a été appliqué à `syncServerState` dans
`socketConnectionStore.ts:349-351` : action **exposée dans le store public**,
donc un piège pour le prochain qui aurait cru s'en servir.

---

## 8. Le design system

### 8.1 Les tokens

`src/styles/theme.css` — la source unique.

| Token | Valeur | Ligne |
|---|---|---|
| `--color-black` | `#050505` | `theme.css:3` |
| `--color-white` | `#FFFFFF` | `theme.css:4` |
| `--color-yellow` | `#FFFF00` | `theme.css:5` |
| `--color-blue` | `#0070FF` | `theme.css:6` |
| `--color-gray-900/800/700` | `#0A0A0A` / `#1A1A1A` / `#2A2A2A` | `theme.css:9-11` |
| `--font-display` | `Outfit`, sans-serif | `theme.css:14` |
| `--font-ui` | `Inter`, sans-serif | `theme.css:15` |
| `--font-mono` | `JetBrains Mono`, monospace | `theme.css:16` |
| `--sat`/`--sab`/`--sal`/`--sar` | `env(safe-area-inset-*)` | `theme.css:19-22` |

Exposés à Tailwind via `@theme inline` (`theme.css:25-38`) :
`zoyd-black`, `zoyd-white`, `zoyd-yellow`, `zoyd-blue`, `zoyd-surface`,
`zoyd-border`, `zoyd-muted`.

> **Le bleu est bien une couleur du design system** (`#0070FF`), au même titre
> que le jaune, le noir et le blanc. Une version antérieure du README
> affirmait le contraire et donnait de mauvaises valeurs — corrigé par le
> commit `f02e739`.

**Ordre d'import des styles :** `src/styles/index.css:1-3` → `fonts.css`,
`tailwind.css`, `theme.css`. `tailwind.css:1-2` déclare
`@import 'tailwindcss' source(none)` puis `@source '../**/*.{js,ts,jsx,tsx}'`
— la détection de classes est **explicite**, pas automatique.

**Polices.** `src/styles/fonts.css:1` charge Outfit + Inter depuis Google
Fonts ; `index.html:27` charge JetBrains Mono. Le fond `html, body` est forcé à
`#000` par un style inline (`index.html:79`) — avant même le chargement du
CSS, pour éviter le flash blanc.

### 8.2 Les utilitaires

`theme.css:77-161` : `safe-top`/`safe-bottom`/`safe-left`/`safe-right`
(`:78-81`), `pb-safe`/`pb-safe-sm` (`:82-83`), `touch-target` 44×44 (`:85-88`),
`tactical-grid` (`:91-96`), `scanline` (`:99-119`), `hud-panel` (`:122-124`),
`tactical-border-y` (`:127-130`), `animate-pulse-yellow` (`:137-140`),
`animate-marquee` (`:142-147`), `scrollbar-hide` (`:150-151`) et le bloc
`prefers-reduced-motion` (`:154-161`).

### 8.3 Les 40 composants de `src/app/components/ui/`

Portés de shadcn/ui, adaptés au design system ZOYD.

| Famille | Composants |
|---|---|
| Actions | `Button`, `Badge`, `Toggle`, `ToggleGroup` |
| Formulaires | `Input`, `Textarea`, `Label`, `Form`, `Checkbox`, `RadioGroup`, `Select`, `Slider`, `Switch` |
| Conteneurs | `Card`, `Table`, `Tabs`, `Accordion`, `Collapsible`, `Sheet`, `Dialog`, `AlertDialog`, `Popover`, `HoverCard`, `Tooltip`, `DropdownMenu`, `ContextMenu`, `Menubar`, `NavigationMenu` |
| Affichage | `Avatar`, `Breadcrumb`, `Chart`, `Pagination`, `ProgressBar`, `ScrollArea`, `Separator`, `Skeleton`, `AspectRatio`, `Modal`, `Sidebar`, `Alert` |
| Aides | `use-mobile.ts`, `utils.ts` (`cn`) |

**Les 40 composants listés ci-dessus sont portés de shadcn/ui** et adaptés au
design system ZOYD. Les deux qui structurent le reste sont `Button` et `Badge`.

`cn` (`src/app/components/ui/utils.ts:4-6`) = `twMerge(clsx(inputs))` — la
combinaison classique qui résout les conflits Tailwind.

**Deux composants sont structurants :**

`Button` (`ui/Button.tsx:6-33`) — variantes via `cva` :

| Variante | Classes | Ligne |
|---|---|---|
| `primary` | `bg-zoyd-yellow text-zoyd-black hover:bg-zoyd-yellow/90` | `:11` |
| `secondary` | `bg-white/5 text-white border border-white/20 hover:bg-white/10 hover:border-zoyd-yellow` | `:12` |
| `ghost` | `bg-transparent text-white hover:bg-white/5` | `:13` |
| `danger` | `… hover:border-red-500` | `:14` |

Tailles `sm|md|lg|xl`, toutes en `min-h-[44px]` (`:17-21`) — cible tactile
mobile. L'animation est un `motion.div` avec `whileHover={{ scale: 1.02 }}` /
`whileTap={{ scale: 0.98 }}` (`:56`).

`Badge` (`ui/Badge.tsx:5-21`) — variantes `default`, `yellow`, `success`,
`live` (`bg-zoyd-yellow text-zoyd-black animate-pulse-yellow`), `disabled`.
**Les variantes `yellow` et `success` sont identiques** (`:11-12`) : le design
system n'a pas de vert.

---

## 9. Le SEO

### 9.1 Les trois sources de vérité

| Source | Ce qu'elle porte | Fichier |
|---|---|---|
| `index.html` | `<title>`, description, Open Graph, Twitter Card, JSON-LD, manifest, icônes | `index.html:28-79` |
| `SEOHead` | `<title>`, description, canonical, OG, Twitter, `noindex` — injectés à l'exécution | `src/app/components/SEOHead.tsx:25-59` |
| `LandingPage` | le `SEOHead` de la page d'accueil | `src/app/pages/LandingPage.tsx:109-113` |

`SEOHead` s'appuie sur `react-helmet-async` (`:1`) et est monté sous
`HelmetProvider` (`src/app/App.tsx:32`).

**`index.html` en détail :**

| Élément | Valeur | Ligne |
|---|---|---|
| `<title>` | `ZOYD — Wagers sécurisés et arbitrage rémunéré sur CODM` | `index.html:31` |
| `<meta name="description">` | « Créez vos matchs compétitifs sur CODM : wagers sécurisés, arbitrage rémunéré, gains Mobile Money. La plateforme compétitive conçue pour l'Afrique. » | `index.html:28` |
| OG (`og:type`/`title`/`description`/`image`/`url`/`locale`/`site_name`) | image `https://zoyd.vercel.app/og.png`, 1200×630 | `index.html:34-42` |
| Twitter Card | `summary_large_image` | `index.html:45-48` |
| JSON-LD | `@type: WebApplication`, `applicationCategory: GameApplication`, `offers: 0 XOF`, `inLanguage: fr` | `index.html:53-74` |
| manifest / icônes | `/manifest.json`, `/logo-icon.png`, `/logo.png` | `index.html:76-78` |

**`SEOHead` en détail :**

| Élément | Ligne |
|---|---|
| `SITE` = `VITE_SITE_URL` ou repli `https://zoyd.vercel.app` | `:13-14` |
| `<title>` | `:38` |
| `<meta name="description">` | `:39` |
| `<link rel="canonical">` | `:40` |
| `noindex` (`robots: noindex, nofollow`) | `:42` |
| Open Graph (type, title, description, url, image, site_name, locale `fr_FR`) | `:45-51` |
| Twitter Card (card, title, description, image) | `:54-57` |

### 9.2 Le titre est défini à **DEUX** endroits

**C'est le piège à connaître.** Le `<title>` de la page d'accueil est
écrit **deux fois** :

| Endroit | Valeur | Ligne |
|---|---|---|
| `index.html` (statique, dans le `<head>`) | `ZOYD — Wagers sécurisés et arbitrage rémunéré sur CODM` | `index.html:31` |
| `LandingPage.tsx` (dynamique, via `SEOHead`) | `ZOYD — Wagers sécurisés et arbitrage rémunéré sur CODM` | `src/app/pages/LandingPage.tsx:110` |

Les deux valeurs sont **identiques aujourd'hui** — et c'est exactement le
problème : rien n'oblige à les garder synchronisées.

**Conséquence.** Corriger le titre d'un seul côté crée une **divergence** :

| On corrige… | …et on laisse | Ce qui se passe |
|---|---|---|
| `index.html:31` | `LandingPage.tsx:110` | le titre affiché change après le chargement de React (Helmet écrase le `<title>` du document) — mais l'aperçu réseau, le marque-page, et **les crawlers qui lisent le HTML initial** voient l'ancien. Un crawler qui n'exécute pas de JS voit un titre différent de celui du site. |
| `LandingPage.tsx:110` | `index.html:31` | inverse. |

**La même règle s'applique à la description** (`index.html:28` vs
`LandingPage.tsx:111`) et au bloc JSON-LD (`index.html:53-74`), qui n'a
**aucun** équivalent dynamique : si le `description` change, il faut changer
les **deux** descriptions **et** le JSON-LD.

**Recommandation** (non appliquée — ce document ne modifie rien) : extraire la
chaîne commune dans une constante importée par `index.html` (via un plugin
Vite) **et** par `SEOHead`, ou supprimer la description dynamique de
`LandingPage` pour que `index.html` reste la seule source.

### 9.3 L'URL de site

`SEOHead` lit `VITE_SITE_URL` au build (`:13-14`), avec repli sur la
production. Avant le commit `046e1c1`, `SITE` était codé en dur sur
`https://zoyd.vercel.app` : en développement, chaque URL canonique et chaque
carte Open Graph annonçaient la production — un lien partagé depuis le local
menait à la prod, et l'aperçu montrait toujours la prod.

Le repli production reste la valeur par défaut : un build sans variable doit
produire la production, **pas une URL vide** (`:11-12`).

**Point de cohérence :** `index.html:37`, `:40`, `:48`, `:58`, `:70` pointent
tous en dur sur `https://zoyd.vercel.app` — **hors** `VITE_SITE_URL`. Même
correction à faire pour eux si l'on veut un build local cohérent.

### 9.4 La CSP

Elle est posée par Vercel, sur les **documents** (`vercel.json`, en-tête
`Content-Security-Policy`) : `default-src 'self'`, `script-src 'self'
https://cdn.fedapay.com`, `frame-ancestors 'none'`, `base-uri 'self'`.
Le commentaire de `index.html:50` le rappelle : « meta tags ignored for
frame-ancestors » — les balises `<meta>` ne peuvent pas porter une CSP.

L'API **n'est pas** couverte par cette CSP (elle est sur une autre origine) :
`docs/03-securite.md` §16.14.

---

## 10. Inventaire des pages

### 10.1 Pages de `src/app/pages/` (15)

| Fichier | Rôle | Route |
|---|---|---|
| `RootIndexPage.tsx` | aiguillage `/` → landing | `/` |
| `LandingPage.tsx` (29 Ko) | page d'accueil, hero vidéo, `SEOHead` | `/` |
| `ModeSelectionPage.tsx` | choix du mode (MJ / BR / Ligue) | `/mode` |
| `DashboardPage.tsx` (34 Ko) | hub MJ / tableau de bord joueur | `/mj` |
| `ClassementsPage.tsx` | classements | `/classements` |
| `WalletPage.tsx` (42 Ko) | portefeuille, dépôts, retraits | `/wallet` |
| `EarningsDashboard.tsx` + `EarningsCharts.tsx` | gains et graphiques | `/earnings` |
| `ChatPage.tsx` (18 Ko) | messagerie | `/chat` |
| `ProfilPage.tsx` / `PublicProfilPage.tsx` | profil propre / profil public | `/profil`, `/profil/:id` |
| `ParametresPage.tsx` (43 Ko) | réglages, sécurité, 2FA | `/parametres` |
| `AdminDashboardPage.tsx` (27 Ko) | administration | `/admin` |
| `LeaksPage.tsx` (38 Ko) | « infos » — l'état réel de la plateforme | `/infos` |
| `NotFoundPage.tsx` | 404 | `*` |

### 10.2 Pages de `src/app/pages/auth/` (4)

`LoginPage.tsx` (14 Ko), `RegisterPage.tsx` (38 Ko), `ActivatePage.tsx` (10 Ko),
`ForgotPasswordPage.tsx` (9 Ko).

### 10.3 Pages légales (7)

`LegalLayout.tsx` + `ConditionsPage.tsx`, `LitigesPage.tsx`,
`AntiFraudePage.tsx`, `ConfidentialitePage.tsx`, `MentionsPage.tsx`,
`JeuResponsablePage.tsx`. Elles sont **hors** `AppLayout` : pas de chrome, pas
de session requise (`routes.tsx:79-104`).

### 10.4 Pages `src/app/pages/mj/` (3)

`HubMJPage.tsx` (14 Ko), `CreateMatchPage.tsx` (35 Ko),
`CreateTournamentPage.tsx` (33 Ko).

### 10.5 Pages de `src/features/` (10)

| Domaine | Page | Composants |
|---|---|---|
| **match** | `MatchDetailPage.tsx` (41 Ko) | `MatchHeader`, `MatchActions` (32 Ko), `MatchChat`, `MatchPlayers`, `MatchResults`, `MatchRules`, `MatchTimeline` |
| **tournament** | `TournoisPage.tsx`, `TournamentBracketPage.tsx` (24 Ko) | `TournamentCard`, `BracketHeader`, `BracketMatchCard`, `BracketGrid`, `BracketActions`, `BracketSidebar` |
| **league** | `LeaguePage.tsx`, `LeagueSeasonPage.tsx` (24 Ko) | `StandingsTable`, `QualificationPanel`, `AdminPanel`, `FinalResultsForm`, `leagueSeasonConstants.ts` |
| **br** | `BrPage.tsx`, `BrLobbyDetailPage.tsx` | `BrLobbyCreatePanel`, `BrArbiterPanel` (22 Ko) |

**Note de découpage.** Le dépôt sépare deux notions de « feature » :

- `src/features/<domaine>/` = le **cœur métier** d'un domaine (page + composants
  dédiés), importé paresseusement.
- `src/app/pages/<sous-domaine>/` = les écrans **secondaires** d'un domaine
  (`mj/`), et `src/app/components/<domaine>/` = les composants transverses
  (`admin/`, `profile/`, `wallet/`, `social/`, `trust/`, `notifications/`).

Le découpage n'est pas strict : `AdminDashboardPage` est dans `app/pages/` alors
que ses onglets sont dans `app/components/admin/`. C'est historique, pas
normatif.

---

## 11. Les points de vigilance — quatre bugs récents, corrigés

Ces quatre défauts ont la même signature : **invisibles à l'œil, invisibles aux
tests unitaires, et échappés au build**. Ils sont documentés ici avec ce
qu'ils **étaient** et ce qu'ils **sont devenus**.

### 11.1 Le double encodage — corrigé

| | |
|---|---|
| **Était** | Des fichiers source relus avec `Get-Content -Raw` (décodage ANSI) puis réécrits en UTF-8 : les accents devenaient « Ã¨ » / « Â§ ». Le fichier passait `node --check` **et** les tests ; l'erreur n'apparaissait qu'au lint, sous le nom opaque « irregular whitespace ». |
| **Devenu** | Zéro mojibake dans `.mjs`/`.ts`/`.tsx`/`.js`/`.sql`, et un **garde-fou réactif** : `server/encoding-integrity.test.mjs` (84 lignes) qui échoue vite et sans ambiguïté. |

Historique vérifié :

| Commit | Portée |
|---|---|
| `be49b60` | `src/app/lib/walletApi.ts` — « n'Ã©met » → « n'émet » |
| `e5754b0` | 5 fichiers de plus : `e2e/api/auth-hardening.spec.ts`, `server/league-orphan-lock.test.mjs`, `server/match-engine.test.mjs`, `server/settlement-stats-and-lock.test.mjs`, `server/withdrawal-daily-cap.test.mjs` ; et réactivation du garde (`it.skip` → `it`) |

> « Cinq fichiers, et NON quatre : `e2e/api/auth-hardening.spec.ts` etait detruit
> depuis le depart (un tiret cadratin) et mon inventaire manuel l avait rate. Son
> regex de diagnostic etait plus etroit que celui du garde-fou — c'est
> exactement ce que le garde-fou existe pour rattraper. » — commit `e5754b0`

> « Le code n a pas changé : uniquement des commentaires et libelles de test. »
> — commit `e5754b0`

**Le garde-fou** : `server/encoding-integrity.test.mjs:43-64` (parcours de
`.`, regex de signatures) et `:66-83` (cibles critiques : `persistence.mjs`,
`wallet-engine.mjs`, `routes/wallet.mjs`, `supabase/schema.sql`).

**Limite à connaître** : le garde ne couvre que les extensions listées
(`:44`). Le `.gitignore` du dépôt est lui-même corrompu et n'est pas couvert —
c'est vérifié, ce n'est pas une supposition.

### 11.2 `selection:` — corrigé

| | |
|---|---|
| **Était** | `src/app/pages/LandingPage.tsx:108` portait `sélection:bg-zoyd-yellow sélection:text-black` — **l'accent rendait la classe ingénérable par Tailwind**. Le style de sélection du texte n'existait pas. |
| **Devenu** | `selection:bg-zoyd-yellow selection:text-black` (sans accent) — la classe existe et est **présente dans le CSS généré**. |

> « L'accent de "selection" rendait la classe ingenérable par Tailwind : le
> style de selection du texte n'existait pas. Le reste de la classe etait
> correct, ce qui rendait l'erreur facile a rater. » — commit `74df122`

**Le piège jumeau, corrigé dans le même commit :**
`src/app/components/ui/Card.tsx:18` portait `hover:border-zoyd-yellow-50` —
**classe invalide** : l'opacité s'écrit `/50`, pas `-50`. La classe voisine
`hover:shadow-zoyd-yellow/10` montrait le motif voulu. Conséquence : la
bordure jaune au survol ne s'appliquait pas, silencieusement.

**Vérification dans le build** (voir `docs/06-tests.md` §6.2) :
`hover:border-zoyd-yellow/50` est présent dans `dist/assets/Card-DgtkzJh4.js`
et l'ancienne classe `hover:border-zoyd-yellow-50` est **absente de tout le
build**.

> « Les deux CSS sont verifies dans le CSS GENERE, pas seulement dans la
> source : les trois classes sont presentes, l'ancienne est absente. Une
> correction de classe qui ne se verrait pas dans le build serait une
> correction au papier. » — commit `74df122`

### 11.3 L'état fantôme de `socketConnectionStore` — corrigé

| | |
|---|---|
| **Était** | `connect(user)` posait l'état optimiste `{ isConnected: true, connectionLabel: 'live'\|'syncing' }` **avant** le garde `if (!user) return`. Sans utilisateur, la fonction annonçait « connecté » puis sortait **sans lier les handlers ni ouvrir le socket**. L'interface affichait un indicateur vert pour une connexion qui n'existait pas. |
| **Devenu** | Le garde passe **en premier** (`socketConnectionStore.ts:123-125`). `isConnected` signifie « on cherche à être connecté » ; `serverConnected` signifie « le socket est réellement ouvert ». Sans utilisateur, les deux restent faux. |

> « L'etat optimiste (`isConnected: true`) etait pose AVANT ce garde : sans
> utilisateur, la fonction annoncait "connecte" puis sortait sans lier les
> handlers ni ouvrir le socket. L'interface affichait un etat vert pour une
> connexion qui n'existait pas — et rien ne pouvait le trahir. »
> — `src/app/stores/socketConnectionStore.ts:114-122`

**La distinction des deux drapeaux** est documentée dans le code
(`socketConnectionStore.ts:120-122`) : `isConnected` = « on cherche à être
connecté » ; `serverConnected` = « le socket est réellement ouvert ».

**Pourquoi c'est grave et pas cosmétique.** Le même mécanisme produisait un
affichage « live » **en vert** alors que l'état servi était périmé. Le
correctif de fond est ailleurs : `dirtySinceDisconnect`
(`socketConnectionStore.ts:90`) + la resynchronisation au retour
(`:148-150`).

### 11.4 L'expiration de session — corrigée

| | |
|---|---|
| **Était** | `getAuthHeaders()` (`src/app/lib/apiClient.ts`) vérifiait `expiresAt` **côté store** et déconnectait le joueur si la date était passée. Or le token vit dans un cookie **httpOnly** : le client ne peut pas connaître son expiration réelle. `expiresAt` n'en est qu'un **miroir**, et il dérive dès qu'une session a été prolongée ailleurs, qu'un onglet a changé avant l'autre, ou qu'un déploiement a changé les durées de vie. |
| **Devenu** | **Toute vérification d'expiration a été retirée** de `getAuthHeaders()` (`src/app/lib/apiClient.ts:12-34`). Le serveur est l'autorité ; un store périmé se résout au premier appel qui répond **401**. |

> « Sur une divergence, le comportement etait le pire des deux : deconnecter un
> joueur dont le cookie est parfaitement valide, alors que le serveur l aurait
> accepte. Il n'avait aucun moyen de le savoir. »
> — `src/app/lib/apiClient.ts:22-27`

Le chemin qui remplace la vérification existe déjà : `handleAuthError`
(`apiClient.ts:36-53`) purge l'état sur un **401**, ou sur un **403
`AUTH_REQUIRED`** — jamais sur un 403 métier comme la 2FA
(`apiClient.ts:36-40`).

**Le pendant serveur** : `useAuthSessionBootstrap.ts:47-61` ne purge que sur un
vrai `401` ; un cold-start Render (timeout 30 s) ou un 502 proposent un
réessai au lieu d'éjecter l'utilisateur.

### 11.5 Deux corrections front à côté des quatre

| Correction | Commit | Contenu |
|---|---|---|
| **URL canonique** | `046e1c1` | `PublicProfilPage` pointait sa canonique sur `/profil` (l'**index**) au lieu de `/profil/:id` (`src/app/pages/PublicProfilPage.tsx:167-176`). Sans effet immédiat (page en `noindex`), mais la fausse canonique aurait survécu au retrait du `noindex`. |
| **Libellés de boutons** | `046e1c1` | `src/lib/walletFunding.ts:73-94` : « Ajouté des ZC… » → « Ajouter des ZC… ». Un participant passe ou le libellé appelle l'infinitif. |

---

## 12. `src/lib/matchPayout.ts` — le champ `perWinner`

> **Un agent a signalé que `perWinner` y est du code mort (aucun composant ne
> lit le champ) et que le serveur calcule autrement. C'est vérifié — et c'est
> exact.**

### 12.1 Vérification 1 — `perWinner` n'est lu par aucun composant

Recherche exhaustive dans `src/` :

| Symbole | Occurrences dans `src/` | Verdict |
|---|---|---|
| `getWinnerPayoutPerPlayer` | **1** — sa définition (`src/lib/matchPayout.ts:52`) | **code mort** |
| `hasAuthoritativePayout` | **1** — sa définition (`src/lib/matchPayout.ts:59`) | **code mort** |
| `perWinner` | **2** — le type de l'interface (`matchPayout.ts:26`) et la déclaration du type dans le store (`src/app/stores/matchStore.ts:163`) | **aucune lecture de valeur** |
| `getWinnerPayout` | 4 lectures réelles | vivant |
| `getArbiterFee` | 2 lectures réelles | vivant |

Les seuls consommateurs de `matchPayout.ts` :

| Consommateur | Import | Ligne |
|---|---|---|
| `src/app/components/profile/ProfileView.tsx:337` | `getWinnerPayout` | `:28` |
| `src/features/match/pages/MatchDetailPage.tsx:734-735` | `getArbiterFee`, `getWinnerPayout` | `:42` |
| `src/features/match/components/MatchActions.tsx:252` | `getArbiterFee` | `:21` |
| `src/lib/profileMetrics.ts:184` | `getWinnerPayout` | `:4` |
| `src/lib/communityInsights.ts:404` | `getWinnerPayout` | `:64` |

**Preuve mécanique dans le build.** `getWinnerPayoutPerPlayer` est **absent de
tout `dist/assets/`** : Rollup l'a **élagué**, faute d'importeur. Le chunk
`dist/assets/matchPayout-*.js` (253 octets) ne contient que
`getArbiterFee` et `getWinnerPayout`. Un code mort ne survit pas au build —
c'est la démonstration la plus économique.

### 12.2 Vérification 2 — le serveur calcule autrement

| Lieu | Calcul | Valeur |
|---|---|---|
| **Projection** (diffusée à tous les clients) | `server/match-engine.mjs:224-226` — `perWinner: winner / match.players.length` | divise par le nombre **total** de joueurs |
| **Règlement réel** | `server/match-engine.mjs:401-402` — `sharePerWinner = payout / winnerCount` | divise par le nombre de **gagnants** (`winnerIds.size`, `:396`) |

**Écart concret.** 2v2, pot réel 1 960 ZC :

| | Calcul | Montant par joueur |
|---|---|---|
| `projectedPayouts.perWinner` | 1 960 / **4** | **490** |
| Règlement réel | 1 960 / **2** | **980** |

L'écart est de 2× en 2v2, 5× en 5v5.

### 12.3 Le piège supplémentaire : `getWinnerPayout` est un **total d'équipe**

`getWinnerPayout` (`src/lib/matchPayout.ts:41-46`) renvoie
`projectedPayouts.winner`, qui est le **total de l'équipe gagnante**
(`server/match-engine.mjs:218`), **pas** la part individuelle.

Deux appelants l'utilisent pour afficher un gain **individuel** :

| Emplacement | Ce qu'il affiche | Conséquence |
|---|---|---|
| `src/lib/profileMetrics.ts:184` | `matchEarnings += getWinnerPayout(match)` | profil ×2 en 2v2, ×5 en 5v5 |
| `src/lib/communityInsights.ts:404` | `record.totalEarnings += getWinnerPayout(match)` | idem |

C'est le constat **V8** de `docs/05-invariants.md:823-841`. **Aucun mouvement
d'argent n'est en jeu** : c'est une divergence d'affichage. La valeur serveur
`user.stats.totalEarnings` est correcte (`server/match-engine.mjs:426`, qui
utilise la part individuelle `amount`) — l'écart est visible entre « mes stats »
et l'historique du portefeuille.

`src/app/components/profile/ProfileView.tsx:337` affiche lui aussi le total
d'équipe (`isWin ? '+' + formatZC(getWinnerPayout(match))`), pour la même
raison.

### 12.4 Verdict et correction à faire

| Affirmation de l'agent | Verdict |
|---|---|
| `perWinner` est du code mort côté front | **Confirmé.** `getWinnerPayoutPerPlayer` n'a aucun appelant ; `perWinner` n'est lu par aucun composant ; Rollup l'élague du build. |
| Le serveur calcule autrement | **Confirmé.** `match.players.length` (projection) vs `winnerIds.size` (règlement). |
| Le champ `perWinner` est faux | **Confirmé**, et c'est le constat **V5** de `docs/05-invariants.md:693-736` — dont la nuance importante : le champ **est** calculé et **est** diffusé à tous les clients (`server/state-helpers.mjs:187`), mais aucun écran ne l'affiche. **Impact utilisateur nul aujourd'hui**, risque latent réel. |

**Le test qui « couvre » le point fige le bug.** `server/match-engine.test.mjs:389-402`
s'intitule « should split the winner pot across the players of the winning
team » mais asserte `expect(projection.perWinner).toBe(490)` pour 4 joueurs et
1 960 ZC — soit la valeur fausse. Un test vert certifie ici le comportement
faux (`docs/05-invariants.md:727-729`).

**Deux corrections distinctes à faire :**

1. `perWinner` côté serveur : diviser par la taille de l'**équipe** gagnante.
   Attention : la projection est calculée pour un match **non soldé**
   (`server/state-helpers.mjs:187` s'exécute à chaque broadcast) — `winnerTeam`
   n'existe pas encore. Il faut donc `teamSize` ou passer le vainqueur en
   paramètre.
2. Le test `server/match-engine.test.mjs:401` : corriger l'assertion en même
   temps que le code.

**Et, séparément**, `getWinnerPayout` ne doit pas être utilisé pour afficher un
gain individuel (`profileMetrics.ts:184`, `communityInsights.ts:404`,
`ProfileView.tsx:337`) — c'est le total de l'équipe.

---

## 13. Règles de lecture du front

| Règle | Source |
|---|---|
| Un garde client (`requireAdmin`, `adminLoader`) est de l'**UX**, pas une autorisation. La barrière est `requireAdmin`/`requireAdmin2fa` côté serveur. | `docs/03-securite.md` §4 |
| Le socket diffuse des **deltas**, pas des collections. Fusionner (`hydrateFromServer`), ne jamais remplacer (`replaceFromServer`). | `src/app/hooks/useRealtimeHeartbeat.ts:15-17` |
| Le client ne connaît pas l'expiration réelle de sa session : le cookie est httpOnly. Ne jamais comparer `expiresAt` côté client. | `src/app/lib/apiClient.ts:16-32` |
| Un 403 métier (2FA, mot de passe actuel) ne détruit pas la session. Seul un 401 — ou un 403 `AUTH_REQUIRED` — purge l'état. | `src/app/lib/apiClient.ts:36-40` |
| Le titre et la description sont définis à **deux** endroits (`index.html` et `SEOHead`). Les corriger des deux côtés. | §9.2 |
| Une correction de classe Tailwind se vérifie dans le **CSS généré**, pas dans la source. | §11.2 |
| Une recherche de marqueur dans le build se fait dans `dist/assets/`, **pas** seulement dans `index-*.js`. | `docs/06-tests.md` §6 |
| Les modules **feuilles** (`apiUrl.ts`) et les **registres** (`sessionPurge.ts`) sont les deux mécanismes de cassage du cycle d'imports. | §2 |
| `projectedPayouts.winner` est un **total d'équipe**, pas une part individuelle. | §12.3 |

---

## 14. Voir aussi

| Document | Sujet |
|---|---|
| `docs/00-INDEX.md` | point d'entrée ; la tension CODM/agilité produit |
| `docs/01-architecture.md` | le serveur : temps réel, presence, diffusion d'état |
| `docs/02-modele-metier.md` | match, pari, arbitrage, validation |
| `docs/03-securite.md` | ce que le client **ne** protège pas (§4) |
| `docs/05-invariants.md` | V5 (`perWinner`), V8 (total d'équipe ajouté au gain individuel) |
| `docs/06-tests.md` | les 3 niveaux, le bundling, la mutation testing |
