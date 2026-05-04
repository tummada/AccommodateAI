// @acmd/db — acmd_refresh_tokens schema
// Refresh token revocation table (used by @acmd/auth)

import {
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdUsers } from './users.js';
import { acmdCompanies } from './companies.js';

export const acmdRefreshTokens = acmdSchema.table('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => acmdUsers.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => acmdCompanies.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdRefreshToken = typeof acmdRefreshTokens.$inferSelect;
export type NewAcmdRefreshToken = typeof acmdRefreshTokens.$inferInsert;
