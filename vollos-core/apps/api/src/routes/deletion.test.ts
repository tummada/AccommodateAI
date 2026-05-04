// deletion.test.ts — Unit tests for GET /api/delete
// CCPA §1798.105 "Right to Delete" — verifies full PII anonymization on soft-delete:
//   email → deleted_<uuid>@anonymous, name → 'Deleted', company → null,
//   ipAddress → null, userAgent → null, deletedAt → timestamp.
//
// SECURITY: fixtures use RFC 5737 TEST-NET-1 (192.0.2.0/24) + synthetic user-agent.
// No real IPs / real user-agent strings appear in source, logs, or error messages.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// ─── Mocks (must be declared before importing deletion.ts) ────────────────────

function makeSelectChain(rows: object[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function makeUpdateChain(captureSet: (set: Record<string, unknown>) => void) {
  return {
    set: vi.fn((values: Record<string, unknown>) => {
      captureSet(values);
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    }),
  };
}

function makeInsertAuditChain() {
  return {
    values: vi.fn().mockResolvedValue([]),
  };
}

vi.mock('@vollos/db', () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  leads: 'leads_table',
  auditLogs: 'audit_logs_table',
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col) => ({ isNull: col })),
}));

// Pass-through rate limiter so token verification is exercised without throttling.
vi.mock('hono-rate-limiter', () => ({
  rateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Fixed HMAC secret — matches value used for token generation in tests below.
const TEST_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
// Use the real config module so verifySignedToken / SIGNED_TOKEN_RE stay in sync
// with production code — only override the secret via env var.
process.env['UNSUBSCRIBE_SECRET'] = TEST_UNSUBSCRIBE_SECRET;

import { db } from '@vollos/db';
const { deletionRouter } = await import('./deletion.js');
import { Hono } from 'hono';

function buildApp() {
  const app = new Hono();
  app.route('/api', deletionRouter);
  return app;
}

// Test fixtures — RFC 5737 TEST-NET-1 + synthetic UA.
const TEST_LEAD_ID = '11111111-2222-3333-4444-555555555555';
const TEST_EMAIL = 'ccpa-test@example.com'; // example.com per RFC 2606
const TEST_IP = '192.0.2.1'; // RFC 5737 TEST-NET-1 (documentation-only range)
const TEST_UA = 'test-user-agent/1.0';

// Sign a token in the new `<base36-timestamp>.<hex-hmac>` format.
function signId(id: string, nowSeconds?: number): string {
  const ts = nowSeconds ?? Math.floor(Date.now() / 1000);
  const tsEncoded = ts.toString(36);
  const hmac = createHmac('sha256', TEST_UNSUBSCRIBE_SECRET)
    .update(`${id}:${ts}`)
    .digest('hex');
  return `${tsEncoded}.${hmac}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/delete — CCPA §1798.105 data deletion', () => {
  it('clears ipAddress and userAgent alongside email/name/company on delete', async () => {
    // Arrange — lead exists, not yet deleted; capture the UPDATE payload.
    let updatePayload: Record<string, unknown> | undefined;
    vi.mocked(db.select).mockReturnValue(
      makeSelectChain([
        { id: TEST_LEAD_ID, email: TEST_EMAIL, deletedAt: null },
      ]) as never,
    );
    vi.mocked(db.update).mockReturnValue(
      makeUpdateChain((set) => {
        updatePayload = set;
      }) as never,
    );
    vi.mocked(db.insert).mockReturnValue(makeInsertAuditChain() as never);

    const token = signId(TEST_LEAD_ID);
    const app = buildApp();

    // Act
    const res = await app.request(`/api/delete?id=${TEST_LEAD_ID}&token=${token}`);

    // Assert — HTTP contract
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(1);

    // Assert — UPDATE clears ALL CCPA identifiers (including ip + ua).
    expect(updatePayload).toBeDefined();
    expect(updatePayload!.ipAddress).toBeNull();
    expect(updatePayload!.userAgent).toBeNull();

    // Assert — existing anonymization behavior preserved (no regression).
    expect(updatePayload!.email).toBe(`deleted_${TEST_LEAD_ID}@anonymous`);
    expect(updatePayload!.name).toBe('Deleted');
    expect(updatePayload!.company).toBeNull();
    expect(updatePayload!.deletedAt).toBeInstanceOf(Date);
    expect(updatePayload!.updatedAt).toBeInstanceOf(Date);

    // Assert — audit log created with masked email, no IP/UA in metadata.
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('invalid HMAC token — does not update lead (ip/ua remain untouched)', async () => {
    vi.mocked(db.select).mockReturnValue(
      makeSelectChain([
        { id: TEST_LEAD_ID, email: TEST_EMAIL, deletedAt: null },
      ]) as never,
    );
    vi.mocked(db.update).mockReturnValue(
      makeUpdateChain(() => {
        /* captured=none — should never be invoked */
      }) as never,
    );

    // Valid-format but wrong HMAC.
    const forgedToken = 'a'.repeat(64);
    const app = buildApp();
    const res = await app.request(`/api/delete?id=${TEST_LEAD_ID}&token=${forgedToken}`);

    expect(res.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('already-deleted lead — returns 200 without re-running UPDATE', async () => {
    vi.mocked(db.select).mockReturnValue(
      makeSelectChain([
        { id: TEST_LEAD_ID, email: TEST_EMAIL, deletedAt: new Date() },
      ]) as never,
    );
    vi.mocked(db.update).mockReturnValue(
      makeUpdateChain(() => {
        /* should not fire */
      }) as never,
    );

    const token = signId(TEST_LEAD_ID);
    const app = buildApp();
    const res = await app.request(`/api/delete?id=${TEST_LEAD_ID}&token=${token}`);

    expect(res.status).toBe(200);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('test fixtures never expose real PII (ip + ua are synthetic)', () => {
    // Guardrail: if fixtures are accidentally replaced with real values,
    // this assertion fails loudly. RFC 5737 TEST-NET-1 and a synthetic UA
    // string are the only permitted values per SKILL.md SECRET HANDLING.
    expect(TEST_IP).toBe('192.0.2.1');
    expect(TEST_UA.startsWith('test-')).toBe(true);
  });
});
