/**
 * Integration + unit tests for Checklist Routes + Checklist Service.
 *
 * Covers:
 *   - GET /api/v1/cases/:id/checklist — list items + tenant isolation
 *   - PATCH /api/v1/cases/:id/checklist/:itemId — toggle + role check
 *   - Checklist completion notification
 *   - POST /api/v1/admin/check-deadlines — admin only
 *   - Role enforcement: viewer can GET but not PATCH
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
        content: [{
          type: 'text',
          text: JSON.stringify({
            law_type: 'ada',
            applicable_laws: ['ADA Title I'],
            confidence: 0.92,
            reasoning: 'Test',
            risk_level: 'medium',
            required_steps: ['Step 1'],
            warnings: [],
          }),
        }],
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
const mockCases: Record<string, unknown>[] = [];
const mockChecklistItems: Record<string, unknown>[] = [];
const mockAuditLogs: Record<string, unknown>[] = [];
const mockNotifications: Record<string, unknown>[] = [];
const mockUsers: Record<string, unknown>[] = [];

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  const insertHandler = vi.fn((table: unknown) => ({
    values: vi.fn((data: unknown) => {
      if (table === 'acmd_cases_table') {
        const caseData = data as Record<string, unknown>;
        const newCase = {
          id: 'case-uuid-1',
          ...caseData,
          status: caseData.status ?? 'intake',
          aiClassification: null,
          suggestedAccommodations: null,
          approvedAccommodation: null,
          denialReason: null,
          deadline: null,
          assignedTo: null,
          closedAt: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockCases.push(newCase);
        return { returning: vi.fn(() => Promise.resolve([newCase])) };
      }
      if (table === 'acmd_checklist_items_table') {
        const items = Array.isArray(data) ? data : [data];
        for (const item of items as Record<string, unknown>[]) {
          mockChecklistItems.push({
            id: `checklist-${mockChecklistItems.length + 1}`,
            ...item,
            completed: false,
            completedAt: null,
            completedBy: null,
            createdAt: new Date(),
          });
        }
      }
      if (table === 'acmd_audit_logs_table') {
        mockAuditLogs.push({ id: `audit-${mockAuditLogs.length + 1}`, ...(data as Record<string, unknown>) });
      }
      if (table === 'acmd_notifications_table') {
        mockNotifications.push({ id: `notif-${mockNotifications.length + 1}`, ...(data as Record<string, unknown>) });
      }
      return { returning: vi.fn(() => Promise.resolve([])) };
    }),
  }));

  const updateHandler = vi.fn(() => ({
    set: vi.fn((data: Record<string, unknown>) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          // For checklist items toggle
          if (data.completed !== undefined) {
            const item = mockChecklistItems.find(
              (i) => i.completed !== data.completed || true,
            );
            if (item) {
              Object.assign(item, data);
              return Promise.resolve([{ ...item }]);
            }
          }
          // For cases
          if (mockCases.length > 0) {
            const updated = { ...mockCases[0], ...data };
            mockCases[0] = updated;
            return Promise.resolve([updated]);
          }
          return Promise.resolve([]);
        }),
      })),
    })),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectHandler = vi.fn((...args: any[]) => {
    const isCountQuery = args.length > 0 && args[0] && typeof args[0] === 'object' && 'count' in args[0];
    const isIdOnlyQuery = args.length > 0 && args[0] && typeof args[0] === 'object' && 'id' in args[0] && !('count' in args[0]);

    return {
      from: vi.fn((table: unknown) => {
        // For checklist items
        if (table === 'acmd_checklist_items_table') {
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => Promise.resolve([...mockChecklistItems])),
              limit: vi.fn(() => Promise.resolve(
                mockChecklistItems.length > 0 ? [mockChecklistItems[0]] : [],
              )),
              // Also directly thenable
              then: (resolve: any, reject?: any) =>
                Promise.resolve([...mockChecklistItems]).then(resolve, reject),
            })),
          };
        }

        // For users table (deadline service: find admins)
        if (table === 'acmd_users_table') {
          return {
            where: vi.fn(() => Promise.resolve([...mockUsers])),
          };
        }

        // For employees
        if (table === 'acmd_employees_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{
                  id: 'emp-uuid',
                  name: 'Test Employee',
                  position: 'Engineer',
                  department: 'Engineering',
                  state: 'CA',
                  companyId: 'company-uuid',
                }]),
              ),
            })),
          };
        }

        // For notifications (duplicate check)
        if (table === 'acmd_notifications_table') {
          if (isIdOnlyQuery) {
            return {
              where: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve([])),
              })),
            };
          }
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
              then: (resolve: any, reject?: any) =>
                Promise.resolve([...mockNotifications]).then(resolve, reject),
            })),
          };
        }

        // For audit logs (duplicate check)
        if (table === 'acmd_audit_logs_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          };
        }

        // For cases table
        return {
          where: vi.fn(() => {
            if (isCountQuery) {
              return Promise.resolve([{ count: mockCases.length }]);
            }
            return {
              limit: vi.fn(() => ({
                offset: vi.fn(() => ({
                  orderBy: vi.fn(() => Promise.resolve([...mockCases])),
                })),
                then: (resolve: any, reject?: any) =>
                  Promise.resolve(mockCases.length > 0 ? [mockCases[0]] : []).then(resolve, reject),
              })),
              then: (resolve: any, reject?: any) =>
                Promise.resolve([...mockCases]).then(resolve, reject),
            };
          }),
        };
      }),
    };
  });

  const dbObj = {
    insert: insertHandler,
    update: updateHandler,
    select: selectHandler,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async (fn: any) => fn(dbObj)),
  };

  return {
    db: dbObj,
    acmdCases: 'acmd_cases_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdNotifications: 'acmd_notifications_table',
    acmdEmployees: 'acmd_employees_table',
    acmdUsers: 'acmd_users_table',
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

describe('Checklist Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockCases.length = 0;
    mockChecklistItems.length = 0;
    mockAuditLogs.length = 0;
    mockNotifications.length = 0;
    mockUsers.length = 0;
  });

  // ---- GET /api/v1/cases/:id/checklist ----

  describe('GET /api/v1/cases/:id/checklist', () => {
    it('should return checklist items for a valid case', async () => {
      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'intake',
        type: 'ada',
      });
      mockChecklistItems.push(
        { id: 'cl-1', caseId: 'case-uuid-1', stepName: 'Acknowledge request', stepOrder: 1, completed: false, completedAt: null, completedBy: null },
        { id: 'cl-2', caseId: 'case-uuid-1', stepName: 'Gather info', stepOrder: 2, completed: false, completedAt: null, completedBy: null },
      );

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.checklist).toBeDefined();
      expect(Array.isArray(body.checklist)).toBe(true);
    });

    it('should return 404 for case not in company', async () => {
      // Empty mockCases = no case found
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/cases/bad-uuid/checklist', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
    });

    it('should allow hr role to GET checklist', async () => {
      mockRole = 'hr';
      mockCases.push({ id: 'case-uuid-1', companyId: 'company-uuid', status: 'intake', type: 'ada' });

      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
    });
  });

  // ---- PATCH /api/v1/cases/:id/checklist/:itemId ----

  describe('PATCH /api/v1/cases/:id/checklist/:itemId', () => {
    it('should toggle checklist item for admin', async () => {
      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'intake',
        type: 'ada',
      });
      mockChecklistItems.push({
        id: 'cl-1',
        caseId: 'case-uuid-1',
        stepName: 'Acknowledge request',
        stepOrder: 1,
        completed: false,
        completedAt: null,
        completedBy: null,
      });

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.item).toBeDefined();
      expect(body.allComplete).toBeDefined();
    });

    it('should return 403 for unknown role on PATCH', async () => {
      mockRole = 'viewer'; // legacy role — no longer valid
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(403);
    });

    it('should allow manager role on PATCH', async () => {
      mockRole = 'manager';
      mockCases.push({ id: 'case-uuid-1', companyId: 'company-uuid', status: 'open' });
      mockChecklistItems.push({
        id: 'cl-1',
        caseId: 'case-uuid-1',
        stepName: 'Test step',
        stepOrder: 1,
        completed: false,
        completedAt: null,
        completedBy: null,
      });

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/bad/checklist/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid item UUID', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist/bad',
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent case', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/checklist/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(404);
    });
  });

  // ---- POST /api/v1/admin/check-deadlines ----

  describe('POST /api/v1/admin/check-deadlines', () => {
    it('should succeed for super_admin role', async () => {
      mockRole = 'super_admin';
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/admin/check-deadlines', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Deadline check completed');
      expect(body.casesChecked).toBeDefined();
    });

    it('should return 403 for hr role', async () => {
      mockRole = 'hr';
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/admin/check-deadlines', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(403);
    });

    it('should return 403 for manager role', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');
      const res = await app.request('/api/v1/admin/check-deadlines', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(403);
    });
  });
});
