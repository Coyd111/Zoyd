# Architecture ZOYD

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Vercel)                     │
│  React 19 + TypeScript + Vite 8 + Tailwind v4            │
│  Zustand (12 stores) + React Router v8                  │
│  Socket.IO client + Service Worker (PWA)                │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API + WebSocket
┌──────────────────────▼──────────────────────────────────┐
│                   BACKEND (Render)                       │
│  Node.js ESM + native http + Socket.IO 4.8              │
│  Modules support + 6 engines + 11 modules routes        │
│  Cron jobs + Match automation                           │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌───────────┐ ┌───────────┐
│  Supabase    │ │Mobile Money│ │  web-push  │
│  (PostgreSQL)│ │  (paiement)│ │ (notifs)  │
└──────────────┘ └───────────┘ └───────────┘
```

## Stack technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Frontend | React 19 + TypeScript | UI SPA |
| Build | Vite 8.3.5 (Rolldown) | Dev server + build |
| Style | Tailwind CSS v4 | Utility-first CSS |
| State | Zustand 5 | Gestion d'état |
| Routing | React Router v8 | Navigation SPA |
| API Client | fetch + custom apiClient | Communication REST |
| Realtime | Socket.IO 4.8 | Événements temps réel |
| Backend | Node.js ESM (http natif) | Serveur REST + WebSocket |
| Database | Supabase (PostgreSQL) | Persistance |
| Auth | Cookies de session (`zoyd_auth`, httpOnly) | Authentification — seul le SHA-256 du jeton est stocké ; scrypt pour les mots de passe |
| Paiement | prestataire de paiement | Mobile Money |
| Push | web-push + VAPID | Notifications navigateur |
| Deploy FE | Vercel | Frontend statique |
| Deploy BE | Render | Backend Node.js |

## Structure du projet

```
Multiplayer Gaming Platform/
├── src/
│   ├── app/
│   │   ├── components/          # UI réutilisable (Button, Modal, Badge, etc.)
│   │   │   ├── layout/          # Navbar, Sidebar, BottomNav
│   │   │   ├── notifications/   # ToastContainer, NotificationDropdown
│   │   │   ├── profile/         # ProfileView
│   │   │   ├── social/          # FriendsWidget
│   │   │   └── ui/              # Button, Input, Modal, Badge, Card, Tabs
│   │   ├── hooks/               # useAuthSessionBootstrap, useServiceWorker, etc.
│   │   ├── layouts/             # RootLayout, AppLayout, AuthLayout
│   │   ├── lib/                 # API clients (apiClient, authApi, walletApi, etc.)
│   │   ├── pages/               # Pages principales
│   │   ├── stores/              # 13 stores Zustand
│   │   ├── routes.tsx           # Configuration des routes
│   │   └── App.tsx              # Point d'entrée React
│   ├── features/
│   │   ├── match/               # MatchDetailPage, MatchChat
│   │   ├── tournament/          # TournoisPage, TournamentBracketPage
│   │   ├── league/              # LeaguePage, LeagueSeasonPage
│   │   └── br/                  # BrPage, BrLobbyDetailPage, panels lobby + arbitre
│   ├── lib/                     # Utilities (competition, utils, etc.)
│   └── styles/                  # CSS global
├── server/
│   ├── realtime-server.mjs      # Serveur principal (REST + Socket.IO)
│   ├── http-utils.mjs           # Sérialisation, CORS, parsing
│   ├── rate-limiter.mjs         # Rate limiting IP-based
│   ├── push-notifications.mjs   # Web-push + notifs in-app
│   ├── channel-presence.mjs     # Présence WebSocket
│   ├── chat-helpers.mjs         # Canaux de chat
│   ├── state-helpers.mjs        # Persistance état
│   ├── admin-totp.mjs           # 2FA TOTP + admin auth
│   ├── persistence.mjs          # Logique DB (Supabase)
│   ├── match-engine.mjs         # Cycle de vie des matchs
│   ├── tournament-engine.mjs    # Tournois + bracket
│   ├── league-engine.mjs        # Ligues + saisons
│   ├── wallet-engine.mjs        # Wallet + transactions
│   ├── payment-engine.mjs       # Mobile Money integration
│   ├── br-engine.mjs            # Battle Royale (variantes, salons, arbitrage)
│   ├── routes/                  # 11 modules de routing HTTP
│   ├── cron.mjs                 # Tâches planifiées
│   └── *.test.mjs               # Tests unitaires
└── public/
    ├── sw.js                    # Service Worker (PWA)
    ├── sw-register.js           # Enregistrement SW
    └── assets/                  # Images, vidéos
