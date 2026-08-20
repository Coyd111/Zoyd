# Architecture ZOYD

## Stack

```mermaid
graph TB
    subgraph Frontend ["Frontend — Vercel"]
        A[React 18 + TypeScript]
        B[Vite 6.3]
        C[Tailwind v4]
        D[Zustand 13 stores]
        E[Socket.IO Client]
        F[FedaPay Widget]
    end

    subgraph Backend ["Backend — Render"]
        G[Node.js ESM]
        H[realtime-server.mjs<br/>REST + Socket.io + Cron]
        I[Supabase Client]
        J[FedaPay Server SDK]
        K[web-push]
    end

    subgraph Database ["Database — Supabase"]
        L[(PostgreSQL<br/>14 tables)]
        M[RLS Policies]
    end

    subgraph External ["External Services"]
        N[FedaPay API]
        O[Vercel CDN]
        P[GitHub Actions]
    end

    A --> E
    E -->|WebSocket| H
    A -->|REST API| H
    H --> I
    I --> L
    H --> J
    J --> N
    H --> K
    B --> O
    P -->|Deploy| O
    P -->|Deploy| H
```

## Data Flow

```mermaid
sequenceDiagram
    participant C as Client (Vercel)
    participant S as Server (Render)
    participant DB as Supabase

    C->>S: POST /api/auth/login
    S->>DB: SELECT user by email
    DB-->>S: User record
    S->>S: verifyPassword (scrypt)
    S->>S: createAuthSession (UUID token)
    S-->>C: { token, user, expiresAt }

    C->>S: POST /api/matches (Create)
    S->>S: lockEntryFee (withWalletMutex)
    S->>DB: UPSERT wallet + match
    DB-->>S: OK
    S-->>C: { match }

    C->>E: Socket.io connect
    E->>S: presence:join
    S-->>C: match_update (broadcast)
```

## Security Layers

| Layer | Implementation |
|-------|---------------|
| Authentication | UUID token + HttpOnly cookie |
| Authorization | Role-based (player/admin) |
| Rate Limiting | 21 guards across auth/wallet/social/admin/chat |
| Input Validation | Zod (client) + engine validation (server) |
| XSS Prevention | HTML entity escaping (sanitizeText) |
| CSRF | SameSite=Strict cookies |
| Wallet Safety | Mutex per userId + rollback on failure |
| Error Handling | ErrorBoundary + structured logging |

## File Structure

```
Multiplayer Gaming Platform/
├── server/
│   ├── realtime-server.mjs    # Monolith: REST + Socket.io + cron
│   ├── persistence.mjs        # Supabase CRUD
│   ├── wallet-engine.mjs      # Wallet logic + mutex
│   ├── match-engine.mjs       # Match lifecycle
│   ├── tournament-engine.mjs  # Tournament logic
│   ├── league-engine.mjs      # League seasons
│   ├── metrics.mjs            # Prometheus metrics
│   └── *.test.mjs             # 162 Vitest tests
├── src/
│   ├── app/
│   │   ├── components/        # UI components
│   │   ├── hooks/             # Auth, chat, wallet, SW bootstraps
│   │   ├── layouts/           # Root, Dashboard, Admin, Auth
│   │   ├── lib/               # API clients (apiClient, authApi, etc.)
│   │   ├── pages/             # 16 pages + sub-pages
│   │   ├── stores/            # 13 Zustand stores
│   │   └── routes.tsx         # Lazy-loaded routes
│   ├── features/              # Match, Tournament, League
│   └── lib/                   # Utils, competition, walletFunding
├── e2e/                       # Playwright E2E tests
└── docs/                      # OpenAPI, architecture, deployment
```
