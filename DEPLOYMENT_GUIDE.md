# Guide de Déploiement ZOYD

## Étape 1: Déployer le Backend sur Render

### Option A: Via render.yaml (Automatique)
1. Push le code sur GitHub
2. Connectez-vous sur https://render.com
3. Cliquez sur "New +" → "Web Service"
4. Connectez votre repo GitHub
5. Render détectera automatiquement `render.yaml` et configurera le service
6. Cliquez sur "Deploy Web Service"

### Option B: Manuel
1. Allez sur https://dashboard.render.com
2. Cliquez sur "New +" → "Web Service"
3. Connectez votre repo GitHub: `Coyd111/Zoyd`
4. Configurez:
   - **Name**: `zoyd-backend`
   - **Region**: `Frankfurt` (ou proche de l'Afrique de l'Ouest)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `pnpm install`
   - **Start Command**: `node server/realtime-server.mjs`
5. Ajoutez les variables d'environnement (voir DEPLOYMENT_ENV.md)
6. Cliquez sur "Create Web Service"

### Variables d'environnement Render
```
DATABASE_URL=postgresql://postgres:Hilmes11@Zoyd@db.kqxkijbuafuphjlgfram.supabase.co:5432/postgres
FEDAPAY_SECRET_KEY=sk_sandbox_EscwCTtrmpHs_CqYJFXwoHW3
SUPABASE_ANON_KEY=sb_publishable_UOPfnslytYUQber2GSBZ8g_iJqUpgyk
SUPABASE_URL=https://kqxkijbuafuphjlgfram.supabase.co
ZOYD_ALLOWED_ORIGINS=https://zoyd-9c4ttzm2i-coyd-s-projects.vercel.app/
ZOYD_ADMIN_PASSWORD=Admin@ZOYD2026
PORT=4001
```

**Note importante:** Une fois le backend déployé, notez l'URL (ex: `https://zoyd-backend.onrender.com`)

## Étape 2: Déployer le Frontend sur Vercel

### Via GitHub (Automatique)
1. Assurez-vous que votre repo est connecté à Vercel
2. Vercel détectera automatiquement le push et déploiera
3. Allez sur https://vercel.com/dashboard
4. Sélectionnez le projet `zoyd-9c4ttzm2i-coyd-s-projects`
5. Configurez les variables d'environnement

### Variables d'environnement Vercel
```
VITE_SUPABASE_URL=https://kqxkijbuafuphjlgfram.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_UOPfnslytYUQber2GSBZ8g_iJqUpgyk
VITE_REALTIME_URL=https://zoyd-backend.onrender.com
```

**Important:** Remplacez `https://zoyd-backend.onrender.com` par l'URL réelle de votre backend Render.

## Étape 3: Mettre à jour ZOYD_ALLOWED_ORIGINS

Une fois le backend déployé:
1. Allez sur le dashboard Render
2. Mettez à jour `ZOYD_ALLOWED_ORIGINS` pour inclure l'URL Vercel:
   ```
   ZOYD_ALLOWED_ORIGINS=https://zoyd-9c4ttzm2i-coyd-s-projects.vercel.app/,https://zoyd-backend.onrender.com
   ```
3. Redéployez le backend Render

## Étape 4: Tester le déploiement

1. **Tester le backend:**
   ```bash
   curl https://zoyd-backend.onrender.com/api/realtime/health
   ```
   Devrait retourner: `{"ok":true,"service":"zoyd-realtime"}`

2. **Tester le frontend:**
   - Ouvrez https://zoyd-9c4ttzm2i-coyd-s-projects.vercel.app/
   - Essayez de créer un compte
   - Vérifiez que les données apparaissent dans Supabase Dashboard

## Étape 5: Vérifier la Sync Supabase

1. Allez sur https://supabase.com/dashboard/project/kqxkijbuafuphjlgfram
2. Vérifiez les tables:
   - `app_users` (utilisateurs créés)
   - `auth_sessions` (sessions actives)
   - `profiles` (profils utilisateurs)
   - `wallets` (soldes)

## Ordre de Déploiement Recommandé

1. ✅ Push sur GitHub
2. ✅ Déployer backend sur Render
3. ✅ Notez l'URL du backend
4. ✅ Configurer VITE_REALTIME_URL sur Vercel
5. ✅ Déployer frontend sur Vercel (automatique)
6. ✅ Mettre à jour ZOYD_ALLOWED_ORIGINS sur Render
7. ✅ Tester l'application complète

## Fichiers de Déploiement Créés

- `render.yaml` - Configuration automatique Render
- `DEPLOYMENT_ENV.md` - Variables d'environnement
- `vercel.json` - Configuration Vercel (existant)
