// @acmd/db — acmd_suggestions schema
// AI-generated accommodation suggestions for cases

import {
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCases } from './cases.js';
import { acmdCompanies } from './companies.js';
import { acmdCostRangeEnum, acmdEffectivenessEnum } from './jan-accommodations.js';

export const acmdSuggestions = acmdSchema.table(
  'suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => acmdCases.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    costEstimate: varchar('cost_estimate', { length: 100 }),
    costRange: acmdCostRangeEnum('cost_range'),
    effectiveness: acmdEffectivenessEnum('effectiveness'),
    janReferenceUrl: varchar('jan_reference_url', { length: 1024 }),
    selected: boolean('selected').default(false).notNull(),
    selectionReason: text('selection_reason'),
    selectedBy: uuid('selected_by'),
    selectedAt: timestamp('selected_at', { withTimezone: true }),
    source: varchar('source', { length: 50 }).notNull().default('ai'),
    // Phase 5A: Customization tracking (migration 0025)
    originalDescription: text('original_description'),
    customizedDescription: text('customized_description'),
    // Phase 5A: Implementation tracking (migration 0025)
    implementationStatus: varchar('implementation_status', { length: 50 }).default('pending'),
    implementationCost: numeric('implementation_cost', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_suggestions_case_id_idx').on(table.caseId),
    index('acmd_suggestions_company_id_idx').on(table.companyId),
    index('acmd_suggestions_impl_status_idx').on(table.caseId, table.implementationStatus),
  ],
);

export type AcmdSuggestion = typeof acmdSuggestions.$inferSelect;
export type NewAcmdSuggestion = typeof acmdSuggestions.$inferInsert;
