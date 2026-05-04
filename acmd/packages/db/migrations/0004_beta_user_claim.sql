-- T-065 / fix-T-063 blockers — beta-signup deferred-claim refactor
--
-- T-063 created acmd.users / acmd.companies inside the beta-signup endpoint
-- with a random id + google_id=''. QA review (review-qa.md L324-L357) flagged
-- two blockers:
--   1. CRITICAL — google_id='' UNIQUE collision on second beta signup
--   2. HIGH     — random acmd.users.id breaks RS-013 invariant
--                 (acmd.users.id MUST equal vollos-core JWT.sub)
--                 → first Google login is blocked by email-UNIQUE 409
--
-- Fix: defer user/company creation until the invitee's first Google login.
-- beta-signup now only marks the token used + records the claimed email in
-- the redemption log. /api/v1/auth/me then matches JWT.email against the
-- log row and atomically creates acmd.users + acmd.companies + sets
-- claimed_user_id back on the log row.
--
-- Schema changes:
--   - ALTER acmd.beta_invite_redemption_log
--       + email             varchar(255)  NULL  — invitee's claimed email
--       + claimed_user_id   uuid          NULL  — FK acmd.users.id (set on claim)
--       + claimed_at        timestamptz   NULL  — when /me claimed this redemption
--       + index on email                         — supports the /me lookup
--
-- No DROPs / no destructive changes. Forwards-only refactor of the audit log.

ALTER TABLE "acmd"."beta_invite_redemption_log"
  ADD COLUMN IF NOT EXISTS "email" varchar(255);
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  ADD COLUMN IF NOT EXISTS "claimed_user_id" uuid;
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  DROP CONSTRAINT IF EXISTS "beta_redemption_log_claimed_user_id_fk";
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  ADD CONSTRAINT "beta_redemption_log_claimed_user_id_fk"
  FOREIGN KEY ("claimed_user_id") REFERENCES "acmd"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "acmd_beta_redemption_log_email_idx"
  ON "acmd"."beta_invite_redemption_log" ("email");

-- ─────────────────────────────────────────────────────────────────────────
-- DOWN — destructive, run only when reverting in dev / staging.
-- ─────────────────────────────────────────────────────────────────────────
-- DOWN below; the migration runner only takes the SQL above this marker.
