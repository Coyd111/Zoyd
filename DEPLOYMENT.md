# Guide de Déploiement ZOYD

## Prérequis

- Node.js 18+
- pnpm (avec `--config.node-linker=hoisted` pour disque exFAT)
- Compte Vercel (frontend)
- Compte Render (backend)
- Projet Supabase (database)
- Clé VAPID (web-push)
- Compte FedaPay (paiements)

## Variables d'environnement

### Frontend (.env)

```
VITE_REALTIME_URL=https://zoyd.onrender.com
VITE_SUPABASE_URL=https://tgvvuapazfehmsbduilx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Backend (.env.server)

```
PORT=10000
SUPABASE_URL=https://tgvvuapazfehmsbduilx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
JWT_SECRET=your-secret-key
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:admin@zoyd.com
FEDAPAY_PUBLIC_KEY=...
FEDAPAY_SECRET_KEY=...
FEDAPAY_ENVIRONMENT=test
ALLOWED_ORIGINS=https://zoyd.vercel.app
```

## Installation locale

```bash
# Frontend
cd "Multiplayer Gaming Platform"
CI=true pnpm install --config.node-linker=hoisted

# Lancer le dev server
node node_modules/vite/bin/vite.js

# Build production
node node_modules/vite/bin/vite.js build

# Tests
$env:CI="true"; node --experimental-vm-modules node_modules/vitest/vitest.mjs run --reporter=verbose --no-file-parallelism --exclude='e2e/**'
```

## Déploiement Frontend (Vercel)

1. Connecter le repo GitHub sur Vercel
2. Framework: Vite
3. Build command: `node node_modules/vite/bin/vite.js build`
4. Output directory: `dist`
5. Install command: `CI=true pnpm install --config.node-linker=hoisted`

### Configuration Vercel (vercel.json)

- Headers de sécurité (CSP, X-Frame-Options, HSTS)
- Cache immutable pour les assets (`/assets/*`)
- `no-cache` pour `index.html`
- Rewrites SPA pour toutes les routes

### Déploiement automatique

Tout push sur `main` déclenche un build Vercel automatique.

## Déploiement Backend (Render)

1. Connecter le repo GitHub sur Render
2. Type: Web Service
3. Runtime: Node
4. Build command: `npm install` (ou `CI=true pnpm install --config.node-linker=hoisted`)
5. Start command: `node server/realtime-server.mjs`
6. Health check path: `/api/health`

### Configuration Render (render.yaml)

Le fichier `render.yaml` définit automatiquement :
- Le service web
- Variables d'environnement
- Plan free tier

### Notes importantes

- **Free tier** : Le service dort après inactivité. Le premier appel prend ~30s.
- **Redéploiement** : Automatique sur push GitHub (branche `main`).
- **PORT** : Render assigne un port dynamique via `process.env.PORT`.

## Database (Supabase)

1. Créer un projet Supabase
2. Exécuter les migrations SQL (tables `app_users`, `app_state`, etc.)
3. Configurer les variables d'environnement
4. Les données sont stockées dans `app_state` (JSONB) via `sbUpsert`

### Tables principales

- `app_users` : Profils utilisateurs (UUID, pseudo, email, stats, wallet)
- `app_state` : État applicatif (matches, tournaments, leagues, chat)
- `app_notifications` : Notifications push
- `app_push_subscriptions` : Abonnements web-push

## Monitoring

### Logs serveur

Le backend utilise un logger structuré :
```
[2026-08-27T20:00:00.000Z] [INFO] [auth] User logged in
[2026-08-27T20:00:00.000Z] [ERROR] [payment] FedaPay error
[2026-08-27T20:00:00.000Z] [WARN] [rate-limit] IP 1.2.3.4 blocked
```

### Endpoints de santé

- `GET /api/health` : État du serveur
- `GET /api/metrics` : Métriques Prometheus

### Côté frontend

- Service Worker : erreurs loggées via `console.warn('[SW] ...')`
- Erreurs API : `ApiError` avec code structuré
- Toasts utilisateur : messages d'erreur localisés

## Rollback

### Frontend

Vercel garde un historique des déploiements. Rollback via le dashboard Vercel.

### Backend

Render garde un historique des déploiements. Rollback via le dashboard Render.

### Database

Supabase supporte les backups automatiques. Restore via le dashboard Supabase.

## Tests

### Tests unitaires (Vitest)

```bash
$env:CI="true"; node --experimental-vm-modules node_modules/vitest/vitest.mjs run --reporter=verbose --no-file-parallelism --exclude='e2e/**'
```

220 tests couvrant :
- Persistance (hashing, normalisation)
- Métriques
- Match engine (XP, Elo, résultats)
- Tournament engine (bracket, inscriptions)
- League engine (Score Z, qualifications)
- Wallet engine (dépôts, retraits, lock)
- Payment engine (FedaPay)
- Stores frontend (auth, wallet, chat, toast, notifications)

### Tests E2E (Playwright)

```bash
npx playwright test
```

## Dépannage

| Problème | Solution |
|----------|----------|
| `pnpm install` échoue sur exFAT | `CI=true pnpm install --config.node-linker=hoisted` |
| Build Vite timeout | Augmenter le timeout (300s) |
| Backend Render dort | Premier appel = ~30s de warmup |
| SW cache stale | Bump `CACHE_NAME` dans `sw.js` |
| Token expiré | Le client redirige vers `/auth/login` automatiquement |
| CORS error | Vérifier `ALLOWED_ORIGINS` dans `.env.server` |
