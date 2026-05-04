/**
 * RS-013 / Q-001 — `acmdTenantGuard` + `requireOnboarded` unit tests.
 *
 * Scope:
 *   - Middleware resolves companyId + role from `acmd.users` keyed on JWT.sub
 *     (NOT from the empty `company_id` claim that vollos-core emits).
 *   - `requireOnboarded` rejects pre-onboarding users with 403
 *     `onboarding_required` so product routes never see an empty companyId
 *     and never crash on a PG UUID cast.
 *
 * Strategy:
 *   - Use a real Hono app with a minimal protected route.
 *   - Mock `@acmd/db` to drive acmd.users lookup outcomes per-test.
 *   - Mock `@acmd/auth.tenantGuard` to simulate the vollos-core JWT setting
 *     `companyId: ''` (identity-only) — exactly the post-RS-013 production
 *     shape that triggered Q-001.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dotenv BEFORE any module import that would trigger config
// ---------------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['ACMD_ENCRYPTION_KEY'] = 'a'.repeat(64);
process.env['VITEST'] = 'true';

// ---------------------------------------------------------------------------
// @acmd/db mock — drive acmd.users lookup per-test via __dbState.
// The tests exercise the three cases the production middleware cares about:
//   - row found      → override companyId/role from DB
//   - row missing    → leave empty so requireOnboarded can gate
//   - lookup throws  → production returns 503 (test-mode branch swallows)
// ---------------------------------------------------------------------------
const __dbState: {
  acmdUsersRow: { companyId: string; role: string } | null;
  throwOnLookup: boolean;
} = { acmdUsersRow: null, throwOnLookup: false };

vi.mock('@acmd/db', () => {
  const mkLimit = () => vi.fn(async () => {
    if (__dbState.throwOnLookup) {
      throw new Error('simulated DB connection lost');
    }
    return __dbState.acmdUsersRow ? [__dbState.acmdUsersRow] : [];
  });
  const mkWhere = () => vi.fn(() => ({ limit: mkLimit() }));
  const mkFrom = () => vi.fn(() => ({ where: mkWhere() }));
  return {
    db: {
      select: vi.fn(() => ({ from: mkFrom() })),
    },
    acmdUsers: {
      id: { name: 'id' },
      companyId: { name: 'company_id' },
      role: { name: 'role' },
      deletedAt: { name: 'deleted_at' },
    },
  };
});

// ---------------------------------------------------------------------------
// @acmd/auth mock — simulate vollos-core JWT path:
//   Mocked tenantGuard sets userId from a fake "verified" JWT and leaves
//   companyId EMPTY (mirrors the real post-RS-013 shape). That's the exact
//   hole Q-001 fell through before the middleware DB lookup was added.
// ---------------------------------------------------------------------------
vi.mock('@acmd/auth', () => ({
  tenantGuard: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      c.set('userId', 'user-sub-from-jwt');
      // vollos-core is identity-only — it signs `company_id: ''`.
      c.set('companyId', '');
      c.set('role', 'viewer');
      c.set('product', 'acmd');
      c.set('tenantDb', { companyId: '', select: vi.fn() });
      await next();
    }),
  requireRole: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_c: any, next: any) => next()),
  createTenantScope: vi.fn((_opts: unknown, companyId: string) => ({
    companyId,
    select: vi.fn(),
  })),
  fetchJwks: vi.fn().mockResolvedValue({}),
  verifyAccessTokenRaw: vi.fn(),
  decodeJwtPayload: vi.fn(() => ({ products: ['acmd'], sub: 'user-sub-from-jwt' })),
}));

// ---------------------------------------------------------------------------
// Helpers — lazy imports so env vars + vi.mock() are in place first.
// ---------------------------------------------------------------------------
async function buildTestApp() {
  const { Hono } = await import('hono');
  const { acmdTenantGuard, requireOnboarded } = await import('../src/middleware/auth.js');
  const app = new Hono();
  app.get('/probe', acmdTenantGuard, (c) =>
    c.json({
      companyId: c.get('companyId' as never),
      role: c.get('role' as never),
      userId: c.get('userId' as never),
    }, 200),
  );
  app.get('/protected', acmdTenantGuard, requireOnboarded, (c) =>
    c.json({
      ok: true,
      companyId: c.get('companyId' as never),
      role: c.get('role' as never),
    }, 200),
  );
  return app;
}

beforeEach(() => {
  __dbState.acmdUsersRow = null;
  __dbState.throwOnLookup = false;
});

describe('acmdTenantGuard — RS-013 DB lookup (Q-001 fix)', () => {
  it('resolves companyId + role from acmd.users when row exists', async () => {
    __dbState.acmdUsersRow = {
      companyId: '11111111-1111-4111-8111-111111111111',
      role: 'super_admin',
    };
    const app = await buildTestApp();
    const res = await app.request('/probe', {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.companyId).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.role).toBe('super_admin');
    expect(body.userId).toBe('user-sub-from-jwt');
  });

  it('leaves companyId empty when acmd.users row missing (pre-onboarding)', async () => {
    __dbState.acmdUsersRow = null;
    const app = await buildTestApp();
    const res = await app.request('/probe', {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // companyId untouched — stays as tenantGuard left it (empty, per
    // vollos-core identity-only JWT shape).
    expect(body.companyId).toBe('');
  });

  it('does not leak 500 when DB lookup throws — test branch falls through', async () => {
    __dbState.throwOnLookup = true;
    const app = await buildTestApp();
    const res = await app.request('/probe', {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-token' },
    });
    // Test-mode branch swallows the thrown error (documented behaviour) and
    // the request completes with the pre-existing empty companyId. The
    // production branch returns 503 — covered indirectly by auth-integration
    // tests that exercise the real pipeline.
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.companyId).toBe('');
  });
});

describe('requireOnboarded — RS-013 pre-onboarding gate', () => {
  it('rejects with 403 onboarding_required when companyId empty', async () => {
    __dbState.acmdUsersRow = null; // pre-onboarding
    const app = await buildTestApp();
    const res = await app.request('/protected', {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-token' },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('onboarding_required');
  });

  it('passes through when acmd.users row present (onboarded)', async () => {
    __dbState.acmdUsersRow = {
      companyId: '22222222-2222-4222-8222-222222222222',
      role: 'hr',
    };
    const app = await buildTestApp();
    const res = await app.request('/protected', {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.companyId).toBe('22222222-2222-4222-8222-222222222222');
    expect(body.role).toBe('hr');
  });
});
