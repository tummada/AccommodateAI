// @acmd/api — Beta gate predicates (T-101)
//
// Shared between POST /api/v1/onboarding and GET /api/v1/auth/me.
//
// Two predicates, both evaluating to "is this caller allowed past the Beta
// gate?":
//
//   isOwnerEmail(email)           → owner-bypass (ACMD_OWNER_EMAIL match)
//   hasUnclaimedBetaRedemption(e) → caller's email has a successful redemption
//                                   row in acmd.beta_invite_redemption_log
//                                   that has not yet been claimed
//
// Why a shared module (T-101 review A-003 / B-004):
//   - The bypass is security-critical: any divergence between the two call
//     sites (onboarding gate and /me gate) is an exploitable inconsistency.
//   - One module + one unit test (apps/api/__tests__/betaGate.unit.test.ts)
//     keeps the predicate provably consistent.
//
// Inconsistency note (T-101 review B-009):
//   apps/api/src/routes/admin/config.ts:46-49 separately checks
//   `if (!config.acmdOwnerEmail) return 503` — admin endpoint refuses service
//   when the env var is empty so misconfigured prod is loud. This module's
//   isOwnerEmail() returns false (bypass disabled) — the gate falls back to
//   requiring a real redemption row, which is the safe default. Both
//   behaviours are correct for their respective endpoints.

import { eq, and, isNull } from 'drizzle-orm';
import { db, acmdBetaInviteRedemptionLog } from '@acmd/db';
import { config } from '../config.js';

/**
 * T-101 — owner bypass predicate.
 *
 * Returns true iff the JWT email matches ACMD_OWNER_EMAIL (case-insensitive,
 * trimmed). Empty config value (no owner configured) means no email matches —
 * bypass is effectively disabled, which is the safer default in non-prod.
 * Production .env MUST set ACMD_OWNER_EMAIL.
 *
 * Empty input email also returns false (and emits a warn log so a
 * misbehaving vollos-core JWT issuer is visible in ops). See review A-008.
 */
export function isOwnerEmail(jwtEmail: string | null | undefined): boolean {
  const owner = config.acmdOwnerEmail.trim().toLowerCase();
  if (owner.length === 0) return false;
  const email = (jwtEmail ?? '').trim().toLowerCase();
  if (email.length === 0) {
    console.warn('[betaGate] empty JWT email — treating as no owner-bypass');
    return false;
  }
  return email === owner;
}

/**
 * T-101 — beta-redemption predicate.
 *
 * Returns true iff the caller's email has a successful, unclaimed redemption
 * row in acmd.beta_invite_redemption_log.
 *
 * Email normalization: we lowercase the input before comparison.
 * beta-signup.ts:225 normalizes via `email.trim().toLowerCase()` BEFORE
 * passing to writeRedemptionLog (which inserts the email into the log row),
 * so the stored emails are guaranteed lowercase. A Google login under a
 * different case still matches.
 *
 * Returns false on DB error so we never accidentally let a user through
 * during a transient outage. The error is logged for ops.
 */
export async function hasUnclaimedBetaRedemption(
  claimEmail: string | null | undefined,
): Promise<boolean> {
  const normalized = (claimEmail ?? '').trim().toLowerCase();
  if (normalized.length === 0) return false;
  try {
    // T-101 R3 (A-R2-005): index coverage — `acmd_beta_redemption_log_email_idx`
    // (packages/db/src/schema/beta-tokens.ts) covers the email filter; result
    // and claimed_user_id are evaluated in-heap. At cap=20 traffic this is
    // negligible. If the cap is raised significantly, add a composite index
    // (email, result, claimed_user_id) — schema change blocked by this task's
    // AC-13 ("no migrations").
    const rows = await db
      .select({ id: acmdBetaInviteRedemptionLog.id })
      .from(acmdBetaInviteRedemptionLog)
      .where(
        and(
          eq(acmdBetaInviteRedemptionLog.email, normalized),
          eq(acmdBetaInviteRedemptionLog.result, 'success'),
          isNull(acmdBetaInviteRedemptionLog.claimedUserId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.error('[betaGate] redemption lookup failed — treating as no-row', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return false;
  }
}
