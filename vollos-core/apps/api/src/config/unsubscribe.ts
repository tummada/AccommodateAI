// unsubscribe.ts — Shared UNSUBSCRIBE_SECRET config + signed-timestamp token helpers
// Fail-fast at startup if secret is missing — prevents silent empty-string HMAC bypass
//
// Token format: `<timestamp>.<hmac>` where
//   timestamp = Unix seconds at issue time, base36 encoded
//   hmac      = HMAC-SHA256(UNSUBSCRIBE_SECRET, "<leadId>:<timestamp>"), hex-encoded, lowercased
//
// Tokens expire after TOKEN_TTL_SECONDS (30 days) to limit the damage window if
// an email inbox is compromised years later. Breaking change (2026-04-20): pre-existing
// plain-HMAC tokens from older emails are rejected — owner confirmed no production
// emails with real users depend on them yet.

import { createHmac, timingSafeEqual } from 'node:crypto';

const _secret = process.env['UNSUBSCRIBE_SECRET'];
if (!_secret) throw new Error('[unsubscribe] UNSUBSCRIBE_SECRET is not set');

export const UNSUBSCRIBE_SECRET: string = _secret;

// ─── Token format constants ───────────────────────────────────────────────────
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Regex for the signed token: <base36-timestamp>.<64-char-hex-hmac>
// Timestamp length: 1..12 base36 chars (covers Unix seconds well past year 9999).
// HMAC length: 64 hex chars (SHA-256 digest).
export const SIGNED_TOKEN_RE = /^[0-9a-z]{1,12}\.[0-9a-f]{64}$/;

// ─── Token generation ─────────────────────────────────────────────────────────
/**
 * Generate a signed unsubscribe/delete token for the given lead id.
 * Format: `<base36-unix-seconds>.<hex-hmac>` — HMAC covers "<leadId>:<timestamp>".
 */
export function generateSignedToken(leadId: string, nowSeconds?: number): string {
  const ts = nowSeconds ?? Math.floor(Date.now() / 1000);
  const tsEncoded = ts.toString(36);
  const hmac = createHmac('sha256', UNSUBSCRIBE_SECRET)
    .update(`${leadId}:${ts}`)
    .digest('hex');
  return `${tsEncoded}.${hmac}`;
}

// ─── Token verification ───────────────────────────────────────────────────────
/**
 * Verify a signed unsubscribe/delete token against a lead id.
 * Returns `true` iff: format matches, timestamp is within [now - 30 days, now],
 * and HMAC matches using constant-time comparison.
 *
 * Rejects: malformed tokens, expired tokens (> 30 days old), future timestamps,
 * tampered HMAC, wrong lead id.
 */
export function verifySignedToken(
  leadId: string,
  token: string,
  nowSeconds?: number,
): boolean {
  // 1. Format check — must match `<base36>.<hex>` with exactly one dot.
  if (!SIGNED_TOKEN_RE.test(token)) return false;

  // 2. Split on dot — guaranteed two parts by the regex above.
  const dotIdx = token.indexOf('.');
  const tsPart = token.slice(0, dotIdx);
  const hmacPart = token.slice(dotIdx + 1);

  // 3. Parse timestamp (base36) and reject non-finite / out-of-range values.
  const ts = parseInt(tsPart, 36);
  if (!Number.isFinite(ts) || ts < 0) return false;

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  // 4. Reject future-dated tokens (clock skew attack / forged future token).
  if (ts > now) return false;

  // 5. Reject tokens older than TTL.
  if (ts < now - TOKEN_TTL_SECONDS) return false;

  // 6. Recompute HMAC and compare in constant time.
  const expected = createHmac('sha256', UNSUBSCRIBE_SECRET)
    .update(`${leadId}:${ts}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacPart, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
