// turnstileReplayCache.ts — In-memory replay-prevention cache for Turnstile tokens
//
// Defense-in-depth against Turnstile token replay attacks (audit MEDIUM-6).
// Cloudflare Turnstile tokens remain valid for 5 minutes from issue. While Cloudflare's
// siteverify is supposed to reject reuse, a narrow race window exists where two
// simultaneous verify calls of the same token may both succeed. We track tokens
// ourselves to close that window.
//
// Design — In-memory Map (NOT Redis):
//   - Single API instance currently; no horizontal scaling yet.
//   - Adding Redis = new infra dependency + deploy complexity for limited marginal benefit.
//   - When we scale horizontally → revisit with Redis + atomic SETNX or pub/sub.
//
// Residual risk:
//   - Process restart clears the cache → replay window re-opens for ≤ ttlSeconds (5 min).
//     Acceptable in validate mode. Document in output.md.
//
// Security notes:
//   - We store sha256(token) rather than the raw token — avoids keeping sensitive
//     material in memory longer than necessary.
//   - sweepExpired() runs opportunistically on every markUsed() call. This keeps the
//     Map bounded by live requests without needing setInterval (which would keep the
//     event loop alive and complicate tests).

import { createHash } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes — matches Turnstile token validity window

// tokenHash (hex sha256) → expiresAt (epoch ms)
const seen = new Map<string, number>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mark a token as consumed. Subsequent calls to `isUsed(token)` within the TTL
 * window will return true.
 *
 * Call this AFTER Cloudflare siteverify succeeds. Never mark a token that
 * siteverify rejected — the attacker could otherwise cause legitimate users'
 * future tokens to be locked out.
 */
export function markUsed(token: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
  const h = hashToken(token);
  seen.set(h, Date.now() + ttlSeconds * 1000);
  sweepExpired();
}

/**
 * Check whether a token has already been consumed within the TTL window.
 * Returns false for unknown tokens and for tokens whose TTL has elapsed
 * (expired entries are cleaned up lazily on read).
 */
export function isUsed(token: string): boolean {
  const h = hashToken(token);
  const expires = seen.get(h);
  if (expires === undefined) return false;
  if (expires < Date.now()) {
    seen.delete(h);
    return false;
  }
  return true;
}

/**
 * Remove all expired entries from the cache. Called automatically on every
 * `markUsed()` invocation. Exposed for tests and operational clarity.
 */
export function sweepExpired(): void {
  const now = Date.now();
  for (const [h, exp] of seen) {
    if (exp < now) seen.delete(h);
  }
}

/**
 * Test-only helper: wipe the cache between test cases.
 * Do NOT call in production code paths.
 */
export function _resetForTests(): void {
  seen.clear();
}