```

## Architecture Backend

Le backend est un **monolithe modulaire** — un seul processus Node.js servant à la fois l'API REST et le WebSocket (Socket.IO).

### Modules internes

```
realtime-server.mjs (point d'entrée)
├── http-utils.mjs          # Sérialisation cookie, CORS, parsing requêtes
├── rate-limiter.mjs        # Rate limiting par IP
├── push-notifications.mjs  # Envoi push + notifications in-app
├── channel-presence.mjs    # Tracking des membres par canal
├── chat-helpers.mjs        # Canaux de chat match
├── state-helpers.mjs       # Sauvegarde état (matches, tournaments, leagues)
└── admin-totp.mjs          # Auth admin + 2FA TOTP

Engines métier (logique pure)
├── match-engine.mjs        # CRUD matchs, résultats, XP
├── tournament-engine.mjs   # Tournois, bracket, inscriptions
├── league-engine.mjs       # Saisons, qualifications, Score Z
├── wallet-engine.mjs       # Dépôts, retraits, lock/unlock
├── payment-engine.mjs      # Vérification paiements
└── br-engine.mjs           # Battle Royale (variantes Classic/Blitz/…)

Routes HTTP
└── routes/*.mjs            # 11 modules : public, auth, wallet, match,
                             #   tournament, league, br, social, chat,
                             #   admin, realtime

Persistance
└── persistence.mjs         # Lecture/écriture Supabase (scrypt auth)
```

### Flux d'une requête API

```
Client → HTTP Request
  → http-utils.mjs (parseBody, getCorsOrigin)
  → rate-limiter.mjs (checkRateLimit)
  → admin-totp.mjs (requireAdmin si /admin/*)
  → realtime-server.mjs (route handler)
  → *-engine.mjs (logique métier)
  → persistence.mjs (Supabase)
  → Response JSON
```

### Flux WebSocket

```
Client → Socket.IO connect
  → cookie de session vérifié (SameSite=None : front Vercel → API Render)
  → channel-presence.mjs (trackSocketChannel)
  → le client (socketConnectionStore) installe ses 13 handlers
    et hydrate les stores métier

Événements réellement émis par le serveur :
  server:hello · state:matches · state:tournaments · wallet:update
  chat:channel · chat:message · chat:read
  presence:snapshot · typing:snapshot · notification:deliver
  error · server:error
```

## Architecture Frontend

### State Management (Zustand)

13 fichiers de store (`src/app/stores/`), soit **12 petites stores logiques** +
1 alias de compatibilité. **Aucun ne persiste** : les données vivent côté
serveur, la session vit dans un cookie httpOnly (`authStore.ts:8`),
`socketConnectionStore` hydrate les autres stores à la reconnexion.

| Store | Rôle |
|-------|------|
| authStore | Session utilisateur (cookie-only, aucune donnée en localStorage) |
| socketConnectionStore | Chef d'orchestre temps réel : connexion, 13 handlers, bootstrap, resynchronisation |
| socketStore | **Alias de compatibilité** : ré-exporte `useSocketConnectionStore` |
| matchStore | Matchs en cours |
| tournamentStore | Tournois |
| leagueStore | Ligues |
| walletStore | Solde + transactions |
| chatStore | Messages de chat |
| friendsStore | Amis |
| notificationStore | Notifications |
| presenceStore | Présence par canal, saisie en cours, canaux vus |
| trustScoreStore | Score de confiance |
| toastStore | Toasts temporaires |

### Routing

35 entrées déclarées dans `src/app/routes.tsx` (dont le layout `/auth` et
2 redirections de compatibilité accentuées). Pages métier sous `AppLayout`,
légales publiques hors layout :

```
/                      → RootIndexPage (landing non auth / dashboard auth)
/auth/login            → LoginPage (layout AuthLayout)
/auth/register         → RegisterPage
/auth/activate         → ActivatePage
/auth/forgot           → ForgotPasswordPage
/mode                  → ModeSelectionPage (MJ vs BR)
/conditions            → ConditionsPage
/reglement-litiges     → LitigesPage
/anti-fraude           → AntiFraudePage
/confidentialite       → ConfidentialitePage
/mentions              → MentionsPage
/jeu-responsable       → JeuResponsablePage
/mj                    → HubMJPage (layout AppLayout)
/mj/creer              → CreateMatchPage
/mj/match/:id          → MatchDetailPage (salon live)
/mj/tournois           → TournoisPage
/mj/tournois/creer     → CreateTournamentPage
/mj/créer              → redirection /mj/creer (compat URL accentuée)
/mj/tournois/créer     → redirection /mj/tournois/creer (compat)
/mj/tournois/:id       → TournamentBracketPage
/wallet                → WalletPage
/earnings              → EarningsDashboard
/classements           → ClassementsGateway : anonyme → PublicClassementsPage,
                         authentifié → ClassementsPage dans AppLayout
/chat                  → ChatPage
/profil                → ProfilPage
/profil/:id            → PublicProfilPage
/parametres            → ParametresPage
/br-league             → LeaguePage (ligues BR, 5 jours, top 40)
/br-league/:seasonId   → LeagueSeasonPage
/br                    → BrPage (Battle Royale : salon unique, 1 match)
/br/:lobbyId           → BrLobbyDetailPage
/infos                 → LeaksPage
/admin                 → AdminDashboardPage (AppLayout requireAdmin)
*                      → NotFoundPage (sans rewrite catch-all Vercel :
                         la 404 servie est celle de Vercel)
```

## Sécurité

| Mesure | Implémentation |
|--------|---------------|
| Auth | Cookie de session `zoyd_auth` httpOnly — jeton aléatoire, seul le SHA-256 est stocké ; scrypt (16-byte salt, 64-byte digest) pour les mots de passe |
| Token storage | Cookie httpOnly uniquement — le store d'auth ne garde rien en localStorage (`authStore.ts:8`) ; le jeton ne réapparaît dans un corps de réponse qu'avec `ALLOW_DEBUG_CODES=true` (jamais en prod) |
| Rate limiting | IP-based, 60 req/min par défaut |
| CSP | Headers HTTP (Vercel) + meta tag |
| Admin auth | `requireAdmin` + `requireAdmin2fa` (TOTP) |
| Input validation | Zod (client) + validation serveur dans engines |
| CORS | `ZOYD_ALLOWED_ORIGINS` (CSV) + 3 origines de prod codées en dur (`http-utils.mjs:99-104`) ; `ALLOWED_ORIGINS` n'est jamais lue |
| XSS | Pas de `dangerouslySetInnerHTML`, texte échappé |
| Passwords | scrypt (pas bcrypt), jamais en clair |

## Déploiement

```
git push main
  ├── Vercel: build automatique → zoyd.vercel.app
  └── Render: auto-deploy → zoyd.onrender.com
```

Voir [DEPLOYMENT.md](./DEPLOYMENT.md) pour les détails.
