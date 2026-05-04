/**
 * T-063 + T-065 — POST /api/v1/beta-signup tests.
 *
 * T-065 (deferred-claim refactor):
 *   beta-signup no longer creates acmd.users / acmd.companies. It only
 *   marks the token used and records the email on the redemption log.
 *   user/company creation is deferred to GET /me on first Google login.
 *
 * Cases covered:
 *   1. happy path     → 200 redeemed   + redemption_log row (success / 200)
 *                       AND no acmd.users INSERT (T-065 R02a)
 *   2. invalid token  → 400 invalid     + redemption_log row (invalid / 400)
 *   3. expired token  → 400 expired     + redemption_log row (expired / 400)
 *   4. used token     → 400 used        + redemption_log row (used / 400)
 *   5. capacity full  → 202 waitlisted  + waitlist row + redemption_log row
 *                                          (capacity_full / 202 / waitlist_id linked)
 *   6. cap = 1 read from app_config (Rolling Cap D14) — first redeem succeeds,
 *      second hits capacity_full (no hardcoded 20)
 *   7. invalid body   → 400 + redemption_log invalid
 *   8. rate limited   → 6th attempt from same IP returns 429 + redemption_log
 *      row with result='rate_limited' / http_status=429
 *   R01 (T-065): two consecutive successful signups (different tokens, no
 *      Google login between) — both succeed; no google_id='' UNIQUE collision
 *   R03a (T-065): XFF=1.1.1.1 from untrusted source → uses peer IP, rate
 *      limit bucket counts spoofed XFF as one peer
 *   R03b (T-065): XFF=1.1.1.1 from trusted-CIDR peer → trusts XFF, counts
 *      1.1.1.1 as the rate-limit key
 *
 * The tests mock @acmd/db end-to-end so they run in-process (no PG needed).
 * The mock state can be flipped per test to exercise each branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ───────────────────────────────────────────────────────────────────────────
// Env stubs
// ───────────────────────────────────────────────────────────────────────────
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['VITEST'] = 'true';
process.env['ACMD_OWNER_EMAIL'] = 'pon@vollos.ai';

// ───────────────────────────────────────────────────────────────────────────
// Test state — flipped per case via the mockState below.
// ───────────────────────────────────────────────────────────────────────────

type MockTokenRow = {
  id: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
};

const mockState: {
  tokens: MockTokenRow[];
  cap: number | null; // null means "key missing" → fallback to default
  usedCount: number;
  appConfigKey: string;
  insertWaitlistThrows: boolean;
  insertedWaitlist: Array<{ id: string; email: string; source: string }>;
  insertedRedemptionLogs: Array<{
    tokenAttempted: string;
    email: string | null;
    ip: string;
    userAgent: string | null;
    result: string;
    httpStatus: number;
    waitlistId: string | null;
  }>;
  txWillRaceLose: boolean; // simulate concurrent redemption — used path
  txInserts: Array<{ table: string; values: unknown }>;
  txUpdates: Array<{ table: string; set: unknown }>;
  upsertedConfig: Array<{ key: string; value: string }>;
} = {
  tokens: [],
  cap: 20,
  usedCount: 0,
  appConfigKey: 'beta_cap_current',
  insertWaitlistThrows: false,
  insertedWaitlist: [],
  insertedRedemptionLogs: [],
  txWillRaceLose: false,
  txInserts: [],
  txUpdates: [],
  upsertedConfig: [],
};

let waitlistAutoId = 0;

// ───────────────────────────────────────────────────────────────────────────
// @acmd/db mock
// ───────────────────────────────────────────────────────────────────────────

vi.mock('@acmd/db', () => {
  const acmdBetaInviteToken = {
    __tableName: 'beta_invite_token',
    id: { name: 'id' },
    token: { name: 'token' },
    expiresAt: { name: 'expires_at' },
    usedAt: { name: 'used_at' },
    usedBy: { name: 'used_by' },
  };
  const acmdBetaWaitlist = {
    __tableName: 'beta_waitlist',
    id: { name: 'id' },
    email: { name: 'email' },
    source: { name: 'source' },
  };
  const acmdBetaInviteRedemptionLog = {
    __tableName: 'beta_invite_redemption_log',
    id: { name: 'id' },
    tokenAttempted: { name: 'token_attempted' },
    email: { name: 'email' },
    ip: { name: 'ip' },
    userAgent: { name: 'user_agent' },
    result: { name: 'result' },
    httpStatus: { name: 'http_status' },
    waitlistId: { name: 'waitlist_id' },
    claimedUserId: { name: 'claimed_user_id' },
    claimedAt: { name: 'claimed_at' },
    createdAt: { name: 'created_at' },
  };
  const acmdAppConfig = {
    __tableName: 'app_config',
    key: { name: 'key' },
    value: { name: 'value' },
    updatedAt: { name: 'updated_at' },
  };
  const acmdUsers = {
    __tableName: 'users',
    id: { name: 'id' },
    email: { name: 'email' },
    companyId: { name: 'company_id' },
    role: { name: 'role' },
    name: { name: 'name' },
    googleId: { name: 'google_id' },
  };
  const acmdCompanies = {
    __tableName: 'companies',
    id: { name: 'id' },
    onboardingCompletedAt: { name: 'onboarding_completed_at' },
  };
  const acmdAuditLogs = { __tableName: 'audit_logs' };
  const acmdRefreshTokens = { __tableName: 'refresh_tokens' };

  // Token name extraction helper.
  function tableName(t: unknown): string {
    return (t as { __tableName?: string })?.__tableName ?? 'unknown';
  }

  // ── db.select chain (top-level reads) ───────────────────────────────────
  function dbSelect(_cols?: unknown) {
    return {
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: (_w: unknown) => ({
            limit: (_n: number) => {
              if (name === 'beta_invite_token') {
                // Lookup by token string — we cheat and return the first row
                // (tests only seed one matching row) or empty.
                return Promise.resolve(mockState.tokens);
              }
              if (name === 'app_config') {
                if (mockState.cap === null) return Promise.resolve([]);
                return Promise.resolve([{ value: String(mockState.cap) }]);
              }
              return Promise.resolve([]);
            },
          }),
          // Used by capacity COUNT(*) query — no .where().limit() chain.
        };
      },
    };
  }

  // For the capacity count query: db.select({ usedCount: sql`COUNT(*)::int` })
  //                                 .from(acmdBetaInviteToken)
  //                                 .where(sql`used_at IS NOT NULL`);
  // The chain returns a Promise<[{ usedCount }]>.
  function capacitySelect() {
    return {
      from: (_table: unknown) => ({
        where: (_w: unknown) => Promise.resolve([{ usedCount: mockState.usedCount }]),
      }),
    };
  }

  let selectCallIdx = 0;
  const selectFn = vi.fn((cols?: unknown) => {
    selectCallIdx++;
    // Heuristic: capacity COUNT query is the only select that doesn't chain
    // .limit() — we identify it by the column shape.
    const looksLikeCount =
      typeof cols === 'object' && cols !== null && 'usedCount' in (cols as object);
    if (looksLikeCount) return capacitySelect();
    return dbSelect(cols);
  });

  // ── db.insert ───────────────────────────────────────────────────────────
  function dbInsert(table: unknown) {
    const name = tableName(table);
    return {
      values: vi.fn((v: unknown) => {
        if (name === 'beta_invite_redemption_log') {
          mockState.insertedRedemptionLogs.push(v as never);
          return Promise.resolve(undefined);
        }
        if (name === 'beta_waitlist') {
          if (mockState.insertWaitlistThrows) {
            return {
              returning: () => Promise.reject(new Error('waitlist insert simulated failure')),
            };
          }
          waitlistAutoId++;
          const newRow = {
            id: `waitlist-${waitlistAutoId}`,
            email: (v as { email: string }).email,
            source: (v as { source: string }).source,
          };
          mockState.insertedWaitlist.push(newRow);
          return {
            returning: () => Promise.resolve([{ id: newRow.id }]),
          };
        }
        if (name === 'app_config') {
          // PATCH /admin/config upsert path
          mockState.upsertedConfig.push(v as never);
          return {
            onConflictDoUpdate: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    key: (v as { key: string }).key,
                    value: (v as { value: string }).value,
                    updatedAt: new Date('2026-04-28T00:00:00Z'),
                  },
                ]),
            }),
          };
        }
        return Promise.resolve(undefined);
      }),
    };
  }

  // ── db.transaction ──────────────────────────────────────────────────────
  function dbTransaction(fn: (tx: unknown) => Promise<unknown>) {
    mockState.txInserts = [];
    mockState.txUpdates = [];

    const txSelectChain = (table: unknown) => ({
      where: () => ({
        limit: () => {
          const name = tableName(table);
          if (name === 'beta_invite_token') {
            // Race re-check — return the row with usedAt set if txWillRaceLose
            const row = mockState.tokens[0];
            if (!row) return Promise.resolve([]);
            if (mockState.txWillRaceLose) {
              return Promise.resolve([{ id: row.id, usedAt: new Date() }]);
            }
            return Promise.resolve([{ id: row.id, usedAt: null }]);
          }
          return Promise.resolve([]);
        },
      }),
    });

    const tx = {
      select: vi.fn(() => ({ from: txSelectChain })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((v: unknown) => {
          const name = tableName(table);
          mockState.txInserts.push({ table: name, values: v });
          return {
            returning: () => {
              if (name === 'companies') {
                return Promise.resolve([{ id: 'company-uuid-' + Date.now() }]);
              }
              if (name === 'users') {
                const inserted = v as {
                  id?: string;
                  companyId: string;
                  email: string;
                  name: string;
                  role: string;
                };
                return Promise.resolve([
                  {
                    id: inserted.id ?? 'user-uuid-' + Date.now(),
                    companyId: inserted.companyId,
                    role: inserted.role,
                    email: inserted.email,
                    name: inserted.name,
                  },
                ]);
              }
              if (name === 'app_config') {
                return Promise.resolve([
                  {
                    key: (v as { key: string }).key,
                    value: (v as { value: string }).value,
                    updatedAt: new Date(),
                  },
                ]);
              }
              return Promise.resolve([]);
            },
            onConflictDoUpdate: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    key: (v as { key: string }).key,
                    value: (v as { value: string }).value,
                    updatedAt: new Date('2026-04-28T00:00:00Z'),
                  },
                ]),
            }),
            // writeAuditLog awaits values() directly.
            then: (resolve: (v: unknown) => void) => resolve(undefined),
          };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((v: unknown) => {
          const name = tableName(table);
          mockState.txUpdates.push({ table: name, set: v });
          if (name === 'beta_invite_token') {
            return {
              where: vi.fn(() => ({
                returning: () => {
                  if (mockState.txWillRaceLose) return Promise.resolve([]);
                  return Promise.resolve([{ id: mockState.tokens[0]?.id ?? 'tok' }]);
                },
              })),
            };
          }
          return {
            where: vi.fn(() => Promise.resolve(undefined)),
          };
        }),
      })),
    };

    return fn(tx);
  }

  return {
    db: {
      select: selectFn,
      insert: vi.fn(dbInsert),
      update: vi.fn(),
      transaction: vi.fn(dbTransaction),
    },
    acmdBetaInviteToken,
    acmdBetaWaitlist,
    acmdBetaInviteRedemptionLog,
    acmdAppConfig,
    acmdUsers,
    acmdCompanies,
    acmdAuditLogs,
    acmdRefreshTokens,
    setTenantContext: vi.fn(),
    clearTenantContext: vi.fn(),
  };
});

// ───────────────────────────────────────────────────────────────────────────
// @acmd/auth mock — beta-signup is public so the acmdTenantGuard is not used,
// but the module is imported transitively by index.ts so we still mock it.
// ───────────────────────────────────────────────────────────────────────────

vi.mock('@acmd/auth', () => ({
  verifyGoogleToken: vi.fn(),
  createTokens: vi.fn(),
  hashToken: vi.fn(),
  fetchJwks: vi.fn().mockResolvedValue({}),
  verifyAccessToken: vi.fn(),
  verifyAccessTokenRaw: vi.fn(),
  verifyRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  DEFAULT_ACCESS_TTL: 900,
  DEFAULT_REFRESH_TTL: 2592000,
  createAuthRoutes: vi.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Hono } = require('hono');
    return new Hono();
  }),
  tenantGuard: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      c.set('userId', 'token-sub-uuid');
      c.set('companyId', '');
      c.set('role', 'super_admin');
      c.set('product', 'acmd');
      c.set('authClaims', {
        sub: 'token-sub-uuid',
        company_id: '',
        role: 'super_admin',
        product: 'acmd',
        email: 'pon@vollos.ai',
        google_id: 'google-sub-123',
        products: ['acmd'],
        iat: 0,
        exp: 9999999999,
      });
      await next();
    }),
  requireRole: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_c: any, next: any) => next()),
  createTenantScope: vi.fn(() => ({})),
  googleAuthRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, next: any) => next()),
  refreshRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, next: any) => next()),
}));

// ───────────────────────────────────────────────────────────────────────────
// authService — real module.
// ───────────────────────────────────────────────────────────────────────────
vi.mock('../src/services/authService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/authService.js')
  >('../src/services/authService.js');
  return {
    ...actual,
    tokenCallbacks: {
      storeToken: vi.fn(),
      revokeToken: vi.fn(),
      isTokenRevoked: vi.fn(),
    },
  };
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function resetState(): void {
  mockState.tokens = [];
  mockState.cap = 20;
  mockState.usedCount = 0;
  mockState.insertWaitlistThrows = false;
  mockState.insertedWaitlist = [];
  mockState.insertedRedemptionLogs = [];
  mockState.txWillRaceLose = false;
  mockState.txInserts = [];
  mockState.txUpdates = [];
  mockState.upsertedConfig = [];
  waitlistAutoId = 0;
}

function makeBody(overrides: Partial<{
  token: string;
  email: string;
  name: string;
  companyName: string;
}> = {}): string {
  return JSON.stringify({
    token: 'invite-tok-1',
    email: 'beta@example.com',
    name: 'Beta User',
    ...overrides,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/beta-signup (T-063)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('B1: happy path — 200 + token redeemed + audit row success/200 (T-065 R02a: no users INSERT)', async () => {
    mockState.tokens = [
      {
        id: 'tok-1',
        token: 'invite-tok-1',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.usedCount = 0;
    mockState.cap = 20;

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.1',
      },
      body: makeBody(),
    });

    expect(res.status).toBe(200);
    // T-065: response no longer carries userId/companyId — those are
    // created by /me on first Google login.
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe('redeemed');
    expect(typeof body.message).toBe('string');

    // Token UPDATE happened — used_at set, used_by remains NULL (T-065).
    const tokenUpdate = mockState.txUpdates.find((u) => u.table === 'beta_invite_token');
    expect(tokenUpdate).toBeDefined();
    const set = tokenUpdate!.set as { usedBy?: string; usedAt?: Date };
    expect(set.usedAt).toBeInstanceOf(Date);
    // T-065 R02a: explicitly verify NO acmd.users INSERT happened in the tx.
    const userInsert = mockState.txInserts.find((i) => i.table === 'users');
    expect(userInsert).toBeUndefined();
    const companyInsert = mockState.txInserts.find((i) => i.table === 'companies');
    expect(companyInsert).toBeUndefined();
    // used_by is NOT set in the UPDATE under T-065.
    expect(set.usedBy).toBeUndefined();

    // Audit log row records the email so /me can find it on first login.
    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('success');
    expect(log?.httpStatus).toBe(200);
    expect(log?.tokenAttempted).toBe('invite-tok-1');
    expect(log?.email).toBe('beta@example.com');
    expect(log?.ip).toBe('203.0.113.1');
  });

  it('B2: invalid token → 400 + audit invalid/400', async () => {
    mockState.tokens = []; // no row found
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.2',
      },
      body: makeBody({ token: 'unknown-tok' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid/i);

    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('invalid');
    expect(log?.httpStatus).toBe(400);
    expect(log?.tokenAttempted).toBe('unknown-tok');
  });

  it('B3: expired token → 400 + audit expired/400', async () => {
    mockState.tokens = [
      {
        id: 'tok-2',
        token: 'invite-tok-2',
        expiresAt: new Date(Date.now() - 1000), // 1s ago
        usedAt: null,
      },
    ];
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.3',
      },
      body: makeBody({ token: 'invite-tok-2' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/expired/i);

    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('expired');
    expect(log?.httpStatus).toBe(400);
  });

  it('B4: already-used token → 400 + audit used/400', async () => {
    mockState.tokens = [
      {
        id: 'tok-3',
        token: 'invite-tok-3',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: new Date(Date.now() - 60 * 1000),
      },
    ];
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.4',
      },
      body: makeBody({ token: 'invite-tok-3' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already been used/i);

    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('used');
    expect(log?.httpStatus).toBe(400);
  });

  it('B5: capacity full → 202 + waitlist row + audit capacity_full/202 with waitlist_id', async () => {
    mockState.tokens = [
      {
        id: 'tok-4',
        token: 'invite-tok-4',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.cap = 20;
    mockState.usedCount = 20; // cap reached

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.5',
      },
      body: makeBody({ token: 'invite-tok-4', email: 'wait@example.com' }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; waitlistId: string };
    expect(body.status).toBe('waitlisted');
    expect(typeof body.waitlistId).toBe('string');

    expect(mockState.insertedWaitlist).toHaveLength(1);
    // T-065: emails are normalized to lowercase before persist so /me's
    // claim lookup matches case-insensitively.
    expect(mockState.insertedWaitlist[0]?.email).toBe('wait@example.com');
    expect(mockState.insertedWaitlist[0]?.source).toBe('beta_full');

    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('capacity_full');
    expect(log?.httpStatus).toBe(202);
    expect(log?.waitlistId).toBe(body.waitlistId);
  });

  it('B6: cap=1 read from app_config — first redeem succeeds, second hits capacity_full', async () => {
    // Run 1 — usedCount=0, cap=1 → success
    mockState.tokens = [
      {
        id: 'tok-5a',
        token: 'invite-tok-5a',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.cap = 1;
    mockState.usedCount = 0;

    const { default: app } = await import('../src/index.js');
    const res1 = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.6',
      },
      body: makeBody({ token: 'invite-tok-5a', email: 'first@example.com' }),
    });
    expect(res1.status).toBe(200);

    // Run 2 — usedCount=1 (== cap=1) → capacity_full
    mockState.tokens = [
      {
        id: 'tok-5b',
        token: 'invite-tok-5b',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.usedCount = 1;

    const res2 = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Different IP so the per-IP rate limit doesn't trigger.
        'x-forwarded-for': '203.0.113.7',
      },
      body: makeBody({ token: 'invite-tok-5b', email: 'second@example.com' }),
    });
    expect(res2.status).toBe(202);
    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('capacity_full');
  });

  it('B7: invalid body (missing token) → 400 + audit invalid/400', async () => {
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.8',
      },
      body: JSON.stringify({ email: 'oops@example.com' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/validation/i);

    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('invalid');
    expect(log?.httpStatus).toBe(400);
  });

  it('B8: rate limited — 6th attempt from same IP returns 429 + audit rate_limited/429', async () => {
    // First 5 succeed (5 distinct invalid tokens — each is 400 invalid but
    // counts toward the rate limit).
    mockState.tokens = [];
    const { default: app } = await import('../src/index.js');

    const ip = '203.0.113.99';
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/v1/beta-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: makeBody({ token: `bad-tok-${i}` }),
      });
      expect(res.status).toBe(400);
    }

    // 6th attempt — rate limited.
    const res6 = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: makeBody({ token: 'bad-tok-6' }),
    });
    expect(res6.status).toBe(429);

    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('rate_limited');
    expect(log?.httpStatus).toBe(429);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-065 R01 — google_id='' UNIQUE collision regression.
  // Two consecutive successful signups (different tokens, no Google login
  // between) must both succeed. Pre-T-065 code inserted google_id='' into
  // acmd.users → second insert hit unique_violation and returned 500. After
  // T-065, beta-signup creates no users at all so this scenario is safe.
  // ─────────────────────────────────────────────────────────────────────────
  it('R01: two consecutive successful signups (no Google login between) — both 200 (T-065 google_id collision fix)', async () => {
    const { default: app } = await import('../src/index.js');

    // Signup 1
    mockState.tokens = [
      {
        id: 'tok-r01-a',
        token: 'invite-r01-a',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.cap = 20;
    mockState.usedCount = 0;
    const res1 = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.111',
      },
      body: makeBody({ token: 'invite-r01-a', email: 'first@example.com' }),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { status: string };
    expect(body1.status).toBe('redeemed');

    // No acmd.users INSERT happened (regression assertion — pre-T-065 the
    // mock would have recorded an `insert(users)` call here).
    expect(mockState.txInserts.find((i) => i.table === 'users')).toBeUndefined();

    // Signup 2 — different token, different email, no Google login between.
    mockState.tokens = [
      {
        id: 'tok-r01-b',
        token: 'invite-r01-b',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.usedCount = 1;

    const res2 = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Different IP so per-IP rate limit doesn't fire.
        'x-forwarded-for': '203.0.113.112',
      },
      body: makeBody({ token: 'invite-r01-b', email: 'second@example.com' }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { status: string };
    expect(body2.status).toBe('redeemed');

    // Two redemption_log success rows — proves both signups completed
    // without the google_id collision that broke T-063 at signup #2.
    const successLogs = mockState.insertedRedemptionLogs.filter(
      (l) => l.result === 'success',
    );
    expect(successLogs.length).toBe(2);
    expect(successLogs[0]?.email).toBe('first@example.com');
    expect(successLogs[1]?.email).toBe('second@example.com');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-065 R03a — Untrusted XFF: peer IP wins (rate limit cannot be bypassed).
  // The route's getTrustedClientIp() reads the TCP peer IP from ConnInfo;
  // when the peer is NOT in TRUSTED_PROXY_IPS (default empty), x-forwarded-for
  // is IGNORED. Sending different XFF values from the same peer all share
  // the same rate-limit bucket → 6th hits 429.
  //
  // We use the `x-test-peer-ip` header (only honored when VITEST=true — see
  // apps/api/src/middleware/trusted-proxy.ts) to simulate the TCP peer IP.
  // ─────────────────────────────────────────────────────────────────────────
  it('R03a: untrusted XFF — peer IP wins, rate limit counts spoofed XFF as one peer', async () => {
    delete process.env['TRUSTED_PROXY_IPS']; // default = trust nothing
    mockState.tokens = [];
    const { default: app } = await import('../src/index.js');

    const peerIp = '9.9.9.9'; // untrusted
    // 5 requests from same peer with DIFFERENT spoofed XFF — all should
    // share the rate-limit bucket because XFF is ignored.
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/v1/beta-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-peer-ip': peerIp,
          // Each request spoofs a fresh XFF — pre-fix this would have given
          // each a fresh bucket.
          'x-forwarded-for': `1.1.1.${i + 1}`,
        },
        body: makeBody({ token: `r03a-tok-${i}` }),
      });
      expect(res.status).toBe(400); // tokens unknown → 400 invalid
    }

    // 6th attempt — same peer, different spoofed XFF. Must hit 429
    // (proves the bucket is keyed on peer, not XFF).
    const res6 = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-peer-ip': peerIp,
        'x-forwarded-for': '1.1.1.99',
      },
      body: makeBody({ token: 'r03a-tok-6' }),
    });
    expect(res6.status).toBe(429);

    // The audit row IP is the peer IP, NOT the spoofed XFF — confirms the
    // SEC-001 fix: untrusted XFF values never end up in the audit log.
    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('rate_limited');
    expect(log?.httpStatus).toBe(429);
    expect(log?.ip).toBe(peerIp);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-065 R03b — Trusted XFF: when the peer IP is in TRUSTED_PROXY_IPS the
  // route trusts X-Forwarded-For. Two different peers with the SAME XFF
  // share the bucket; one peer with rotating XFF gets fresh buckets.
  // ─────────────────────────────────────────────────────────────────────────
  it('R03b: trusted XFF (peer in TRUSTED_PROXY_IPS) — XFF wins, audit IP = XFF', async () => {
    process.env['TRUSTED_PROXY_IPS'] = '10.0.0.0/8';
    // Force the trusted-proxy module to reparse env for this test.
    const { _resetTrustedProxyCacheForTests } = await import(
      '../src/middleware/trusted-proxy.js'
    );
    _resetTrustedProxyCacheForTests();

    mockState.tokens = [
      {
        id: 'tok-r03b',
        token: 'invite-r03b',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        usedAt: null,
      },
    ];
    mockState.cap = 20;
    mockState.usedCount = 0;

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/beta-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-peer-ip': '10.0.0.5', // peer IP in trusted CIDR
        'x-forwarded-for': '1.1.1.1', // trusted because peer is trusted
      },
      body: makeBody({
        token: 'invite-r03b',
        email: 'r03b@example.com',
      }),
    });

    expect(res.status).toBe(200);

    // Audit row IP = the trusted XFF, NOT the peer IP. This is what we
    // want for downstream analytics / abuse reports when behind a real
    // reverse proxy.
    const log = mockState.insertedRedemptionLogs.at(-1);
    expect(log?.result).toBe('success');
    expect(log?.ip).toBe('1.1.1.1');

    // Reset env so other tests aren't affected.
    delete process.env['TRUSTED_PROXY_IPS'];
    _resetTrustedProxyCacheForTests();
  });
});
