import type { Database } from '../db/index.js';
import { trades } from '../db/schema.js';
import { fetchPositionsMinted } from '../predict/client.js';
import type { PredictPositionMintedEvent } from '../predict/types.js';
import {
  creditPoints,
  rewardReferrerForVolume,
  volumePointsForUsd,
} from './points.js';
import { rawQuoteToUsd } from './quote.js';
import { normalizeSuiAddress } from './sui-address.js';
import { updateStatsForMint } from './user-stats.js';

export type RecordMintResult = {
  recorded: boolean;
  pointsCredited: number;
  stakeUsd: number;
};

export async function findMintEventByTxDigest(
  txDigest: string
): Promise<PredictPositionMintedEvent | null> {
  const normalized = txDigest.trim();
  const events = await fetchPositionsMinted(500);
  return (
    events.find((e) => e.digest === normalized || e.event_digest === normalized) ?? null
  );
}

/** Idempotent mint + volume points for a registered Hedge user. */
export async function recordMintForUser(
  db: Database,
  userId: string,
  suiAddress: string,
  event: PredictPositionMintedEvent
): Promise<RecordMintResult> {
  const wallet = normalizeSuiAddress(suiAddress);
  const trader = normalizeSuiAddress(event.trader);
  const isClientReport = event.event_digest.startsWith('client:');
  if (!isClientReport && trader !== wallet) {
    throw new Error('Mint trader does not match your registered wallet');
  }

  const stakeUsd = rawQuoteToUsd(event.cost);
  const occurredAt = new Date(event.checkpoint_timestamp_ms);

  const inserted = await db
    .insert(trades)
    .values({
      eventDigest: event.event_digest,
      txDigest: event.digest,
      userId,
      suiAddress: wallet,
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

  if (inserted.length === 0) {
    return { recorded: false, pointsCredited: 0, stakeUsd };
  }

  const points = volumePointsForUsd(stakeUsd);
  const pointsCredited = await creditPoints(db, {
    userId,
    source: 'volume',
    amount: points,
    referenceId: event.event_digest,
    occurredAt,
  });
  await rewardReferrerForVolume(db, userId, event.event_digest, stakeUsd, occurredAt);
  await updateStatsForMint(db, userId, stakeUsd, occurredAt);

  return { recorded: true, pointsCredited, stakeUsd };
}

/** Client-reported mint: resolve from predict-server or build a minimal event. */
export async function recordMintFromClientReport(
  db: Database,
  userId: string,
  suiAddress: string,
  params: {
    txDigest: string;
    stakeUsd: number;
    oracleId?: string;
    predictId?: string;
    managerId?: string;
  }
): Promise<RecordMintResult> {
  const onChain = await findMintEventByTxDigest(params.txDigest);
  if (onChain) {
    try {
      return await recordMintForUser(db, userId, suiAddress, onChain);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('does not match your registered wallet')) {
        throw error;
      }
    }
  }

  const wallet = normalizeSuiAddress(suiAddress);
  const stakeUsd = Math.max(0, params.stakeUsd);
  const occurredAt = new Date();
  const eventDigest = `client:${params.txDigest.trim()}`;

  const synthetic: PredictPositionMintedEvent = {
    event_digest: eventDigest,
    digest: params.txDigest.trim(),
    sender: wallet,
    checkpoint: 0,
    checkpoint_timestamp_ms: occurredAt.getTime(),
    predict_id: params.predictId ?? '',
    manager_id: params.managerId ?? '',
    trader: wallet,
    oracle_id: params.oracleId ?? 'unknown',
    expiry: 0,
    strike: 0,
    is_up: true,
    quantity: 0,
    cost: Math.round(stakeUsd * 1_000_000),
    ask_price: 0,
  };

  return recordMintForUser(db, userId, suiAddress, synthetic);
}
