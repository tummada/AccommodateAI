// @acmd/db — Beta gate schema (T-063, T-065 deferred-claim refactor)
//
// Tables:
//   1. beta_invite_token            — token issued by mentor3 (Day 5 push 100 emails)
//   2. beta_waitlist                — emails captured when cap is full
//   3. beta_invite_redemption_log   — audit log for every signup attempt
//
// T-065 (2026-04-28) — deferred-claim model:
//   beta-signup NO LONGER creates acmd.users / acmd.companies. It only marks
//   `beta_invite_token.used_at = now()` and writes a redemption_log row that
//   captures the email the invitee claimed. The acmd.users + acmd.companies
//   pair is created later by GET /api/v1/auth/me on the user's first Google
//   login: the /me handler matches JWT.email against
//     beta_invite_redemption_log.email
//       WHERE result='success' AND claimed_user_id IS NULL
//   and atomically (a) inserts acmd.users with id=JWT.sub, (b) inserts the
//   placeholder acmd.companies row, (c) updates the matching log row's
//   claimed_user_id to JWT.sub. This sidesteps:
//     - QA #1 (T-063 review-qa.md L324-L340): google_id='' UNIQUE collision
//       on second beta signup
//     - QA #2 (T-063 review-qa.md L342-L357): random acmd.users.id blocks
//       legitimate Google login because email is UNIQUE and JWT.sub is fresh
//
// Notes on FK targets:
//   - `used_by` (on beta_invite_token) references acmd.users.id and is set
//     when the user later claims via Google login. Stays NULL for invitees
//     who redeemed but never logged in.
//   - `claimed_user_id` (on redemption_log, T-065) references acmd.users.id
//     and is set in the same atomic /me transaction that inserts the
//     acmd.users row. NULL until the invitee signs in for the first time.
//   - `waitlist_id` (on redemption_log) references acmd.beta_waitlist.id and
//     is populated only when result='capacity_full'.
//   - `email` (on redemption_log, T-065) is the email the invitee submitted
//     to /beta-signup. Required for /me to match the redemption row by JWT.email.

import {
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdUsers } from './users.js';

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

/** Result of a single beta-signup attempt (audit log + analytics signal). */
export const acmdBetaRedemptionResultEnum = acmdSchema.enum(
  'acmd_beta_redemption_result',
  ['success', 'invalid', 'expired', 'used', 'capacity_full', 'rate_limited'],
);

// ─────────────────────────────────────────────────────────────────────────
// beta_invite_token
// ─────────────────────────────────────────────────────────────────────────

export const acmdBetaInviteToken = acmdSchema.table(
  'beta_invite_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Token string sent to invitee (e.g. random 32-char URL-safe).
    token: varchar('token', { length: 128 }).notNull().unique(),
    // sent_at + 30 days; mentor3 sets this when generating the token.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Populated on successful redemption — points to acmd.users.id (= JWT.sub).
    usedBy: uuid('used_by').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('acmd_beta_invite_token_used_at_idx').on(table.usedAt),
  ],
);

export type AcmdBetaInviteToken = typeof acmdBetaInviteToken.$inferSelect;
export type NewAcmdBetaInviteToken = typeof acmdBetaInviteToken.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// beta_waitlist
// ─────────────────────────────────────────────────────────────────────────

export const acmdBetaWaitlist = acmdSchema.table('beta_waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  // Where the waitlist signup came from (defaults to 'beta_full' = capacity full).
  source: varchar('source', { length: 50 }).notNull().default('beta_full'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AcmdBetaWaitlist = typeof acmdBetaWaitlist.$inferSelect;
export type NewAcmdBetaWaitlist = typeof acmdBetaWaitlist.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// beta_invite_redemption_log (C2 audit, mentor3 finalized 2026-04-28)
// ─────────────────────────────────────────────────────────────────────────

export const acmdBetaInviteRedemptionLog = acmdSchema.table(
  'beta_invite_redemption_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The token string the caller attempted (may be invalid/garbage — store as-is).
    tokenAttempted: varchar('token_attempted', { length: 256 }).notNull(),
    // T-065: email the invitee claimed. Required for /me to match the
    // redemption row by JWT.email on first Google login. Nullable because
    // rate-limited / malformed-body rows have no validated email.
    email: varchar('email', { length: 255 }),
    // IPv4 / IPv6 supported up to 45 chars.
    ip: varchar('ip', { length: 45 }).notNull(),
    userAgent: text('user_agent'),
    result: acmdBetaRedemptionResultEnum('result').notNull(),
    // C2 addition (mentor3 2026-04-28): exact HTTP status returned to the caller.
    httpStatus: integer('http_status').notNull(),
    // C2 addition (mentor3 2026-04-28): set when result='capacity_full' so the
    // log row links back to the freshly-inserted waitlist record.
    waitlistId: uuid('waitlist_id').references(() => acmdBetaWaitlist.id, {
      onDelete: 'set null',
    }),
    // T-065 (deferred-claim): set when the invitee later signs in via Google
    // and the /me handler atomically creates acmd.users + acmd.companies.
    // NULL until claimed; non-null = this redemption has been bound to a
    // real acmd.users row. Audit-trail signal for D14/D16 funnel analysis.
    claimedUserId: uuid('claimed_user_id').references(() => acmdUsers.id, {
      onDelete: 'set null',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('acmd_beta_redemption_log_created_at_idx').on(table.createdAt),
    index('acmd_beta_redemption_log_result_idx').on(table.result),
    // T-065: support /me's lookup-by-email-where-claimed-user-id-is-null.
    index('acmd_beta_redemption_log_email_idx').on(table.email),
  ],
);

export type AcmdBetaInviteRedemptionLog =
  typeof acmdBetaInviteRedemptionLog.$inferSelect;
export type NewAcmdBetaInviteRedemptionLog =
  typeof acmdBetaInviteRedemptionLog.$inferInsert;
