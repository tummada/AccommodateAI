// @acmd/db — acmd_letters schema
// AI-generated letters for accommodation cases

import {
  uuid,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCases } from './cases.js';
import { acmdUsers } from './users.js';

export const acmdLetterTypeEnum = acmdSchema.enum('acmd_letter_type', [
  'acknowledgment',
  'medical_request',
  'approval',
  'denial',
  'follow_up',
]);

export const acmdLetterStatusEnum = acmdSchema.enum('acmd_letter_status', [
  'draft',
  'sent',
]);

export const acmdLetters = acmdSchema.table('letters', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => acmdCases.id, { onDelete: 'cascade' }),
  type: acmdLetterTypeEnum('type').notNull(),
  content: text('content').notNull(),
  status: acmdLetterStatusEnum('status').notNull().default('draft'),
  sentToEmail: varchar('sent_to_email', { length: 255 }),
  pdfUrl: varchar('pdf_url', { length: 1024 }),
  createdBy: uuid('created_by').references(() => acmdUsers.id, {
    onDelete: 'set null',
  }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdLetter = typeof acmdLetters.$inferSelect;
export type NewAcmdLetter = typeof acmdLetters.$inferInsert;
