import { count, eq, max, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { waitlistUsers } from '../db/schema.js';
import { env } from '../env.js';
import { cacheDelete } from './cache.js';
import { referralCodeFromHandle } from './referral-code.js';
import { isHandleAvailable, validateAppReferralCode } from './users.js';

export type WaitlistPoints = {
  base: number;
  referral_given: number;
  referral_used: number;
  shared_on_x: number;
  downloaded_app: number;
  total: number;
};

export type WaitlistUserDto = {
  id: number;
  email: string;
  wallet_address: string | null;
  handle: string;
  rank: number;
  referred_by_handle: string | null;
  referred_count: number;
  shared_on_x: boolean;
  downloaded_app: boolean;
  points: WaitlistPoints;
  created_at: string;
  updated_at: string;
};

function rowToPoints(row: typeof waitlistUsers.$inferSelect): WaitlistPoints {
  const base = row.pointsBase;
  const referral_given = row.pointsReferralGiven;
  const referral_used = row.pointsReferralUsed;
  const shared_on_x = row.pointsSharedOnX;
  const downloaded_app = row.pointsDownloadedApp;
  return {
    base,
    referral_given,
    referral_used,
    shared_on_x,
    downloaded_app,
    total: base + referral_given + referral_used + shared_on_x + downloaded_app,
  };
}

export function toWaitlistDto(row: typeof waitlistUsers.$inferSelect): WaitlistUserDto {
  return {
    id: row.id,
    email: row.email,
    wallet_address: row.walletAddress,
    handle: row.handle,
    rank: row.rank,
    referred_by_handle: row.referredByHandle,
    referred_count: row.referredCount,
    shared_on_x: row.sharedOnX,
    downloaded_app: row.downloadedApp,
    points: rowToPoints(row),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function normalizeWaitlistHandle(handle: string): string | null {
  return referralCodeFromHandle(handle);
}

export async function isWaitlistHandleAvailable(
  db: Database,
  handle: string
): Promise<boolean> {
  const normalized = normalizeWaitlistHandle(handle);
  if (!normalized) return false;
  const [row] = await db
    .select({ id: waitlistUsers.id })
    .from(waitlistUsers)
    .where(eq(waitlistUsers.handle, normalized))
    .limit(1);
  return !row;
}

export async function findWaitlistByEmail(db: Database, email: string) {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.email, normalized))
    .limit(1);
  return row ?? null;
}

export async function findWaitlistByHandle(db: Database, handle: string) {
  const normalized = normalizeWaitlistHandle(handle);
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.handle, normalized))
    .limit(1);
  return row ?? null;
}

async function nextWaitlistRank(db: Database): Promise<number> {
  const [row] = await db.select({ maxRank: max(waitlistUsers.rank) }).from(waitlistUsers);
  return (row?.maxRank ?? 0) + 1;
}

export async function createWaitlistUser(
  db: Database,
  params: {
    email: string;
    handle: string;
    walletAddress?: string | null;
    referredByHandle?: string | null;
  }
): Promise<WaitlistUserDto> {
  const email = params.email.trim().toLowerCase();
  const handle = normalizeWaitlistHandle(params.handle);
  if (!handle) {
    throw new Error('Handle must be 3–20 alphanumeric characters');
  }

  const existingEmail = await findWaitlistByEmail(db, email);
  if (existingEmail) {
    throw new Error('Email already registered on waitlist');
  }

  const existingHandle = await findWaitlistByHandle(db, handle);
  if (existingHandle) {
    throw new Error('Handle is already taken');
  }

  const appHandleTaken = !(await isHandleAvailable(db, handle));
  if (appHandleTaken) {
    throw new Error('Username is already taken');
  }

  let referredByHandle: string | null = null;
  let pointsReferralUsed = 0;
  if (params.referredByHandle?.trim()) {
    const referrerHandle = normalizeWaitlistHandle(params.referredByHandle);
    if (!referrerHandle) {
      throw new Error('Invalid referral handle');
    }
    if (referrerHandle === handle) {
      throw new Error('Cannot refer yourself');
    }
    const referrer = await findWaitlistByHandle(db, referrerHandle);
    if (!referrer) {
      throw new Error('Referral handle not found');
    }
    referredByHandle = referrerHandle;
    pointsReferralUsed = env.waitlistReferralUsedPoints;

    await db
      .update(waitlistUsers)
      .set({
        referredCount: sql`${waitlistUsers.referredCount} + 1`,
        pointsReferralGiven: sql`${waitlistUsers.pointsReferralGiven} + ${env.waitlistReferralGivenPoints}`,
        updatedAt: new Date(),
      })
      .where(eq(waitlistUsers.id, referrer.id));
  }

  const rank = await nextWaitlistRank(db);

  const [created] = await db
    .insert(waitlistUsers)
    .values({
      email,
      handle,
      walletAddress: params.walletAddress?.trim() || null,
      rank,
      referredByHandle,
      pointsBase: env.waitlistBasePoints,
      pointsReferralUsed,
    })
    .returning();

  cacheDelete('referral_validate', handle);
  return toWaitlistDto(created);
}

