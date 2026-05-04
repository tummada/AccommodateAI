// @acmd/db — acmd_discussions schema
// Interactive Discussion records for EEOC Stage 3 (ADA/PWFA interactive process)

import {
  uuid,
  text,
  date,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';
import { acmdCases } from './cases.js';
import { acmdUsers } from './users.js';

export const acmdDiscussionMethodEnum = acmdSchema.enum('acmd_discussion_method', [
  'in_person',
  'video',
  'phone',
  'email',
  'written',
]);

export const acmdDiscussions = acmdSchema.table(
  'discussions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => acmdCases.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'cascade' }),
    recordedBy: uuid('recorded_by').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    discussionDate: date('discussion_date').notNull(),
    method: acmdDiscussionMethodEnum('method').notNull(),
    // JSONB for participant names array — avoids pg array complexity
    participants: jsonb('participants').notNull().default([]),
    summary: text('summary').notNull(),
    employeePreference: text('employee_preference'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_discussions_case_company_idx').on(table.caseId, table.companyId),
    index('acmd_discussions_case_date_idx').on(table.caseId, table.discussionDate),
  ],
);

export type AcmdDiscussion = typeof acmdDiscussions.$inferSelect;
export type NewAcmdDiscussion = typeof acmdDiscussions.$inferInsert;
