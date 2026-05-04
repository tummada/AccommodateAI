// @acmd/db — acmd_employees schema
// Employees who file accommodation requests

import {
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';

export const acmdEmployees = acmdSchema.table('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  position: varchar('position', { length: 255 }),
  department: varchar('department', { length: 255 }),
  state: varchar('state', { length: 50 }),
  hrisId: varchar('hris_id', { length: 255 }),
  employmentStatus: varchar('employment_status', { length: 20 }).notNull().default('active'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdEmployee = typeof acmdEmployees.$inferSelect;
export type NewAcmdEmployee = typeof acmdEmployees.$inferInsert;
