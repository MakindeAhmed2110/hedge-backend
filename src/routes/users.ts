import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/index.js';
import { env } from '../env.js';
import { userStats, users } from '../db/schema.js';
import { getPointsSummary } from '../lib/points.js';
import { buildReferralUrl, normalizeReferralCodeInput } from '../lib/referral-code.js';
import { validateReferralTarget } from '../lib/waitlist.js';
import {
  applyReferralCode,
  getUserProfile,
  isHandleAvailable,
  registerUser,
  syncUserReferralIdentity,
  findUserByPrivyId,
} from '../lib/users.js';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';

const registerSchema = z.object({
  suiAddress: z.string().min(10),
  handle: z.string().min(3).max(20),
  referralCode: z.string().min(3).max(20).optional(),
});

const referralSchema = z.object({
  referralCode: z.string().min(3).max(20),
});

const handleSchema = z.object({
  handle: z.string().min(3).max(20),
});

export const userRoutes = new Hono<{ Variables: AuthVariables }>();

userRoutes.get('/referrals/config', (c) => {
  return c.json({
    data: {
      appUrl: env.appPublicUrl,
      refParam: 'ref',
      example: buildReferralUrl(env.appPublicUrl, 'mankind'),
    },
  });
});

userRoutes.get('/referrals/validate/:code', async (c) => {
  const code = normalizeReferralCodeInput(c.req.param('code'));
  const result = await validateReferralTarget(db, code);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({
    data: {
      valid: result.valid,
      kind: result.kind,
      handle: result.handle,
      ref: result.handle,
    },
  });
});

userRoutes.get('/users/handle/:handle/available', async (c) => {
  const available = await isHandleAvailable(db, c.req.param('handle'));
  return c.json({ data: { available } });
});

userRoutes.post('/users/register', requireAuth, async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const privyUserId = c.get('privyUserId');
    const user = await registerUser(db, {
      privyUserId,
      suiAddress: parsed.data.suiAddress,
      handle: parsed.data.handle,
      referralCode: parsed.data.referralCode ?? null,
    });

    const profile = await getUserProfile(db, user.id);
    return c.json({ data: formatUserResponse(profile) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return c.json({ error: message }, 400);
  }
});

userRoutes.patch('/users/me/handle', requireAuth, async (c) => {
  const parsed = handleSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const privyUserId = c.get('privyUserId');
  const existing = await findUserByPrivyId(db, privyUserId);
  if (!existing) {
    return c.json({ error: 'User not registered' }, 404);
  }

  try {
    const user = await syncUserReferralIdentity(db, existing, parsed.data.handle);
    const profile = await getUserProfile(db, user.id);
    return c.json({ data: formatUserResponse(profile) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed';
    return c.json({ error: message }, 400);
  }
});

userRoutes.get('/users/me', requireAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: 'User not registered. POST /users/register first.' }, 404);
  }
  const profile = await getUserProfile(db, userId);
  if (!profile) return c.json({ error: 'User not found' }, 404);
  return c.json({ data: formatUserResponse(profile) });
});

userRoutes.post('/users/me/referral', requireAuth, async (c) => {
  const parsed = referralSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: 'User not registered' }, 404);
  }

  const result = await applyReferralCode(
    db,
    userId,
    normalizeReferralCodeInput(parsed.data.referralCode)
  );
  if (!result.ok) {
    return c.json({ error: result.message ?? 'Failed to apply referral' }, 400);
  }

  const profile = await getUserProfile(db, userId);
  return c.json({ data: formatUserResponse(profile) });
});

userRoutes.get('/users/me/points', requireAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'User not registered' }, 404);
  const points = await getPointsSummary(db, userId);
  return c.json({ data: points });
});

userRoutes.get('/users/me/referrals', requireAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'User not registered' }, 404);

  const rows = await db
    .select({
      userAddress: users.suiAddress,
      handle: users.handle,
      joinedAt: users.createdAt,
      lifetimeVolumeUsd: userStats.lifetimeVolumeUsd,
    })
    .from(users)
    .leftJoin(userStats, eq(userStats.userId, users.id))
    .where(eq(users.referredByUserId, userId))
    .orderBy(sql`${users.createdAt} desc`)
    .limit(200);

  const referrals = rows.map((row, index) => ({
    id: `${row.userAddress}-${index}`,
    userAddress: row.userAddress,
    handle: row.handle,
    joinedAt:
      row.joinedAt instanceof Date
        ? row.joinedAt.toISOString()
        : row.joinedAt
          ? String(row.joinedAt)
          : null,
    lifetimeVolumeUsd: Number(row.lifetimeVolumeUsd ?? 0),
  }));

  return c.json({
    data: {
      totalReferrals: referrals.length,
      referrals,
    },
  });
});

function formatUserResponse(profile: Awaited<ReturnType<typeof getUserProfile>>) {
  if (!profile) return null;
  const { user, stats } = profile;
  const code = user.referralCode;
  return {
    userAddress: user.suiAddress,
    privyUserId: user.privyUserId,
    handle: user.handle,
    referralCode: code,
    referralUrl: code ? buildReferralUrl(env.appPublicUrl, code) : null,
    hasReferrer: Boolean(user.referredByUserId),
    stats: stats
      ? {
          lifetimeVolumeUsd: Number(stats.lifetimeVolumeUsd),
          weekVolumeUsd: Number(stats.weekVolumeUsd),
          totalPoints: stats.totalPoints,
          weekPoints: stats.weekPoints,
          winCount: stats.winCount,
          lossCount: stats.lossCount,
          currentStreakDays: stats.currentStreakDays,
        }
      : {
          lifetimeVolumeUsd: 0,
          weekVolumeUsd: 0,
          totalPoints: 0,
          weekPoints: 0,
          winCount: 0,
          lossCount: 0,
          currentStreakDays: 0,
        },
  };
}
