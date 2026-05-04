// @acmd/db — acmd_checklist_items schema
// Interactive Process steps for each case

import {
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCases } from './cases.js';
import { acmdUsers } from './users.js';

export const acmdChecklistItems = acmdSchema.table(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => acmdCases.id, { onDelete: 'cascade' }),
    stepName: varchar('step_name', { length: 255 }).notNull(),
    stepOrder: integer('step_order').notNull(),
    required: boolean('required').notNull().default(true),
    completed: boolean('completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_checklist_items_case_step_idx').on(table.caseId, table.stepOrder),
  ],
);

export type AcmdChecklistItem = typeof acmdChecklistItems.$inferSelect;
export type NewAcmdChecklistItem = typeof acmdChecklistItems.$inferInsert;
