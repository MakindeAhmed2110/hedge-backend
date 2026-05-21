import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { indexerState, trades, userStats, users } from '../db/schema.js';
import { rawQuoteToUsd } from '../lib/quote.js';
import {
  creditPoints,
  rewardReferrerForVolume,
  volumePointsForUsd,
} from '../lib/points.js';
import { utcDayKey, weekStartUtc } from '../lib/week.js';
import { fetchPositionsMinted, fetchPositionsRedeemed } from './client.js';
import type {
  PredictPositionMintedEvent,
  PredictPositionRedeemedEvent,
} from './types.js';

const MINTED_CURSOR = 'minted_checkpoint_ms';
const REDEEMED_CURSOR = 'redeemed_checkpoint_ms';

async function getCursor(db: Database, key: string): Promise<number> {
  const [row] = await db
    .select({ lastCheckpointMs: indexerState.lastCheckpointMs })
    .from(indexerState)
    .where(eq(indexerState.key, key))
    .limit(1);
  return row?.lastCheckpointMs ?? 0;
}

async function setCursor(db: Database, key: string, checkpointMs: number): Promise<void> {
  await db
    .insert(indexerState)
    .values({ key, lastCheckpointMs: checkpointMs })
    .onConflictDoUpdate({
      target: indexerState.key,
      set: { lastCheckpointMs: checkpointMs, updatedAt: new Date() },
    });
}

async function findUserIdBySuiAddress(
  db: Database,
  address: string
): Promise<string | null> {
  const normalized = address.trim().toLowerCase();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.suiAddress, normalized))
    .limit(1);
  return row?.id ?? null;
}

async function updateStatsForMint(
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

async function ingestMint(db: Database, event: PredictPositionMintedEvent): Promise<boolean> {
  const stakeUsd = rawQuoteToUsd(event.cost);
  const occurredAt = new Date(event.checkpoint_timestamp_ms);
  const suiAddress = event.trader.trim().toLowerCase();
  const userId = await findUserIdBySuiAddress(db, suiAddress);

  const inserted = await db
    .insert(trades)
    .values({
      eventDigest: event.event_digest,
      txDigest: event.digest,
      userId,
      suiAddress,
      tradeType: 'mint',
      oracleId: event.oracle_id,
      predictId: event.predict_id,
      managerId: event.manager_id,
      stakeUsd: String(stakeUsd),
      quantity: event.quantity,
      isUp: event.is_up,
      strike: event.strike,
      payoutUsd: null,
      checkpoint: event.checkpoint,
      occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: trades.id });

  if (inserted.length === 0) return false;

  if (userId) {
    const points = volumePointsForUsd(stakeUsd);
    await creditPoints(db, {
      userId,
      source: 'volume',
      amount: points,
      referenceId: event.event_digest,
      occurredAt,
    });
    await rewardReferrerForVolume(db, userId, event.event_digest, stakeUsd, occurredAt);
    await updateStatsForMint(db, userId, stakeUsd, occurredAt);
  }

  return true;
}

async function ingestRedeem(db: Database, event: PredictPositionRedeemedEvent): Promise<boolean> {
  const payoutUsd = rawQuoteToUsd(event.payout);
  const occurredAt = new Date(event.checkpoint_timestamp_ms);
  const suiAddress = event.owner.trim().toLowerCase();
  const userId = await findUserIdBySuiAddress(db, suiAddress);

  const inserted = await db
    .insert(trades)
    .values({
      eventDigest: event.event_digest,
      txDigest: event.digest,
      userId,
      suiAddress,
      tradeType: 'redeem',
      oracleId: event.oracle_id,
      predictId: event.predict_id,
      managerId: event.manager_id,
      stakeUsd: '0',
      quantity: event.quantity,
      isUp: event.is_up,
      strike: event.strike,
      payoutUsd: String(payoutUsd),
      checkpoint: event.checkpoint,
      occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: trades.id });

  if (inserted.length === 0) return false;

  if (userId && event.is_settled) {
    const mintStake = await db
      .select({ stakeUsd: trades.stakeUsd })
      .from(trades)
      .where(
        sql`${trades.userId} = ${userId} AND ${trades.oracleId} = ${event.oracle_id} AND ${trades.tradeType} = 'mint'`
      )
      .limit(1);

    const cost = Number(mintStake[0]?.stakeUsd ?? 0);
    if (payoutUsd > cost) {
      await db
        .update(userStats)
        .set({ winCount: sql`${userStats.winCount} + 1`, updatedAt: new Date() })
        .where(eq(userStats.userId, userId));
    } else if (cost > 0) {
      await db
        .update(userStats)
        .set({ lossCount: sql`${userStats.lossCount} + 1`, updatedAt: new Date() })
        .where(eq(userStats.userId, userId));
    }
  }

  return true;
}

export type IndexerRunResult = {
  mintedIngested: number;
  redeemedIngested: number;
  mintedCursor: number;
  redeemedCursor: number;
};

export async function runPredictIndexer(db: Database): Promise<IndexerRunResult> {
  const mintedCursor = await getCursor(db, MINTED_CURSOR);
  const redeemedCursor = await getCursor(db, REDEEMED_CURSOR);

  const [mintedEvents, redeemedEvents] = await Promise.all([
    fetchPositionsMinted(),
    fetchPositionsRedeemed(),
  ]);

  const newMints = mintedEvents
    .filter((e) => e.checkpoint_timestamp_ms > mintedCursor)
    .sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);

  const newRedeems = redeemedEvents
    .filter((e) => e.checkpoint_timestamp_ms > redeemedCursor)
    .sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);

  let mintedIngested = 0;
  let maxMintMs = mintedCursor;
  for (const event of newMints) {
    const ingested = await ingestMint(db, event);
    if (ingested) mintedIngested += 1;
    maxMintMs = Math.max(maxMintMs, event.checkpoint_timestamp_ms);
  }

  let redeemedIngested = 0;
  let maxRedeemMs = redeemedCursor;
  for (const event of newRedeems) {
    const ingested = await ingestRedeem(db, event);
    if (ingested) redeemedIngested += 1;
    maxRedeemMs = Math.max(maxRedeemMs, event.checkpoint_timestamp_ms);
  }

  if (maxMintMs > mintedCursor) await setCursor(db, MINTED_CURSOR, maxMintMs);
  if (maxRedeemMs > redeemedCursor) await setCursor(db, REDEEMED_CURSOR, maxRedeemMs);

  return {
    mintedIngested,
    redeemedIngested,
    mintedCursor: maxMintMs,
    redeemedCursor: maxRedeemMs,
  };
}
