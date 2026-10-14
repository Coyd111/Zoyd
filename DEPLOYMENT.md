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

> Cette section a été réécrite à partir du code, pas à partir de souvenirs.
> Les valeurs ci-dessous sont celles que le serveur lit réellement, avec leur
> comportement quand elles sont absentes. La version précédente documentait
> neuf variables que le code ne lit pas : les suivre produisait une
> configuration en partie inerte, sans le moindre avertissement.

### Backend — obligatoire en production

| Variable | Effet si absente | Rôle |
|----------|------------------|------|
| `SUPABASE_URL` | **mode mémoire** : l'état vit et meurt avec le processus, les données sont perdues au redémarrage | Point d'entrée Supabase |
| `SUPABASE_SERVICE_KEY` | **mode mémoire**, même conséquence | Clé `service_role`. `SUPABASE_SERVICE_ROLE_KEY` est accepté en alias |
| `FEDAPAY_SECRET_KEY` | dépôts et retraits refusés | Clé serveur FedaPay |
| `ZOYD_ADMIN_PASSWORD` | l'admin est créé avec le mot de passe **public du dépôt** | Mot de passe du compte d'administration |
| `METRICS_TOKEN` | `/metrics` répond 403 | Jeton Bearer d'accès aux métriques |

`SUPABASE_ANON_KEY` **n'est pas utilisé et ne doit pas être défini.** Tout
l'accès à la base passe par la clé `service_role`, qui contourne les RLS :
avec une clé `anon`, chaque écriture échouerait derrière un client pourtant
annoncé actif, et l'argent cesserait d'être persisté sans la moindre alerte.

### Backend — behaviour réseau et journalisation

| Variable | Défaut | Rôle |
|----------|--------|------|
| `PORT` | `ZOYD_REALTIME_PORT`, sinon `4001` | Port HTTP. **Render injecte `PORT` et l'impose** |
| `ZOYD_REALTIME_PORT` | `4001` | Port de repli quand `PORT` est absent |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug`. En production Render est sur `warn` |
| `TRUST_PROXY` | `false` | À mettre à `true` **derrière un load balancer**, sinon tous les utilisateurs partagent un seul bucket de rate limit |
| `ZOYD_ALLOWED_ORIGINS` | les 3 domaines de production, codés en dur | Origines CORS supplémentaires, séparées par des virgules |

> **Attention, erreur corrigée dans cette version.** L'ancien document
> indiquait `ALLOWED_ORIGINS`, que le code ne lit pas. Le nom réel est
> `ZOYD_ALLOWED_ORIGINS`. Les trois domaines de production (`zoyd.vercel.app`,
> `zoyd.africa`, `www.zoyd.africa`) sont de toute façon autorisés en repli, donc
> l'erreur n'était pas bloquante — mais ajouter un nouveau domaine en suivant
> l'ancienne doc produirait un blocage CORS muet.

### Backend — identité de l'admin

| Variable | Défaut | Rôle |
|----------|--------|------|
| `ZOYD_ADMIN_EMAIL` | `admin@zoyd.com` (**public dans le dépôt**) | Compte d'administration |
| `ZOYD_ADMIN_PSEUDO` | `ZOYD Control` | Pseudo affiché |
| `ZOYD_ADMIN_ID` | identifiant interne | Doit correspondre au compte réellement créé |
| `ZOYD_ADMIN_PHONE` | `+2290161000001` (**par défaut en dur**) | Numéro de l'admin, pour les notifications |

> `ensureSeedAdmin` ne peut pas écraser un compte existant. Si l'email de la
> variable ne correspond plus au compte déjà en base, aucun compte n'est créé et
> le serveur démarre sans administrateur — c'est le comportement voulu, mais il
> faut le savoir avant de changer la variable.

### Backend — ajuster le comportement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `ZOYD_RATE_LIMIT_MAX` | `100000` | Plafond global. **N'agit que si `NODE_ENV=test` et `ALLOW_DEBUG_CODES=true`** |
| `ZOYD_BR_START_EARLY_MS` | — | Avance le démarrage d'une partie BR, en millisecondes |
| `ZOYD_API_KEY_ROTATION_DAYS` | `90` | Âge au-delà duquel une clé d'API est signalée à renouveler |
| `ALLOW_DEBUG_CODES` | `false` | **Nernels jamais en production** : expose les codes de vérification dans les réponses |

### Intégrations facultatives

Toutes facultatives : le service démarre sans, la fonction concernée est
simplement indisponible.

| Variable | Défaut | Rôle |
|----------|--------|------|
| `RESEND_API_KEY` | — | Envoi d'e-mails, canal recommandé |
| `BREVO_API_KEY` | — | Envoi d'e-mails, alternative |
| `EMAIL_FROM` / `SMTP_FROM` | `ZOYD <onboarding@resend.dev>` | Expéditeur affiché |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | port `587` | Envoi d'e-mails par SMTP |
| `SMTP_PORT` | `587` | — |
| `SMTP_SECURE` | `true` si le port est `465` | Chiffrement du transport |
| `CODE_DELIVERY_WEBHOOK` | — | Webhook de livraison des codes |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | Notifications push. Sans elles, `/api/realtime/push/public-key` répond 503 |
| `ZOYD_ALLOWED_ORIGINS` | — | voir plus haut |

> **Priorité d'envoi** : Resend, puis Brevo, puis SMTP, puis le webhook.

### Frontend — lues au build, pas à l'exécution

| Variable | Rôle |
|----------|------|
| `VITE_FEDAPAY_PUBLIC_KEY` | Clé publique FedaPay, utilisée par la page Portefeuille |
| `VITE_REALTIME_URL` | URL du serveur temps réel |

Les variables `VITE_*` sont **intégrées dans le bundle au moment du build** :
les modifier sur Render ne change rien tant que le frontend n'est pas
reconstruit. Ne jamais y placer de secret — il serait public.

### Fournies automatiquement par Render

`RENDER_GIT_COMMIT` et `RENDER_GIT_BRANCH` sont injectés par la plateforme et
sert à `/api/health`, qui expose `persistence.deployedCommitShort`. C'est le
moyen fiable de vérifier quel commit tourne réellement en production.

### Tests et développement local uniquement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `ZOYD_DISABLE_SUPABASE` | `false` | Force le mode mémoire. **La suite E2E en dépend** : sans elle, les tests dépendent du réseau et des données Supabase |
| `ZOYD_DEV_URL` | `http://localhost:5173` | Cible des tests UI |

