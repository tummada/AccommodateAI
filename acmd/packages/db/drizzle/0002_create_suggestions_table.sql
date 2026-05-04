-- Migration: Create acmd_suggestions table
-- ACMD-026: AI Suggestions from JAN Database
-- Stores AI-generated and fallback accommodation suggestions per case

CREATE TABLE IF NOT EXISTS acmd_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES acmd_cases(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES acmd_companies(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  cost_estimate VARCHAR(100),
  cost_range acmd_cost_range,
  effectiveness acmd_effectiveness,
  jan_reference_url VARCHAR(1024),
  selected BOOLEAN NOT NULL DEFAULT false,
  selection_reason TEXT,
  selected_by UUID,
  selected_at TIMESTAMPTZ,
  source VARCHAR(50) NOT NULL DEFAULT 'ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acmd_suggestions_case_id_idx ON acmd_suggestions(case_id);
CREATE INDEX IF NOT EXISTS acmd_suggestions_company_id_idx ON acmd_suggestions(company_id);
