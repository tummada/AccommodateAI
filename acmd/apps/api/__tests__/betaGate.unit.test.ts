/**
 * T-101 — Unit tests for apps/api/src/services/betaGate.ts.
 *
 * Per review A-003 / B-004: the bypass predicate is security-critical and
 * was duplicated in two route files in Round 1. After extraction, this test
 * keeps the predicate provably consistent across call sites.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';

// betaGate imports @acmd/db for hasUnclaimedBetaRedemption — stub the table
// + db.select chain. We don't exercise the DB path in this file (the route
// tests cover that integration). isOwnerEmail is the focus here.
vi.mock('@acmd/db', () => ({
  db: { select: vi.fn() },
  acmdBetaInviteRedemptionLog: {
    id: { name: 'id' },
    email: { name: 'email' },
    result: { name: 'result' },
    claimedUserId: { name: 'claimed_user_id' },
  },
}));

describe('betaGate.isOwnerEmail', () => {
  // Reload the module per test so config picks up the freshly-set env var.
  // (config.ts caches process.env via the singleton object.)
  async function loadIsOwnerEmail(envValue: string | undefined) {
    if (envValue === undefined) {
      delete process.env['ACMD_OWNER_EMAIL'];
    } else {
      process.env['ACMD_OWNER_EMAIL'] = envValue;
    }
    vi.resetModules();
    const mod = await import('../src/services/betaGate.js');
    return mod.isOwnerEmail;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true on exact match', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('owner@example.com');
    expect(isOwnerEmail('owner@example.com')).toBe(true);
  });

  it('returns true on case-insensitive match', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('OWNER@Example.COM');
    expect(isOwnerEmail('owner@example.com')).toBe(true);
    expect(isOwnerEmail('Owner@Example.com')).toBe(true);
  });

  it('returns true after trimming whitespace on both sides', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('  owner@example.com  ');
    expect(isOwnerEmail('owner@example.com')).toBe(true);
    expect(isOwnerEmail('  owner@example.com\n')).toBe(true);
  });

  it('returns false on non-match', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('owner@example.com');
    expect(isOwnerEmail('attacker@example.com')).toBe(false);
  });

  it('returns false when owner env is empty', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('');
    expect(isOwnerEmail('owner@example.com')).toBe(false);
  });

  it('returns false when owner env is unset', async () => {
    const isOwnerEmail = await loadIsOwnerEmail(undefined);
    expect(isOwnerEmail('owner@example.com')).toBe(false);
  });

  it('returns false when JWT email is empty', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('owner@example.com');
    expect(isOwnerEmail('')).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });

  it('returns false when both empty (no double-empty match)', async () => {
    const isOwnerEmail = await loadIsOwnerEmail('');
    expect(isOwnerEmail('')).toBe(false);
  });
});

// T-101 R3 (A-R2-004 ACCEPT) — cover the DB-error fail-closed path. The
// route-level tests do not exercise this path because they stub the query
// chain to return rows; only here can we make `db.select` throw.
describe('betaGate.hasUnclaimedBetaRedemption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns false when db.select throws (DB error → fail-closed)', async () => {
    process.env['ACMD_OWNER_EMAIL'] = 'owner@example.com';
    const dbModule = await import('@acmd/db');
    vi.mocked(dbModule.db.select).mockImplementationOnce(() => {
      throw new Error('simulated db connection failure');
    });
    const { hasUnclaimedBetaRedemption } = await import(
      '../src/services/betaGate.js'
    );
    const result = await hasUnclaimedBetaRedemption('user@example.com');
    expect(result).toBe(false);
  });

  it('returns false on empty/null/undefined input without touching db', async () => {
    const dbModule = await import('@acmd/db');
    const selectSpy = vi.mocked(dbModule.db.select);
    selectSpy.mockClear();
    const { hasUnclaimedBetaRedemption } = await import(
      '../src/services/betaGate.js'
    );
    expect(await hasUnclaimedBetaRedemption('')).toBe(false);
    expect(await hasUnclaimedBetaRedemption(null)).toBe(false);
    expect(await hasUnclaimedBetaRedemption(undefined)).toBe(false);
    expect(selectSpy).not.toHaveBeenCalled();
  });
});
