# Deployment Guide — ZOYD

## Prerequisites

- Node.js 18+
- pnpm (with `.npmrc` configured for exFAT: `node-linker=hoisted`)
- Supabase project with service role key
- Vercel account (frontend)
- Render account (backend)
- FedaPay account (payments)
- VAPID keys (web push)

## Environment Variables

### Backend (Render)

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Yes |
| `VAPID_PUBLIC_KEY` | Web push public key | Yes |
| `VAPID_PRIVATE_KEY` | Web push private key | Yes |
| `FEDAPAY_SECRET_KEY` | FedaPay API secret | Yes |
| `ZOYD_ADMIN_PASSWORD` | Admin panel password | Yes |
| `ZOYD_ALLOWED_ORIGINS` | Comma-separated allowed origins | Yes |
| `ZOYD_API_KEY_ROTATION_DAYS` | API key rotation period (default 90) | No |
| `NODE_ENV` | `production` | Yes |

### Frontend (Vercel)

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_REALTIME_URL` | Backend URL (e.g. `https://zoyd.onrender.com`) | Yes |
| `VITE_FEDAPAY_PUBLIC_KEY` | FedaPay public key | Yes |

## Deploy Steps

### 1. Backend (Render)

```bash
# From project root
cd "Multiplayer Gaming Platform"

# Install dependencies (exFAT compatible)
CI=true pnpm install --no-frozen-lockfile --config.node-linker=hoisted

# Run tests
$env:CI="true"; node --experimental-vm-modules node_modules/vitest/vitest.mjs run server/

# Build (if needed)
node node_modules/vite/bin/vite.js build

# Push to GitHub
git push origin main
```

Render auto-deploys from `main` branch. Ensure `render.yaml` is present.

### 2. Frontend (Vercel)

```bash
# Vercel auto-deploys from GitHub
# Ensure vercel.json has:
# - Rewrites for SPA routing
# - Security headers (HSTS, CSP)
# - No-cache for index.html
```

### 3. Database (Supabase)

- Run migration SQL in Supabase SQL Editor
- Enable RLS on all tables
- Verify policies with test queries

### 4. Post-Deploy Verification

```bash
# Health check
curl https://zoyd.onrender.com/api/health

# Test login
curl -X POST https://zoyd.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"test123"}'
```

## Monitoring

- **Health**: `GET /api/health`
- **Metrics**: `GET /metrics` (Prometheus format)
- **Logs**: Render dashboard → Logs tab
- **Errors**: Check `log.error` entries in server logs

## Rollback

1. Revert git commit: `git revert HEAD`
2. Push: `git push origin main`
3. Render auto-deploys the rollback
4. Verify health endpoint

## Scaling Plan

### Current State
- **Backend**: Render free tier (single instance, 512MB RAM)
- **Database**: Supabase free tier (500MB, 500K rows)
- **Frontend**: Vercel (serverless, auto-scales)

### Growth Triggers
| Metric | Current Limit | Action |
|--------|--------------|--------|
| Active users | ~100 | Upgrade Render to paid tier |
| DB rows | 500K | Upgrade Supabase Pro |
| Concurrent matches | ~20 | Add Render horizontal scaling |
| Storage | 500MB | Migrate to Supabase Pro (8GB) |

### Scale-Up Path
1. **Phase 1** (100-500 users): Render Starter ($7/mo), Supabase Pro ($25/mo)
2. **Phase 2** (500-2K users): Render Standard ($25/mo), add Redis for sessions
3. **Phase 3** (2K+ users): Split monolith into services (match, wallet, chat)
4. **Phase 4** (10K+ users): Kubernetes, dedicated Postgres, CDN for assets