export async function getWaitlistStats(db: Database) {
  const [totals] = await db
    .select({
      totalUsers: count(),
      totalReferrals: sql<number>`coalesce(sum(${waitlistUsers.referredCount}), 0)::int`,
      latestRank: max(waitlistUsers.rank),
    })
    .from(waitlistUsers);

  return {
    total_users: Number(totals?.totalUsers ?? 0),
    total_referrals: Number(totals?.totalReferrals ?? 0),
    latest_rank: Number(totals?.latestRank ?? 0),
  };
}

export async function getWaitlistReferralStats(db: Database, handle: string) {
  const user = await findWaitlistByHandle(db, handle);
  if (!user) return null;

  const referred = await db
    .select()
    .from(waitlistUsers)
    .where(eq(waitlistUsers.referredByHandle, user.handle))
    .orderBy(sql`${waitlistUsers.createdAt} desc`);

  return {
    user: {
      id: user.id,
      email: user.email,
      handle: user.handle,
      rank: user.rank,
      referred_count: user.referredCount,
      created_at: user.createdAt.toISOString(),
    },
    referred_users: referred.map((row) => ({
      id: row.id,
      email: row.email,
      handle: row.handle,
      rank: row.rank,
      created_at: row.createdAt.toISOString(),
    })),
    summary: {
      total_referrals: user.referredCount,
      referrer_rank: user.rank,
    },
  };
}

export async function updateWaitlistFlags(
  db: Database,
  handle: string,
  flags: { sharedOnX?: boolean; downloadedApp?: boolean }
): Promise<WaitlistUserDto> {
  const user = await findWaitlistByHandle(db, handle);
  if (!user) throw new Error('Waitlist user not found');

  let pointsSharedOnX = user.pointsSharedOnX;
  let pointsDownloadedApp = user.pointsDownloadedApp;
  let sharedOnX = user.sharedOnX;
  let downloadedApp = user.downloadedApp;

  if (flags.sharedOnX === true && !user.sharedOnX) {
    sharedOnX = true;
    pointsSharedOnX = env.waitlistSharedOnXPoints;
  }
  if (flags.downloadedApp === true && !user.downloadedApp) {
    downloadedApp = true;
    pointsDownloadedApp = env.waitlistDownloadedAppPoints;
  }

  const [updated] = await db
    .update(waitlistUsers)
    .set({
      sharedOnX,
      downloadedApp,
      pointsSharedOnX,
      pointsDownloadedApp,
      updatedAt: new Date(),
    })
    .where(eq(waitlistUsers.id, user.id))
    .returning();

  return toWaitlistDto(updated);
}

/** App referral code or waitlist handle (pre-launch). */
export async function validateReferralTarget(
  db: Database,
  code: string
): Promise<{ valid: boolean; kind: 'app_user' | 'waitlist' | null; handle: string | null }> {
  const app = await validateAppReferralCode(db, code);
  if (app.valid) return app;

  if (env.waitlistEnabled) {
    const waitlist = await findWaitlistByHandle(db, code);
    if (waitlist) {
      return { valid: true, kind: 'waitlist', handle: waitlist.handle };
    }
  }
  return { valid: false, kind: null, handle: null };
}
