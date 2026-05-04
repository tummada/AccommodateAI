// @acmd/db — acmd_companies schema
// Tenant companies (HR clients) for AccommodateAI

import {
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';

export const acmdPlanTierEnum = acmdSchema.enum('acmd_plan_tier', [
  'starter',
  'pro',
  'business',
]);

export const acmdSubscriptionStatusEnum = acmdSchema.enum('acmd_subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);

export const acmdCompanies = acmdSchema.table('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  hqState: varchar('hq_state', { length: 50 }),
  size: varchar('size', { length: 50 }),
  industry: varchar('industry', { length: 100 }),
  planTier: acmdPlanTierEnum('plan_tier').notNull().default('starter'),
  subscriptionStatus: acmdSubscriptionStatusEnum('subscription_status')
    .notNull()
    .default('trialing'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  maxStates: integer('max_states').notNull().default(1),
  settings: jsonb('settings'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', {
    withTimezone: true,
  }),
  // FK to acmd_users.id — FK enforced at DB level (circular ref: users → companies → users)
  // nullable — not required until Phase 4 onboarding
  defaultHrContactId: uuid('default_hr_contact_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AcmdCompany = typeof acmdCompanies.$inferSelect;
export type NewAcmdCompany = typeof acmdCompanies.$inferInsert;
