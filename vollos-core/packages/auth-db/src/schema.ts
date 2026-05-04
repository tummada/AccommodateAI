// @vollos/auth-db — Drizzle ORM schema for auth service
// Uses pgSchema('auth') — all tables live in the 'auth' PostgreSQL schema

import {
  pgSchema,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── auth PostgreSQL schema ────────────────────────────────────────────────────
const authSchema = pgSchema('auth');

// ─── users ────────────────────────────────────────────────────────────────────
export const users = authSchema.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleId: varchar('google_id', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── refresh_tokens ───────────────────────────────────────────────────────────
export const refreshTokens = authSchema.table('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── user_products ────────────────────────────────────────────────────────────
// Entitlement table — which user has access to which VOLLOS product.
// Row exists ⇒ user can log in to that product. `status` distinguishes
// active / trial / expired without requiring row deletion (preserves audit).
//
// RS-013 (Phase 1): used by auth-service to populate JWT `products` claim so
// product apps can authorize without a second DB round-trip at login time.
export const userProducts = authSchema.table(
  'user_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    product: text('product').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // UNIQUE(user_id, product) — same user can only be entitled to each product once
    userProductUnique: uniqueIndex('user_products_user_id_product_unique').on(
      table.userId,
      table.product,
    ),
  }),
);

// ─── type exports ─────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type UserProduct = typeof userProducts.$inferSelect;
export type NewUserProduct = typeof userProducts.$inferInsert;
