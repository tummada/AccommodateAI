// @acmd/db — acmd_audit_logs schema
// Append-only audit trail for all actions
// IMPORTANT: No updated_at, no deleted_at — INSERT only, enforced by DB trigger

import {
  uuid,
  timestamp,
  jsonb,
  index,
  text,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';
import { acmdCases } from './cases.js';
import { acmdUsers } from './users.js';

export const acmdAuditActionEnum = acmdSchema.enum('acmd_audit_action', [
  // Case lifecycle (6)
  'case_created',
  'case_updated',
  'case_assigned',
  'case_reassigned',
  'case_status_changed',
  'case_closed',
  // Interactive process (6)
  'interactive_process_started',
  'medical_docs_requested',
  'medical_docs_received',
  'manager_input_requested',
  'manager_input_received',
  'employee_meeting_logged',
  // Decision (4)
  'accommodation_approved',
  'accommodation_denied',
  'accommodation_modified',
  'legal_review_requested',
  // Implementation (4)
  'implementation_started',
  'implementation_completed',
  'follow_up_scheduled',
  'follow_up_completed',
  // Documents (2)
  'document_uploaded',
  'document_deleted',
  // AI (4)
  'ai_classification_completed',
  'ai_suggestions_generated',
  'ai_consent_given',
  'ai_consent_declined',
  // System (5)
  'deadline_approaching',
  'deadline_overdue',
  'escalation_triggered',
  'notification_sent',
  'audit_exported',
  // Phase 4B: Approval chain
  'denial_gate_validated',
  'legal_review_completed',
  'pwfa_fast_track_approved',
  'approval_settings_updated',
  // Phase 4E: PWFA safeguards
  'pwfa_interim_recorded',
  'pwfa_leave_forcing_blocked',
  'pwfa_leave_forcing_approved',
  // Phase 5B: Auto-status transitions (migration 0032)
  'auto_status_transition',
  // Phase 6C: Discussion records (ACMD-137-A)
  'discussion_created',
  // Phase 7C: Supervisor review (ACMD-159)
  'supervisor_approved',
  'supervisor_rejected',
  'supervisor_info_requested',
  // RS-013: onboarding lifecycle
  'onboarding_created',
  // Legacy (kept for backward compatibility)
  'case_classified',
  'checklist_completed',
  'letter_generated',
  'letter_sent',
  'case_reopened',
  'deadline_missed',
  'medical_info_accessed',
]);

export const acmdAuditLogs = acmdSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
    caseId: uuid('case_id').references(() => acmdCases.id, {
      onDelete: 'set null',
    }),
    action: acmdAuditActionEnum('action').notNull(),
    actorId: uuid('actor_id').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata'),
    // Role-based visibility: which roles can see this event in the timeline
    // Default: ['super_admin', 'hr'] — medical events stay restricted, implementation adds 'manager'
    visibility: text('visibility').array().default(['super_admin', 'hr']).notNull(),
    // No updated_at — append-only table
    // No deleted_at — records must never be deleted (legal requirement)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_audit_logs_company_case_idx').on(table.companyId, table.caseId),
    index('acmd_audit_logs_company_created_at_idx').on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

export type AcmdAuditLog = typeof acmdAuditLogs.$inferSelect;
export type NewAcmdAuditLog = typeof acmdAuditLogs.$inferInsert;
