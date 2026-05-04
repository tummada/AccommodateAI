// @acmd/db — acmd_app_config schema
// T-063: Rolling Cap (D14) — key/value runtime config (Beta cap, etc.).
//
// Owner-update flow (D14): Pon updates `beta_cap_current` via PATCH
// /api/v1/admin/config (auth = ACMD_OWNER_EMAIL) or by direct SQL UPDATE.
// Beta-signup endpoint reads `beta_cap_current` per request — never hardcoded
// in TS so cap can grow Day 5/10/15 without redeploy.

import { varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';

export const acmdAppConfig = acmdSchema.table('app_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AcmdAppConfig = typeof acmdAppConfig.$inferSelect;
export type NewAcmdAppConfig = typeof acmdAppConfig.$inferInsert;
