-- RS-013-api-fix / SEC-004: wipe stale validate-mode data + add UNIQUE(email) on acmd_users
--
-- Owner-approved (Track A): ACMD is still in validate mode and has no paying
-- customers. The acmd.users table pre-dates the UNIQUE(email) constraint so
-- legacy rows can carry duplicates. Rather than deduplicate row-by-row, the
-- owner approved a full wipe of all acmd tenant data + re-onboarding path.
--
-- FK chain analysis (deepest → shallowest, derived from packages/db/src/schema/*.ts):
--
--   Leaf / grandchild tables
--     suggestions          → cases (cascade),     companies (restrict)
--     documents            → cases (cascade),     users (set null)
--     notifications        → cases (set null),    companies (restrict), users (cascade)
--     letters              → cases (cascade),     users (set null)
--     checklist_items      → cases (cascade),     users (set null)
--     discussions          → cases (cascade),     companies (cascade), users (set null)
--     case_decisions       → cases (restrict),    companies (restrict), users (restrict/set null)
--     audit_logs           → cases (set null),    companies (restrict), users (set null)
--     refresh_tokens       → users (cascade),     companies (cascade)
--
--   Mid tables
--     cases                → companies (restrict), employees (restrict), users (set null)
--     employees            → companies (restrict)
--
--   Root tables
--     users                → companies (restrict)
--     companies            → (no inbound FK — default_hr_contact_id is NOT a DB-level FK)
--
-- Because several restrict FKs block DELETE on parents (e.g. audit_logs.company_id
-- restrict blocks companies delete, case_decisions.case_id restrict blocks cases
-- delete), the order below matches the dependency graph exactly.
--
-- DELETE (not TRUNCATE) is used on purpose:
--   - triggers run (acmd has an INSERT-only trigger on audit_logs — DELETE is allowed
--     but TRUNCATE bypasses row-level triggers and table ACL checks)
--   - RLS policies stay in effect (TRUNCATE requires OWNER, would fail under RLS user)
--   - migration runs inside the migration runner's transaction — rollback is clean
--
-- Safe in validate mode only. DO NOT run in production-with-customers.

-- ─── 1. Grandchild / leaf tables (restrict on companies → must wipe first) ──
DELETE FROM "acmd"."suggestions";
--> statement-breakpoint
DELETE FROM "acmd"."documents";
--> statement-breakpoint
DELETE FROM "acmd"."notifications";
--> statement-breakpoint
DELETE FROM "acmd"."letters";
--> statement-breakpoint
DELETE FROM "acmd"."checklist_items";
--> statement-breakpoint
DELETE FROM "acmd"."discussions";
--> statement-breakpoint
DELETE FROM "acmd"."case_decisions";
--> statement-breakpoint
DELETE FROM "acmd"."audit_logs";
--> statement-breakpoint
DELETE FROM "acmd"."refresh_tokens";
--> statement-breakpoint

-- ─── 2. Mid tables (cases, employees) ───────────────────────────────────────
DELETE FROM "acmd"."cases";
--> statement-breakpoint
DELETE FROM "acmd"."employees";
--> statement-breakpoint

-- ─── 3. Root tables — users first (restrict on companies), then companies ──
DELETE FROM "acmd"."users";
--> statement-breakpoint
DELETE FROM "acmd"."companies";
--> statement-breakpoint

-- ─── 4. Add UNIQUE(email) on acmd.users (SEC-004) ───────────────────────────
-- Drizzle's .unique() emits CREATE UNIQUE INDEX + CONSTRAINT naming convention
-- users_email_unique. Kept explicit here so the migration is self-contained
-- and a future `drizzle-kit generate` diff shows zero pending changes.
ALTER TABLE "acmd"."users"
  ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
--> statement-breakpoint

-- NOTE: the `onboarding_created` enum value is added in a separate migration
-- (0002_acmd_onboarding_audit_enum.sql). PostgreSQL forbids running
-- ALTER TYPE ... ADD VALUE inside the same transaction block that later
-- references that value — keeping the enum change isolated avoids that
-- class of error in downstream tooling.
