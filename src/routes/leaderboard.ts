import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../db/index.js';
import { userStats, users } from '../db/schema.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { env } from '../env.js';

const LEADERBOARD_CACHE_NS = 'leaderboard';

export const leaderboardRoutes = new Hono();

leaderboardRoutes.get('/leaderboard', async (c) => {
  const metric = c.req.query('metric') === 'volume' ? 'volume' : 'points';
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 200);
  const cacheKey = `${metric}:${limit}`;
  const cached = cacheGet<{ items: unknown[]; metric: string }>(
    LEADERBOARD_CACHE_NS,
    cacheKey
  );
  if (cached) {
    c.header('Cache-Control', 'public, max-age=15');
    return c.json({ data: cached, meta: 'ok' });
  }

  const rows = await db
    .select({
      userAddress: users.suiAddress,
      handle: users.handle,
      referralCode: users.referralCode,
      totalPoints: userStats.totalPoints,
      weekPoints: userStats.weekPoints,
      lifetimeVolumeUsd: userStats.lifetimeVolumeUsd,
      weekVolumeUsd: userStats.weekVolumeUsd,
      winCount: userStats.winCount,
      lossCount: userStats.lossCount,
      currentStreakDays: userStats.currentStreakDays,
    })
    .from(userStats)
    .innerJoin(users, eq(users.id, userStats.userId))
    .orderBy(
      metric === 'volume' ? desc(userStats.weekVolumeUsd) : desc(userStats.totalPoints)
    )
    .limit(limit);

  const items = rows.map((row, index) => ({
    rank: index + 1,
    userAddress: row.userAddress,
    handle: row.handle,
    referralCode: row.referralCode,
    experience: {
      totalXp: row.totalPoints,
      weekXp: row.weekPoints,
      level: Math.max(1, Math.floor(row.totalPoints / 500) + 1),
      rankName: rankLabel(index + 1),
      totalFeesPaidInUsd: 0,
    },
    stats: {
      lifetimeVolumeUsd: Number(row.lifetimeVolumeUsd),
      weekVolumeUsd: Number(row.weekVolumeUsd),
      winCount: row.winCount,
      lossCount: row.lossCount,
      currentStreakDays: row.currentStreakDays,
    },
  }));

  const payload = { items, metric };
  cacheSet(LEADERBOARD_CACHE_NS, cacheKey, payload, env.cacheLeaderboardTtlMs);
  c.header('Cache-Control', 'public, max-age=15');
  return c.json({ data: payload, meta: 'ok' });
});

function rankLabel(rank: number): string {
  if (rank === 1) return 'Champion';
  if (rank <= 3) return 'Elite';
  if (rank <= 10) return 'Pro';
  return 'Predictor';
}
