// @acmd/db — acmd_cases schema
// Accommodation requests (ADA/PWFA cases) — core of the system

import {
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';
import { acmdUsers } from './users.js';
import { acmdEmployees } from './employees.js';

export const acmdCaseStatusEnum = acmdSchema.enum('acmd_case_status', [
  'intake',
  'interactive_process',
  'awaiting_medical',
  'awaiting_input',
  'review',
  'implementation',
  'active',
  'approved',
  'denied',
  'closed',
]);

export const acmdCaseTypeEnum = acmdSchema.enum('acmd_case_type', [
  'ada',
  'pwfa',
  'state_law',
  'multiple',
]);

export const acmdCases = acmdSchema.table(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => acmdEmployees.id, { onDelete: 'restrict' }),
    assignedTo: uuid('assigned_to').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    status: acmdCaseStatusEnum('status').notNull().default('intake'),
    aiConsentGiven: boolean('ai_consent_given').notNull().default(false),
    aiConsentTimestamp: timestamp('ai_consent_timestamp', { withTimezone: true }),
    pwfaPerSe: boolean('pwfa_per_se').notNull().default(false),
    type: acmdCaseTypeEnum('type').notNull(),
    requestDescription: text('request_description'),
    // medical_info is plain text here; encryption handled at app layer (ACMD-014)
    medicalInfo: text('medical_info'),
    aiClassification: jsonb('ai_classification'),
    suggestedAccommodations: jsonb('suggested_accommodations'),
    approvedAccommodation: text('approved_accommodation'),
    denialReason: text('denial_reason'),
    // PWFA Phase 4E: Interim accommodation tracking
    interimAccommodationOffered: boolean('interim_accommodation_offered').notNull().default(false),
    interimAccommodationDescription: text('interim_accommodation_description'),
    interimOfferedAt: timestamp('interim_offered_at', { withTimezone: true }),
    deadline: timestamp('deadline', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_cases_company_status_idx').on(table.companyId, table.status),
    index('acmd_cases_company_type_idx').on(table.companyId, table.type),
    index('acmd_cases_company_created_at_idx').on(table.companyId, table.createdAt),
    index('acmd_cases_employee_id_idx').on(table.employeeId),
  ],
);

export type AcmdCase = typeof acmdCases.$inferSelect;
export type NewAcmdCase = typeof acmdCases.$inferInsert;
