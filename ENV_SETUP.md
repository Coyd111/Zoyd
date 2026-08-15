# 📋 Variables d'Environnement ZOYD - Configuration Déploiement

## 🔧 Variables à configurer dans Vercel (Frontend)

### Variables obligatoires pour le frontend

| Variable | Description | Valeur suggérée | Comment obtenir |
|----------|-------------|----------------|----------------|
| `VITE_REALTIME_URL` | URL du backend Node.js (Render) | `https://zoyd-backend.onrender.com` | Après déploiement Render |
| `VITE_FEDAPAY_PUBLIC_KEY` | Clé publique FedaPay | `pk_live_xxxxxx` | Dashboard FedaPay |

### Variables optionnelles pour le frontend

| Variable | Description | Valeur suggérée |
|----------|-------------|----------------|
| `VITE_SUPABASE_URL` | URL Supabase (accès direct) | `https://xxxxx.supabase.co` |

---

## 🔧 Variables à configurer dans Render (Backend)

### Variables déjà configurées dans render.yaml

| Variable | Description | Valeur | Notes |
|----------|-------------|--------|-------|
| `NODE_ENV` | Environnement | `production` | Déjà configuré |
| `SUPABASE_URL` | URL Supabase | À configurer | À configurer |
| `SUPABASE_SERVICE_KEY` | Clé service Supabase | À configurer | À configurer |
| `FEDAPAY_SECRET_KEY` | Clé secrète FedaPay | À configurer | À configurer |
| `ZOYD_ADMIN_PASSWORD` | Mot de passe admin | À configurer | Sécurisé |
| `VAPID_PUBLIC_KEY` | Clé publique VAPID | À configurer | Notifications |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID | À configurer | Notifications |
| `ALLOWED_ORIGINS` | CORS autorisés | `https://zoyd.vercel.app,https://zoyd.africa,https://www.zoyd.africa` | Déjà configuré |

---

## 🎯 Instructions de configuration

### 1. Configuration Vercel (Frontend)

1. Aller sur https://vercel.com/your-project/settings/environment-variables
2. Ajouter les variables suivantes :

```
VITE_REALTIME_URL=https://zoyd-backend.onrender.com
VITE_FEDAPAY_PUBLIC_KEY=pk_live_votre_clé_fedapay
```

### 2. Configuration Render (Backend)

1. Aller sur le dashboard Render du projet
2. Section "Environment Variables"
3. Configurer les variables manquantes :

```
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_SERVICE_KEY=votre_service_role_key
FEDAPAY_SECRET_KEY=sk_live_votre_clé_secrète
ZOYD_ADMIN_PASSWORD=mot_de_passe_sécurisé
VAPID_PUBLIC_KEY=clé_publique_vapid
VAPID_PRIVATE_KEY=clé_privée_vapid
```

### 3. Obtention des clés

#### FedaPay
- Se connecter sur https://dashboard.fedapay.com/
- Section "API Keys"
- Clé publique pour frontend (VITE_FEDAPAY_PUBLIC_KEY)
- Clé secrète pour backend (FEDAPAY_SECRET_KEY)

#### Supabase
- Se connecter sur https://supabase.com/dashboard
- Sélectionner le projet
- Settings → API
- Project URL (SUPABASE_URL)
- service_role key (SUPABASE_SERVICE_KEY)

#### VAPID (Web Push)
- Générer via `npx web-push generate-vapid-keys`
- Ou utiliser un service en ligne

---

## 🔍 Variables utilisées dans le code

### Frontend (src/)
- `VITE_REALTIME_URL` → apiClient.ts, realtimeClient.ts
- `VITE_FEDAPAY_PUBLIC_KEY` → WalletPage.tsx
- `VITE_SUPABASE_URL` → (optionnel)

### Backend (server/)
- `PORT` / `ZOYD_REALTIME_PORT` → realtime-server.mjs
- `ZOYD_ALLOWED_ORIGINS` → realtime-server.mjs
- `SUPABASE_URL` → supabase.mjs
- `SUPABASE_SERVICE_KEY` / `SUPABASE_ANON_KEY` → supabase.mjs
- `FEDAPAY_SECRET_KEY` → payment-engine.mjs
- `ZOYD_ADMIN_PASSWORD` → persistence.mjs
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` → realtime-server.mjs
- `LOG_LEVEL` → logger.mjs
- `NODE_ENV` → logger.mjs, persistence.mjs

---

## ⚠️ Notes de sécurité

1. **Jamais commiter les vraies clés** dans le repository
2. **Utiliser des clés différentes** pour dev et prod
3. **Faire régulièrement la rotation** des clés sensibles
4. **Surveiller les logs** pour détecter les usages anormaux
5. **Limiter les permissions** des clés API au minimum nécessaire

---

## 🚀 Ordre de déploiement recommandé

1. **Configurer Supabase** → Obtenir URL et clés
2. **Configurer FedaPay** → Obtenir clés API
3. **Générer VAPID keys** → Pour notifications push
4. **Déployer backend Render** → Avec variables d'environnement
5. **Obtenir URL Render** → Pour VITE_REALTIME_URL
6. **Configurer Vercel** → Avec variables frontend
7. **Déployer frontend Vercel** → Avec les variables configurées
