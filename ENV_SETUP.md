# 📋 Variables d'Environnement ZOYD - Configuration Déploiement

> Aligné une par une sur le code (P14 C2, audit-3). Le guide complet —
> prérequis, procédures Vercel/Render, vérifications `/api/health`,
> dépannage — reste **`DEPLOYMENT.md`**. Les gabarits à copier-renommer sont
> `.env.example` (front) et `.env.server.example` (backend).

## 🔧 Vercel (Frontend) — lues au BUILD Vite, pas à l'exécution

| Variable | Rôle | Lue par |
|----------|------|---------|
| `VITE_REALTIME_URL` | URL du backend Node.js (Render) — REST et Socket.io sur la même origine | `src/app/lib/apiUrl.ts` |
| `VITE_FEDAPAY_PUBLIC_KEY` | Clé publique FedaPay (checkout) | `src/app/pages/WalletPage.tsx` |

**Piège `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` : ne pas définir.**
Le navigateur n'accède jamais à Supabase directement, tout passe par le
backend (voir DEPLOYMENT.md, section « Corrigé »). Le préfixe `VITE_` ne
fait qu'embarquer la valeur dans le bundle client.

Ces valeurs sont figées au build : les changer dans Vercel exige un
nouveau déploiement frontend.

---

## 🔧 Render (Backend)

### Déjà configurées par render.yaml

| Variable | Valeur | Rôle |
|----------|--------|------|
| `NODE_ENV` | `production` | Logs JSON, gardes prod |
| `WEB_CONCURRENCY` | `1` | Garantie mono-processus (par l'absence de cluster, voir render.yaml) |
| `LOG_LEVEL` | `warn` | Le debug par requête noierait les logs Render gratuit |
| `PORT` | `4001` | Port interne du serveur |
| `TRUST_PROXY` | `true` | `X-Forwarded-For` du load balancer — rate-limit par IP réelle |
| `ZOYD_ALLOWED_ORIGINS` | domaines zoyd | CORS (`realtime-server.mjs`) — à ajuster si vos domaines diffèrent |

### À configurer dans le dashboard Render

| Variable | Rôle | Notes |
|----------|------|-------|
| `SUPABASE_URL` | URL du projet Supabase | |
| `SUPABASE_SERVICE_KEY` | Clé service_role Supabase | Le serveur écrit avec elle (contourne les RLS) ; `SUPABASE_SERVICE_ROLE_KEY` accepté en alias |
| `FEDAPAY_SECRET_KEY` | Clé secrète FedaPay | `payment-engine.mjs` |
| `ZOYD_ADMIN_PASSWORD` | Mot de passe du compte admin | Recréation du compte admin au boot (`persistence.mjs`) |
| `ZOYD_ADMIN_EMAIL` / `ZOYD_ADMIN_PSEUDO` / `ZOYD_ADMIN_ID` | Identité du compte de modération | Les défauts du code (`admin@zoyd.com`, `ZOYD Control`, `admin-zoyd-control`) sont publics : surcharger avant le déploiement |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notifications push web | Générer via `npx web-push generate-vapid-keys` |
| `RESEND_API_KEY` | Canal mail recommandé | Priorité Resend → Brevo → SMTP (`code-delivery.mjs`) — Render gratuit bloque SMTP (ports 25/465/587) |
| `BREVO_API_KEY` | Canal mail alternatif | |
| `EMAIL_FROM` | Expéditeur affiché | Doit être vérifié chez le provider |
| `METRICS_TOKEN` | Protège `/api/metrics` (Bearer) | **Obligatoire en prod** : sans lui, la route répond 403 `METRICS_DISABLED` (`routes/public.mjs`) |

### À NE PAS définir

- `SUPABASE_ANON_KEY` : `server/supabase.mjs` refuse volontairement tout
  repli sur la clé anon — le serveur doit écrire avec la clé service_role.
- `ALLOWED_ORIGINS` (le code lit `ZOYD_ALLOWED_ORIGINS`), `JWT_SECRET`
  (aucune clé de signature de session n'existe), `VAPID_EMAIL`,
  `FEDAPAY_ENVIRONMENT` : jamais lues — voir DEPLOYMENT.md, section
  « Corrigé : variables de l'ancienne documentation que le code ne lit pas ».
- `NODE_ENV=production` en LOCAL : les gardes `NODE_ENV === 'test'`
  (`br-engine.mjs`, `rate-limiter.mjs`) et les logs lisibles deviennent
  inaccessibles ; render.yaml pose production côté prod.

## 🎯 Instructions de configuration

### 1. Configuration Vercel (Frontend)

1. Aller sur https://vercel.com/your-project/settings/environment-variables
2. Ajouter les variables suivantes :

```
VITE_REALTIME_URL=https://zoyd-backend.onrender.com
VITE_FEDAPAY_PUBLIC_KEY=pk_live_votre_cle_fedapay
```

### 2. Configuration Render (Backend)

1. Aller sur le dashboard Render du projet
2. Section "Environment Variables"
3. Configurer les variables du tableau « À configurer » :

```
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_SERVICE_KEY=votre_service_role_key
FEDAPAY_SECRET_KEY=sk_live_votre_cle_secrete
ZOYD_ADMIN_PASSWORD=mot_de_passe_securise
ZOYD_ADMIN_EMAIL=admin@votre-domaine.com
ZOYD_ADMIN_PSEUDO=VotrePseudoAdmin
ZOYD_ADMIN_ID=votre-identifiant-admin
VAPID_PUBLIC_KEY=cle_publique_vapid
VAPID_PRIVATE_KEY=cle_privee_vapid
RESEND_API_KEY=re_votre_cle
EMAIL_FROM=ZOYD <onboarding@resend.dev>
METRICS_TOKEN=token_long_aleatoire
```

## 🔑 Obtention des clés

### FedaPay
- Se connecter sur https://dashboard.fedapay.com/
- Section "API Keys"
- Clé publique pour frontend (VITE_FEDAPAY_PUBLIC_KEY)
- Clé secrète pour backend (FEDAPAY_SECRET_KEY)

### Supabase
- Se connecter sur https://supabase.com/dashboard
- Sélectionner le projet
- Settings → API
- Project URL (SUPABASE_URL)
- service_role key (SUPABASE_SERVICE_KEY) — PAS la clé anon

### VAPID (Web Push)
- Générer via `npx web-push generate-vapid-keys`
- Ou utiliser un service en ligne

### Resend / Brevo (mail)
- Resend (recommandé) : https://resend.com/api-keys → `re_...`
- Brevo : https://app.brevo.com/settings/keys/api → `xkeysib-...`
- `EMAIL_FROM` doit être un expéditeur vérifié chez le provider

---

## ⚠️ Notes de sécurité

1. **Jamais commiter les vraies clés** dans le repository
2. **Utiliser des clés différentes** pour dev et prod
3. **Faire régulièrement la rotation** des clés sensibles
4. **Surveiller les logs** pour détecter les usages anormaux
5. **Limiter les permissions** des clés API au minimum nécessaire

---

## 🚀 Ordre de déploiement recommandé

1. **Configurer Supabase** → Obtenir URL et clé service_role
2. **Configurer FedaPay** → Obtenir clés API
3. **Générer VAPID keys** → Pour notifications push
4. **Déployer backend Render** → Avec variables d'environnement (dont METRICS_TOKEN)
5. **Obtenir URL Render** → Pour VITE_REALTIME_URL
6. **Configurer Vercel** → Avec variables frontend
7. **Déployer frontend Vercel** → Avec les variables configurées
