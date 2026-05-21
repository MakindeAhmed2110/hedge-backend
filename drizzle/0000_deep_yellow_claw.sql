CREATE TYPE "public"."points_source" AS ENUM('volume', 'referral_signup', 'referral_volume', 'streak', 'bonus');--> statement-breakpoint
CREATE TYPE "public"."trade_type" AS ENUM('mint', 'redeem');--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_checkpoint_ms" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "points_source" NOT NULL,
	"amount" integer NOT NULL,
	"reference_id" text,
	"week_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_digest" text NOT NULL,
	"tx_digest" text NOT NULL,
	"user_id" uuid,
	"sui_address" text NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"oracle_id" text NOT NULL,
	"predict_id" text NOT NULL,
	"manager_id" text,
	"stake_usd" numeric(20, 6) NOT NULL,
	"quantity" bigint NOT NULL,
	"is_up" boolean NOT NULL,
	"strike" bigint NOT NULL,
	"payout_usd" numeric(20, 6),
	"checkpoint" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"lifetime_volume_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"week_volume_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"week_points" integer DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"loss_count" integer DEFAULT 0 NOT NULL,
	"current_streak_days" integer DEFAULT 0 NOT NULL,
	"last_active_date" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_user_id" text NOT NULL,
	"sui_address" text NOT NULL,
	"handle" text,
	"referral_code" text NOT NULL,
	"referred_by_user_id" uuid,
	"referral_locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_user_id_idx" ON "points_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "points_ledger_week_start_idx" ON "points_ledger" USING btree ("week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_dedupe_uidx" ON "points_ledger" USING btree ("user_id","source","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_event_digest_uidx" ON "trades" USING btree ("event_digest");--> statement-breakpoint
CREATE INDEX "trades_user_id_idx" ON "trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_sui_address_idx" ON "trades" USING btree ("sui_address");--> statement-breakpoint
CREATE INDEX "trades_occurred_at_idx" ON "trades" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_privy_user_id_uidx" ON "users" USING btree ("privy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_sui_address_uidx" ON "users" USING btree ("sui_address");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uidx" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_uidx" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_user_id");