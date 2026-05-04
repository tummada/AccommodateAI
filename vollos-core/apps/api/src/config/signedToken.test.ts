// signedToken.test.ts — Unit tests for generateSignedToken / verifySignedToken
// T-039 — 30-day expiry for unsubscribe + CCPA-delete tokens.
//
// The 6 required cases live in the top-level `describe` so they are easy to audit:
//   1. valid token              — pass
//   2. expired token (31 days)  — reject
//   3. future timestamp         — reject
//   4. tampered HMAC            — reject
//   5. malformed token (no dot) — reject
//   6. valid token, wrong leadId — reject
//
// Secret is injected via env var *before* importing the module so the top-level
// `if (!_secret) throw` guard stays exercised.

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

const TEST_SECRET = 'test-signed-token-secret';
process.env['UNSUBSCRIBE_SECRET'] = TEST_SECRET;

const {
  generateSignedToken,
  verifySignedToken,
  TOKEN_TTL_SECONDS,
  SIGNED_TOKEN_RE,
} = await import('./unsubscribe.js');

const LEAD_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_LEAD_ID = '99999999-8888-7777-6666-555555555555';

// Convenience: sign against TEST_SECRET directly (mirrors generateSignedToken).
function rawSign(leadId: string, ts: number): string {
  const tsEncoded = ts.toString(36);
  const hmac = createHmac('sha256', TEST_SECRET)
    .update(`${leadId}:${ts}`)
    .digest('hex');
  return `${tsEncoded}.${hmac}`;
}

describe('generateSignedToken', () => {
  it('emits a token matching SIGNED_TOKEN_RE (<base36>.<64-hex>)', () => {
    const token = generateSignedToken(LEAD_ID);
    expect(SIGNED_TOKEN_RE.test(token)).toBe(true);
    // Hex HMAC length is exactly 64 chars (SHA-256).
    expect(token.split('.')[1]?.length).toBe(64);
  });

  it('is deterministic for a given (leadId, timestamp) pair', () => {
    const ts = 1_700_000_000;
    expect(generateSignedToken(LEAD_ID, ts)).toBe(generateSignedToken(LEAD_ID, ts));
    // And matches a hand-computed HMAC.
    expect(generateSignedToken(LEAD_ID, ts)).toBe(rawSign(LEAD_ID, ts));
  });
});

describe('verifySignedToken — required T-039 cases', () => {
  it('case 1 — valid token (fresh) → pass', () => {
    const now = 1_700_000_000;
    const token = rawSign(LEAD_ID, now);
    expect(verifySignedToken(LEAD_ID, token, now)).toBe(true);
    // Still valid 29 days later.
    expect(verifySignedToken(LEAD_ID, token, now + 29 * 24 * 60 * 60)).toBe(true);
    // And valid right up to the TTL boundary.
    expect(verifySignedToken(LEAD_ID, token, now + TOKEN_TTL_SECONDS)).toBe(true);
  });

  it('case 2 — expired token (31 days old) → reject', () => {
    const issuedAt = 1_700_000_000;
    const token = rawSign(LEAD_ID, issuedAt);
    const verifyAt = issuedAt + 31 * 24 * 60 * 60; // 31 days later
    expect(verifySignedToken(LEAD_ID, token, verifyAt)).toBe(false);
  });

  it('case 3 — future timestamp → reject', () => {
    const now = 1_700_000_000;
    const futureTs = now + 60; // 1 min in the future
    const token = rawSign(LEAD_ID, futureTs);
    expect(verifySignedToken(LEAD_ID, token, now)).toBe(false);
  });

  it('case 4 — tampered HMAC → reject', () => {
    const now = 1_700_000_000;
    const token = rawSign(LEAD_ID, now);
    const [tsPart, hmacPart] = token.split('.') as [string, string];
    // Flip the first hex char (wraps 'f' → '0').
    const flipped =
      hmacPart[0] === '0' ? `1${hmacPart.slice(1)}` : `0${hmacPart.slice(1)}`;
    const tampered = `${tsPart}.${flipped}`;
    expect(verifySignedToken(LEAD_ID, tampered, now)).toBe(false);
  });

  it('case 5 — malformed token (no dot) → reject', () => {
    const now = 1_700_000_000;
    // Legacy / raw HMAC-only shape — must not validate under the new scheme.
    const legacy = createHmac('sha256', TEST_SECRET).update(LEAD_ID).digest('hex');
    expect(verifySignedToken(LEAD_ID, legacy, now)).toBe(false);
    // Other shapes that also fail format: empty, dotless garbage, too many dots.
    expect(verifySignedToken(LEAD_ID, '', now)).toBe(false);
    expect(verifySignedToken(LEAD_ID, 'not-a-token', now)).toBe(false);
    expect(verifySignedToken(LEAD_ID, 'a.b.c', now)).toBe(false);
  });

  it('case 6 — valid token but wrong leadId → reject', () => {
    const now = 1_700_000_000;
    const token = rawSign(LEAD_ID, now); // signed for LEAD_ID
    expect(verifySignedToken(OTHER_LEAD_ID, token, now)).toBe(false);
  });
});
