// @acmd/api — Auth Routes (RS-013)
//
// After RS-013, acmd-api no longer owns login. Token minting
// (POST /auth/google), refresh (POST /auth/refresh), and logout
// (POST /auth/logout) were moved to vollos-core auth-service.
//
// Remaining here:
//   GET  /api/v1/auth/me          — profile + onboarding hints (validates
//                                   vollos-core JWT via JWKS in acmdTenantGuard)
//   POST /api/v1/auth/test-login  — dev/E2E only. Production guard returns 404.
//                                   Signs with local RSA pair so Playwright can
//                                   drive the API without going through
//                                   vollos-core in tests. Will be removed once
//                                   vollos-core ships a test-login endpoint
//                                   acmd can forward to.
//
// The factory is still async because test-login still references @acmd/auth's
// createTokens / hashToken for token issuance.

import { Hono } from 'hono';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthEnv } from '@acmd/auth';
import {
  db,
  acmdUsers,
  acmdCompanies,
  acmdBetaInviteRedemptionLog,
} from '@acmd/db';
import { config, rsaKeys } from '../config.js';
import { ACMD_AUTH_COOKIE_PATH } from '../config/cookiePaths.js';
import { acmdTenantGuard } from '../middleware/auth.js';
import type { AcmdAuthClaims } from '../middleware/auth.js';
import {
  createUser,
  tokenCallbacks,
} from '../services/authService.js';
import { writeAuditLog } from '../services/caseService.js';
import {
  isOwnerEmail,
  hasUnclaimedBetaRedemption,
} from '../services/betaGate.js';
import type { UserRecord, CreateUserData } from '@acmd/auth';

/**
 * T-065 deferred-claim: link a vollos-core JWT to a previously-redeemed beta
 * invite and create the acmd.users + acmd.companies pair atomically.
 *
 * Returns the freshly-created acmd.users row when:
 *   - a beta_invite_redemption_log row matches `claimEmail` with
 *     result='success' AND claimed_user_id IS NULL
 *   - the createUser + claim UPDATE both succeed in one transaction
 *
 * Returns null when:
 *   - no matching unredeemed log row exists (caller should fall back to the
 *     standard onboarding-required hints)
 *   - the claim transaction fails for any reason (caller falls back to
 *     onboarding-required hints; we never throw to the /me caller because a
 *     transient DB error here must not break login)
 *
 * Concurrency: if two /me requests for the same JWT race, the second hits
 * the email-UNIQUE constraint on acmd.users → caught and returns null →
 * falls through to onboarding-required hints. Both responses are equivalent
 * from the FE's perspective (the second just sees the row created by the
 * first on the next /me call).
 */
