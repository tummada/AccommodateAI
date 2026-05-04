-- Migration: Add 'case_classified' to acmd_audit_action enum
-- ACMD-025: Required for proper audit logging of AI classification events
-- Backward compatible: ALTER TYPE ... ADD VALUE is non-destructive

ALTER TYPE acmd_audit_action ADD VALUE IF NOT EXISTS 'case_classified' AFTER 'case_updated';
