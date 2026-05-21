import { eq, isNull } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { trades, users } from '../db/schema.js';
import { normalizeSuiAddress } from './sui-address.js';
import {
  creditPoints,
  rewardReferrerForVolume,
  volumePointsForUsd,
} from './points.js';
import { updateStatsForMint } from './user-stats.js';

export type TradeReconcileResult = {
  linkedTrades: number;
  volumePointsCredited: number;
};

/** Registered Hedge wallets: normalized `sui_address` → `user_id`. */
export async function loadRegisteredWalletMap(db: Database): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, suiAddress: users.suiAddress }).from(users);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(normalizeSuiAddress(row.suiAddress), row.id);
  }
  return map;
}

/** Remove rows ingested before we filtered to app users only (saves Supabase space). */
export async function pruneUnregisteredTrades(db: Database): Promise<number> {
  const deleted = await db
    .delete(trades)
    .where(isNull(trades.userId))
    .returning({ id: trades.id });
  return deleted.length;
}

/** Link `trades` rows to registered users by `sui_address` and credit missed volume points. */
export async function reconcileUnlinkedTrades(db: Database): Promise<TradeReconcileResult> {
  const rows = await db
    .select({
      tradeId: trades.id,
      eventDigest: trades.eventDigest,
      tradeType: trades.tradeType,
      stakeUsd: trades.stakeUsd,
      occurredAt: trades.occurredAt,
      userId: users.id,
    })
    .from(trades)
    .innerJoin(users, eq(trades.suiAddress, users.suiAddress))
    .where(isNull(trades.userId));

  let linkedTrades = 0;
  let volumePointsCredited = 0;

  for (const row of rows) {
    await db.update(trades).set({ userId: row.userId }).where(eq(trades.id, row.tradeId));
    linkedTrades += 1;

    if (row.tradeType !== 'mint') continue;

    const stakeUsd = Number(row.stakeUsd);
    if (stakeUsd <= 0) continue;

    const points = volumePointsForUsd(stakeUsd);
    const credited = await creditPoints(db, {
      userId: row.userId,
      source: 'volume',
      amount: points,
      referenceId: row.eventDigest,
      occurredAt: row.occurredAt,
    });
    if (credited > 0) {
      volumePointsCredited += credited;
      await rewardReferrerForVolume(
        db,
        row.userId,
        row.eventDigest,
        stakeUsd,
        row.occurredAt
      );
      await updateStatsForMint(db, row.userId, stakeUsd, row.occurredAt);
    }
  }

  return { linkedTrades, volumePointsCredited };
}
