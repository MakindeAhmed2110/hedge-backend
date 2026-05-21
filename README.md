# Hedge API

Postgres-backed API for Hedge: user registration, referrals, points, leaderboard, and a Predict trade indexer.

## Is Postgres free?

| Option | Cost |
|--------|------|
| **Local (Docker)** | Free — `docker compose up -d` in this folder |
| **[Neon](https://neon.tech)** | Free tier (generous for dev/small prod) |
| **[Supabase](https://supabase.com)** | Free tier — you’re on this (Nano, EU Central) |
| **Railway / Render** | Paid after trial; small DB is a few $/mo |

PostgreSQL itself is open source; you only pay for hosting (or run it yourself for free).

## Deploy on Railway

See **[docs/RAILWAY.md](./docs/RAILWAY.md)** — root directory `backend`, custom domain `api.hedgeapp.trade`, env vars, indexer cron.

## Quick start (Supabase — recommended)

1. In [Supabase](https://supabase.com/dashboard) → your project → **Connect** (or **Project Settings** → **Database**).
2. Under **Connection string**, choose **URI** and **Session pooler** — **not** “Direct connection”.
   - **Direct** (`db.xxxxx.supabase.co`) is IPv6-only and often breaks locally (“Not IPv4 compatible” in the dashboard).
   - **Session pooler** (`aws-0-eu-central-1.pooler.supabase.com`, user `postgres.xxxxx`) works on normal WiFi and is what you want.
3. Copy the pooler URI, replace `[YOUR-PASSWORD]` with your database password, and paste into `backend/.env`:

   ```env
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   HEDGE_SERVICE_KEY=<random-secret>
   ```

4. Run migrations and start the API:

   ```bash
   cd backend
   pnpm install
   pnpm db:migrate    # creates users, trades, points_ledger, etc.
   pnpm dev
   ```

5. Open **Table Editor** in Supabase — you should see `users`, `trades`, `points_ledger`, `user_stats`, `indexer_state` after migrate.

SSL to Supabase is enabled automatically when the URL contains `supabase.co`. Set `DATABASE_SSL=require` if needed.

## Quick start (local Docker)

```bash
cd backend
cp .env.example .env
# DATABASE_URL=postgresql://hedge:hedge@localhost:5432/hedge

docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

API base: `http://localhost:8787`

### Indexer (cron every 1–5 min)

Ingests mint/redeem events from the Mysten predict-server and credits points for registered users:

```bash
pnpm indexer
# or
curl -X POST http://localhost:8787/internal/index/run \
  -H "Authorization: Bearer $HEDGE_SERVICE_KEY"
```

## Auth

Two modes (for `my-app` BFF or direct mobile once Privy is wired):

1. **Service key** (recommended for Expo `app/api` routes):  
   `Authorization: Bearer <HEDGE_SERVICE_KEY>`  
   `X-Privy-User-Id: <privy did>`

2. **Privy JWT**: set `PRIVY_APP_ID` and send the user’s Privy access token as Bearer.

Never put `HEDGE_SERVICE_KEY` in `EXPO_PUBLIC_*` — only server-side.

### `HEDGE_SERVICE_KEY` (how to create one)

Generate a **random secret** (32+ bytes). One-time per environment (dev vs prod use different keys):

```bash
openssl rand -base64 32
```

Example output shape: `K7x9mP2vQn4R8wL1jT6yH0cF3bN5aZ8eU2dG9sX1kM4p=`

| Where to set it | Value |
|-----------------|--------|
| `backend/.env` on **api.hedgeapp.trade** | Same secret |
| **my-app** host env (Expo API routes / EAS secrets) | Same secret — **not** `EXPO_PUBLIC_` |
| Supabase / mobile bundle | **Never** |

**Do not** use a word password, your Privy secret, or the Supabase DB password. This key only protects Hedge API admin routes (`/users/register`, `/internal/index/run`, etc.).

If it leaks: rotate the key in both places and restart the API.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Liveness |
| POST | `/users/register` | ✓ | `{ suiAddress, handle, referralCode? }` |
| GET | `/users/me` | ✓ | Profile + stats |
| POST | `/users/me/referral` | ✓ | Apply referral code |
| GET | `/users/me/points` | ✓ | Points + weekly summary |
| GET | `/users/me/referrals` | ✓ | Referred users |
| GET | `/referrals/validate/:code` | — | Check code exists |
| GET | `/leaderboard?metric=points\|volume&limit=100` | — | Rankings |
| POST | `/internal/index/run` | service key | Run indexer |

## Wire up `my-app`

1. DNS: `api.hedgeapp.trade` → backend host; `hedgeapp.trade` → marketing site.
2. Add server env: `HEDGE_API_URL=https://api.hedgeapp.trade`, `HEDGE_SERVICE_KEY` (see above; not public).
3. After onboarding + Sui wallet: BFF `POST /api/hedge/register` → Hedge `POST /users/register`.
4. Point leaderboard at `GET /leaderboard` instead of the old Miracle URL.
5. Schedule indexer (GitHub Action, cron, or Railway cron).

## How referrals & DB work

See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for auth, referral validate/register flow, and waitlist.

**Short version:** Supabase = Postgres only. Privy = app login. `HEDGE_SERVICE_KEY` = server-to-server trust. Referrals live in `users` (+ validate also checks `waitlist_users` handles).

## Waitlist

Pre-launch signups (email + handle) — public routes, env-tunable points:

```bash
GET  /waitlist/config
POST /waitlist
GET  /waitlist?email=user@example.com
```

Set `WAITLIST_ENABLED=false` to turn off.

## Points rules (env-tunable)

- `USD_PER_POINT=10` — $10 mint volume = 1 point (`POINTS_PER_USD=0.1` is equivalent)  
- `REFERRAL_SIGNUP_POINTS=10` — referrer bonus when someone signs up with their code  
- `REFERRAL_VOLUME_SHARE_BPS` — share of referred mint volume (basis points)
