// @vollos/db — Drizzle ORM schema: leads + audit_logs
// PDPA-compliant lead capture schema

import {
  pgSchema,
  uuid,
  varchar,
  boolean,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ─── vollos PostgreSQL schema ─────────────────────────────────────────────────
const vollosSchema = pgSchema('vollos');

// ─── leads ───────────────────────────────────────────────────────────────────
export const leads = vollosSchema.table('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  source: varchar('source', { length: 50 }),           // 'form' | 'one_tap'
  productSource: varchar('product_source', { length: 50 }).notNull().default('vollos'), // 'vollos' | 'acmd' — which product this lead belongs to
  productSlug: varchar('product_slug', { length: 100 }),
  consentGiven: boolean('consent_given').notNull().default(false), // PDPA
  company: varchar('company', { length: 255 }),         // optional company name
  ipAddress: varchar('ip_address', { length: 45 }),    // IPv4/IPv6
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // PDPA fields
  consentGivenAt: timestamp('consent_given_at', { withTimezone: true }),
  consentRevokedAt: timestamp('consent_revoked_at', { withTimezone: true }),
  consentVersion: varchar('consent_version', { length: 50 }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  dataExpiresAt: timestamp('data_expires_at', { withTimezone: true }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
}, (table) => [
  index('leads_created_at_idx').on(table.createdAt),
  index('leads_deleted_at_idx').on(table.deletedAt),
  index('leads_product_slug_idx').on(table.productSlug),
  index('leads_source_idx').on(table.source),
  index('leads_product_source_idx').on(table.productSource),
]);

// ─── audit_logs ──────────────────────────────────────────────────────────────
export const auditLogs = vollosSchema.table('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  action: varchar('action', { length: 100 }).notNull(),  // 'lead_created', 'lead_duplicate', etc.
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('audit_logs_lead_id_idx').on(table.leadId),
  index('audit_logs_created_at_idx').on(table.createdAt),
  index('audit_logs_action_idx').on(table.action),
]);

// ─── type exports ────────────────────────────────────────────────────────────
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
