// @acmd/db — acmd_approval_settings + acmd_case_decisions schema
// Phase 4B: Approval chain, denial gate, PWFA per se fast-track

import {
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';
import { acmdCases } from './cases.js';
import { acmdUsers } from './users.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const acmdDecisionTypeEnum = acmdSchema.enum('acmd_decision_type', [
  'approved',
  'denied',
]);

export const acmdLegalReviewPolicyEnum = acmdSchema.enum('acmd_legal_review_policy', [
  'yes',
  'no',
  'recommend',
]);

// ---------------------------------------------------------------------------
// acmd_approval_settings — per-company approval workflow config
// ---------------------------------------------------------------------------

export const acmdApprovalSettings = acmdSchema.table(
  'approval_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
    requireManagerInput: boolean('require_manager_input').notNull().default(true),
    requireLegalReviewForDenial: acmdLegalReviewPolicyEnum('require_legal_review_for_denial')
      .notNull()
      .default('recommend'),
    allowSelfApproval: boolean('allow_self_approval').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('acmd_approval_settings_company_id_uniq').on(table.companyId),
  ],
);

export type AcmdApprovalSettings = typeof acmdApprovalSettings.$inferSelect;
export type NewAcmdApprovalSettings = typeof acmdApprovalSettings.$inferInsert;

// ---------------------------------------------------------------------------
// acmd_case_decisions — approval/denial decision records
// ---------------------------------------------------------------------------

export const acmdCaseDecisions = acmdSchema.table(
  'case_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => acmdCases.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
    decisionType: acmdDecisionTypeEnum('decision_type').notNull(),
    // Denial gate: 4 required factors (ADA undue hardship analysis)
    costAnalysis: text('cost_analysis'),
    financialResources: text('financial_resources'),
    sizeAndType: text('size_and_type'),
    operationalImpact: text('operational_impact'),
    // Must have >= 2 alternatives considered before denial
    alternativesConsidered: jsonb('alternatives_considered'),
    // Legal review tracking
    legalReviewRequired: boolean('legal_review_required').notNull().default(true),
    legalReviewed: boolean('legal_reviewed').notNull().default(false),
    legalReviewedBy: uuid('legal_reviewed_by').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    legalReviewedAt: timestamp('legal_reviewed_at', { withTimezone: true }),
    // Decision actor
    decidedBy: uuid('decided_by')
      .notNull()
      .references(() => acmdUsers.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Supervisor review (Phase 7C)
    supervisorStatus: varchar('supervisor_status', {
      enum: ['pending_review', 'approved', 'rejected', 'info_requested'],
    }),
    supervisorId: uuid('supervisor_id').references(() => acmdUsers.id, { onDelete: 'set null' }),
    supervisorReviewedAt: timestamp('supervisor_reviewed_at', { withTimezone: true }),
    supervisorRejectReason: text('supervisor_reject_reason'),
    supervisorInfoRequest: text('supervisor_info_request'),
  },
  (table) => [
    index('acmd_case_decisions_case_id_idx').on(table.caseId),
    index('acmd_case_decisions_company_id_idx').on(table.companyId),
  ],
);

export type AcmdCaseDecision = typeof acmdCaseDecisions.$inferSelect;
export type NewAcmdCaseDecision = typeof acmdCaseDecisions.$inferInsert;
