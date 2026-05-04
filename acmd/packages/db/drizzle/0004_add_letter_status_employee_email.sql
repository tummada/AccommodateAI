-- Migration 0004: Add letter status/sentToEmail columns + employee email
-- ACMD-027: Phase 2D — Letter Generator

-- Add letter status enum
DO $$ BEGIN
  CREATE TYPE acmd_letter_status AS ENUM ('draft', 'sent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add columns to acmd_letters
ALTER TABLE acmd_letters ADD COLUMN IF NOT EXISTS status acmd_letter_status NOT NULL DEFAULT 'draft';
ALTER TABLE acmd_letters ADD COLUMN IF NOT EXISTS sent_to_email VARCHAR(255);
ALTER TABLE acmd_letters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add email to employees
ALTER TABLE acmd_employees ADD COLUMN IF NOT EXISTS email VARCHAR(255);
