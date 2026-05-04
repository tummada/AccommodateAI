// @acmd/db — acmd_jan_accommodations schema
// Job Accommodation Network (JAN) database (global — no company_id)

import {
  uuid,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';

export const acmdCostRangeEnum = acmdSchema.enum('acmd_cost_range', [
  'no_cost',
  'low',
  'moderate',
  'high',
]);

export const acmdEffectivenessEnum = acmdSchema.enum('acmd_effectiveness', [
  'high',
  'medium',
  'low',
]);

export const acmdJanAccommodations = acmdSchema.table('jan_accommodations', {
  id: uuid('id').primaryKey().defaultRandom(),
  condition: varchar('condition', { length: 255 }).notNull(),
  jobCategory: varchar('job_category', { length: 255 }),
  accommodation: varchar('accommodation', { length: 255 }).notNull(),
  costEstimate: varchar('cost_estimate', { length: 100 }),
  costRange: acmdCostRangeEnum('cost_range'),
  effectiveness: acmdEffectivenessEnum('effectiveness'),
  description: text('description'),
  sourceUrl: varchar('source_url', { length: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdJanAccommodation = typeof acmdJanAccommodations.$inferSelect;
export type NewAcmdJanAccommodation =
  typeof acmdJanAccommodations.$inferInsert;
