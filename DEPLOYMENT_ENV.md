# Variables d'Environnement pour Déploiement

## Backend (Render)
Ajouter ces variables dans le dashboard Render:
```
DATABASE_URL=postgresql://postgres:Hilmes11@Zoyd@db.kqxkijbuafuphjlgfram.supabase.co:5432/postgres
FEDAPAY_SECRET_KEY=sk_sandbox_EscwCTtrmpHs_CqYJFXwoHW3
SUPABASE_ANON_KEY=sb_publishable_UOPfnslytYUQber2GSBZ8g_iJqUpgyk
SUPABASE_URL=https://kqxkijbuafuphjlgfram.supabase.co
ZOYD_ALLOWED_ORIGINS=https://zoyd-9c4ttzm2i-coyd-s-projects.vercel.app/
ZOYD_ADMIN_PASSWORD=Admin@ZOYD2026
PORT=4001
```

## Frontend (Vercel)
Ajouter ces variables dans le dashboard Vercel:
```
VITE_SUPABASE_URL=https://kqxkijbuafuphjlgfram.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_UOPfnslytYUQber2GSBZ8g_iJqUpgyk
VITE_REALTIME_URL=https://zoyd.onrender.com
```

**Note:** Remplacez `https://zoyd.onrender.com` par l'URL réelle de votre backend Render une fois déployé.
