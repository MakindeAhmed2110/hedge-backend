UPDATE "waitlist_users" SET "handle" = lower(trim("handle")) WHERE "handle" IS NOT NULL;
