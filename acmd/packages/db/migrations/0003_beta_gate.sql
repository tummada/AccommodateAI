-- T-063 / M3-001 §3.5: Beta gate (mentor3 confirmed C1+C2 2026-04-28)
--
-- Adds 4 tables that gate the Day-5 Beta launch:
--   1. acmd.app_config                    — runtime key/value (Rolling Cap D14)
--   2. acmd.beta_invite_token             — invite tokens issued by mentor3
--   3. acmd.beta_waitlist                 — emails captured when cap is full
--   4. acmd.beta_invite_redemption_log    — audit log for every signup attempt
--
-- C2 audit additions (mentor3 2026-04-28):
--   - http_status (int)        — exact HTTP code returned per attempt
--   - waitlist_id (uuid FK)    — links capacity_full attempts to waitlist row
--
-- Cross-schema FK note (CLAUDE.md C5):
--   `used_by` references acmd.users.id (NOT auth.users.id) — RS-013 invariant
--   guarantees the value space is identical (acmd.users.id === JWT.sub) and
--   the acmd_user role only has privileges on the acmd schema.
--
-- Seed: app_config row { key='beta_cap_current', value='20' } so the endpoint
-- can read the cap without a code change Day 1.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE "acmd"."acmd_beta_redemption_result" AS ENUM(
  'success',
  'invalid',
  'expired',
  'used',
  'capacity_full',
  'rate_limited'
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- app_config
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "acmd"."app_config" (
  "key" varchar(100) PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

INSERT INTO "acmd"."app_config" ("key", "value")
VALUES ('beta_cap_current', '20')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- beta_invite_token
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "acmd"."beta_invite_token" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" varchar(128) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_by" uuid,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "beta_invite_token_token_unique" UNIQUE ("token")
);
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_token"
  ADD CONSTRAINT "beta_invite_token_used_by_users_id_fk"
  FOREIGN KEY ("used_by") REFERENCES "acmd"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "acmd_beta_invite_token_used_at_idx"
  ON "acmd"."beta_invite_token" ("used_at");
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- beta_waitlist
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "acmd"."beta_waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  "source" varchar(50) DEFAULT 'beta_full' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- beta_invite_redemption_log (C2 audit)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "acmd"."beta_invite_redemption_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_attempted" varchar(256) NOT NULL,
  "ip" varchar(45) NOT NULL,
  "user_agent" text,
  "result" "acmd"."acmd_beta_redemption_result" NOT NULL,
  "http_status" integer NOT NULL,
  "waitlist_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "acmd"."beta_invite_redemption_log"
  ADD CONSTRAINT "beta_redemption_log_waitlist_id_fk"
  FOREIGN KEY ("waitlist_id") REFERENCES "acmd"."beta_waitlist"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "acmd_beta_redemption_log_created_at_idx"
  ON "acmd"."beta_invite_redemption_log" ("created_at");
--> statement-breakpoint

CREATE INDEX "acmd_beta_redemption_log_result_idx"
  ON "acmd"."beta_invite_redemption_log" ("result");

-- ─────────────────────────────────────────────────────────────────────────
-- DOWN — destructive, run only when reverting in dev / staging.
-- ─────────────────────────────────────────────────────────────────────────
-- DOWN below; the migration runner only takes the SQL above this marker.
