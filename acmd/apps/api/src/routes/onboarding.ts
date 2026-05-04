// @acmd/api — Onboarding Routes (RS-013 + RS-013-api-fix + RS-013-api-fix2)
//
// POST /api/v1/onboarding
//   Creates the local acmd_users + acmd_companies rows for a vollos-core
//   authenticated user that does NOT yet exist in acmd, and flips the new
//   company's onboarding_completed_at inside the same transaction so GET /me
//   returns onboarding_required=false on the very next request.
//
//   Invariant: acmd_users.id === vollos-core auth.users.id (JWT.sub). This
//   keeps the two identity stores in lockstep so every subsequent /me look-up
//   keyed on JWT.sub hits a row directly (no email fallback, no join gymnastics).
//
// Request body: { name: string (min 1, max 255), companyName?: string }
//   - `name` is required (vollos-core JWT does not carry a display name).
//   - `companyName` is optional; if omitted we fall back to the email domain.
//   - email / google_id / user_id come from the JWT — NEVER from the request
//     body. A client-supplied email would let an attacker choose someone
//     else's identity on their first hit.
//
// Responses:
//   201 { onboarding_required: false, profile }       — user + company created
//   200 { onboarding_required, profile }              — already onboarded
//   400 Validation failed                              — bad body
//   401 / 403 handled by acmdTenantGuard
//   409 Conflict                                       — concurrent onboarding
//                                                        (another request won
//                                                        the race for this
//                                                        user_id or email)
//
// RS-013-api-fix / OB-1 / SEC-001:
//   The check-existing → insert-company → insert-user → write-audit-log flow
//   runs inside a single `db.transaction(tx)`. Two concurrent POSTs for the
//   same JWT.sub or same email now produce exactly one success and one 409 —
//   never a 500 with an orphan acmd_companies row.
//
// RS-013-api-fix / SEC-003:
//   A successful onboarding writes an immutable audit_logs row
//   (action='onboarding_created') inside the same transaction. If the audit
//   insert fails, the entire onboarding is rolled back.

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import { db, acmdUsers, acmdCompanies } from '@acmd/db';
import { acmdTenantGuard } from '../middleware/auth.js';
import type { AcmdAuthClaims } from '../middleware/auth.js';
import { createUser } from '../services/authService.js';
import { writeAuditLog } from '../services/caseService.js';
import {
  isOwnerEmail,
  hasUnclaimedBetaRedemption,
} from '../services/betaGate.js';

const onboarding = new Hono<AuthEnv>();

// All onboarding endpoints require a valid vollos-core JWT.
onboarding.use('*', acmdTenantGuard);

// Schema — `name` required, `companyName` optional. Email / google_id / user_id
// are explicitly NOT on the body — they come from the JWT.
const onboardingBodySchema = z.object({
  name: z.string().min(1).max(255),
  companyName: z.string().min(1).max(255).optional(),
});

/**
 * Sentinel thrown from inside the onboarding transaction when we detect that
 * another request won the race (acmd_users row for this JWT.sub already
 * exists). Catching this outside the transaction lets us return 409 without
 * surfacing a raw PG error to the caller.
 */
class OnboardingConflictError extends Error {
  constructor(message = 'Onboarding already completed') {
    super(message);
    this.name = 'OnboardingConflictError';
  }
}

/**
 * Detect PostgreSQL 23505 unique_violation thrown from inside a transaction.
 * postgres.js puts the SQLSTATE code on `err.code`; Drizzle passes it through
 * untouched. We only treat this as 409 when it originates from acmd.users
 * (unique(email) or PK) — other unique violations should bubble as 500.
 */
function isAcmdUsersUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code !== '23505') return false;
  // Any of: constraint_name, table_name, detail — postgres.js exposes these.
  const constraint = (err as { constraint_name?: unknown; constraint?: unknown }).constraint_name
    ?? (err as { constraint?: unknown }).constraint;
  const table = (err as { table_name?: unknown; table?: unknown }).table_name
    ?? (err as { table?: unknown }).table;
  const detail = (err as { detail?: unknown }).detail;
  const constraintStr = typeof constraint === 'string' ? constraint : '';
  const tableStr = typeof table === 'string' ? table : '';
  const detailStr = typeof detail === 'string' ? detail : '';
  return (
    tableStr === 'users'
    || constraintStr.includes('users_')
    || detailStr.includes('Key (email)')
    || detailStr.includes('Key (id)')
  );
}

