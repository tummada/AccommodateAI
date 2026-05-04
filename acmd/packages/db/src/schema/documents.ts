// @acmd/db — acmd_documents schema
// File attachments (medical certificates, etc.)

import {
  uuid,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCases } from './cases.js';
import { acmdUsers } from './users.js';

export const acmdDocuments = acmdSchema.table('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => acmdCases.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 100 }),
  storagePath: varchar('storage_path', { length: 1024 }).notNull(),
  encrypted: boolean('encrypted').notNull().default(true),
  uploadedBy: uuid('uploaded_by').references(() => acmdUsers.id, {
    onDelete: 'set null',
  }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdDocument = typeof acmdDocuments.$inferSelect;
export type NewAcmdDocument = typeof acmdDocuments.$inferInsert;
