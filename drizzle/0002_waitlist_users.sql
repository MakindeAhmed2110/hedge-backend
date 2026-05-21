CREATE TABLE IF NOT EXISTS "waitlist_users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"email" text NOT NULL,
	"wallet_address" text,
	"handle" text NOT NULL,
	"rank" integer NOT NULL,
	"referred_by_handle" text,
	"referred_count" integer DEFAULT 0 NOT NULL,
	"shared_on_x" boolean DEFAULT false NOT NULL,
	"downloaded_app" boolean DEFAULT false NOT NULL,
	"points_base" integer DEFAULT 0 NOT NULL,
	"points_referral_given" integer DEFAULT 0 NOT NULL,
	"points_referral_used" integer DEFAULT 0 NOT NULL,
	"points_shared_on_x" integer DEFAULT 0 NOT NULL,
	"points_downloaded_app" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_users_email_uidx" ON "waitlist_users" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_users_handle_uidx" ON "waitlist_users" USING btree ("handle");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_users_referred_by_idx" ON "waitlist_users" USING btree ("referred_by_handle");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_users_rank_idx" ON "waitlist_users" USING btree ("rank");