onboarding.post('/', async (c) => {
  const claims = (c as unknown as { get: (k: string) => AcmdAuthClaims }).get(
    'authClaims',
  );

  // Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = onboardingBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }
  const { name, companyName } = parsed.data;

  // If the row already exists, just return the current profile.
  // (Read-only fast path — outside the transaction.)
  const existing = await db
    .select({
      id: acmdUsers.id,
      email: acmdUsers.email,
      name: acmdUsers.name,
      role: acmdUsers.role,
      companyId: acmdUsers.companyId,
      onboardingCompletedAt: acmdCompanies.onboardingCompletedAt,
    })
    .from(acmdUsers)
    .leftJoin(acmdCompanies, eq(acmdCompanies.id, acmdUsers.companyId))
    .where(and(eq(acmdUsers.id, claims.sub), isNull(acmdUsers.deletedAt)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    return c.json(
      {
        onboarding_required: row.onboardingCompletedAt === null,
        profile: {
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          companyId: row.companyId,
        },
      },
      200,
    );
  }

  // T-101 — Beta invite gate. The user has a valid acmd JWT but no acmd.users
  // row yet. Before we create one, require either:
  //   (a) a successful, unclaimed redemption_log row for this email, OR
  //   (b) the caller is the owner (ACMD_OWNER_EMAIL bypass).
  // This blocks random Google accounts from reaching the dashboard before
  // mentor3's Day 5 cold email push (cap=20 invites). Placed AFTER the
  // existing-row fast path so re-POST by an already-onboarded user remains
  // 200 even if their redemption row was already claimed.
  if (!isOwnerEmail(claims.email)) {
    const allowed = await hasUnclaimedBetaRedemption(claims.email);
    if (!allowed) {
      // T-101 / A-005 — durable audit row blocked by AC-13 (audit_logs.company_id
      // is NOT NULL FK + AC-13 forbids migrations); console-only with
      // jwt_sub + email_domain so the Day 5 cold-email-blast forensics
      // still work. NEVER log full email (PII).
      const emailDomain = (claims.email ?? '').split('@')[1] ?? null;
      console.error('[onboarding] beta_gate_reject', {
        jwt_sub: claims.sub,
        email_domain: emailDomain,
      });
      return c.json(
        {
          error: 'beta_invite_required',
          redirect_to: '/redeem-invite',
        },
        403,
      );
    }
  }

  // OB-1 / SEC-001: wrap create-company + create-user + audit-log in one
  // transaction so concurrent POSTs either both succeed cleanly (one wins,
  // one rolls back with 409) or neither leaves state behind.
  try {
    const created = await db.transaction(async (tx) => {
      // Re-check inside the tx so we see writes committed after the outer
      // SELECT but before our INSERT. Still not a full guarantee against a
      // concurrent INSERT — that is what the PK / UNIQUE(email) is for.
      const racedRows = await tx
        .select({ id: acmdUsers.id })
        .from(acmdUsers)
        .where(and(eq(acmdUsers.id, claims.sub), isNull(acmdUsers.deletedAt)))
        .limit(1);
      if (racedRows.length > 0) {
        throw new OnboardingConflictError('Onboarding already completed');
      }

      // `userId` forces acmd_users.id = JWT.sub so /me look-ups match.
      const user = await createUser(
        {
          email: claims.email,
          name,
          google_id: claims.google_id,
          company_id: '',
          role: 'super_admin',
          product: 'acmd',
        },
        { userId: claims.sub },
        tx,
      );

      // RS-013-api-fix2 / OB-3:
      // Always flip acmd.companies.onboarding_completed_at → now() inside this
      // transaction. Without this, GET /me keeps returning
      // `onboarding_required: true` forever and OnboardingGuard traps the user
      // in a /onboarding ↔ /dashboard redirect loop.
      //
      // Optional: also override the placeholder company name (defaulted to the
      // email domain in createUser) with the value the FE captured in the form.
      const companyUpdateSet: {
        onboardingCompletedAt: Date;
        updatedAt: Date;
        name?: string;
      } = {
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      };
      if (companyName) {
        companyUpdateSet.name = companyName;
      }
      await tx
        .update(acmdCompanies)
        .set(companyUpdateSet)
        .where(eq(acmdCompanies.id, user.company_id));

      // SEC-003: immutable audit trail of the onboarding event. If the
      // audit insert fails (enum mismatch, FK, etc.) the whole transaction
      // rolls back — we refuse to onboard without a durable audit record.
      await writeAuditLog(
        {
          companyId: user.company_id,
          action: 'onboarding_created',
          actorId: user.id,
          metadata: {
            source: 'rs-013',
            email_domain: claims.email.split('@')[1] ?? null,
            company_name_supplied: Boolean(companyName),
          },
        },
        tx,
      );

      return user;
    });

    return c.json(
      {
        onboarding_required: false,
        profile: {
          id: created.id,
          email: created.email,
          name: created.name,
          role: created.role,
          companyId: created.company_id,
        },
      },
      201,
    );
  } catch (err) {
    if (
      err instanceof OnboardingConflictError
      || isAcmdUsersUniqueViolation(err)
    ) {
      return c.json({ error: 'Onboarding already completed' }, 409);
    }
    // Unknown failure — log generic, never expose DB error details.
    console.error('[onboarding] transaction failed', {
      user_id: claims.sub,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return c.json({ error: 'Onboarding failed' }, 500);
  }
});

export { onboarding as onboardingRoutes };
