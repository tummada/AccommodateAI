-- T-065 — DOWN: revert deferred-claim columns on beta_invite_redemption_log.
-- Use only when reverting 0004 in dev / staging.

DROP INDEX IF EXISTS "acmd"."acmd_beta_redemption_log_email_idx";
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  DROP CONSTRAINT IF EXISTS "beta_redemption_log_claimed_user_id_fk";
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  DROP COLUMN IF EXISTS "claimed_at";
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  DROP COLUMN IF EXISTS "claimed_user_id";
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  DROP COLUMN IF EXISTS "email";
