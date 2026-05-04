/**
 * Integration tests for JAN Search routes.
 *
 * Covers:
 *   - GET /api/v1/jan/search — search with condition + job filters
 *   - Pagination: limit + offset
 *   - Validation: invalid params
 *   - Role: any authenticated role can search
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------
// Mock dotenv
// -----------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';
process.env['ACMD_ENCRYPTION_KEY'] = 'a'.repeat(64);

// -----------------------------------------------------------------------
// Mock @anthropic-ai/sdk
// -----------------------------------------------------------------------
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts?: any) {}
  },
}));

// -----------------------------------------------------------------------
// Mock @acmd/crypto
// -----------------------------------------------------------------------
vi.mock('@acmd/crypto', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
  validateKey: vi.fn(),
}));

// -----------------------------------------------------------------------
// Mock stores
// -----------------------------------------------------------------------
const mockJanAccommodations: Record<string, unknown>[] = [];

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  const { sql: _sql } = require('drizzle-orm');

  const insertHandler = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([])),
    })),
  }));

  const updateHandler = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
      })),
    })),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectHandler = vi.fn((...args: any[]) => {
    const isCountQuery = args.length > 0 && args[0] && typeof args[0] === 'object' && 'count' in args[0];

    return {
      from: vi.fn((table: unknown) => {
        if (table === 'acmd_jan_accommodations_table') {
          if (isCountQuery) {
            return {
              where: vi.fn(() => Promise.resolve([{ count: mockJanAccommodations.length }])),
              // No where (select all)
              then: (resolve: any, reject?: any) =>
                Promise.resolve([{ count: mockJanAccommodations.length }]).then(resolve, reject),
            };
          }
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => Promise.resolve([...mockJanAccommodations])),
              })),
              // For fallback search (limit only, no offset)
              then: (resolve: any, reject?: any) =>
                Promise.resolve([...mockJanAccommodations]).then(resolve, reject),
            })),
            limit: vi.fn(() => ({
              offset: vi.fn(() => Promise.resolve([...mockJanAccommodations])),
            })),
            // Direct then for no where clause
            then: (resolve: any, reject?: any) =>
              Promise.resolve([...mockJanAccommodations]).then(resolve, reject),
          };
        }

        // Default for cases/employees/etc
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(() => ({
                orderBy: vi.fn(() => Promise.resolve([])),
              })),
              then: (resolve: any, reject?: any) =>
                Promise.resolve([]).then(resolve, reject),
            })),
            then: (resolve: any, reject?: any) =>
              Promise.resolve([]).then(resolve, reject),
          })),
        };
      }),
    };
  });

  return {
    db: {
      insert: insertHandler,
      update: updateHandler,
      select: selectHandler,
    },
    acmdCases: 'acmd_cases_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdNotifications: 'acmd_notifications_table',
    acmdEmployees: 'acmd_employees_table',
    acmdUsers: 'acmd_users_table',
    acmdSuggestions: 'acmd_suggestions_table',
    acmdJanAccommodations: 'acmd_jan_accommodations_table',
    acmdCompanies: { id: 'id', companyId: 'company_id' },
    acmdRefreshTokens: { tokenHash: 'token_hash' },
  };
});

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
// Mock @acmd/auth
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

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('escapeIlike (Fix 5 — ILIKE Wildcard Escape)', () => {
  it('should escape % character', async () => {
    const { escapeIlike } = await import('../src/services/janService.js');
    expect(escapeIlike('100% effective')).toBe('100\\% effective');
  });

  it('should escape _ character', async () => {
    const { escapeIlike } = await import('../src/services/janService.js');
    expect(escapeIlike('job_category')).toBe('job\\_category');
  });

  it('should escape \\ character', async () => {
    const { escapeIlike } = await import('../src/services/janService.js');
    expect(escapeIlike('back\\slash')).toBe('back\\\\slash');
  });

  it('should escape all special characters together', async () => {
    const { escapeIlike } = await import('../src/services/janService.js');
    expect(escapeIlike('100%_test\\value')).toBe('100\\%\\_test\\\\value');
  });

  it('should leave normal text unchanged', async () => {
    const { escapeIlike } = await import('../src/services/janService.js');
    expect(escapeIlike('mobility impairment')).toBe('mobility impairment');
  });

  it('should handle empty string', async () => {
    const { escapeIlike } = await import('../src/services/janService.js');
    expect(escapeIlike('')).toBe('');
  });
});

describe('JAN Search Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockJanAccommodations.length = 0;
  });

  describe('GET /api/v1/jan/search', () => {
    it('should return accommodations with condition filter', async () => {
      mockJanAccommodations.push(
        {
          id: 'jan-1',
          condition: 'mobility',
          jobCategory: 'office',
          accommodation: 'Ergonomic Desk',
          costEstimate: '$200-$600',
          costRange: 'low',
          effectiveness: 'high',
          description: 'Height-adjustable desk',
          sourceUrl: 'https://askjan.org/solutions/Adjustable-Desks.cfm',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      );

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?condition=mobility', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accommodations).toBeDefined();
      expect(Array.isArray(body.accommodations)).toBe(true);
      expect(body.total).toBeDefined();
      expect(body.limit).toBeDefined();
      expect(body.offset).toBeDefined();
    });

    it('should return accommodations with both condition and job filters', async () => {
      mockJanAccommodations.push({
        id: 'jan-2',
        condition: 'vision',
        jobCategory: 'customer_service',
        accommodation: 'Large Print Materials',
        costEstimate: '$50-$200',
        costRange: 'low',
        effectiveness: 'medium',
        description: 'Large-print reference materials',
        sourceUrl: 'https://askjan.org/solutions/Large-Print.cfm',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?condition=vision&job=customer', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accommodations).toBeDefined();
    });

    it('should support pagination with limit and offset', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?condition=mobility&limit=5&offset=10', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
    });

    it('should return empty results when no match', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?condition=nonexistent', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accommodations).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should return 400 for invalid limit (0)', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?limit=0', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for limit over 100', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?limit=999', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
    });

    it('should allow hr role to search', async () => {
      mockRole = 'hr';
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search?condition=hearing', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
    });

    it('should return all when no filters specified', async () => {
      mockJanAccommodations.push(
        { id: 'jan-1', condition: 'mobility', accommodation: 'Desk' },
        { id: 'jan-2', condition: 'vision', accommodation: 'Magnifier' },
      );

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/jan/search', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBe(2);
    });
  });
});
