// @acmd/db — acmd_compliance_rules schema
// ADA / PWFA / State law rules (global — no company_id)

import {
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';

export const acmdLawTypeEnum = acmdSchema.enum('acmd_law_type', [
  'ada',
  'pwfa',
  'state',
]);

export const acmdComplianceRules = acmdSchema.table(
  'compliance_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lawType: acmdLawTypeEnum('law_type').notNull(),
    state: varchar('state', { length: 50 }), // null = federal law
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    requirements: jsonb('requirements'),
    deadlines: jsonb('deadlines'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_compliance_rules_law_type_state_idx').on(
      table.lawType,
      table.state,
    ),
  ],
);

export type AcmdComplianceRule = typeof acmdComplianceRules.$inferSelect;
export type NewAcmdComplianceRule = typeof acmdComplianceRules.$inferInsert;
