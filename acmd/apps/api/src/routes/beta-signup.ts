// @acmd/api — Beta gate signup route (T-063 + T-065 deferred-claim refactor)
//
// POST /api/v1/beta-signup
//
// Body: { token: string, email: string, name?: string, companyName?: string }
//   (name / companyName accepted for FE compatibility but only `email` is
//   persisted on the redemption_log row — see T-065 deferred-claim model.)
//
// T-065 deferred-claim model (replaces T-063 inline createUser path):
//   beta-signup NO LONGER creates acmd.users / acmd.companies. It only
//     - validates the token (exists / not expired / not used)
//     - checks the rolling cap (acmd.app_config.beta_cap_current)
//     - on success: marks beta_invite_token.used_at = now() atomically
//                   AND records the email on beta_invite_redemption_log
//     - on capacity_full: inserts a beta_waitlist row and links it on the log
//   The acmd.users + acmd.companies pair is created later by GET /me on the
//   invitee's first Google login, which matches JWT.email against this log
//   row's `email` (see apps/api/src/routes/auth.ts /me handler — T-065 claim).
//
//   Why: T-063 review-qa.md L324-L357 flagged two integration bugs that
//   unit mocks couldn't see:
//     1. CRITICAL — google_id='' UNIQUE collision on second beta signup
//     2. HIGH     — random acmd.users.id breaks RS-013 invariant
//                   (acmd.users.id MUST equal vollos-core JWT.sub)
//   Both are fixed by deferring user creation until JWT.sub is known.
//
// Rate limit (mentor3 C1, 2026-04-28): 5 attempts/IP/hour via hono-rate-limiter.
//   When the limit fires we still want a row in beta_invite_redemption_log so
//   Day-16 analytics can count rate_limited attempts. The middleware below
//   writes the audit row in `handler` BEFORE returning 429.
//
// IP source (T-065 / SEC-001 fix): the rate-limit keyGenerator and audit IP
//   come from getTrustedClientIp() (apps/api/src/middleware/trusted-proxy.ts).
//   That helper only trusts x-forwarded-for when the TCP peer IP is in the
//   operator's TRUSTED_PROXY_IPS allowlist — defense against XFF spoofing
//   that would otherwise bypass the per-IP rate cap.

import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';
import { eq, sql, and } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  acmdBetaInviteToken,
  acmdBetaWaitlist,
  acmdBetaInviteRedemptionLog,
  acmdAppConfig,
} from '@acmd/db';
import { getTrustedClientIp } from '../middleware/trusted-proxy.js';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Rolling Cap key — owner updates via PATCH /api/v1/admin/config or SQL. */
const BETA_CAP_KEY = 'beta_cap_current';

/** Default cap if app_config row is missing (defensive — seed should exist). */
const BETA_CAP_DEFAULT = 20;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Append a row to acmd.beta_invite_redemption_log. Never throws — audit
 * failures must not break the user-facing response, but they must be
 * surfaced in server logs so we can backfill from log analysis.
 */