### Corrigé : variables de l'ancienne documentation que le code ne lit pas

`ALLOWED_ORIGINS`, `JWT_SECRET`, `VAPID_EMAIL`, `FEDAPAY_ENVIRONMENT`,
`FEDAPAY_PUBLIC_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_ANON_KEY`, `CACHE_NAME`.

Les deux dernières catégories sont particulièrement trompeuses :

- `JWT_SECRET` donne l'impression qu'une clé de signature de session existe.
  Il n'y en a pas : les sessions reposent sur d'autres mécanismes.
- `VITE_SUPABASE_*` suggère un accès direct du navigateur à Supabase. Il n'y
  en a pas : tout passe par le serveur.

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

#### `user_reports` — signalements de joueurs

Ajoutée le 14/10/2026. La table était utilisée par `POST /api/social/report`
sans qu'aucun fichier SQL du dépôt ne la déclare : sur un environnement neuf,
rien ne la créait et les signalements disparaissaient.

```sql
CREATE TABLE IF NOT EXISTS user_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT,
  target_id TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_target ON user_reports(target_id, created_at DESC);
```

Le code écrit `{ id, payload, created_at }`, d'où la colonne `payload` JSONB.

**Vérifier sans connexion SQL :**

```bash
curl -s https://zoyd.onrender.com/api/health
```

**Si la table est absente** : la route `/api/social/report` répond `503` au
joueur au lieu de « Signalement envoyé ». Le message est exact — c'est
volontaire : mieux vaut un signalement annoncé comme échoué qu'un signalement
annoncé comme pris et perdu.

Les deux index servent à la future lecture par la modération. Tant qu'aucun
endpoint ne relit la table, ils ne sont pas utilisés : le tableau de bord
d'administration n'affiche aujourd'hui que les signalements faits **dans le
navigateur courant**.

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
