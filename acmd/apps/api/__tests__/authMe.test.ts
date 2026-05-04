/**
 * RS-013 — GET /api/v1/auth/me tests.
 *
 * After RS-013 the /me response shape changed from the flat 6-field payload
 * to a wrapped envelope:
 *
 *   user found →
 *     { onboarding_required, profile: { id, email, name, role, companyId } }
 *   user NOT found (vollos-core user, not yet onboarded in acmd) →
 *     200 + { onboarding_required: true,
 *             profile: { user_id, email, name, google_id } }
 *   products lacks 'acmd' → handled by acmdTenantGuard (403)
 *
 * Covers:
 *   - 200 happy path: valid access token -> envelope with onboarding flag
 *   - 200 onboarding_required:true when user not yet created in acmd
 *   - 401: no Authorization header
 *   - 401: invalid/expired token
 *   - query scope: where-clause uses ctx `userId` from JWT sub
 *   - data minimization: response cannot leak password/refresh/googleId/deletedAt
 *   - Cache-Control: no-store
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------
// Mock dotenv (must be before any import that triggers config)
// -----------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';

// -----------------------------------------------------------------------
// DB mock — we drive query results per test via this spy so we can
// assert that the WHERE clause received the userId from context and
// NOT a client-provided value.
// -----------------------------------------------------------------------
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockLeftJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ leftJoin: mockLeftJoin, where: mockWhere }));

// T-065 redemption-log chain (tryClaimBetaRedemption): select({id,email,claimedUserId})
// .from().where().orderBy().limit()
const mockRedemptionLimit = vi.fn(async () => []);
const mockRedemptionOrderBy = vi.fn(() => ({ limit: mockRedemptionLimit }));
const mockRedemptionWhere = vi.fn(() => ({ orderBy: mockRedemptionOrderBy }));
const mockRedemptionFrom = vi.fn(() => ({ where: mockRedemptionWhere }));

// T-101 gate-query chain: select({id}).from().where().limit() — betaGate.ts
// Default to one row so pre-T-101 tests that don't care about gate pass it.
let mockGateRedemptionRows: unknown[] = [{ id: 'gate-row-uuid' }];
const mockGateLimit = vi.fn(async () => mockGateRedemptionRows);
const mockGateWhere = vi.fn(() => ({ limit: mockGateLimit }));
const mockGateFrom = vi.fn(() => ({ where: mockGateWhere }));

// Shape-based dispatch: routes select() calls to the right chain.
// See onboarding.test.ts / auth-integration.test.ts for full dispatch warning.
const mockSelect = vi.fn((cols?: unknown) => {
  if (
    cols
    && typeof cols === 'object'
    && 'claimedUserId' in (cols as object)
  ) {
    return { from: mockRedemptionFrom };
  }
  if (
    cols
    && typeof cols === 'object'
    && 'id' in (cols as object)
    && !('email' in (cols as object))
    && !('claimedUserId' in (cols as object))
    && !('companyId' in (cols as object))
  ) {
    return { from: mockGateFrom };
  }
  return { from: mockFrom };
});

vi.mock('@acmd/db', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
  acmdUsers: {
    id: { name: 'id' },
    email: { name: 'email' },
    name: { name: 'name' },
    role: { name: 'role' },
    companyId: { name: 'company_id' },
    deletedAt: { name: 'deleted_at' },
    googleId: { name: 'google_id' },
  },
  acmdCompanies: {
    id: { name: 'id' },
    onboardingCompletedAt: { name: 'onboarding_completed_at' },
  },
  acmdRefreshTokens: { tokenHash: 'token_hash' },
  // T-101: betaGate.ts imports this table — must be exported from the mock.
  acmdBetaInviteRedemptionLog: {
    id: { name: 'id' },
    email: { name: 'email' },
    result: { name: 'result' },
    claimedUserId: { name: 'claimed_user_id' },
    claimedAt: { name: 'claimed_at' },
    createdAt: { name: 'created_at' },
  },
}));

// -----------------------------------------------------------------------
// authService mock (shared with auth.test.ts — index.ts imports it)
// -----------------------------------------------------------------------
vi.mock('../src/services/authService.js', () => ({
  findUserByGoogleId: vi.fn(),
  createUser: vi.fn(),
  updateLastLogin: vi.fn(),
  isOnboardingRequired: vi.fn(),
  tokenCallbacks: {
    storeToken: vi.fn(),
    revokeToken: vi.fn(),
    isTokenRevoked: vi.fn(),
  },
}));

// -----------------------------------------------------------------------
// @acmd/auth mock — tenantGuard is mocked so tests drive auth outcomes via
// __authState. The guard sets userId + (RS-013) authClaims into ctx.
// -----------------------------------------------------------------------
const __authState: {
  mode: 'ok' | 'missing' | 'invalid';
  userId: string;
  claims: {
    sub: string;
    email: string;
    google_id: string;
    products: string[];
  };
} = {
  mode: 'ok',
  userId: 'token-sub-uuid',
  claims: {
    sub: 'token-sub-uuid',
    email: 'hr@acme.com',
    google_id: 'google-sub-123',
    products: ['acmd'],
  },
};

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
      if (__authState.mode === 'missing') {
        return c.json({ error: 'Missing or invalid Authorization header' }, 401);
      }
      if (__authState.mode === 'invalid') {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
      c.set('userId', __authState.userId);
      c.set('companyId', 'company-uuid');
      c.set('role', 'super_admin');
      c.set('product', 'acmd');
      c.set('tenantDb', { companyId: 'company-uuid', select: vi.fn() });
      // RS-013: expose the full claims so /me and onboarding handlers can
      // use email / google_id hints without a second network hit.
      c.set('authClaims', {
        sub: __authState.claims.sub,
        company_id: 'company-uuid',
        role: 'super_admin',
        product: 'acmd',
        email: __authState.claims.email,
        google_id: __authState.claims.google_id,
        products: __authState.claims.products,
        iat: 0,
        exp: 9999999999,
        token_type: 'access',
      });
      await next();
    }),
  requireRole: vi.fn((...roles: string[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      const role = c.get('role');
      if (!roles.includes(role)) {
        return c.json({ error: 'Insufficient permissions' }, 403);
      }
      await next();
    }),
  createTenantScope: vi.fn(() => ({ companyId: 'company-uuid', select: vi.fn() })),
  googleAuthRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, next: any) => next()),
  refreshRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any, next: any) => next()),
}));

describe('GET /api/v1/auth/me (RS-013)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // T-101 — default to "gate passes" so pre-T-101 tests don't need changes.
    mockGateRedemptionRows = [{ id: 'gate-row-uuid' }];
    // T-101 — owner-bypass off by default.
    delete process.env['ACMD_OWNER_EMAIL'];
    __authState.mode = 'ok';
    __authState.userId = 'token-sub-uuid';
    __authState.claims = {
      sub: 'token-sub-uuid',
      email: 'hr@acme.com',
      google_id: 'google-sub-123',
      products: ['acmd'],
    };
  });

  it('RS-013-1: user found → envelope with onboarding_required based on company flag', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: 'Jane HR',
        role: 'super_admin',
        companyId: 'company-uuid',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = await res.json();
    expect(body).toEqual({
      onboarding_required: false,
      profile: {
        id: 'token-sub-uuid',
        user_id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: 'Jane HR',
        role: 'super_admin',
        companyId: 'company-uuid',
      },
    });
  });

  it('RS-013-2: user found, company onboarding not complete → onboarding_required: true', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'token-sub-uuid',
        email: 'new@acme.com',
        name: 'New Admin',
        role: 'super_admin',
        companyId: 'company-uuid',
        onboardingCompletedAt: null,
      },
    ]);

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboarding_required).toBe(true);
    expect(body.profile.id).toBe('token-sub-uuid');
  });

  it('RS-013-3: acmd_users row missing → 200 + onboarding_required:true + JWT hints', async () => {
    mockLimit.mockResolvedValueOnce([]); // user row missing

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      onboarding_required: true,
      profile: {
        user_id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: '',
        google_id: 'google-sub-123',
      },
    });

    // Log hygiene: warn logs opaque user_id only (no email/name).
    const warnArg = warnSpy.mock.calls[0]?.[0] ?? '';
    expect(warnArg).toContain('user_id=token-sub-uuid');
    expect(warnArg).not.toContain('@');
    warnSpy.mockRestore();
  });

  it('returns 401 when Authorization header is missing', async () => {
    __authState.mode = 'missing';
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/auth/me', { method: 'GET' });
    expect(res.status).toBe(401);
    // DB should never be queried when auth fails.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid/expired', async () => {
    __authState.mode = 'invalid';
    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer expired-token' },
    });
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('query is scoped to the JWT sub from ctx — client-supplied id is ignored', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: 'Jane HR',
        role: 'super_admin',
        companyId: 'company-uuid',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    __authState.userId = 'token-sub-uuid';

    const { default: app } = await import('../src/index.js');
    const res = await app.request(
      '/api/v1/auth/me?id=attacker-uuid',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer valid-token',
          'X-User-Id': 'attacker-uuid',
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe('token-sub-uuid');
    expect(mockWhere).toHaveBeenCalled();
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('response never includes password/hash/refreshToken/googleId/deletedAt', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'token-sub-uuid',
        email: 'hr@acme.com',
        name: 'Jane HR',
        role: 'super_admin',
        companyId: 'company-uuid',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
        // Extra fields that MUST NOT leak even if a future refactor
        // accidentally forwards the whole row.
        passwordHash: 'SHOULD-NEVER-LEAK',
        refreshToken: 'SHOULD-NEVER-LEAK',
        googleId: 'google-sub',
        deletedAt: null,
      },
    ]);

    const { default: app } = await import('../src/index.js');
    const res = await app.request('/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    });

    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('refreshToken');
    expect(serialized).not.toContain('googleId');
    expect(serialized).not.toContain('deletedAt');
    expect(serialized).not.toContain('SHOULD-NEVER-LEAK');
  });
});
