import { and, eq, sql } from 'drizzle-orm';

import { env } from '../env.js';
import type { Database } from '../db/index.js';
import { pointsLedger, userStats, users } from '../db/schema.js';
import { cacheClearNamespace } from './cache.js';
import { weekStartUtc } from './week.js';

export async function creditPoints(
  db: Database,
  params: {
    userId: string;
    source: 'volume' | 'referral_signup' | 'referral_volume' | 'streak' | 'bonus';
    amount: number;
    referenceId?: string;
    occurredAt?: Date;
  }
): Promise<number> {
  if (params.amount <= 0) return 0;

  const weekStart = weekStartUtc(params.occurredAt ?? new Date());

  const inserted = await db
    .insert(pointsLedger)
    .values({
      userId: params.userId,
      source: params.source,
      amount: Math.floor(params.amount),
      referenceId: params.referenceId ?? null,
      weekStart,
    })
    .onConflictDoNothing()
    .returning({ amount: pointsLedger.amount });

  if (inserted.length === 0) return 0;

  const amount = inserted[0].amount;
  const weekStartIso = weekStart.toISOString();
  const currentWeekStart = weekStartUtc(new Date()).toISOString();

  await db
    .insert(userStats)
    .values({
      userId: params.userId,
      totalPoints: amount,
      weekPoints: weekStartIso === currentWeekStart ? amount : 0,
    })
    .onConflictDoUpdate({
      target: userStats.userId,
      set: {
        totalPoints: sql`${userStats.totalPoints} + ${amount}`,
        weekPoints:
          weekStartIso === currentWeekStart
            ? sql`${userStats.weekPoints} + ${amount}`
            : userStats.weekPoints,
        updatedAt: new Date(),
      },
    });

  cacheClearNamespace('leaderboard');
  return amount;
}

export function volumePointsForUsd(stakeUsd: number): number {
  return Math.floor(stakeUsd * env.pointsPerUsd);
}

export async function rewardReferrerForVolume(
  db: Database,
  referredUserId: string,
  tradeEventDigest: string,
  stakeUsd: number,
  occurredAt: Date
): Promise<void> {
  const [referred] = await db
    .select({ referredByUserId: users.referredByUserId })
    .from(users)
    .where(eq(users.id, referredUserId))
    .limit(1);

  if (!referred?.referredByUserId) return;

  const share = Math.floor((stakeUsd * env.referralVolumeShareBps) / 10_000);
  if (share <= 0) return;

  await creditPoints(db, {
    userId: referred.referredByUserId,
    source: 'referral_volume',
    amount: share,
    referenceId: `vol:${tradeEventDigest}`,
    occurredAt,
  });
}

export async function getPointsSummary(db: Database, userId: string) {
  const [stats] = await db
    .select({
      totalPoints: userStats.totalPoints,
      weekPoints: userStats.weekPoints,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);

  const weekStart = weekStartUtc(new Date());
  const weeklyRows = await db
    .select({
      date: sql<string>`to_char(${pointsLedger.createdAt}, 'YYYY-MM-DD')`.as('date'),
      points: sql<number>`sum(${pointsLedger.amount})::int`.as('points'),
    })
    .from(pointsLedger)
    .where(
      and(eq(pointsLedger.userId, userId), sql`${pointsLedger.weekStart} = ${weekStart}`)
    )
    .groupBy(sql`to_char(${pointsLedger.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`date`);

  return {
    totalPoints: stats?.totalPoints ?? 0,
    weeklyPoints: stats?.weekPoints ?? 0,
    weeklySummary: weeklyRows.map((row) => ({
      date: row.date,
      points: Number(row.points),
    })),
  };
}
