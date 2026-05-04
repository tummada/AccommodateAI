/**
 * Unit tests for auth routes (RS-013).
 *
 * After RS-013, /auth/google, /auth/refresh, /auth/logout were removed from
 * acmd-api — vollos-core owns login. The tests that asserted those endpoints
 * behaviour were deleted; what remains here covers:
 *
 *   - /test-login  — dev/E2E helper (kept, unchanged behaviour)
 *   - CORS         — app-wide config (unrelated to auth endpoints but still
 *                    verified here to keep the suite minimal).
 *
 * /me behaviour is covered in authMe.test.ts and JWKS integration flow is
 * covered in auth-integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------
// Mock dotenv (must be before any import that triggers config)
// -----------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

// Set env vars
process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => ({
  db: {},
  acmdUsers: { id: 'id', companyId: 'company_id', googleId: 'google_id' },
  acmdCompanies: { id: 'id', name: 'name' },
  acmdRefreshTokens: { tokenHash: 'token_hash' },
}));

// -----------------------------------------------------------------------
// Mock authService
// -----------------------------------------------------------------------
const mockStoreToken = vi.fn();
const mockRevokeToken = vi.fn();
const mockIsTokenRevoked = vi.fn();

vi.mock('../src/services/authService.js', () => ({
  findUserByGoogleId: vi.fn(),
  createUser: vi.fn(),
  updateLastLogin: vi.fn(),
  isOnboardingRequired: vi.fn(),
  tokenCallbacks: {
    storeToken: (...args: unknown[]) => mockStoreToken(...args),
    revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
    isTokenRevoked: (...args: unknown[]) => mockIsTokenRevoked(...args),
  },
}));

// -----------------------------------------------------------------------
// Mock @acmd/auth
// -----------------------------------------------------------------------
const mockCreateTokens = vi.fn();
const mockHashToken = vi.fn();

vi.mock('@acmd/auth', () => ({
  verifyGoogleToken: vi.fn(),
  createTokens: (...args: unknown[]) => mockCreateTokens(...args),
  hashToken: (...args: unknown[]) => mockHashToken(...args),
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
      c.set('userId', 'user-uuid');
      c.set('companyId', 'company-uuid');
      c.set('role', 'super_admin');
      c.set('product', 'acmd');
      c.set('tenantDb', { companyId: 'company-uuid', select: vi.fn() });
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
  fetchJwks: vi.fn().mockResolvedValue({}),
}));

describe('Auth Routes (RS-013)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreToken.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------
  // RS-013: removed endpoints should now 404
  // ---------------------------------------------------------------------
  describe('removed endpoints — moved to vollos-core', () => {
    it('POST /api/v1/auth/google → 404 (moved to vollos-core)', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'any-token' }),
      });
      expect(res.status).toBe(404);
    });

    it('POST /api/v1/auth/refresh → 404 (moved to vollos-core)', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Cookie': 'refresh_token=whatever' },
      });
      expect(res.status).toBe(404);
    });

    it('POST /api/v1/auth/logout → 404 (moved to vollos-core)', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Cookie': 'refresh_token=whatever' },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('CORS (AC-8)', () => {
    it('should allow requests from https://accommodate-app.vollos.ai', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/', {
        method: 'GET',
        headers: { 'Origin': 'https://accommodate-app.vollos.ai' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://accommodate-app.vollos.ai');
    });

    it('should allow requests from https://accommodate.vollos.ai', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/', {
        method: 'GET',
        headers: { 'Origin': 'https://accommodate.vollos.ai' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://accommodate.vollos.ai');
    });

    it('should allow requests from http://localhost:3003', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/', {
        method: 'GET',
        headers: { 'Origin': 'http://localhost:3003' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3003');
    });

    it('should reject requests from unauthorized origins', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/', {
        method: 'GET',
        headers: { 'Origin': 'https://evil.com' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('should not set Access-Control-Allow-Origin for rejected origins', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/', {
        method: 'GET',
        headers: { 'Origin': 'https://evil.example.com' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // ACMD-160: POST /api/v1/auth/test-login (dev/E2E only)
  // -----------------------------------------------------------------------
  describe('POST /api/v1/auth/test-login', () => {
    // Mock db for upsert — default: no existing user
    let mockDbSelect: ReturnType<typeof vi.fn>;
    let mockDbInsert: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const acmdDb = await import('@acmd/db');
      const db = acmdDb.db as Record<string, unknown>;

      // db.select is called THREE times per /test-login request:
      //   1st: company check         → must return company row (company exists)
      //   2nd: user lookup by email → default []: no existing user → insert
      //   3rd: company onboarding flag lookup (post-insert, to compute onboardingRequired)
      const makeSelectChain = (resolvedValue: unknown[]) => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(resolvedValue),
          }),
        }),
      });

      mockDbSelect = vi.fn()
        .mockReturnValueOnce(makeSelectChain([{ id: 'test-company-uuid' }])) // company exists
        .mockReturnValueOnce(makeSelectChain([])) // user not found (default)
        .mockReturnValue(makeSelectChain([{ onboardingCompletedAt: null }])); // not onboarded

      mockDbInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 'test-user-uuid',
              companyId: 'test-company-uuid',
              role: 'hr',
              email: 'playwright@test.com',
              name: 'playwright@test.com',
            },
          ]),
        }),
      });

      db['select'] = mockDbSelect;
      db['insert'] = mockDbInsert;

      mockCreateTokens.mockResolvedValue({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      });
      mockHashToken.mockReturnValue('test-hashed-token');
      mockStoreToken.mockResolvedValue(undefined);
    });

    it('ACMD-160-1: returns 404 when NODE_ENV is production', async () => {
      const configModule = await import('../src/config.js');
      const configObj = configModule.config as Record<string, unknown>;
      const origNodeEnv = configObj['nodeEnv'];
      configObj['nodeEnv'] = 'production';

      try {
        const { default: app } = await import('../src/index.js');
        const res = await app.request('/api/v1/auth/test-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@test.com', role: 'hr', companyId: 'company-uuid' }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Not found');
      } finally {
        configObj['nodeEnv'] = origNodeEnv;
      }
    });

    it('ACMD-160-2: returns 400 when body is invalid (missing required fields)', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', role: 'invalid_role' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('ACMD-160-3: happy path — new user → insert, issue token, set cookie, return user shape', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'playwright@test.com',
          role: 'hr',
          companyId: 'test-company-uuid',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.accessToken).toBeDefined();
      expect(body.user).toBeDefined();
      expect(body.user).toMatchObject({
        id: expect.any(String),
        email: 'playwright@test.com',
        role: expect.any(String),
        companyId: expect.any(String),
        onboardingRequired: expect.any(Boolean),
      });

      const setCookie = res.headers.get('Set-Cookie') ?? '';
      expect(setCookie).toContain('refresh_token=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Path=/api/v1/auth');
      expect(setCookie).toContain('Max-Age=2592000');

      expect(mockStoreToken).toHaveBeenCalledWith(
        'test-hashed-token',
        expect.any(String),
        expect.any(Date),
      );
    });
  });
});
