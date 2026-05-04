/**
 * T-063 / M3-001 §3.5 — PATCH /api/v1/admin/config tests.
 *
 * Cases covered:
 *   1. owner email match → 200 + upserted row + audit log
 *   2. non-owner JWT     → 403 forbidden
 *   3. ACMD_OWNER_EMAIL unset → 503 admin_disabled (fail-closed)
 *   4. invalid body shape → 400
 *   5. beta_cap_current value not non-neg integer → 400
 *
 * @acmd/db is mocked end-to-end. The auth mock can flip the JWT email per test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));
process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['VITEST'] = 'true';

// JWT email is flipped per test by mutating __authState below — the env var
// is set on a per-test basis (B-3 deletes it to test the fail-closed branch).

// ───────────────────────────────────────────────────────────────────────────
// State
// ───────────────────────────────────────────────────────────────────────────

const mockState = {
  upsertedConfig: [] as Array<{ key: string; value: string }>,
  txInserts: [] as Array<{ table: string; values: unknown }>,
};

const __authState: {
  email: string;
  sub: string;
  companyId: string;
} = {
  email: 'pon@vollos.ai',
  sub: 'user-uuid-pon',
  companyId: 'company-uuid-pon',
};

// ───────────────────────────────────────────────────────────────────────────
// @acmd/db mock
// ───────────────────────────────────────────────────────────────────────────

vi.mock('@acmd/db', () => {
  const acmdAppConfig = {
    __tableName: 'app_config',
    key: { name: 'key' },
    value: { name: 'value' },
    updatedAt: { name: 'updated_at' },
  };
  const acmdAuditLogs = { __tableName: 'audit_logs' };
  const acmdUsers = {
    __tableName: 'users',
    id: { name: 'id' },
    email: { name: 'email' },
    companyId: { name: 'company_id' },
    role: { name: 'role' },
    deletedAt: { name: 'deleted_at' },
    googleId: { name: 'google_id' },
  };
  const acmdCompanies = { __tableName: 'companies' };
  const acmdRefreshTokens = { __tableName: 'refresh_tokens' };
  const acmdBetaInviteToken = { __tableName: 'beta_invite_token' };
  const acmdBetaWaitlist = { __tableName: 'beta_waitlist' };
  const acmdBetaInviteRedemptionLog = { __tableName: 'beta_invite_redemption_log' };

  function tableName(t: unknown): string {
    return (t as { __tableName?: string })?.__tableName ?? 'unknown';
  }

  // db.transaction(fn) — runs fn with a tx that records inserts.
  const dbTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    mockState.txInserts = [];
    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((v: unknown) => {
          const name = tableName(table);
          mockState.txInserts.push({ table: name, values: v });
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
            // For audit_logs await.
            then: (resolve: (v: unknown) => void) => resolve(undefined),
          };
        }),
      })),
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
      })),
    };
    return await fn(tx);
  });

  return {
    db: {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: dbTransaction,
    },
    acmdAppConfig,
    acmdAuditLogs,
    acmdUsers,
    acmdCompanies,
    acmdRefreshTokens,
    acmdBetaInviteToken,
    acmdBetaWaitlist,
    acmdBetaInviteRedemptionLog,
    setTenantContext: vi.fn(),
    clearTenantContext: vi.fn(),
  };
});

// ───────────────────────────────────────────────────────────────────────────
// @acmd/auth mock — drives JWT email per test.
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
      c.set('userId', __authState.sub);
      c.set('companyId', __authState.companyId);
      c.set('role', 'super_admin');
      c.set('product', 'acmd');
      c.set('authClaims', {
        sub: __authState.sub,
        company_id: __authState.companyId,
        role: 'super_admin',
        product: 'acmd',
        email: __authState.email,
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
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/config (T-063)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.upsertedConfig = [];
    mockState.txInserts = [];
    __authState.email = 'pon@vollos.ai';
    __authState.sub = 'user-uuid-pon';
    __authState.companyId = 'company-uuid-pon';
    process.env['ACMD_OWNER_EMAIL'] = 'pon@vollos.ai';
    // Force re-read of config when index is imported.
    vi.resetModules();
  });

  it('AC1: owner email match → 200 + upserted row + audit log', async () => {
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/admin/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'beta_cap_current', value: '30' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; value: string };
    expect(body.key).toBe('beta_cap_current');
    expect(body.value).toBe('30');

    // app_config insert recorded.
    const upsert = mockState.txInserts.find((i) => i.table === 'app_config');
    expect(upsert).toBeDefined();
    expect((upsert!.values as { key: string }).key).toBe('beta_cap_current');
    expect((upsert!.values as { value: string }).value).toBe('30');

    // Audit log recorded.
    const audit = mockState.txInserts.find((i) => i.table === 'audit_logs');
    expect(audit).toBeDefined();
  });

  it('AC2: non-owner JWT → 403 forbidden + no upsert', async () => {
    __authState.email = 'someone@else.com';
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/admin/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'beta_cap_current', value: '30' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');
    expect(mockState.txInserts).toEqual([]);
  });

  it('AC3: ACMD_OWNER_EMAIL unset → 503 admin_disabled (fail-closed)', async () => {
    delete process.env['ACMD_OWNER_EMAIL'];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/admin/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'beta_cap_current', value: '30' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('admin_disabled');
    expect(mockState.txInserts).toEqual([]);
    errSpy.mockRestore();
  });

  it('AC4: invalid body shape → 400', async () => {
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/admin/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: '' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Validation failed');
  });

  it('AC5: beta_cap_current must be non-negative integer string → 400 on bad value', async () => {
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/admin/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'beta_cap_current', value: '-5' }),
    });
    expect(res.status).toBe(400);

    const res2 = await app.request('/api/v1/admin/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'beta_cap_current', value: 'abc' }),
    });
    expect(res2.status).toBe(400);
  });
});