async function tryClaimBetaRedemption(
  userIdFromJwt: string,
  claimEmail: string,
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
} | null> {
  // 1. Find the most recent successful redemption row for this email that
  //    has not yet been claimed. We use ORDER BY created_at DESC so a
  //    re-redemption (extremely rare — token unique constraint usually
  //    prevents this) maps to the most recent attempt.
  let candidateRow: {
    id: string;
    email: string | null;
    claimedUserId: string | null;
  } | undefined;
  try {
    const candidates = await db
      .select({
        id: acmdBetaInviteRedemptionLog.id,
        email: acmdBetaInviteRedemptionLog.email,
        claimedUserId: acmdBetaInviteRedemptionLog.claimedUserId,
      })
      .from(acmdBetaInviteRedemptionLog)
      .where(
        and(
          eq(acmdBetaInviteRedemptionLog.email, claimEmail),
          eq(acmdBetaInviteRedemptionLog.result, 'success'),
          isNull(acmdBetaInviteRedemptionLog.claimedUserId),
        ),
      )
      .orderBy(desc(acmdBetaInviteRedemptionLog.createdAt))
      .limit(1);
    candidateRow = candidates[0];
  } catch (err) {
    console.error('[auth/me] beta claim lookup failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }

  if (!candidateRow) {
    return null;
  }

  // 2. Atomic create + claim. If the email is already taken in acmd.users
  //    (concurrent /me race), the unique constraint surfaces here and the
  //    caller falls back to onboarding-required hints.
  try {
    const created = await db.transaction(async (tx) => {
      const user = await createUser(
        {
          email: claimEmail,
          // vollos-core JWT doesn't carry display name; FE will overwrite via
          // the onboarding form. Use email local-part as a usable placeholder
          // so acmd.users.name is never empty (NOT NULL constraint).
          name: claimEmail.split('@')[0] ?? 'Beta User',
          // T-065: google_id stays empty here — vollos-core auth-service
          // is responsible for binding google_id during the OAuth flow.
          // We deliberately do NOT set google_id='' on insert: leaving it
          // out keeps the column NULL and avoids the QA #1 bug
          // (review-qa.md L324-L340: '' UNIQUE collision on second beta).
          company_id: '',
          role: 'super_admin',
          product: 'acmd',
        } as CreateUserData,
        // RS-013: force acmd.users.id = JWT.sub so subsequent /me lookups
        // keyed on JWT.sub hit the row directly.
        { userId: userIdFromJwt },
        tx,
      );

      // Mark the log row as claimed. We re-check claimed_user_id IS NULL
      // inside the UPDATE so a concurrent /me race resolves to one winner.
      const updated = await tx
        .update(acmdBetaInviteRedemptionLog)
        .set({
          claimedUserId: user.id,
          claimedAt: new Date(),
        })
        .where(
          and(
            eq(acmdBetaInviteRedemptionLog.id, candidateRow!.id),
            isNull(acmdBetaInviteRedemptionLog.claimedUserId),
          ),
        )
        .returning({ id: acmdBetaInviteRedemptionLog.id });

      if (updated.length === 0) {
        // Lost the race — another /me already claimed this row. Roll back
        // so we don't leave an orphan acmd.users row.
        throw new Error('beta_claim_race_lost');
      }

      // Audit: record the link between the beta redemption and the new
      // acmd identity. Same enum value as onboarding so existing dashboards
      // see the event in their timeline; metadata.source distinguishes it.
      await writeAuditLog(
        {
          companyId: user.company_id,
          action: 'onboarding_created',
          actorId: user.id,
          metadata: {
            source: 'beta_claim',
            email_domain: claimEmail.split('@')[1] ?? null,
            redemption_log_id: candidateRow!.id,
          },
        },
        tx,
      );

      return user;
    });

    return {
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      companyId: created.company_id,
    };
  } catch (err) {
    // Email collision (PG 23505) or race-lost — both surface as null so the
    // caller falls back to the onboarding hints. Log only — never expose to
    // the caller because the JWT subject did pass auth.
    console.warn('[auth/me] beta claim transaction failed — falling back', {
      user_id: userIdFromJwt,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

/**
 * Build the auth sub-app (RS-013).
 *
 * Provides /me (protected by acmdTenantGuard) and /test-login (dev/E2E only).
 * /google, /refresh, /logout were removed — vollos-core owns them now.
 */
export async function buildAuthRoutes(): Promise<Hono<AuthEnv>> {
  const auth = new Hono<AuthEnv>();

  // ---------------------------------------------------------------------
  // GET /me — current user profile + onboarding hints (RS-013)
  //
  // acmdTenantGuard verifies the vollos-core JWT and stores the decoded
  // claims (including email / google_id / products) in `authClaims`.
  //
  // Behaviour:
  //   - User row found  → 200 + { onboarding_required, profile }
  //                       onboarding_required mirrors company onboarding flag.
  //   - User row missing → 200 + { onboarding_required: true, profile: hints
  //                                from JWT (user_id, email, google_id, name) }
  //                       The frontend uses these hints to prefill the
  //                       onboarding form; the row is created by POST /api/v1/onboarding.
  //   - JWT lacks `products` claim → 401 (handled in middleware).
  //   - JWT `products` doesn't include 'acmd' → 403 (handled in middleware).
  //
  // Log hygiene: warn logs only opaque user_id — never email or name.
  // ---------------------------------------------------------------------
  auth.get('/me', acmdTenantGuard, async (c) => {
    const userId = c.get('userId');
    const claims = (c as unknown as { get: (k: string) => AcmdAuthClaims }).get(
      'authClaims',
    );

    const rows = await db
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
      .where(and(eq(acmdUsers.id, userId), isNull(acmdUsers.deletedAt)))
      .limit(1);

    const baseHeaders = {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    } as const;

    if (rows.length === 0) {
      // T-065 deferred-claim: before falling through to "onboarding required",
      // check whether this email previously redeemed a beta invite via
      // POST /api/v1/beta-signup. If yes, atomically create acmd.users +
      // acmd.companies AND link the redemption_log row to the new user_id.
      //
      // Match criteria (must match all):
      //   - claims.email is non-empty (no claim if vollos-core JWT didn't
      //     carry an email — claims.email is the only authoritative source
      //     for matching; we never trust user-supplied identity here)
      //   - a redemption_log row exists with the same email (case-insensitive)
      //     and result='success' and claimed_user_id IS NULL
      //
      // After claim:
      //   - acmd.users row exists with id = claims.sub (RS-013 invariant)
      //   - acmd.companies row exists (created by createUser)
      //   - log row's claimed_user_id = claims.sub (audit trail for D14/D16)
      //   - response is the same as the standard /me 200 (onboarding_required
      //     reflects the company's onboarding_completed_at, which createUser
      //     leaves NULL → onboarding_required=true so FE still routes to the
      //     onboarding form to capture name + companyName)
      const claimEmail = (claims.email ?? '').trim().toLowerCase();
      if (claimEmail.length > 0) {
        const claimed = await tryClaimBetaRedemption(claims.sub, claimEmail);
        if (claimed) {
          return c.json(
            {
              onboarding_required: true,
              profile: {
                id: claimed.id,
                user_id: claimed.id,
                email: claimed.email,
                name: claimed.name,
                role: claimed.role,
                companyId: claimed.companyId,
              },
            },
            200,
            baseHeaders,
          );
        }
      }

      // T-101: Before falling through to "onboarding required", check whether
      // the caller is allowed past the Beta gate. Order:
      //   1. Owner bypass (ACMD_OWNER_EMAIL) → return onboarding hints (proceeds
      //      to onboarding form as normal).
      //   2. Otherwise: no acmd.users row + no unclaimed redemption row →
      //      respond with needs_beta_invite=true so the FE routes to
      //      /redeem-invite instead of the onboarding form.
      //
      // tryClaimBetaRedemption already ran above. It returns null in two cases:
      //   (i)  no unclaimed redemption row exists (the legitimate no-redemption
      //        case → gate should fire),
      //   (ii) row exists but claim transaction failed.
      //
      // For case (ii), failure is either:
      //   - race-lost (other /me already claimed) → the row's claimed_user_id
      //     is now NOT NULL → the gate query (which filters claimed_user_id IS
      //     NULL) will NOT find this row → falls through to onboarding hints
      //     (no needs_beta_invite). This is correct — race winner already
      //     onboarded, race loser will see existing acmd.users row on next /me.
      //   - transient DB error (rare) → row remains unclaimed → the gate sees
      //     it → returns needs_beta_invite=true to a user who DOES have a
      //     valid beta. Next /me retry recovers. Open Question Q-A6.
      //
      // We deliberately keep two SELECTs (the one in tryClaimBetaRedemption +
      // the gate query here) rather than refactoring tryClaimBetaRedemption to
      // a discriminated-union return — at cap=20 traffic the overhead is
      // negligible, and the refactor would touch a well-tested security path.
      // Cleanup tracked as a future refactor (Q-B5).
      if (!isOwnerEmail(claims.email)) {
        const allowed = await hasUnclaimedBetaRedemption(claims.email);
        if (!allowed) {
          const emailDomain = (claims.email ?? '').split('@')[1] ?? null;
          console.warn('[auth/me] needs_beta_invite=true', {
            jwt_sub: claims.sub,
            email_domain: emailDomain,
          });
          return c.json(
            {
              onboarding_required: true,
              needs_beta_invite: true,
              profile: {
                user_id: claims.sub,
                email: claims.email,
                name: '',
                google_id: claims.google_id,
              },
            },
            200,
            baseHeaders,
          );
        }
      }

      // Owner bypass branch OR a redemption row exists but tryClaimBetaRedemption
      // raced and lost (claimed_user_id is now NOT NULL — the row will not be
      // re-found above). Return the standard onboarding-hints envelope so the
      // FE prefills the onboarding form. Owner can complete onboarding because
      // POST /api/v1/onboarding's gate also bypasses on owner email.
      // User not yet onboarded in acmd — return JWT hints so FE can prefill
      // the onboarding form. This is NOT an error: vollos-core created the
      // auth.users row, acmd just hasn't created its local acmd_users row yet.
      console.warn(`[auth/me] acmd_users row missing — onboarding_required=true user_id=${userId}`);
      return c.json(
        {
          onboarding_required: true,
          profile: {
            user_id: claims.sub,
            email: claims.email,
            name: '', // vollos-core JWT doesn't carry display name (by design)
            google_id: claims.google_id,
          },
        },
        200,
        baseHeaders,
      );
    }

    const row = rows[0]!;

    // Explicit response shape — sensitive columns (googleId, deletedAt,
    // timestamps) are excluded from the select, so they cannot leak.
    return c.json(
      {
        onboarding_required: row.onboardingCompletedAt === null,
        profile: {
          id: row.id,
          user_id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          companyId: row.companyId,
        },
      },
      200,
      baseHeaders,
    );
  });

  // ---------------------------------------------------------------------
  // POST /test-login — ACMD-160: Playwright E2E bypass (test/dev only)
  //
  // ⚠️  PRODUCTION GUARD: NODE_ENV === 'production' → 404 immediately.
  //
  // Accepts { email, role, companyId } and mints a local JWT using the
  // ephemeral / configured RSA pair. Note: tokens minted here will NOT
  // validate through vollos-core's JWKS — that's intentional. Playwright
  // tests run against acmd-api in isolation so the acmd-api middleware's
  // dev-mode branch (no VOLLOS_AUTH_URL) accepts them.
  //
  // RS-013 TODO: migrate this to forward to vollos-core once vollos-core
  // exposes a dev-only /auth/test-login. Tracked in a follow-up.
  // ---------------------------------------------------------------------

  // role enum mirrors acmdUserRoleEnum in packages/acmd-db/src/schema/users.ts.
  const testLoginSchema = z.object({
    email: z.string().email(),
    role: z.enum(['super_admin', 'hr', 'manager']),
    companyId: z.string().min(1),
    companyName: z.string().optional(),
  });

  auth.post('/test-login', async (c) => {
    // Production guard — 404 so endpoint is not enumerable
    if (config.nodeEnv === 'production') {
      return c.json({ error: 'Not found' }, 404);
    }

    // Parse + validate body
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parseResult = testLoginSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', issues: parseResult.error.issues }, 400);
    }

    const { email, role, companyId, companyName } = parseResult.data;

    // Upsert company: insert a minimal placeholder if missing.
    const company = await db
      .select()
      .from(acmdCompanies)
      .where(eq(acmdCompanies.id, companyId))
      .limit(1);
    if (company.length === 0) {
      await db.insert(acmdCompanies).values({
        id: companyId,
        name: companyName ?? `${companyId}-e2e`,
      });
    }

    // Upsert user: find by email, or insert a new one.
    const { createTokens, hashToken, DEFAULT_REFRESH_TTL } = await import('@acmd/auth');
    const { setCookie } = await import('hono/cookie');

    let user: UserRecord;

    const existingRows = await db
      .select({
        id: acmdUsers.id,
        companyId: acmdUsers.companyId,
        role: acmdUsers.role,
        email: acmdUsers.email,
        name: acmdUsers.name,
      })
      .from(acmdUsers)
      .where(and(eq(acmdUsers.email, email), isNull(acmdUsers.deletedAt)))
      .limit(1);

    if (existingRows.length > 0) {
      const row = existingRows[0]!;
      user = {
        id: row.id,
        company_id: row.companyId,
        role: row.role,
        email: row.email,
        name: row.name,
        product: 'acmd',
      };
    } else {
      const [inserted] = await db
        .insert(acmdUsers)
        .values({
          companyId,
          name: email, // placeholder name for test users
          email,
          role,
          lastLoginAt: new Date(),
        })
        .returning({
          id: acmdUsers.id,
          companyId: acmdUsers.companyId,
          role: acmdUsers.role,
          email: acmdUsers.email,
          name: acmdUsers.name,
        });

      if (!inserted) {
        return c.json({ error: 'Failed to create user' }, 500);
      }

      user = {
        id: inserted.id,
        company_id: inserted.companyId,
        role: inserted.role,
        email: inserted.email,
        name: inserted.name,
        product: 'acmd',
      };
    }

    // Issue token pair (RS256). In test mode, rsaKeys.privateKey is null
    // but createTokens is mocked at the vitest level.
    const testLoginPrivateKey = rsaKeys.privateKey;
    if (!testLoginPrivateKey && process.env['VITEST'] === undefined && process.env['NODE_ENV'] !== 'test') {
      return c.json({ error: 'Auth not initialized' }, 503);
    }
    const tokenPair = await createTokens(
      {
        sub: user.id,
        company_id: user.company_id,
        role: user.role,
        product: 'acmd',
        // T-053: acmdTenantGuard (middleware/auth.ts:319) requires
        // `Array.isArray(payload.products)` and `products.includes('acmd')`.
        // Mint the entitlement locally so /test-login tokens satisfy the
        // guard without round-tripping through vollos-core.
        products: ['acmd'],
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        privateKey: testLoginPrivateKey!,
      },
    );

    // Store refresh token hash.
    const refreshHash = hashToken(tokenPair.refreshToken);
    const expiresAt = new Date(Date.now() + DEFAULT_REFRESH_TTL * 1000);
    await tokenCallbacks.storeToken(refreshHash, user.id, expiresAt);

    // Set refresh cookie on the auth mount path (legacy E2E expectation).
    setCookie(c, 'refresh_token', tokenPair.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'Strict',
      maxAge: DEFAULT_REFRESH_TTL,
      path: ACMD_AUTH_COOKIE_PATH,
    });

    // For test-login we report onboardingRequired based on company row state.
    const companyRow = await db
      .select({ onboardingCompletedAt: acmdCompanies.onboardingCompletedAt })
      .from(acmdCompanies)
      .where(eq(acmdCompanies.id, user.company_id))
      .limit(1);
    const onboardingRequired =
      companyRow.length === 0 || companyRow[0]!.onboardingCompletedAt === null;

    return c.json(
      {
        accessToken: tokenPair.accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.company_id,
          onboardingRequired,
        },
      },
      200,
    );
  });

  return auth;
}
