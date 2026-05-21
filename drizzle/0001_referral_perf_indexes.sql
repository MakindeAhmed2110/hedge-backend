CREATE INDEX IF NOT EXISTS "user_stats_total_points_idx" ON "user_stats" USING btree ("total_points");
CREATE INDEX IF NOT EXISTS "user_stats_week_volume_idx" ON "user_stats" USING btree ("week_volume_usd");

-- Lowercase legacy rows so ?ref=mankind matches
UPDATE "users" SET "handle" = lower(trim("handle")), "referral_code" = lower(trim("referral_code")) WHERE "handle" IS NOT NULL;
UPDATE "users" SET "referral_code" = "handle" WHERE "handle" IS NOT NULL AND ("referral_code" IS NULL OR "referral_code" <> "handle");
