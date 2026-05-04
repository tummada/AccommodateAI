-- T-063 / M3-001 §3.5: Beta gate — DOWN migration
-- Drops the 4 tables introduced in 0003_beta_gate.sql plus the enum.

DROP TABLE IF EXISTS "acmd"."beta_invite_redemption_log";
--> statement-breakpoint
DROP TABLE IF EXISTS "acmd"."beta_waitlist";
--> statement-breakpoint
DROP TABLE IF EXISTS "acmd"."beta_invite_token";
--> statement-breakpoint
DROP TABLE IF EXISTS "acmd"."app_config";
--> statement-breakpoint
DROP TYPE IF EXISTS "acmd"."acmd_beta_redemption_result";
