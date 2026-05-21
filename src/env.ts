import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  nodeEnv: optional('NODE_ENV', 'development'),
  databaseUrl: optional(
    'DATABASE_URL',
    'postgresql://hedge:hedge@localhost:5432/hedge'
  ),
  serviceKey: optional('HEDGE_SERVICE_KEY'),
  privyAppId: optional('PRIVY_APP_ID'),
  predictServerUrl: optional(
    'PREDICT_SERVER_URL',
    'https://predict-server.testnet.mystenlabs.com'
  ).replace(/\/$/, ''),
  /** USD of mint volume per 1 point (default: $10 → 1 point). */
  usdPerPoint: Number(process.env.USD_PER_POINT ?? 10),
  pointsPerUsd: (() => {
    const explicit = process.env.POINTS_PER_USD?.trim();
    if (explicit) return Number(explicit);
    const usdPerPoint = Number(process.env.USD_PER_POINT ?? 10);
    return 1 / Math.max(usdPerPoint, 1);
  })(),
  referralSignupPoints: Number(process.env.REFERRAL_SIGNUP_POINTS ?? 10),
  referralVolumeShareBps: Number(process.env.REFERRAL_VOLUME_SHARE_BPS ?? 500),
  quoteDecimals: Number(process.env.QUOTE_DECIMALS ?? 6),

  waitlistEnabled: process.env.WAITLIST_ENABLED !== 'false',
  waitlistBasePoints: Number(process.env.WAITLIST_BASE_POINTS ?? 100),
  waitlistReferralGivenPoints: Number(process.env.WAITLIST_REFERRAL_GIVEN_POINTS ?? 10),
  waitlistReferralUsedPoints: Number(process.env.WAITLIST_REFERRAL_USED_POINTS ?? 10),
  waitlistSharedOnXPoints: Number(process.env.WAITLIST_SHARED_ON_X_POINTS ?? 25),
  waitlistDownloadedAppPoints: Number(process.env.WAITLIST_DOWNLOADED_APP_POINTS ?? 25),
  /** Display-only % shown in app copy (e.g. 10 = "10% bonus"). */
  waitlistReferralBonusPercent: Number(process.env.WAITLIST_REFERRAL_BONUS_PERCENT ?? 10),

  /** Public site for share links: `https://hedgeapp.trade/?ref=username` */
  appPublicUrl: optional('HEDGE_APP_URL', 'https://hedgeapp.trade').replace(/\/$/, ''),
  cacheValidateTtlMs: Number(process.env.CACHE_VALIDATE_TTL_MS ?? 60_000),
  cacheLeaderboardTtlMs: Number(process.env.CACHE_LEADERBOARD_TTL_MS ?? 15_000),
} as const;

/** Supabase (and most hosted Postgres) require TLS. */
export function databaseSslMode(): 'require' | false {
  if (process.env.DATABASE_SSL === 'disable') return false;
  if (process.env.DATABASE_SSL === 'require') return 'require';
  const url = env.databaseUrl.toLowerCase();
  if (url.includes('supabase.co') || url.includes('supabase.com')) return 'require';
  return false;
}

export function assertRuntimeConfig(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. On Railway, set your Supabase Session pooler URI in Variables.'
    );
  }
  if (
    env.nodeEnv === 'production' &&
    /localhost|127\.0\.0\.1/.test(databaseUrl)
  ) {
    throw new Error(
      'DATABASE_URL points to localhost in production. Set the Supabase pooler URL in Railway Variables.'
    );
  }
}

export function isServiceKeyConfigured(): boolean {
  return Boolean(env.serviceKey);
}

export function requireServiceKey(): string {
  return required('HEDGE_SERVICE_KEY');
}
