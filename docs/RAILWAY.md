# Deploy Hedge API on Railway

## 1. Create the service

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** (this repo).
2. **Settings → Root Directory** → `backend` (required).
3. Railway reads `backend/railway.toml` for build/start.

## 2. Environment variables

In **Variables**, add (no quotes needed in Railway UI):

| Variable | Example / notes |
|----------|------------------|
| `DATABASE_URL` | Supabase **Session pooler** URI (not direct IPv6 URL) |
| `HEDGE_SERVICE_KEY` | `openssl rand -base64 32` — same value in Expo/EAS server secrets |
| `HEDGE_APP_URL` | `https://hedgeapp.trade` |
| `NODE_ENV` | `production` |
| `DATABASE_POOL_MAX` | `5` (Supabase Nano has low connection limits) |
| `USD_PER_POINT` | `10` |
| `REFERRAL_SIGNUP_POINTS` | `10` |
| `POINTS_PER_USD` | `0.1` |

Optional: `PRIVY_APP_ID`, waitlist vars — see `.env.example`.

**Do not set `PORT`** — Railway injects it automatically.

`DATABASE_SSL` is auto-enabled when the URL contains `supabase.co`.

## 3. Custom domain `api.hedgeapp.trade`

1. Service → **Settings → Networking → Custom Domain**.
2. Add `api.hedgeapp.trade`.
3. At your registrar (where you bought hedgeapp.trade), add DNS:

   | Type | Name | Value |
   |------|------|--------|
   | CNAME | `api` | Railway target (shown in dashboard, e.g. `xxxx.up.railway.app`) |

4. Wait for SSL (Railway provisions HTTPS).

Smoke test:

```bash
curl https://api.hedgeapp.trade/health
curl "https://api.hedgeapp.trade/leaderboard?limit=5"
```

## 4. What runs on each deploy

1. **Build:** `pnpm install --frozen-lockfile && pnpm build` → `dist/`
2. **Pre-deploy:** `node dist/db/migrate.js` → applies `drizzle/*.sql` to Supabase
3. **Start:** `node dist/index.js` → listens on `PORT`

## 5. Indexer (points / volume)

Railway has no built-in cron on all plans. Options:

Use an external cron (e.g. [cron-job.org](https://cron-job.org)) every 5 min:

```bash
# Returns immediately (202). Full sync can take minutes — do not wait on curl.
curl -X POST "https://api.hedgeapp.trade/internal/index/run" \
  -H "Authorization: Bearer <HEDGE_SERVICE_KEY>"

# Optional: poll status
curl "https://api.hedgeapp.trade/internal/index/status" \
  -H "Authorization: Bearer <HEDGE_SERVICE_KEY>"
```

Add `?wait=true` only if you want to block until finished (slow; not for cron).

**B. GitHub Action** on a schedule hitting the same endpoint.

## 6. `my-app` after deploy

```env
EXPO_PUBLIC_HEDGE_API_BASE_URL=https://api.hedgeapp.trade
```

Server-only (EAS secrets / hosting env for `app/api/*`):

```env
HEDGE_API_URL=https://api.hedgeapp.trade
HEDGE_SERVICE_KEY=<same as Railway>
```

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| Build can’t find pnpm | Root Directory must be `backend`; `packageManager` is in `package.json` |
| Pre-deploy `ECONNREFUSED` on migrate | **`DATABASE_URL` missing or wrong on Railway** — without it, the app defaults to `localhost:5432` inside the container. Paste the same Supabase **Session pooler** URI as local `.env`. Set `DATABASE_SSL=require` if needed. |
| DB connection timeout | Use Supabase **Session pooler** URI; lower `DATABASE_POOL_MAX` |
| Migrate fails (other) | Check password URL-encoding in `DATABASE_URL`; run SQL from `drizzle/` in Supabase SQL editor if needed |
| 502 on health | Logs tab; confirm `PORT` is not overridden |

## 8. Logs & redeploy

**Deployments** → latest → **View logs**.  
Push to `main` (or your connected branch) to redeploy; pre-deploy runs migrations automatically.
