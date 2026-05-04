/**
 * Unit tests for users routes.
 *
 * Covers:
 *   ACMD-168: GET /api/v1/users/managers — list managers (super_admin or hr only)
 *   - authorized success (super_admin) → 200 + managers array
 *   - authorized success (hr) → 200 + managers array
 *   - unauthorized (manager role) → 403
 *   - unauthorized (medical_reviewer) → 403
 *   - empty result → { managers: [] } (not an error)
 *   - no sensitive fields in response
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------
// Mock dotenv
// -----------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
let mockSelectResult: unknown[] = [];

const mockOrderBy = vi.fn(() => Promise.resolve(mockSelectResult));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@acmd/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
  acmdCompanies: {
    id: 'id',
    name: 'name',
    hqState: 'hq_state',
    size: 'size',
    industry: 'industry',
    onboardingCompletedAt: 'onboarding_completed_at',
    defaultHrContactId: 'default_hr_contact_id',
    updatedAt: 'updated_at',
    companyId: 'company_id',
  },
  acmdUsers: {
    id: 'id',
    companyId: 'company_id',
    name: 'name',
    email: 'email',
    role: 'role',
    deletedAt: 'deleted_at',
  },
  acmdRefreshTokens: { tokenHash: 'token_hash' },
}));

// -----------------------------------------------------------------------
// Mock authService
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
// Mock @acmd/auth — tenantGuard and requireRole
// -----------------------------------------------------------------------
let mockRole = 'super_admin';

vi.mock('@acmd/auth', () => ({
  tenantGuard: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      c.set('userId', 'user-uuid');
      c.set('companyId', 'company-uuid');
      c.set('role', mockRole);
      c.set('product', 'acmd');
      c.set('tenantDb', { companyId: 'company-uuid', select: vi.fn() });
      await next();
    }),
  requireRole: vi.fn((...roles: string[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      const role = c.get('role');
      if (!roles.includes(role)) {
        return c.json({ error: 'Insufficient permissions', required: roles, current: role }, 403);
      }
      await next();
    }),
  createTenantScope: vi.fn(() => ({ companyId: 'company-uuid', select: vi.fn() })),
  createAuthRoutes: vi.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Hono } = require('hono');
    return new Hono();
  }),
  verifyGoogleToken: vi.fn(),
  createTokens: vi.fn(),
  hashToken: vi.fn(),
  fetchJwks: vi.fn().mockResolvedValue({}),
  googleAuthRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_c: any, next: any) => next()),
  refreshRateLimit: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_c: any, next: any) => next()),
}));

describe('Users Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockSelectResult = [];
    // Re-attach the mock chain (clearAllMocks resets return values)
    mockOrderBy.mockResolvedValue(mockSelectResult);
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  describe('GET /api/v1/users/managers', () => {
    it('ACMD-168: super_admin can list managers → 200 + managers array', async () => {
      const managersData = [
        { id: 'mgr-1', displayName: 'Alice Manager', email: 'alice@example.com' },
        { id: 'mgr-2', displayName: 'Bob Manager', email: 'bob@example.com' },
      ];
      mockOrderBy.mockResolvedValue(managersData);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/users/managers', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { managers: unknown[] };
      expect(body.managers).toBeDefined();
      expect(Array.isArray(body.managers)).toBe(true);
      expect(body.managers).toHaveLength(2);
      expect((body.managers[0] as { displayName: string }).displayName).toBe('Alice Manager');
    });

    it('ACMD-168: hr role can list managers → 200', async () => {
      mockRole = 'hr';
      mockOrderBy.mockResolvedValue([]);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/users/managers', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { managers: unknown[] };
      expect(body.managers).toBeDefined();
      expect(Array.isArray(body.managers)).toBe(true);
    });

    it('ACMD-168: manager role → 403 Forbidden', async () => {
      mockRole = 'manager';

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/users/managers', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(403);
    });

    it('ACMD-168: medical_reviewer role → 403 Forbidden', async () => {
      mockRole = 'medical_reviewer';

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/users/managers', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(403);
    });

    it('ACMD-168: empty manager list → { managers: [] } not an error', async () => {
      mockOrderBy.mockResolvedValue([]);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/users/managers', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { managers: unknown[] };
      expect(body.managers).toEqual([]);
    });

    it('ACMD-168: response does not contain sensitive fields', async () => {
      const managersData = [
        { id: 'mgr-1', displayName: 'Alice Manager', email: 'alice@example.com' },
      ];
      mockOrderBy.mockResolvedValue(managersData);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/users/managers', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { managers: Record<string, unknown>[] };
      const manager = body.managers[0];
      expect(manager).toBeDefined();
      expect(manager['passwordHash']).toBeUndefined();
      expect(manager['refreshTokenHash']).toBeUndefined();
      expect(manager['googleId']).toBeUndefined();
      // Only expected fields present
      expect(Object.keys(manager).sort()).toEqual(['displayName', 'email', 'id'].sort());
    });
  });
});
