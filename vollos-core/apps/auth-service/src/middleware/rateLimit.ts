// rateLimit.ts — Per-IP rate limiting middleware for auth-service
//
// T-021: Adds IP-based rate limits to the auth-service endpoint groups that
// currently lack one (only /auth/google and /auth/refresh have inline limits
// inside @vollos/auth; /auth/logout, /me, /onboarding, /auth/google/callback
// do not). This module provides path-level limiters wired from index.ts so
// the limits apply BEFORE the route handler is invoked — consistent with the
// vollos-api pattern in apps/api/src/middleware/rateLimit.ts.
//
// Design choices:
//   - getTrustedIp: reads the LAST entry from x-forwarded-for (Caddy appends
//     the real client IP at the tail). Mirrors apps/api/src/middleware/
//     rateLimit.ts — single source of truth for IP extraction. Any upstream
//     hop appends; only the trailing entry is attacker-controlled-proof
//     because it was written by our Caddy proxy.
//   - Memory store (hono-rate-limiter default). Redis upgrade deferred to a
//     later task (see task.md Forbidden). For a single-container auth-service
//     instance this is fine; horizontal scale will need a shared store.
//   - standardHeaders: 'draft-6' emits RateLimit-Policy / RateLimit-Limit /
//     RateLimit-Remaining / RateLimit-Reset on every response AND Retry-After
//     on 429 responses (verified via hono-rate-limiter@0.5.3 dist/index.js).
//   - 429 body shape: { error: 'Too many requests', retryAfter: <seconds> }
//     consistent with @vollos/auth/src/rateLimit.ts so clients can share code.
//
// NOTE: /auth/google and /auth/refresh already carry an inline limiter inside
// packages/auth/src/rateLimit.ts (10/min and 30/min respectively). The path-
// level limiter here runs FIRST — whichever limit is tighter wins. T-021
// stricter bucket (5-minute window) is the outer gate; the inline per-minute
// limiter stays as defence-in-depth.

import type { Context, MiddlewareHandler } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';

// IPv4 / IPv6 sanity check — same regex as apps/api/src/middleware/rateLimit.ts
const IP_REGEX = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{2,39})$/;

/**
 * Extract the trusted client IP from the `x-forwarded-for` header.
 *
 * Caddy (our reverse proxy) is configured to append the real client IP at
 * the END of the header. Any other entries earlier in the list were supplied
 * by clients upstream and are NOT trusted.
 *
 * Returns `'unknown'` if the header is missing or malformed so that all
 * untagged traffic shares a single rate-limit bucket (fail-closed, not
 * fail-open per IP).
 */
export function getTrustedIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const candidate = forwarded.split(',').at(-1)!.trim();
  return IP_REGEX.test(candidate) ? candidate : 'unknown';
}

// ─── Factory ────────────────────────────────────────────────────────────────

interface CreateIpRateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests per IP per window. */
  limit: number;
  /** Bucket prefix so limiters with different windows do not collide. */
  bucket: string;
}

/**
 * Create a per-IP rate-limit middleware.
 *
 * Each limiter gets its own in-memory store (hono-rate-limiter default)
 * keyed by `${bucket}:${trustedIp}` so that e.g. the /me and /onboarding
 * buckets count independently.
 */
export function createIpRateLimiter(
  opts: CreateIpRateLimiterOptions,
): MiddlewareHandler {
  const windowSeconds = Math.ceil(opts.windowMs / 1000);
  return rateLimiter({
    windowMs: opts.windowMs,
    limit: opts.limit,
    // draft-6 emits RateLimit-* headers AND Retry-After on 429 — verified
    // in hono-rate-limiter@0.5.3/dist/index.js line 33:
    //   context.header("Retry-After", resetSeconds?.toString())
    standardHeaders: 'draft-6',
    keyGenerator: (c) => `${opts.bucket}:${getTrustedIp(c)}`,
    message: { error: 'Too many requests', retryAfter: windowSeconds },
  });
}

// ─── Concrete limiters ──────────────────────────────────────────────────────
// Limits come from T-021 task.md. Window = 5 minutes across the board so the
// bucket resets at the same cadence as the user's typical interactive
// session. Values are conservative — can be loosened later from telemetry.

const FIVE_MIN_MS = 5 * 60 * 1000;

/** POST /auth/refresh — token refresh, 30 req / 5 min per IP. */
export const refreshRateLimiter: MiddlewareHandler = createIpRateLimiter({
  windowMs: FIVE_MIN_MS,
  limit: 30,
  bucket: 'auth-refresh',
});

/** GET /auth/google/callback — OAuth redirect landing, 20 req / 5 min per IP. */
export const googleCallbackRateLimiter: MiddlewareHandler = createIpRateLimiter(
  {
    windowMs: FIVE_MIN_MS,
    limit: 20,
    bucket: 'auth-google-callback',
  },
);

/** POST /auth/logout — session end, 20 req / 5 min per IP. */
export const logoutRateLimiter: MiddlewareHandler = createIpRateLimiter({
  windowMs: FIVE_MIN_MS,
  limit: 20,
  bucket: 'auth-logout',
});

/** GET /me — user info, 60 req / 5 min per IP (higher: client polls on nav). */
export const meRateLimiter: MiddlewareHandler = createIpRateLimiter({
  windowMs: FIVE_MIN_MS,
  limit: 60,
  bucket: 'me',
});

/** POST /onboarding — first-login flow, 20 req / 5 min per IP. */
export const onboardingRateLimiter: MiddlewareHandler = createIpRateLimiter({
  windowMs: FIVE_MIN_MS,
  limit: 20,
  bucket: 'onboarding',
});
