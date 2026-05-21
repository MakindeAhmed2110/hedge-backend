import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tradeTypeEnum = pgEnum('trade_type', ['mint', 'redeem']);

export const pointsSourceEnum = pgEnum('points_source', [
  'volume',
  'referral_signup',
  'referral_volume',
  'streak',
  'bonus',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    privyUserId: text('privy_user_id').notNull(),
    suiAddress: text('sui_address').notNull(),
    handle: text('handle'),
    referralCode: text('referral_code').notNull(),
    referredByUserId: uuid('referred_by_user_id'),
    referralLockedAt: timestamp('referral_locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_privy_user_id_uidx').on(table.privyUserId),
    uniqueIndex('users_sui_address_uidx').on(table.suiAddress),
    uniqueIndex('users_referral_code_uidx').on(table.referralCode),
    uniqueIndex('users_handle_uidx').on(table.handle),
    index('users_referred_by_idx').on(table.referredByUserId),
  ]
);

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventDigest: text('event_digest').notNull(),
    txDigest: text('tx_digest').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    suiAddress: text('sui_address').notNull(),
    tradeType: tradeTypeEnum('trade_type').notNull(),
    oracleId: text('oracle_id').notNull(),
    predictId: text('predict_id').notNull(),
    managerId: text('manager_id'),
    stakeUsd: numeric('stake_usd', { precision: 20, scale: 6 }).notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    isUp: boolean('is_up').notNull(),
    strike: bigint('strike', { mode: 'number' }).notNull(),
    payoutUsd: numeric('payout_usd', { precision: 20, scale: 6 }),
    checkpoint: integer('checkpoint').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trades_event_digest_uidx').on(table.eventDigest),
    index('trades_user_id_idx').on(table.userId),
    index('trades_sui_address_idx').on(table.suiAddress),
    index('trades_occurred_at_idx').on(table.occurredAt),
  ]
);

export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: pointsSourceEnum('source').notNull(),
    amount: integer('amount').notNull(),
    referenceId: text('reference_id'),
    weekStart: timestamp('week_start', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('points_ledger_user_id_idx').on(table.userId),
    index('points_ledger_week_start_idx').on(table.weekStart),
    uniqueIndex('points_ledger_dedupe_uidx').on(table.userId, table.source, table.referenceId),
  ]
);

export const userStats = pgTable(
  'user_stats',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    lifetimeVolumeUsd: numeric('lifetime_volume_usd', { precision: 20, scale: 6 })
      .notNull()
      .default('0'),
    weekVolumeUsd: numeric('week_volume_usd', { precision: 20, scale: 6 }).notNull().default('0'),
    totalPoints: integer('total_points').notNull().default(0),
    weekPoints: integer('week_points').notNull().default(0),
    winCount: integer('win_count').notNull().default(0),
    lossCount: integer('loss_count').notNull().default(0),
    currentStreakDays: integer('current_streak_days').notNull().default(0),
    lastActiveDate: timestamp('last_active_date', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_stats_total_points_idx').on(table.totalPoints),
    index('user_stats_week_volume_idx').on(table.weekVolumeUsd),
  ]
);

export const indexerState = pgTable('indexer_state', {
  key: text('key').primaryKey(),
  lastCheckpointMs: bigint('last_checkpoint_ms', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Pre-launch email + handle waitlist (separate from Privy `users`). */
export const waitlistUsers = pgTable(
  'waitlist_users',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    email: text('email').notNull(),
    walletAddress: text('wallet_address'),
    handle: text('handle').notNull(),
    rank: integer('rank').notNull(),
    referredByHandle: text('referred_by_handle'),
    referredCount: integer('referred_count').notNull().default(0),
    sharedOnX: boolean('shared_on_x').notNull().default(false),
    downloadedApp: boolean('downloaded_app').notNull().default(false),
    pointsBase: integer('points_base').notNull().default(0),
    pointsReferralGiven: integer('points_referral_given').notNull().default(0),
    pointsReferralUsed: integer('points_referral_used').notNull().default(0),
    pointsSharedOnX: integer('points_shared_on_x').notNull().default(0),
    pointsDownloadedApp: integer('points_downloaded_app').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('waitlist_users_email_uidx').on(table.email),
    uniqueIndex('waitlist_users_handle_uidx').on(table.handle),
    index('waitlist_users_referred_by_idx').on(table.referredByHandle),
    index('waitlist_users_rank_idx').on(table.rank),
  ]
);