async function writeRedemptionLog(params: {
  tokenAttempted: string;
  email: string | null;
  ip: string;
  userAgent: string | undefined;
  result:
    | 'success'
    | 'invalid'
    | 'expired'
    | 'used'
    | 'capacity_full'
    | 'rate_limited';
  httpStatus: number;
  waitlistId?: string | null;
}): Promise<void> {
  try {
    await db.insert(acmdBetaInviteRedemptionLog).values({
      tokenAttempted: params.tokenAttempted.slice(0, 256),
      email: params.email ? params.email.slice(0, 255) : null,
      ip: params.ip,
      userAgent: params.userAgent ?? null,
      result: params.result,
      httpStatus: params.httpStatus,
      waitlistId: params.waitlistId ?? null,
    });
  } catch (err) {
    console.error('[beta-signup] failed to write redemption log', {
      result: params.result,
      ip: params.ip,
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
}

/** Read the current cap from acmd.app_config. Falls back to BETA_CAP_DEFAULT. */
async function readBetaCap(): Promise<number> {
  const rows = await db
    .select({ value: acmdAppConfig.value })
    .from(acmdAppConfig)
    .where(eq(acmdAppConfig.key, BETA_CAP_KEY))
    .limit(1);
  if (rows.length === 0) return BETA_CAP_DEFAULT;
  const parsed = Number.parseInt(rows[0]!.value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn('[beta-signup] beta_cap_current is not a non-negative integer', {
      value: rows[0]!.value,
    });
    return BETA_CAP_DEFAULT;
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// Body schema
// ─────────────────────────────────────────────────────────────────────────

const betaSignupBodySchema = z.object({
  token: z.string().min(1).max(256),
  email: z.string().email().max(255),
  // Accepted for FE compat but ignored — acmd.users.name is set on /me claim
  // from the user's profile (typed during onboarding), not from beta-signup.
  name: z.string().min(1).max(255).optional(),
  companyName: z.string().min(1).max(255).optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// Rate limit (mentor3 C1: 5 attempts / IP / hour)
// ─────────────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

/**
 * Rate limiter for POST /api/v1/beta-signup — 5 attempts per IP per hour.
 *
 * `handler` is invoked when the limit fires (Hono short-circuits to it before
 * the route handler). We use the hook to write an audit row with
 * result='rate_limited' + http_status=429 so the C2 audit log captures
 * blocked attempts too.
 *
 * keyGenerator uses getTrustedClientIp() so spoofed X-Forwarded-For headers
 * cannot mint fresh rate-limit keys (T-065 SEC-001 fix).
 */
export const betaSignupRateLimit = rateLimiter({
  windowMs: HOUR_MS,
  limit: 5,
  standardHeaders: 'draft-6',
  keyGenerator: (c) => getTrustedClientIp(c),
  message: { error: 'Too many requests', retryAfter: 3600 },
  // Body might still be present but route handler hasn't parsed it yet — log
  // a placeholder token_attempted so the row passes the NOT NULL constraint.
  handler: async (c) => {
    const ip = getTrustedClientIp(c);
    await writeRedemptionLog({
      tokenAttempted: 'rate_limited',
      email: null,
      ip,
      userAgent: c.req.header('user-agent'),
      result: 'rate_limited',
      httpStatus: 429,
    });
    return c.json({ error: 'Too many requests', retryAfter: 3600 }, 429);
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

const betaSignup = new Hono();

betaSignup.post('/', betaSignupRateLimit, async (c) => {
  const ip = getTrustedClientIp(c);
  const userAgent = c.req.header('user-agent');

  // 0. Parse body. Audit malformed payloads as 'invalid' so we can spot
  //    misbehaving clients in the log.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    await writeRedemptionLog({
      tokenAttempted: '',
      email: null,
      ip,
      userAgent,
      result: 'invalid',
      httpStatus: 400,
    });
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = betaSignupBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    // Body shape wrong — try to capture token_attempted if it was a string.
    const maybeToken =
      typeof (rawBody as { token?: unknown })?.token === 'string'
        ? ((rawBody as { token: string }).token).slice(0, 256)
        : '';
    const maybeEmail =
      typeof (rawBody as { email?: unknown })?.email === 'string'
        ? ((rawBody as { email: string }).email).slice(0, 255)
        : null;
    await writeRedemptionLog({
      tokenAttempted: maybeToken,
      email: maybeEmail,
      ip,
      userAgent,
      result: 'invalid',
      httpStatus: 400,
    });
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
  }

  const { token, email } = parsed.data;
  // Normalize email so /me's later claim lookup matches case-insensitively.
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Token exists?
  const tokenRows = await db
    .select({
      id: acmdBetaInviteToken.id,
      token: acmdBetaInviteToken.token,
      expiresAt: acmdBetaInviteToken.expiresAt,
      usedAt: acmdBetaInviteToken.usedAt,
    })
    .from(acmdBetaInviteToken)
    .where(eq(acmdBetaInviteToken.token, token))
    .limit(1);

  if (tokenRows.length === 0) {
    await writeRedemptionLog({
      tokenAttempted: token,
      email: normalizedEmail,
      ip,
      userAgent,
      result: 'invalid',
      httpStatus: 400,
    });
    return c.json({ error: 'Invalid invite token' }, 400);
  }

  const tokenRow = tokenRows[0]!;

  // 2. Expired?
  if (tokenRow.expiresAt.getTime() <= Date.now()) {
    await writeRedemptionLog({
      tokenAttempted: token,
      email: normalizedEmail,
      ip,
      userAgent,
      result: 'expired',
      httpStatus: 400,
    });
    return c.json({ error: 'Invite token has expired' }, 400);
  }

  // 3. Already used?
  if (tokenRow.usedAt !== null) {
    await writeRedemptionLog({
      tokenAttempted: token,
      email: normalizedEmail,
      ip,
      userAgent,
      result: 'used',
      httpStatus: 400,
    });
    return c.json({ error: 'Invite token has already been used' }, 400);
  }

  // 4. Capacity? Cap from app_config. Count tokens with non-null used_at.
  const cap = await readBetaCap();
  const [{ usedCount }] = await db
    .select({ usedCount: sql<number>`COUNT(*)::int` })
    .from(acmdBetaInviteToken)
    .where(sql`${acmdBetaInviteToken.usedAt} IS NOT NULL`);

  if (usedCount >= cap) {
    // Insert waitlist row first so we can link it on the audit log.
    let waitlistId: string | null = null;
    try {
      const [waitlistRow] = await db
        .insert(acmdBetaWaitlist)
        .values({ email: normalizedEmail, source: 'beta_full' })
        .returning({ id: acmdBetaWaitlist.id });
      waitlistId = waitlistRow?.id ?? null;
    } catch (err) {
      console.error('[beta-signup] failed to insert waitlist row', {
        message: err instanceof Error ? err.message : 'unknown',
      });
    }

    await writeRedemptionLog({
      tokenAttempted: token,
      email: normalizedEmail,
      ip,
      userAgent,
      result: 'capacity_full',
      httpStatus: 202,
      waitlistId,
    });

    return c.json(
      {
        status: 'waitlisted',
        message: 'Beta full — added to waitlist',
        waitlistId,
      },
      202,
    );
  }

  // 5. Happy path — atomic redeem inside a transaction:
  //    a) re-check used_at so two concurrent redemptions of the same token
  //       don't both succeed
  //    b) UPDATE beta_invite_token SET used_at WHERE id = token.id
  //       AND used_at IS NULL (race-safe — only one writer wins)
  //
  // T-065: NO acmd.users / acmd.companies INSERT here. The user row is
  // created later by GET /me on the invitee's first Google login, when
  // we finally know JWT.sub (RS-013 invariant: acmd.users.id === JWT.sub).
  // used_by stays NULL until the /me claim path UPDATEs it.
  try {
    await db.transaction(async (tx) => {
      // Re-check used_at inside the tx so two concurrent redemptions of the
      // same token don't both succeed.
      const [latest] = await tx
        .select({
          id: acmdBetaInviteToken.id,
          usedAt: acmdBetaInviteToken.usedAt,
        })
        .from(acmdBetaInviteToken)
        .where(eq(acmdBetaInviteToken.id, tokenRow.id))
        .limit(1);

      if (!latest || latest.usedAt !== null) {
        // Surface as 'used' to the caller — another redemption beat us to it.
        throw new BetaTokenAlreadyUsedError();
      }

      // Atomic redeem: only succeeds while used_at IS NULL. used_by stays
      // NULL — it gets set on first Google login (see /me claim path).
      const updated = await tx
        .update(acmdBetaInviteToken)
        .set({
          usedAt: new Date(),
        })
        .where(
          and(
            eq(acmdBetaInviteToken.id, tokenRow.id),
            sql`${acmdBetaInviteToken.usedAt} IS NULL`,
          ),
        )
        .returning({ id: acmdBetaInviteToken.id });

      if (updated.length === 0) {
        throw new BetaTokenAlreadyUsedError();
      }
    });
  } catch (err) {
    if (err instanceof BetaTokenAlreadyUsedError) {
      await writeRedemptionLog({
        tokenAttempted: token,
        email: normalizedEmail,
        ip,
        userAgent,
        result: 'used',
        httpStatus: 400,
      });
      return c.json({ error: 'Invite token has already been used' }, 400);
    }
    console.error('[beta-signup] redemption tx failed', {
      ip,
      message: err instanceof Error ? err.message : 'unknown',
    });
    await writeRedemptionLog({
      tokenAttempted: token,
      email: normalizedEmail,
      ip,
      userAgent,
      result: 'invalid',
      httpStatus: 500,
    });
    return c.json({ error: 'Beta signup failed' }, 500);
  }

  await writeRedemptionLog({
    tokenAttempted: token,
    email: normalizedEmail,
    ip,
    userAgent,
    result: 'success',
    httpStatus: 200,
  });

  // T-065: success response no longer carries userId / companyId — those
  // don't exist yet. The FE shows "check your email + sign in with Google"
  // and the user/company rows materialize on /me's first hit.
  return c.json(
    {
      status: 'redeemed',
      message: 'Invite accepted — sign in with Google to finish setup',
    },
    200,
  );
});

/** Sentinel for the race-loss path inside the redemption transaction. */
class BetaTokenAlreadyUsedError extends Error {
  constructor() {
    super('Beta invite token already used');
    this.name = 'BetaTokenAlreadyUsedError';
  }
}

export { betaSignup as betaSignupRoutes };
