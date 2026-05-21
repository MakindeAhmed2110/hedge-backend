import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { indexerState, trades, userStats } from '../db/schema.js';
import { recordMintForUser } from '../lib/record-mint.js';
import { normalizeSuiAddress } from '../lib/sui-address.js';
import { rawQuoteToUsd } from '../lib/quote.js';
import {
  loadRegisteredWalletMap,
  pruneUnregisteredTrades,
  reconcileUnlinkedTrades,
} from '../lib/trade-reconcile.js';
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

async function ingestMint(
  db: Database,
  event: PredictPositionMintedEvent,
  registered: Map<string, string>
): Promise<boolean> {
  const suiAddress = normalizeSuiAddress(event.trader);
  const userId = registered.get(suiAddress);
  if (!userId) return false;

  const result = await recordMintForUser(db, userId, suiAddress, event);
  return result.recorded;
}

async function ingestRedeem(
  db: Database,
  event: PredictPositionRedeemedEvent,
  registered: Map<string, string>
): Promise<boolean> {
  const suiAddress = normalizeSuiAddress(event.owner);
  const userId = registered.get(suiAddress);
  if (!userId) return false;

  const payoutUsd = rawQuoteToUsd(event.payout);
  const occurredAt = new Date(event.checkpoint_timestamp_ms);

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

  if (event.is_settled) {
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
  registeredWallets: number;
  prunedUnregisteredTrades: number;
  /** Mints for Hedge users found in latest feed (ignores global cursor). */
  mintsScannedFromFeed: number;
  mintedIngested: number;
  redeemedIngested: number;
  mintedCursor: number;
  redeemedCursor: number;
  linkedTrades: number;
  volumePointsCredited: number;
};

/**
 * Polls Predict for new mints/redeems but only persists rows for registered Hedge users.
 * Cursor still advances over the global feed so we do not re-scan old chain events.
 */
export async function runPredictIndexer(db: Database): Promise<IndexerRunResult> {
  const prunedUnregisteredTrades = await pruneUnregisteredTrades(db);
  const registered = await loadRegisteredWalletMap(db);

  const mintedCursor = await getCursor(db, MINTED_CURSOR);
  const redeemedCursor = await getCursor(db, REDEEMED_CURSOR);

  if (registered.size === 0) {
    return {
      registeredWallets: 0,
      prunedUnregisteredTrades,
      mintsScannedFromFeed: 0,
      mintedIngested: 0,
      redeemedIngested: 0,
      mintedCursor,
      redeemedCursor,
      linkedTrades: 0,
      volumePointsCredited: 0,
    };
  }

  const [mintedEvents, redeemedEvents] = await Promise.all([
    fetchPositionsMinted(),
    fetchPositionsRedeemed(),
  ]);

  let mintsScannedFromFeed = 0;
  for (const event of mintedEvents) {
    const suiAddress = normalizeSuiAddress(event.trader);
    if (!registered.has(suiAddress)) continue;
    const ingested = await ingestMint(db, event, registered);
    if (ingested) mintsScannedFromFeed += 1;
  }

  const newMints = mintedEvents
    .filter((e) => e.checkpoint_timestamp_ms > mintedCursor)
    .sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);

  const newRedeems = redeemedEvents
    .filter((e) => e.checkpoint_timestamp_ms > redeemedCursor)
    .sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);

  let mintedIngested = 0;
  let maxMintMs = mintedCursor;
  for (const event of newMints) {
    const ingested = await ingestMint(db, event, registered);
    if (ingested) mintedIngested += 1;
    maxMintMs = Math.max(maxMintMs, event.checkpoint_timestamp_ms);
  }

  let redeemedIngested = 0;
  let maxRedeemMs = redeemedCursor;
  for (const event of newRedeems) {
    const ingested = await ingestRedeem(db, event, registered);
    if (ingested) redeemedIngested += 1;
    maxRedeemMs = Math.max(maxRedeemMs, event.checkpoint_timestamp_ms);
  }

  if (maxMintMs > mintedCursor) await setCursor(db, MINTED_CURSOR, maxMintMs);
  if (maxRedeemMs > redeemedCursor) await setCursor(db, REDEEMED_CURSOR, maxRedeemMs);

  const reconcile = await reconcileUnlinkedTrades(db);

  return {
    registeredWallets: registered.size,
    prunedUnregisteredTrades,
    mintsScannedFromFeed,
    mintedIngested,
    redeemedIngested,
    mintedCursor: maxMintMs,
    redeemedCursor: maxRedeemMs,
    linkedTrades: reconcile.linkedTrades,
    volumePointsCredited: reconcile.volumePointsCredited,
  };
}
