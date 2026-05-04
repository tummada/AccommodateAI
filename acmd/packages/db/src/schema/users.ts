// @acmd/db — acmd_users schema
// HR staff users within a company

import {
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';

export const acmdUserRoleEnum = acmdSchema.enum('acmd_user_role', [
  'super_admin',
  'hr',
  'manager',
]);

export const acmdUsers = acmdSchema.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 255 }).notNull(),
  // RS-013/SEC-004: email is UNIQUE — one acmd account per email address.
  // Concurrent onboarding POSTs for the same email now surface as a PG
  // unique-violation (23505) → caught in the onboarding route → 409 Conflict.
  email: varchar('email', { length: 255 }).notNull().unique(),
  role: acmdUserRoleEnum('role').notNull().default('hr'),
  googleId: varchar('google_id', { length: 255 }).unique(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdUser = typeof acmdUsers.$inferSelect;
export type NewAcmdUser = typeof acmdUsers.$inferInsert;
