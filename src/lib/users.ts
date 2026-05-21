import { eq, or } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { userStats, users } from '../db/schema.js';
import { cacheDelete, cacheGet, cacheSet } from './cache.js';
import { creditPoints } from './points.js';
import {
  normalizeReferralCodeInput,
  referralCodeFromHandle,
  validateHandleInput,
} from './referral-code.js';
import { env } from '../env.js';

export type UserRow = typeof users.$inferSelect;

const VALIDATE_CACHE_NS = 'referral_validate';

export async function findUserIdByPrivyId(
  db: Database,
  privyUserId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  return row?.id ?? null;
}

export async function findUserByPrivyId(db: Database, privyUserId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.privyUserId, privyUserId)).limit(1);
  return row ?? null;
}

/** Username and referral code are the same (`?ref=mankind`). */
export async function findUserByReferralCode(
  db: Database,
  code: string
): Promise<UserRow | null> {
  const normalized = normalizeReferralCodeInput(code);
  const [row] = await db
    .select()
    .from(users)
    .where(or(eq(users.referralCode, normalized), eq(users.handle, normalized)))
    .limit(1);
  return row ?? null;
}

export async function isHandleAvailable(db: Database, handle: string): Promise<boolean> {
  const normalized = referralCodeFromHandle(handle);
  if (!normalized) return false;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.handle, normalized), eq(users.referralCode, normalized)))
    .limit(1);
  return !row;
}

export async function registerUser(
  db: Database,
  params: {
    privyUserId: string;
    suiAddress: string;
    handle: string;
    referralCode?: string | null;
  }
): Promise<UserRow> {
  const normalizedAddress = params.suiAddress.trim().toLowerCase();
  const existing = await findUserByPrivyId(db, params.privyUserId);
  if (existing) {
    return syncUserReferralIdentity(db, existing, params.handle);
  }

  const handleError = validateHandleInput(params.handle);
  if (handleError) {
    throw new Error(handleError);
  }

  const handle = referralCodeFromHandle(params.handle)!;
  const available = await isHandleAvailable(db, handle);
  if (!available) {
    throw new Error('Username is already taken');
  }

  let referredByUserId: string | null = null;
  if (params.referralCode?.trim()) {
    const referrer = await findUserByReferralCode(db, params.referralCode);
    if (referrer) {
      if (referrer.handle === handle) {
        throw new Error('Cannot refer yourself');
      }
      referredByUserId = referrer.id;
    }
  }

  const [created] = await db
    .insert(users)
    .values({
      privyUserId: params.privyUserId,
      suiAddress: normalizedAddress,
      handle,
      referralCode: handle,
      referredByUserId,
      referralLockedAt: referredByUserId ? new Date() : null,
    })
    .returning();

  await db.insert(userStats).values({ userId: created.id }).onConflictDoNothing();

  if (referredByUserId) {
    await creditPoints(db, {
      userId: referredByUserId,
      source: 'referral_signup',
      amount: env.referralSignupPoints,
      referenceId: `signup:${created.id}`,
    });
    await creditPoints(db, {
      userId: created.id,
      source: 'bonus',
      amount: Math.floor(env.referralSignupPoints / 5),
      referenceId: `joined:${referredByUserId}`,
    });
  }

  cacheDelete(VALIDATE_CACHE_NS, handle);
  return created;
}

/** Keep `handle` and `referral_code` in sync (username = referral link). */
export async function syncUserReferralIdentity(
  db: Database,
  user: UserRow,
  handleInput: string
): Promise<UserRow> {
  const handleError = validateHandleInput(handleInput);
  if (handleError) {
    throw new Error(handleError);
  }

  const handle = referralCodeFromHandle(handleInput)!;
  if (user.handle === handle && user.referralCode === handle) {
    return user;
  }

  if (user.handle !== handle) {
    const available = await isHandleAvailable(db, handle);
    if (!available) {
      throw new Error('Username is already taken');
    }
  }

  const [updated] = await db
    .update(users)
    .set({ handle, referralCode: handle, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  if (user.referralCode) cacheDelete(VALIDATE_CACHE_NS, user.referralCode);
  if (user.handle) cacheDelete(VALIDATE_CACHE_NS, user.handle);
  cacheDelete(VALIDATE_CACHE_NS, handle);

  return updated;
}

export async function applyReferralCode(
  db: Database,
  userId: string,
  code: string
): Promise<{ ok: boolean; message?: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, message: 'User not found' };
  if (user.referredByUserId || user.referralLockedAt) {
    return { ok: false, message: 'Referral already applied' };
  }

  const referrer = await findUserByReferralCode(db, code);
  if (!referrer) return { ok: false, message: 'Invalid referral code' };
  if (referrer.id === userId || referrer.handle === user.handle) {
    return { ok: false, message: 'Cannot refer yourself' };
  }

  await db
    .update(users)
    .set({
      referredByUserId: referrer.id,
      referralLockedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await creditPoints(db, {
    userId: referrer.id,
    source: 'referral_signup',
    amount: env.referralSignupPoints,
    referenceId: `signup:${userId}`,
  });

  return { ok: true };
}

export async function getUserProfile(db: Database, userId: string) {
  const [row] = await db
    .select({
      user: users,
      stats: userStats,
    })
    .from(users)
    .leftJoin(userStats, eq(userStats.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return { user: row.user, stats: row.stats ?? null };
}

export type ReferralValidateResult = {
  valid: boolean;
  kind: 'app_user' | 'waitlist' | null;
  handle: string | null;
};

export async function validateAppReferralCode(
  db: Database,
  code: string
): Promise<ReferralValidateResult> {
  const normalized = normalizeReferralCodeInput(code);
  const cached = cacheGet<ReferralValidateResult>(VALIDATE_CACHE_NS, normalized);
  if (cached) return cached;

  const user = await findUserByReferralCode(db, normalized);
  const result: ReferralValidateResult = user
    ? { valid: true, kind: 'app_user', handle: user.handle }
    : { valid: false, kind: null, handle: null };

  cacheSet(VALIDATE_CACHE_NS, normalized, result, env.cacheValidateTtlMs);
  return result;
}
