-- RS-013-api-fix / SEC-003: extend acmd_audit_action enum with onboarding_created
--
-- Needed by writeAuditLog({ action: 'onboarding_created' }) inside the
-- onboarding transaction so that a successful signup is recorded in the
-- append-only audit trail alongside case/decision/letter events.
--
-- This migration is intentionally isolated from 0001 because
-- `ALTER TYPE ... ADD VALUE` cannot be combined with later statements that
-- use the new value in the same transaction block on older PG versions.

ALTER TYPE "acmd"."acmd_audit_action" ADD VALUE IF NOT EXISTS 'onboarding_created';
