# Architecture ZOYD

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Vercel)                     │
│  React 18 + TypeScript + Vite 6 + Tailwind v4           │
│  Zustand (13 stores) + React Router v7                  │
│  Socket.IO client + Service Worker (PWA)                │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API + WebSocket
┌──────────────────────▼──────────────────────────────────┐
│                   BACKEND (Render)                       │
│  Node.js ESM + native http + Socket.IO 4.8              │
│  7 modules internes (http, rate-limit, push, etc.)      │
│  Cron jobs + Match automation                           │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌───────────┐ ┌───────────┐
│  Supabase    │ │  FedaPay  │ │  web-push  │
│  (PostgreSQL)│ │  (paiement)│ │ (notifs)  │
└──────────────┘ └───────────┘ └───────────┘
```

## Stack technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Frontend | React 18 + TypeScript | UI SPA |
| Build | Vite 6.3 | Dev server + build |
| Style | Tailwind CSS v4 | Utility-first CSS |
| State | Zustand 4 | Gestion d'état |
| Routing | React Router v7 | Navigation SPA |
| API Client | fetch + custom apiClient | Communication REST |
| Realtime | Socket.IO 4.8 | Événements temps réel |
| Backend | Node.js ESM (http natif) | Serveur REST + WebSocket |
| Database | Supabase (PostgreSQL) | Persistance |
| Auth | Custom JWT (scrypt hash) | Authentification |
| Paiement | FedaPay | Mobile Money |
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
│   │   └── league/              # LeaguePage, LeagueSeasonPage
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
│   ├── payment-engine.mjs       # FedaPay integration
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
└── payment-engine.mjs      # Vérification FedaPay

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
  → channel-presence.mjs (trackSocketChannel)
  → Événements: match:join, match:leave, chat:message, etc.
  → broadcastStateSnapshot (via push-notifications.mjs)
```

## Architecture Frontend

### State Management (Zustand)

| Store | Persist | Rôle |
|-------|---------|------|
| authStore | localStorage | Session utilisateur |
| walletStore | localStorage | Solde + transactions |
| matchStore | - | Matchs en cours |
| tournamentStore | - | Tournois |
| leagueStore | - | Ligues |
| socketStore | - | Connexion Socket.IO |
| chatStore | - | Messages |
| friendsStore | localStorage | Amis |
| notificationStore | localStorage | Notifications |
| trustScoreStore | - | Score de confiance |
| toastStore | - | Toasts temporaires |

### Routing

```
/                    → RootIndexPage (Landing si non-auth, Dashboard si auth)
/auth/login          → LoginPage
/auth/register       → RegisterPage
/mode                → ModeSelectionPage (MJ vs BR)
/mj                  → HubMJPage (AppLayout)
/mj/creer            → CreateMatchPage
/mj/tournois         → TournoisPage
/wallet              → WalletPage
/classements         → ClassementsPage
/chat                → ChatPage
/profil              → ProfilPage
/br-league           → LeaguePage
/admin               → AdminDashboardPage (admin only)
```

## Sécurité

| Mesure | Implémentation |
|--------|---------------|
| Auth | JWT custom (scrypt 16-byte salt, 64-byte digest) |
| Token storage | localStorage (client) + HttpOnly cookie (serveur) |
| Rate limiting | IP-based, 60 req/min par défaut |
| CSP | Headers HTTP (Vercel) + meta tag |
| Admin auth | `requireAdmin` + `requireAdmin2fa` (TOTP) |
| Input validation | Zod (client) + validation serveur dans engines |
| CORS | `ALLOWED_ORIGINS` whitelist |
| XSS | Pas de `dangerouslySetInnerHTML`, texte échappé |
| Passwords | scrypt (pas bcrypt), jamais en clair |

## Déploiement

```
git push main
  ├── Vercel: build automatique → zoyd.vercel.app
  └── Render: auto-deploy → zoyd.onrender.com
```

Voir [DEPLOYMENT.md](./DEPLOYMENT.md) pour les détails.
