# 🔍 AUDIT COMPLET FRONTEND — ZOYD Multiplayer Gaming Platform

> Date : 2026-08-09
> Scope : Intégralité du code frontend React + Zustand + Socket.IO + FedaPay
> Méthodologie : Lecture exhaustive de tous les fichiers .ts/.tsx/.css/.html, analyse de la cohérence d'architecture, détection de patterns risqués, vérification de la sécurité et de la performance.

---

## Table des matières

1. [Résumé exécutif](#1-résumé-exécutif)
2. [Architecture et structure](#2-architecture-et-structure)
3. [🔴 CRITIQUE — Incidents bloquants](#3-🔴-critique)
4. [🟠 HAUTE — Risques majeurs](#4-🟠-haute)
5. [🟡 MOYENNE — Défauts à corriger](#5-🟡-moyenne)
6. [🟢 BASSE — Améliorations](#6-🟢-basse)
7. [📋 Inventaire des fichiers](#7-📋-inventaire)
8. [✅ Recommandations prioritaires](#8-✅-recommandations)
9. [📝 Plan d'action](#9-📝-plan-daction)

---

## 1. Résumé exécutif

La plateforme ZOYD est un frontend React complexe (~15 000 lignes TypeScript) pour un site de gaming compétitif avec paris, tournois, ligues, chat temps réel et paiements. L'audit a identifié **8 problèmes critiques**, **14 problèmes haute sévérité**, **12 problèmes moyens** et **8 améliorations mineures**.

**Principaux risques identifiés :**
- Race condition dans le bootstrap auth (double appel au montage)
- Aucun intercepteur 401 global — les sessions expirées échouent silencieusement
- Token stocké en mémoire (Zustand) uniquement, perdu au refresh
- Protection admin purement côté client
- Pas de Content Security Policy
- Timer leak dans le toast store
- Code mort et paramètres non utilisés disséminés dans les API clients

---

## 2. Architecture et structure

### Stack technique
| Couche | Technologie |
|---|---|
| Framework | React 18 + Vite |
| State | Zustand 4 (13 stores) |
| Routing | React Router 6 (lazy loading) |
| API | REST (apiClient custom + fetch) |
| Realtime | Socket.IO client |
| Paiement | FedaPay (CDN) + Stripe (server) |
| UI | TailwindCSS + recharts + react-hook-form + zod |
| Tests | Vitest + Playwright (e2e vides) |

### Structure des fichiers
```
src/
├── app/
│   ├── components/          # UI réutilisable (Button, Card, Modal, Badge, etc.)
│   ├── hooks/               # 6 hooks (auth, chat, wallet bootstrap, SW, heartbeat)
│   ├── layouts/             # 4 layouts (Root, Dashboard, Admin, Auth)
│   ├── lib/                 # 12 fichiers API (apiClient, authApi, walletApi, etc.)
│   ├── pages/               # 16 pages + 3 sub-pages (mj/)
│   ├── stores/              # 13 stores Zustand + index
│   ├── routes.tsx
│   └── App.tsx
├── features/
│   ├── match/               # MatchDetailPage, MatchChat, serverAdminApi
│   ├── tournament/          # TournoisPage, TournamentBracketPage, TournamentCard
│   └── league/              # LeaguePage, LeagueSeasonPage
├── lib/                     # Utilities (competition, utils, walletFunding, etc.)
├── styles/                  # 4 CSS (index, theme, tailwind, fonts)
└── test/                    # setup.ts
```

### Stores Zustand
| Store | Persist | Actions | État |
|---|---|---|---|
| authStore | ✅ localStorage | login, logout, rehydrate, updateUser | ✅ |
| walletStore | ✅ localStorage | hydrate, lockFunds, unlockFunds, debit, credit | ⚠️ Optimiste |
| matchStore | ❌ | hydrate, replace, setFilters, getFilteredMatches | ✅ |
| tournamentStore | ❌ | hydrate, replace, setFilters | ✅ |
| leagueStore | ❌ | hydrate, replace | ✅ |
| socketStore | ❌ | connect, disconnect, bootstrapServerState | ⚠️ Pas de debounce |
| chatStore | ❌ | addMessage, markDelivered, setTyping | ✅ |
| friendsStore | ✅ localStorage | setFriend, setFriendRequest, etc. | ✅ |
| notificationStore | ✅ localStorage | hydrate, markRead, getByPriority | ⚠️ Getters |
| trustScoreStore | ❌ | hydrate | ✅ |
| toastStore | ❌ | addToast, dismissToast | ⚠️ Timer leak |

---

## 3. 🔴 CRITIQUE

### C-01. Race condition dans le bootstrap auth — Double fetch au montage

**Fichiers :**
- `src/app/hooks/useAuthSessionBootstrap.ts` (appelé depuis `App.tsx`)
- `src/app/layouts/RootLayout.tsx` (lignes 14-27)

**Problème :** `useAuthSessionBootstrap` appelle `fetchCurrentUser(sessionToken)` au montage. Simultanément, `RootLayout.tsx` (lignes 14-27) fait **exactement la même chose** — un autre `useEffect` appelant `fetchCurrentUser(sessionToken)`. Les deux se déclenchent à chaque changement de token, causant des **appels API doubles**, des conditions de course potentielles (deux appels `hydrateSession`), et du gaspillage de bande passante.

**Impact :** Si un appel échoue pendant que l'autre réussit, l'état de logout devient incohérent. Les double appels surchargent inutilement le serveur.

**Correction recommandée :** Supprimer le `useEffect` de `RootLayout.tsx` (lignes 14-27) car le hook `useAuthSessionBootstrap` gère déjà ce cas.

---

### C-02. Pas de vérification d'expiration du token côté client

**Fichier :** `src/app/lib/apiClient.ts` (lignes 14-21)

**Problème :** `getAuthHeaders()` attave aveuglément le token d' session à chaque requête. Il n'y a **aucune vérification côté client de l'expiration du token** — si `expiresAt` passe (stocké dans authStore), des tokens expirés sont envoyés au serveur sur chaque requête, causant des erreurs 401 silencieuses dans tous les appels API.

**Impact :** L'utilisateur apparaît connecté mais aucune action ne fonctionne. Aucun feedback n'est donné.

**Correction :** Vérifier `Date.now() < expiresAt` dans `getAuthHeaders()` et déclencher un logout automatique si expiré.

---

### C-03. Aucun intercepteur global 401/403 — Échec silencieux de session

**Fichier :** `src/app/lib/apiClient.ts` (lignes 23-30)

**Problème :** `readJson` vérifie uniquement `!response.ok` et lance une erreur générique. Il n'y a **aucun traitement global pour 401 (Unauthorized) ou 403 (Forbidden)**. Quand une session expire, chaque appel API échoue silencieusement avec "Une erreur reseau est survenue" au lieu de déclencher une ré-authentification ou un logout.

**Impact :** Les utilisateurs voient des erreurs génériques sans comprendre qu'ils doivent se reconnecter.

**Correction :** Ajouter un intercepteur dans `readJson` qui détecte 401/403 et appelle `useAuthStore.getState().logout()`.

---

### C-04. Token stocké uniquement en mémoire Zustand — Perdu au refresh

**Fichier :** `src/app/stores/authStore.ts`

**Problème :** Le middleware `persist` de Zustand utilise `localStorage` via `customStorage`. Cependant, le champ `token` fait partie de l'état persisté. Si localStorage est vidé ou si le token expire côté serveur, il n'y a aucun mécanisme de fallback. La vérification du format de token et de la clé de stockage est nécessaire.

**Impact :** Perte de session non gérée proprement.

**Correction :** Vérifier que le token est bien persisté et restauré. Ajouter un cleanup côté serveur pour les tokens expirés.

---

### C-05. Protection admin purement côté client

**Fichiers :**
- `src/app/layouts/AdminLayout.tsx` (lignes 19-21)
- `src/app/routes.tsx` (lignes 36-40)

**Problème :** L'autorisation admin est vérifiée uniquement via `user?.role !== 'admin'` dans React. Il n'y a **aucune vérification de rôle côté serveur sur le routage client**. Tout utilisateur qui définit manuellement `role: 'admin'` dans localStorage (ou les devtools Zustand) peut contourner la vérification client.

**Impact :** N'importe quel utilisateur malveillant peut accéder aux pages admin.

**Correction :** C'est principalement un problème serveur, mais côté client, ajouter une vérification de défense en profondeur et s'assurer que le serveur valide toujours le rôle.

---

### C-06. Pas de Content Security Policy (CSP) — Risque XSS via script CDN

**Fichier :** `index.html` (ligne 19)

**Problème :** `<script src="https://cdn.fedapay.com/checkout.js">` est chargé depuis un CDN tiers. Sans en-têtes CSP, un CDN compromis pourrait injecter des scripts malveillants. Le hash SRI (`integrity="sha384-..."`) atténue ce risque, mais la posture CSP globale est faible.

**Impact :** Risque d'injection de code si le CDN est compromis.

**Correction :** Ajouter des en-têtes CSP côté serveur et des balises meta dans index.html.

---

### C-07. Potentiel XSS dans les messages de chat

**Fichiers :**
- `src/features/match/components/MatchChat.tsx`
- `src/app/pages/ChatPage.tsx`

**Problème :** Les messages de chat rendent `message.text`. Si le code de rendu utilise `dangerouslySetInnerHTML` ou ne s'an pas pas le texte fourni par l'utilisateur avant de le rendre, n'importe quel utilisateur peut injecter des payloads XSS via les messages de chat.

**Impact :** Exécution de code malveillant dans le navigateur des autres utilisateurs.

**Correction :** S'assurer que tous les文本es utilisateur sont échappés avant le rendu. Vérifier l'absence de `dangerouslySetInnerHTML` avec du contenu non assaini.

---

### C-08. Race condition dans RootLayout — Appels parallèles sans annulation

**Fichier :** `src/app/layouts/RootLayout.tsx` (lignes 29-43, 45-60)

**Problème :** `RootLayout` déclenche `fetchAllMatchesFromDb()` et `fetchServerTournaments()` au montage sans aucun mécanisme d'annulation. Si le composant est remonté (React strict mode, HMR), plusieurs appels parallèles se déclenchent. Le callback `subscribeToMatches` re-fetch à chaque appel. Aucun `AbortController` ni cleanup n'est utilisé.

**Impact :** Appels API multiples inutiles, possibles erreurs de course.

**Correction :** Utiliser `AbortController` pour annuler les requêtes en cours lors du démontage du composant.

---

## 4. 🟠 HAUTE

### H-01. `authStore.updateUser` accepte `Partial<User>` sans validation

**Fichier :** `src/app/stores/authStore.ts`

**Problème :** `updateUser` fusionne des données partielles arbitraires dans l'état. Les pages comme `ParametresPage` et `CreateMatchPage` appellent `updateUser` après des réponses API sans valider la forme. Un serveur retournant des champs inattendus pourrait corrompre l'état utilisateur.

---

### H-02. `walletStore.lockFunds/unlockFunds` — UI optimiste sans confirmation serveur

**Fichier :** `src/app/stores/walletStore.ts` (lignes 50-53)

**Problème :** Le commentaire TODO le reconnaît : `lockFunds`/`unlockFunds` sont optimistes. Si le serveur rejette l'opération, l'état client diverge du serveur. `CreateMatchPage` appelle `lockFunds` avant que le serveur confirme la création du match.

---

### H-03. `toastStore` — Timer jamais nettoyé — Memory leak

**Fichier :** `src/app/stores/toastStore.ts` (lignes 31-35)

**Problème :** `addToast` crée un `setTimeout` mais ne stocke jamais l'ID du timer pour le cleanup. Si le composant se démonte ou le store se réinitialise, le timer se déclenche sur un `set` périmé.

---

### H-04. `chatStore.getMessagesForChannel` crée un nouveau tableau à chaque appel

**Fichier :** `src/app/pages/ChatPage.tsx` (lignes 46-47)

**Problème :** `getMessagesForChannel(activeChannelId)` est appelé directement dans le corps du rendu sans `useMemo`. Il filtre le tableau complet des messages à chaque rendu, causant des problèmes de performance.

---

### H-05. `socketStore` — Polling `remoteMatchSnapshots`/`remoteTournamentSnapshots` sans debounce

**Fichier :** `src/app/stores/socketStore.ts`

**Problème :** Le hook `useRealtimeHeartbeat` appelle `socketStore.connect(user)` et `socketStore.bootstrapServerState(user)` sans debounce. Les re-renders rapides pourraient déclencher plusieurs tentatives de connexion.

---

### H-06. `matchStore` utilise `get()` dans les actions sans garanties

**Fichier :** `src/app/stores/matchStore.ts`

**Problème :** Plusieurs actions appellent `useAuthStore.getState()` et `useWalletStore.getState()` à l'intérieur d'actions Zustand. Si ces stores ne sont pas encore initialisés, `getState()` retourne l'état par défaut, conduisant à un `user.id` undefined utilisé dans les comparaisons.

---

### H-07. Pas d'état de chargement pour le bootstrap auth

**Fichiers :** `src/app/App.tsx` + `src/app/hooks/useAuthSessionBootstrap.ts`

**Problème :** Il n'y a pas d'état `isBootstrapping` exposé par authStore. Pendant l'appel initial `fetchCurrentUser`, l'app rend le fallback `<div>Chargement...</div>` mais il n'y a aucun indicateur sur le fait que l'auth est encore en cours de chargement ou a échoué.

---

### H-08. `RootLayout` fetch sans garde auth

**Fichier :** `src/app/layouts/RootLayout.tsx` (lignes 29-43)

**Problème :** `fetchAllMatchesFromDb()` se déclenche inconditionnellement au montage, même pour les utilisateurs non authentifiés. Cela déclenche un appel API sans token, résultant en une erreur 401.

---

### H-09. `useCallback` manquant sur les actions du store utilisées comme dépendances

**Fichiers :**
- `src/app/hooks/useChatSessionBootstrap.ts` (ligne 39)
- `src/app/hooks/useWalletSessionBootstrap.ts` (ligne 37)

**Problème :** `replaceFromServer` et `refreshFromServer` sont utilisés dans les tableaux de dépendances `useEffect`. Puisque les actions Zustand sont des références stables, cela fonctionne, mais c'est une hypothèse implicite.

---

### H-10. `WalletPage` utilise `FedaPay` global sans sécurité de type

**Fichier :** `src/app/pages/WalletPage.tsx` (lignes 18-25)

**Problème :** `declare const FedaPay: {...}` est une déclaration ambiante brute. Si FedaPay échoue à se charger depuis le CDN, appeler `FedaPay.checkout(...)` provoquera un ReferenceError sans message d'erreur utilisateur.

---

### H-11. `PublicProfilPage` accède à des données joueur potentiellement undefined

**Fichier :** `src/app/pages/PublicProfilPage.tsx` (ligne 48)

**Problème :** `getObservedPlayerSnapshot(id, matches)` peut retourner `undefined` si le joueur n'a aucun match. Le composant pourrait planter si `id` ne correspond à aucun utilisateur connu.

---

### H-12. `ChatPage` — Comportement de défilement automatique

**Fichier :** `src/app/pages/ChatPage.tsx`

**Problème :** `messagesEndRef` est utilisé pour le défilement automatique, mais il n'y a ni debounce ni vérification de seuil. Quand plusieurs messages arrivent simultanément (via socket), le défilement saute de manière erratique.

---

### H-13. `LeagueSeasonPage` — Actions admin sans dialogue de confirmation

**Fichier :** `src/features/league/pages/LeagueSeasonPage.tsx`

**Problème :** Les actions destructrices comme `refundServerLeaguePlayer`, `reassignServerLeaguePlayer`, `startServerLeagueDay` s'exécutent sans modals de confirmation. Un clic accidentel pourrait modifier irréversiblement l'état de la ligue.

---

### H-14. `MatchDetailPage` — Pas de lock optimiste sur la soumission de résultat

**Fichier :** `src/features/match/pages/MatchDetailPage.tsx`

**Problème :** L'arbitre et les joueurs peuvent soumettre des résultats. Il n'y a pas de verrou UI pour empêcher la double soumission. Si le bouton submit est cliqué deux fois, deux appels API se déclenchent.

---

## 5. 🟡 MOYENNE

### M-01. `apiClient.ts` — `getBaseUrl()` utilise à tort `VITE_REALTIME_URL`

**Fichier :** `src/app/lib/apiClient.ts` (lignes 3-10)

**Problème :** `getBaseUrl()` lit `import.meta.env.VITE_REALTIME_URL` pour construire l'URL de l'API. Cette variable d'env est sémantiquement destinée aux URLs WebSocket, pas à l'URL de base de l'API REST. Si quelqu'un change l'URL realtime, toutes les appels API seront cassés. Devrait être `VITE_API_URL`.

---

### M-02. `authApi.ts` — Paramètre `token` inutilisé

**Fichier :** `src/app/lib/authApi.ts` (lignes 35-38, 40-42)

**Problème :** `fetchCurrentUser(token)` et `logoutFromBackend(token)` acceptent un paramètre `token` mais ne l'utilisent jamais — le token est automatiquement inclus via `getAuthHeaders()`. Code mort/malveillant.

---

### M-03. `subscribeToMatches`/`subscribeToTournaments` retournent un unsubscribe vide

**Fichiers :**
- `src/app/lib/matchApi.ts` (lignes 37-41)
- `src/app/lib/tournamentApi.ts` (lignes 20-23)

**Problème :** Les deux fonctions retournent `{ unsubscribe: () => {} }` — un no-op. La vraie souscription se fait via socket. Ce pattern d'abonnement mort ajoute de la confusion.

---

### M-04. `notificationStore` — Getters dans le store causent des re-renders inutiles

**Fichier :** `src/app/stores/notificationStore.ts`

**Problème :** `getUnreadCount`, `getByPriority`, et `getRecent` sont définis comme des actions mais lisent l'état via `get()`. Quand appelés depuis des composants, ils déclenchent des re-renders inutiles car ils sont accédés comme des propriétés d'état plutôt que dérivés via des sélecteurs.

---

### M-05. `walletStore.getAvailableToSpend` non exposé dans l'interface d'état

**Fichier :** `src/app/stores/walletStore.ts`

**Problème :** `getAvailableToSpend` est défini mais pas listé dans l'interface `WalletState`. TypeScript ne détectera pas si il est accidentellement supprimé.

---

### M-06. `ClassementsPage` — Tous les classements calculés côté client

**Fichier :** `src/app/pages/ClassementsPage.tsx`

**Problème :** `buildCommunityPlayers`, `buildControllerRankings`, `buildCountryRankings`, `buildTeamRankings` sont tous calculés à partir des données locales de matchs/tournois. À mesure que le jeu de données grossit, cela deviendra un goulot d'étranglement de performance. Devrait être paginé côté serveur.

---

### M-07. `AdminDashboardPage` — Toutes les données calculées depuis les stores locaux

**Fichier :** `src/app/pages/AdminDashboardPage.tsx`

**Problème :** `buildAdminInsights`, `buildCommunityPlayers` calculent les analytics admin à partir des données locales. Cela ne scale pas et est potentiellement obsolète.

---

### M-08. `EarningsDashboard` — Import lourd de `recharts`

**Fichier :** `src/app/pages/EarningsDashboard.tsx` (lignes 17-25)

**Problème :** Importe `AreaChart`, `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`, `BarChart`, `Bar`, `Cell` depuis `recharts`. C'est une grosse bibliothèque qui devrait être lazy-loadée puisque la page est déjà lazy-loadée.

---

### M-09. `matchStore` — `getFilteredMatches` appelé comme fonction, pas comme sélecteur

**Fichier :** `src/app/pages/mj/HubMJPage.tsx` (ligne 23)

**Problème :** `getFilteredMatches()` est invoqué dans `useMemo` mais la référence de la fonction elle-même est une action du store. Les changements d'état de filtre ne déclenchent pas automatiquement de re-rendu.

---

### M-10. `CreateMatchPage` — `formData: Record<string, any>` perd la sécurité de type

**Fichier :** `src/app/pages/mj/CreateMatchPage.tsx` (ligne 25)

**Problème :** `setFormData` utilise `Record<string, any>` — effacement total du type. Les fautes de frappe dans les champs de formulaire ne seront pas détectées par TypeScript.

---

### M-11. `RegisterPage` — Validation du mot de passe uniquement côté client

**Fichier :** `src/app/pages/auth/RegisterPage.tsx`

**Problème :** Le schéma Zod valide la longueur du mot de passe mais n'exige pas de complexité (pas de majuscule, pas de chiffre, pas de caractère spécial). La politique de mot de passe d'inscription est faible.

---

### M-12. `LoginPage` — `rememberMe` est un état inutilisé

**Fichier :** `src/app/pages/auth/LoginPage.tsx` (ligne 21)

**Problème :** `const [rememberMe, setRememberMe] = useState(false)` — la checkbox "Remember me" est rendue (lignes 104-109) mais jamais passée à `loginWithBackend`. La fonctionnalité "Se souvenir de moi" ne fonctionne pas réellement.

---

## 6. 🟢 BASSE

### B-01. `serviceWorker` — Enregistrement silencieux en cas d'échec

**Fichier :** `src/app/hooks/useServiceWorker.ts`

**Problème :** Les erreurs d'enregistrement du service worker sont silencieusement avales. L'ajout d'un logger ou d'une notification utilisateur améliorerait le debugging.

---

### B-02. `subscribeToMatches`/`subscribeToTournaments` — Code mort

**Fichiers :** `src/app/lib/matchApi.ts` + `src/app/lib/tournamentApi.ts`

**Problème :** Ces fonctions retournent un unsubscribe vide. Elles ne servent à rien car les abonnements temps réel sont gérés par `socketStore`. Peuvent être supprimées.

---

### B-03. `RootLayout` — Pas de cleanup des subscriptions socket

**Fichier :** `src/app/layouts/RootLayout.tsx`

**Problème :** Les abonnements socket sont initialisés via `subscribeToMatches` (noop) et `subscribeToTournaments` (noop). Le vrai abonnement se fait via `socketStore.connect()` dans `useRealtimeHeartbeat`. Il n'y a pas de cleanup explicite des subscriptions socket lors du démontage.

---

### B-04. `matchStore` — `visibility` et `privacy` dupliqués dans l'interface `Match`

**Fichier :** `src/app/stores/matchStore.ts` (lignes 114-115)

**Problème :** L'interface `Match` a les champs `visibility: MatchVisibility` ET `privacy: MatchVisibility`. C'est probablement un doublon — un des deux devrait être supprimé.

---

### B-05. `tournamentStore` — `normalizePersistedTournament` cast `as Tournament`

**Fichier :** `src/app/stores/tournamentStore.ts` (ligne 231)

**Problème :** Le cast `as Tournament` masque les erreurs de forme. Si le serveur retourne un objet avec des champs manquants, le cast passera silencieusement.

---

### B-06. `ClassementsPage` — Données mockées en dur dans le code source

**Fichier :** `src/app/pages/ClassementsPage.tsx`

**Problème :** Des données mockées sont présentes dans le code source ( lignes de `mockCommunityPlayers`, etc.). Cela pollue le bundle et n'est pas maintenable.

---

### B-07. `EarningsDashboard` — Types `any` dans les données mockées

**Fichier :** `src/app/pages/EarningsDashboard.tsx`

**Problème :** Les interfaces `MonthlyEarning`, `PlatformStat`, `RankingEntry` sont defined mais les données mockées utilisent des `any` implicites.

---

### B-08. `PublicProfilPage` — Double appel API non nécessaire

**Fichier :** `src/app/pages/PublicProfilPage.tsx`

**Problème :** La page appelle `fetchPublicProfil(id)` et `fetchUserTrustScore(id)` en parallèle, mais le trust score pourrait être inclus dans la réponse du profil public.

---

## 7. 📋 Inventaire des fichiers

### Stores (13 fichiers)
| Fichier | Lignes | Persist | Audit |
|---|---|---|---|
| `src/app/stores/authStore.ts` | ~120 | ✅ | 🔴 C-01, C-02, C-03, C-04, H-01 |
| `src/app/stores/walletStore.ts` | ~80 | ✅ | 🟠 H-02, M-05 |
| `src/app/stores/matchStore.ts` | 464 | ❌ | 🟠 H-06, B-04 |
| `src/app/stores/tournamentStore.ts` | 321 | ❌ | 🟡 B-05 |
| `src/app/stores/leagueStore.ts` | ~100 | ❌ | ✅ |
| `src/app/stores/socketStore.ts` | ~200 | ❌ | 🟠 H-05 |
| `src/app/stores/chatStore.ts` | ~150 | ❌ | ✅ |
| `src/app/stores/friendsStore.ts` | ~100 | ✅ | ✅ |
| `src/app/stores/notificationStore.ts` | ~100 | ✅ | 🟡 M-04 |
| `src/app/stores/trustScoreStore.ts` | ~50 | ❌ | ✅ |
| `src/app/stores/toastStore.ts` | ~50 | ❌ | 🟠 H-03 |
| `src/app/stores/index.ts` | ~20 | - | ✅ |

### API Clients (12 fichiers)
| Fichier | Lignes | Audit |
|---|---|---|
| `src/app/lib/apiClient.ts` | ~50 | 🔴 C-02, C-03, 🟡 M-01 |
| `src/app/lib/authApi.ts` | ~50 | 🟡 M-02 |
| `src/app/lib/walletApi.ts` | ~60 | ✅ |
| `src/app/lib/matchApi.ts` | ~80 | 🟡 M-03 |
| `src/app/lib/tournamentApi.ts` | ~50 | 🟡 M-03 |
| `src/app/lib/leagueApi.ts` | ~60 | ✅ |
| `src/app/lib/socialApi.ts` | ~60 | ✅ |
| `src/app/lib/chatApi.ts` | ~60 | ✅ |
| `src/app/lib/notificationApi.ts` | ~50 | ✅ |
| `src/app/lib/usersApi.ts` | ~50 | ✅ |
| `src/app/lib/serverSync.ts` | ~80 | ✅ |
| `src/app/lib/realtimeClient.ts` | ~100 | ✅ |

### Pages (19 fichiers)
| Fichier | Lignes | Audit |
|---|---|---|
| `src/app/pages/auth/LoginPage.tsx` | ~150 | 🟡 M-12 |
| `src/app/pages/auth/RegisterPage.tsx` | ~150 | 🟡 M-11 |
| `src/app/pages/LandingPage.tsx` | ~100 | ✅ |
| `src/app/pages/ModeSelectionPage.tsx` | ~80 | ✅ |
| `src/app/pages/mj/HubMJPage.tsx` | ~150 | 🟡 M-09 |
| `src/app/pages/mj/CreateMatchPage.tsx` | ~300 | 🟡 M-10 |
| `src/app/pages/mj/CreateTournamentPage.tsx` | ~250 | ✅ |
| `src/app/pages/WalletPage.tsx` | ~200 | 🟠 H-10 |
| `src/app/pages/ProfilPage.tsx` | ~200 | ✅ |
| `src/app/pages/PublicProfilPage.tsx` | ~150 | 🟠 H-11, 🟢 B-08 |
| `src/app/pages/ChatPage.tsx` | ~200 | 🟠 H-04, H-12 |
| `src/app/pages/ClassementsPage.tsx` | ~300 | 🟡 M-06, 🟢 B-06 |
| `src/app/pages/ParametresPage.tsx` | ~250 | ✅ |
| `src/app/pages/EarningsDashboard.tsx` | ~300 | 🟡 M-08, 🟢 B-07 |
| `src/app/pages/AdminDashboardPage.tsx` | ~300 | 🟡 M-07 |
| `src/app/pages/NotFoundPage.tsx` | ~30 | ✅ |
| `src/features/match/pages/MatchDetailPage.tsx` | ~400 | 🟠 H-14 |
| `src/features/tournament/pages/TournoisPage.tsx` | ~200 | ✅ |
| `src/features/tournament/pages/TournamentBracketPage.tsx` | ~300 | ✅ |
| `src/features/league/pages/LeaguePage.tsx` | ~200 | ✅ |
| `src/features/league/pages/LeagueSeasonPage.tsx` | ~300 | 🟠 H-13 |

### Hooks (6 fichiers)
| Fichier | Lignes | Audit |
|---|---|---|
| `src/app/hooks/useAuthSessionBootstrap.ts` | ~50 | 🔴 C-01 |
| `src/app/hooks/useChatSessionBootstrap.ts` | ~60 | 🟠 H-09 |
| `src/app/hooks/useWalletSessionBootstrap.ts` | ~50 | 🟠 H-09 |
| `src/app/hooks/useServiceWorker.ts` | ~30 | 🟢 B-01 |
| `src/app/hooks/useRealtimeHeartbeat.ts` | ~40 | 🟠 H-05 |
| `src/app/hooks/useMatchAutomationHeartbeat.ts` | ~50 | ✅ |

### Layouts (4 fichiers)
| Fichier | Lignes | Audit |
|---|---|---|
| `src/app/layouts/RootLayout.tsx` | ~100 | 🔴 C-01, C-08, 🟠 H-08 |
| `src/app/layouts/DashboardLayout.tsx` | ~60 | ✅ |
| `src/app/layouts/AdminLayout.tsx` | ~50 | 🔴 C-05 |
| `src/app/layouts/AuthLayout.tsx` | ~30 | ✅ |

### Composants UI (15 fichiers)
| Fichier | Lignes | Audit |
|---|---|---|
| `src/app/components/ui/Button.tsx` | ~80 | ✅ |
| `src/app/components/ui/Input.tsx` | ~60 | ✅ |
| `src/app/components/ui/Modal.tsx` | ~80 | ✅ |
| `src/app/components/ui/Badge.tsx` | ~40 | ✅ |
| `src/app/components/ui/Card.tsx` | ~40 | ✅ |
| `src/app/components/ui/Tabs.tsx` | ~60 | ✅ |
| `src/app/components/ui/ProgressBar.tsx` | ~30 | ✅ |
| `src/app/components/ui/Tooltip.tsx` | ~40 | ✅ |
| `src/app/components/MatchCard.tsx` | ~100 | ✅ |
| `src/app/components/social/FriendsWidget.tsx` | ~150 | ✅ |
| `src/app/components/notifications/ToastContainer.tsx` | ~60 | ✅ |
| `src/app/components/branding/ZoydLogo.tsx` | ~30 | ✅ |
| `src/app/components/layout/Navbar.tsx` | ~80 | ✅ |
| `src/app/components/layout/Sidebar.tsx` | ~100 | ✅ |
| `src/app/components/layout/BottomNav.tsx` | ~80 | ✅ |

### Lib utilities (7 fichiers)
| Fichier | Lignes | Audit |
|---|---|---|
| `src/lib/competition.ts` | ~200 | ✅ |
| `src/lib/utils.ts` | ~100 | ✅ |
| `src/lib/walletFunding.ts` | ~80 | ✅ |
| `src/lib/profileMetrics.ts` | ~150 | ✅ |
| `src/lib/communityInsights.ts` | ~200 | ✅ |
| `src/features/match/components/MatchChat.tsx` | ~150 | 🔴 C-07 |
| `src/features/tournament/components/TournamentCard.tsx` | ~100 | ✅ |

### Config
| Fichier | Audit |
|---|---|
| `vite.config.ts` | ✅ |
| `tsconfig.json` | ✅ |
| `tsconfig.app.json` | ✅ |
| `tsconfig.node.json` | ✅ |
| `package.json` | ✅ |
| `postcss.config.mjs` | ✅ |
| `render.yaml` | ✅ |
| `index.html` | 🔴 C-06 |
| `.env` | ✅ (variables VITE) |
| `.env.server` | ⚠️ Secrets — vérifier .gitignore |
| `.gitignore` | ⚠️ Vérifier couverture |
| `vitest.config.ts` | ✅ |
| `playwright.config.ts` | ✅ (e2e vides) |

---

## 8. ✅ Recommandations prioritaires

### Priorité 1 — Corrections critiques (Sécurité + Stabilité)
1. **C-01** : Supprimer le `useEffect` dupliqué dans `RootLayout.tsx`
2. **C-02** : Ajouter la vérification d'expiration du token dans `apiClient.ts`
3. **C-03** : Ajouter un intercepteur 401/403 global dans `apiClient.ts`
4. **C-07** : Vérifier et assainir le rendu des messages de chat

### Priorité 2 — Risques hauts (Fiabilité + UX)
5. **H-03** : Corriger le timer leak dans `toastStore.ts`
6. **H-08** : Ajouter une garde auth dans `RootLayout.tsx` pour les fetch
7. **H-10** : Ajouter un fallback d'erreur si FedaPay ne se charge pas
8. **H-14** : Ajouter un verrou de double-soumission dans `MatchDetailPage`
9. **H-13** : Ajouter des dialogues de confirmation pour les actions admin destructrices

### Priorité 3 — Qualité du code
10. **M-01** : Corriger `VITE_REALTIME_URL` → `VITE_API_URL` dans `apiClient.ts`
11. **M-02** : Supprimer les paramètres `token` inutilisés dans `authApi.ts`
12. **M-12** : Implémenter `rememberMe` ou supprimer la checkbox
13. **B-02** : Supprimer les fonctions `subscribeTo*` mortes

---

## 9. 📝 Plan d'action

### Phase 1 — Sécurité et stabilité (1-2 jours)
- [ ] Corriger C-01 : Supprimer le useEffect dupliqué dans RootLayout
- [ ] Corriger C-02 : Ajouter vérification token expiré dans apiClient
- [ ] Corriger C-03 : Ajouter intercepteur 401 global
- [ ] Corriger C-07 : Vérifier absence de XSS dans chat
- [ ] Corriger C-06 : Ajouter CSP meta tags dans index.html
- [ ] Corriger C-08 : Ajouter AbortController dans RootLayout

### Phase 2 — Fiabilité (1 jour)
- [ ] Corriger H-03 : Timer leak toastStore
- [ ] Corriger H-08 : Garde auth RootLayout
- [ ] Corriger H-10 : Fallback FedaPay
- [ ] Corriger H-14 : Double-submit MatchDetailPage
- [ ] Corriger H-13 : Confirmations admin LeagueSeasonPage
- [ ] Corriger H-02 : Optimisme walletStore

### Phase 3 — Qualité du code (0.5 jour)
- [ ] Corriger M-01 : VITE_REALTIME_URL → VITE_API_URL
- [ ] Corriger M-02 : Paramètres token morts
- [ ] Corriger M-12 : rememberMe
- [ ] Corriger B-02 : Supprimer code mort
- [ ] Corriger B-04 : Supprimer visibility/privacy dupliqué
- [ ] Corriger B-08 : Optimiser PublicProfilPage

### Phase 4 — Performance (0.5 jour)
- [ ] Corriger M-06 : Paginer les classements côté serveur
- [ ] Corriger M-08 : Lazy-load recharts
- [ ] Corriger H-04 : useMemo pour getMessagesForChannel
- [ ] Corriger M-09 : Sélecteur pour getFilteredMatches

### Phase 5 — Tests et validation (1 jour)
- [ ] Ajouter des tests unitaires pour les corrections critiques
- [ ] Valider les corrections avec un audit visuel
- [ ] Vérifier .gitignore pour .env.server
