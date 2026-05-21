# Hedge backend architecture

## Database connection

All data lives in **Postgres** (Supabase). One env var:

```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@....pooler.supabase.com:5432/postgres
```

`src/db/index.ts` opens a pooled `postgres.js` client (SSL auto-enabled for `supabase.co`).  
`pnpm db:migrate` applies SQL in `backend/drizzle/` to create tables.

**Tables**

| Table | Purpose |
|-------|---------|
| `users` | Logged-in app users (Privy id + Sui address + referral code) |
| `user_stats` | Volume, points, streaks per app user |
| `trades` | Indexed Predict mints/redeems |
| `points_ledger` | Append-only point credits |
| `waitlist_users` | Pre-launch email/handle signups (separate funnel) |
| `indexer_state` | Cursor for predict-server indexer |

---

## Auth (not Supabase JWT)

Supabase is **only Postgres**. Login is **Privy** in the app.

Protected routes use `requireAuth`:

```
Authorization: Bearer <token>
```

| Token | Meaning |
|-------|---------|
| `HEDGE_SERVICE_KEY` | Server trust (Expo `app/api`). Also send `X-Privy-User-Id: did:privy:...` |
| Privy access JWT | If `PRIVY_APP_ID` is set, backend verifies JWT via Privy JWKS |

**Public routes (no auth):** `GET /health`, `GET /leaderboard`, `GET /referrals/validate/:code`, all `/waitlist/*`.

---

## App referrals (post-launch users)

### 1. Check code (onboarding UI)

```
GET /referrals/validate/ALICE
→ { valid, kind: "app_user" | "waitlist", handle }
```

Looks up `users.referral_code`, then `waitlist_users.handle` if waitlist is enabled.

### 2. Register with referral

```
POST /users/register   (auth required)
{ suiAddress, handle?, referralCode? }
```

- Creates row in `users` with unique `referral_code` (from handle or random).
- If `referralCode` matches another **app user** → sets `referred_by_user_id`, credits referrer `REFERRAL_SIGNUP_POINTS`.

### 3. Apply referral later

```
POST /users/me/referral   (auth required)
{ referralCode }
```

Only if not already referred (`referral_locked_at` is null).

### 4. Ongoing volume share

Indexer ingests mints → `volume` points for trader → `referral_volume` points for referrer (`REFERRAL_VOLUME_SHARE_BPS`).

### 5. List referrals

```
GET /users/me/referrals   (auth required)
```

---

## Waitlist (pre-launch)

Separate from Privy users. **Public** endpoints; configured via `.env`:

| Env | Default | Meaning |
|-----|---------|---------|
| `WAITLIST_ENABLED` | true | Set `false` to disable routes |
| `WAITLIST_BASE_POINTS` | 100 | Signup points |
| `WAITLIST_REFERRAL_GIVEN_POINTS` | 10 | Referrer when someone uses their handle |
| `WAITLIST_REFERRAL_USED_POINTS` | 10 | New user who used a referral handle |
| `WAITLIST_SHARED_ON_X_POINTS` | 25 | One-time flag bonus |
| `WAITLIST_DOWNLOADED_APP_POINTS` | 25 | One-time flag bonus |
| `WAITLIST_REFERRAL_BONUS_PERCENT` | 10 | For marketing copy only |

**Endpoints**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/waitlist/config` | Points rules for UI |
| POST | `/waitlist` | Join `{ email, handle, referred_by_handle? }` |
| GET | `/waitlist?email=` | Lookup user |
| GET | `/waitlist/stats` | Totals |
| GET | `/waitlist/referral?handle=` | Referrer dashboard |
| GET | `/waitlist/handle/:handle` | Availability check |
| PATCH | `/waitlist/flags` | `{ handle, shared_on_x?, downloaded_app? }` |

After launch, app users use `users` + Privy; waitlist rows stay for historical points/rank.

---

## Request flow (recommended)

```
my-app  →  Privy login
        →  POST app/api/hedge/register (verify Privy, add HEDGE_SERVICE_KEY)
        →  Hedge API  →  Supabase Postgres
```

Never put `HEDGE_SERVICE_KEY` in `EXPO_PUBLIC_*`.
