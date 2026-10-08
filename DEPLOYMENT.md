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
VITE_SUPABASE_URL=https://<ton-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Backend (.env.server)

```
PORT=10000
SUPABASE_URL=https://<ton-project-ref>.supabase.co
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

### Migrations à exécuter en production

Le fichier `supabase/schema.sql` est cumulatif et idempotent
(`CREATE TABLE IF NOT EXISTS`) : le réexécuter est sans risque.

Le DDL n'est pas accessible depuis l'application : PostgREST ne fait que du
CRUD, et la clé `service_role` n'exécute pas de SQL arbitraire. Une migration se
joue donc dans l'éditeur SQL du tableau de bord Supabase (ou via un Personal
Access Token et l'API Management).

#### `login_attempts` — verrouillage de connexion persistant

```sql
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_updated ON login_attempts(updated_at);
```

`id` est le SHA-256 de l'identifiant normalisé (préfixe `zoyd-lockout:`),
jamais l'identifiant en clair : la table ne doit pas devenir un annuaire des
pseudos et emails essayés en force.

**Vérifier sans connexion SQL** — le serveur sonde la table au démarrage et
publie le résultat :

```bash
curl -s https://zoyd.onrender.com/api/health | grep -o '"loginLockoutPersisted":[a-z]*'
```

`true` = migration jouée. `false` = elle ne l'est pas encore.

**Si la table est absente, ce qui se passe** — et ce qui ne se passe pas :

- Le verrouillage de connexion continue de fonctionner, en mémoire.
- Il ne survit plus à un redémarrage : un attaquant n'a qu'à attendre un
  déploiement pour repartir de cinq essais.
- **Aucune connexion n'est refusée** à cause de la migration manquante. La
  table est sondée hors du `try/catch` global volontairement : traitée comme
  une table ordinaire, son absence remit `stateTrusted` à `false` et le serveur
  refusait alors *toute écriture d'état* — lecture seule totale, pour une base
  parfaitement saine.

#### Sessions

- `auth_sessions.token` et `realtime_sessions.token` contiennent le **SHA-256**
  du jeton, pas le jeton. Un dump de la base ne donne donc aucune session
  réutilisable. Les lignes écrites avant cette correction contiennent encore
  des jetons en clair : pour les purger sans déconnecter personne, un simple
  `DELETE FROM auth_sessions;` (les joueurs se reconnectent une fois).

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
