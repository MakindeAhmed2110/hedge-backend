import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { userStats } from '../db/schema.js';
import { utcDayKey, weekStartUtc } from './week.js';

export async function updateStatsForMint(
  db: Database,
  userId: string | null,
  stakeUsd: number,
  occurredAt: Date
): Promise<void> {
  if (!userId || stakeUsd <= 0) return;

  const weekStart = weekStartUtc(new Date());
  const tradeWeekStart = weekStartUtc(occurredAt);
  const isCurrentWeek = weekStart.getTime() === tradeWeekStart.getTime();

  const dayKey = utcDayKey(occurredAt);
  const [stats] = await db
    .select({
      lastActiveDate: userStats.lastActiveDate,
      currentStreakDays: userStats.currentStreakDays,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);

  let streak = stats?.currentStreakDays ?? 0;
  const last = stats?.lastActiveDate;
  if (!last) {
    streak = 1;
  } else {
    const lastKey = utcDayKey(last);
    if (lastKey === dayKey) {
      streak = stats?.currentStreakDays ?? 1;
    } else {
      const yesterday = new Date(occurredAt);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      streak = utcDayKey(yesterday) === lastKey ? (stats?.currentStreakDays ?? 0) + 1 : 1;
    }
  }

  await db
    .insert(userStats)
    .values({
      userId,
      lifetimeVolumeUsd: String(stakeUsd),
      weekVolumeUsd: isCurrentWeek ? String(stakeUsd) : '0',
      lastActiveDate: occurredAt,
      currentStreakDays: streak,
    })
    .onConflictDoUpdate({
      target: userStats.userId,
      set: {
        lifetimeVolumeUsd: sql`${userStats.lifetimeVolumeUsd} + ${stakeUsd}`,
        weekVolumeUsd: isCurrentWeek
          ? sql`${userStats.weekVolumeUsd} + ${stakeUsd}`
          : userStats.weekVolumeUsd,
        lastActiveDate: occurredAt,
        currentStreakDays: streak,
        updatedAt: new Date(),
      },
    });
}
