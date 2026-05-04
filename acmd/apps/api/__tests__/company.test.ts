/**
 * Unit tests for company routes.
 *
 * Covers:
 *   AC-6: PATCH /api/v1/company — update company info (admin only)
 *   AC-7: POST /api/v1/company/onboarding/complete — set onboarding_completed_at
 *   Edge cases: non-admin role -> 403, missing fields, company not found
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
const mockDbUpdate = vi.fn();
const mockDbSet = vi.fn();
const mockDbWhere = vi.fn();
const mockDbReturning = vi.fn();

vi.mock('@acmd/db', () => ({
  db: {
    update: (...args: unknown[]) => {
      mockDbUpdate(...args);
      return {
        set: (...s: unknown[]) => {
          mockDbSet(...s);
          return {
            where: (...w: unknown[]) => {
              mockDbWhere(...w);
              return {
                returning: (...r: unknown[]) => {
                  mockDbReturning(...r);
                  return mockDbReturning._resolveValue ?? Promise.resolve([]);
                },
              };
            },
          };
        },
      };
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
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
  acmdUsers: { id: 'id', companyId: 'company_id', role: 'role', deletedAt: 'deleted_at' },
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

describe('Company Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    // Reset the resolve value
    (mockDbReturning as any)._resolveValue = undefined;
  });

  describe('PATCH /api/v1/company', () => {
    it('AC-6: should update company info with valid fields', async () => {
      const returnValue = [{
        id: 'company-uuid',
        name: 'Acme Corp',
        hqState: 'CA',
        size: 50,
        industry: 'Technology',
        updatedAt: new Date(),
      }];
      (mockDbReturning as any)._resolveValue = Promise.resolve(returnValue);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'Acme Corp',
          hqState: 'CA',
          size: 50,
          industry: 'Technology',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.company).toBeDefined();
      expect(body.company.name).toBe('Acme Corp');
    });

    it('AC-6: should return 400 when no fields provided', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('AC-6: should return 400 for invalid JSON body', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });

    it('should return 403 for non-super_admin role', async () => {
      mockRole = 'hr'; // hr cannot modify company settings
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(403);
    });

    it('should return 404 when company not found', async () => {
      (mockDbReturning as any)._resolveValue = Promise.resolve([]);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'Test Corp' }),
      });

      expect(res.status).toBe(404);
    });

    it('AC-6: should allow partial update (only name)', async () => {
      const returnValue = [{
        id: 'company-uuid',
        name: 'New Name',
        hqState: null,
        size: null,
        industry: null,
        updatedAt: new Date(),
      }];
      (mockDbReturning as any)._resolveValue = Promise.resolve(returnValue);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.company.name).toBe('New Name');
    });
  });

  describe('POST /api/v1/company/onboarding/complete', () => {
    it('AC-7: should set onboarding_completed_at', async () => {
      const now = new Date();
      (mockDbReturning as any)._resolveValue = Promise.resolve([{
        id: 'company-uuid',
        onboardingCompletedAt: now,
      }]);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company/onboarding/complete', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Onboarding completed');
      expect(body.onboarding_completed_at).toBeDefined();
    });

    it('should return 403 for non-super_admin role', async () => {
      mockRole = 'hr'; // hr cannot complete onboarding
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company/onboarding/complete', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(403);
    });

    it('should return 404 when company not found', async () => {
      (mockDbReturning as any)._resolveValue = Promise.resolve([]);

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/company/onboarding/complete', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      expect(res.status).toBe(404);
    });
  });
});
