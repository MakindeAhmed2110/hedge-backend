import { and, eq } from 'drizzle-orm';

import { closeDb, db } from '../src/db/index.js';
import { trades, userStats, users } from '../src/db/schema.js';
import {
  creditPoints,
  rewardReferrerForVolume,
  volumePointsForUsd,
} from '../src/lib/points.js';
import { env } from '../src/env.js';

async function main() {
  const handle = process.argv[2] ?? 'mankind';
  const [user] = await db.select().from(users).where(eq(users.handle, handle)).limit(1);
  if (!user) {
    console.error(`User not found: ${handle}`);
    process.exit(1);
  }

  const mints = await db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, user.id), eq(trades.tradeType, 'mint')));

  let newlyCredited = 0;
  for (const mint of mints) {
    const stakeUsd = Number(mint.stakeUsd);
    const amount = volumePointsForUsd(stakeUsd);
    const credited = await creditPoints(db, {
      userId: user.id,
      source: 'volume',
      amount,
      referenceId: mint.eventDigest,
      occurredAt: mint.occurredAt,
    });
    if (credited > 0) {
      newlyCredited += credited;
      await rewardReferrerForVolume(
        db,
        user.id,
        mint.eventDigest,
        stakeUsd,
        mint.occurredAt
      );
    }
  }

  const [stats] = await db
    .select({ totalPoints: userStats.totalPoints, weekPoints: userStats.weekPoints })
    .from(userStats)
    .where(eq(userStats.userId, user.id))
    .limit(1);

  console.log(
    JSON.stringify(
      {
        handle,
        pointsPerUsd: env.pointsPerUsd,
        mints: mints.length,
        newlyCredited,
        totalPoints: stats?.totalPoints ?? 0,
        weekPoints: stats?.weekPoints ?? 0,
      },
      null,
      2
    )
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
