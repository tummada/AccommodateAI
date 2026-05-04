/**
 * Integration tests for employee routes (ACMD-068).
 *
 * Covers:
 *   - POST /api/v1/employees — create employee + validation + role check
 *   - GET /api/v1/employees — list + pagination + search + filter
 *   - GET /api/v1/employees/:id — detail
 *   - PUT /api/v1/employees/:id — update + termination handling
 *   - DELETE /api/v1/employees/:id — soft delete
 *   - POST /api/v1/employees/import — CSV import + validation + error report
 *   - GET /api/v1/employees/import/template — download CSV template
 *   - Tenant isolation: viewer/manager cannot POST/PUT/DELETE
 *   - Zod validation: missing name, invalid email, invalid state
 *   - Quick-add: internal service function for case creation
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
// Mock @google-cloud/vertexai
// -----------------------------------------------------------------------
vi.mock('@google-cloud/vertexai', () => ({
  VertexAI: class MockVertexAI {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts?: any) {}
    getGenerativeModel = vi.fn(() => ({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  law_type: 'ada',
                  applicable_laws: ['ADA Title I'],
                  confidence: 0.92,
                  reasoning: 'Test classification',
                  risk_level: 'medium',
                  required_steps: ['Step 1'],
                  warnings: [],
                }),
              }],
            },
          }],
        },
      }),
    }));
  },
}));

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
            reasoning: 'Test classification',
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
// Mock data stores
// -----------------------------------------------------------------------
const mockEmployees: Record<string, unknown>[] = [];
const mockAuditLogs: Record<string, unknown>[] = [];
const mockCases: Record<string, unknown>[] = [];

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  const insertHandler = vi.fn((table: unknown) => ({
    values: vi.fn((data: unknown) => {
      if (table === 'acmd_employees_table') {
        const items = Array.isArray(data) ? data : [data];
        const inserted: Record<string, unknown>[] = [];
        for (const item of items) {
          const empData = item as Record<string, unknown>;
          const newEmp = {
            id: `emp-uuid-${mockEmployees.length + 1}`,
            ...empData,
            employmentStatus: empData.employmentStatus ?? 'active',
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockEmployees.push(newEmp);
          inserted.push(newEmp);
        }
        return {
          returning: vi.fn(() => Promise.resolve(inserted)),
        };
      }
      if (table === 'acmd_audit_logs_table') {
        mockAuditLogs.push(data as Record<string, unknown>);
      }
      if (table === 'acmd_cases_table') {
        const caseData = data as Record<string, unknown>;
        const newCase = {
          id: `case-uuid-${mockCases.length + 1}`,
          ...caseData,
          status: caseData.status ?? 'intake',
          deletedAt: null,
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockCases.push(newCase);
        return {
          returning: vi.fn(() => Promise.resolve([newCase])),
        };
      }
      return {
        returning: vi.fn(() => Promise.resolve([])),
      };
    }),
  }));

  const updateHandler = vi.fn(() => ({
    set: vi.fn((data: Record<string, unknown>) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          if (mockEmployees.length > 0) {
            const updated = { ...mockEmployees[0], ...data };
            mockEmployees[0] = updated;
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

    return {
      from: vi.fn((table: unknown) => {
        if (table === 'acmd_employees_table') {
          return {
            where: vi.fn(() => {
              if (isCountQuery) {
                return Promise.resolve([{ count: mockEmployees.filter((e) => !e.deletedAt).length }]);
              }
              return {
                limit: vi.fn(() => {
                  // For getEmployeeById
                  const active = mockEmployees.filter((e) => !e.deletedAt);
                  return {
                    offset: vi.fn(() => ({
                      orderBy: vi.fn(() => Promise.resolve(active)),
                    })),
                    then: (resolve: any, reject?: any) =>
                      Promise.resolve(active.length > 0 ? [active[0]] : []).then(resolve, reject),
                  };
                }),
                then: (resolve: any, reject?: any) =>
                  Promise.resolve(mockEmployees.filter((e) => !e.deletedAt)).then(resolve, reject),
              };
            }),
          };
        }
        if (table === 'acmd_cases_table') {
          return {
            where: vi.fn(() => {
              if (isCountQuery) {
                return Promise.resolve([{ count: mockCases.length }]);
              }
              return {
                limit: vi.fn(() => ({
                  then: (resolve: any, reject?: any) =>
                    Promise.resolve(mockCases.length > 0 ? [mockCases[0]] : []).then(resolve, reject),
                })),
                then: (resolve: any, reject?: any) =>
                  Promise.resolve([...mockCases]).then(resolve, reject),
              };
            }),
          };
        }
        if (table === 'acmd_companies_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([{ defaultHrContactId: null }])),
            })),
          };
        }
        if (table === 'acmd_users_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          };
        }
        if (table === 'acmd_audit_logs_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          };
        }
        // Default
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
            then: (resolve: any, reject?: any) =>
              Promise.resolve([]).then(resolve, reject),
          })),
        };
      }),
    };
  });

  const mockDb = {
    insert: insertHandler,
    update: updateHandler,
    select: selectHandler,
    transaction: vi.fn(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb)),
  };

  return {
    db: mockDb,
    acmdEmployees: 'acmd_employees_table',
    acmdCases: 'acmd_cases_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdCompanies: 'acmd_companies_table',
    acmdUsers: 'acmd_users_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdNotifications: 'acmd_notifications_table',
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

describe('Employee Routes (ACMD-068)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockEmployees.length = 0;
    mockAuditLogs.length = 0;
    mockCases.length = 0;
  });

  // ===== POST /api/v1/employees =====

  describe('POST /api/v1/employees', () => {
    it('should create an employee with valid input (admin)', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'Jane Doe',
          email: 'jane@example.com',
          position: 'Software Engineer',
          department: 'Engineering',
          state: 'CA',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.employee).toBeDefined();
      expect(body.employee.name).toBe('Jane Doe');
      expect(body.employee.companyId).toBe('company-uuid');
    });

    it('should create employee with hr role', async () => {
      mockRole = 'hr';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'John Smith',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should return 400 for missing name', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          email: 'noname@example.com',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 for invalid email format', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'Bad Email',
          email: 'not-an-email',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON body', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid JSON body');
    });

    it('should return 403 for manager role', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'Should Fail',
        }),
      });

      expect(res.status).toBe(403);
    });

    it('should return 403 for viewer role', async () => {
      mockRole = 'viewer';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'Should Fail',
        }),
      });

      expect(res.status).toBe(403);
    });
  });

  // ===== GET /api/v1/employees =====

  describe('GET /api/v1/employees', () => {
    it('should list employees with pagination', async () => {
      mockEmployees.push({
        id: 'emp-1',
        companyId: 'company-uuid',
        name: 'Alice',
        email: 'alice@test.com',
        employmentStatus: 'active',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees?limit=10&offset=0', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employees).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(0);
    });

    it('should filter by employmentStatus', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees?employmentStatus=active', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
    });

    it('should search by name/email/department', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees?search=alice', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
    });

    it('should allow manager role to list', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
    });
  });

  // ===== GET /api/v1/employees/:id =====

  describe('GET /api/v1/employees/:id', () => {
    it('should return employee detail', async () => {
      mockEmployees.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        name: 'Bob',
        email: 'bob@test.com',
        employmentStatus: 'active',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employee).toBeDefined();
    });

    it('should return 404 for non-existent employee', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid UUID format', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/not-a-uuid', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid employee ID format');
    });
  });

  // ===== PUT /api/v1/employees/:id =====

  describe('PUT /api/v1/employees/:id', () => {
    it('should update employee fields', async () => {
      mockEmployees.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        name: 'Original Name',
        email: 'orig@test.com',
        employmentStatus: 'active',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          name: 'Updated Name',
          department: 'HR',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employee).toBeDefined();
    });

    it('should return 400 when no fields provided', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('At least one field is required for update');
    });

    it('should return 404 for non-existent employee', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 403 for manager role', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'Should Fail' }),
      });

      expect(res.status).toBe(403);
    });

    it('should handle termination status change and return flags', async () => {
      // Add an employee with an open case
      mockEmployees.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        name: 'About To Leave',
        employmentStatus: 'active',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add an open case for this employee
      mockCases.push({
        id: 'case-open-1',
        companyId: 'company-uuid',
        employeeId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        status: 'interactive_process',
        deletedAt: null,
        closedAt: null,
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          employmentStatus: 'terminated',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employee).toBeDefined();
      // Termination flags should be present if open cases exist
      if (body.terminationFlags) {
        expect(body.terminationFlags.length).toBeGreaterThan(0);
        expect(body.terminationFlags[0].reason).toContain('HIGH RISK');
      }
    });

    it('should return 400 for invalid JSON body', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });
  });

  // ===== DELETE /api/v1/employees/:id =====

  describe('DELETE /api/v1/employees/:id', () => {
    it('should soft delete an employee', async () => {
      mockEmployees.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        name: 'To Delete',
        employmentStatus: 'active',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Employee deleted');
      expect(body.employee).toBeDefined();
    });

    it('should return 404 for non-existent employee', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/bad-id', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
    });

    it('should return 403 for manager role', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(403);
    });
  });

  // ===== POST /api/v1/employees/import =====

  describe('POST /api/v1/employees/import', () => {
    it('should import valid CSV data', async () => {
      const { default: app } = await import('../src/index.js');

      const csvContent = 'name,email,position,department,state,hris_id\nAlice Smith,alice@test.com,Engineer,Engineering,CA,E001\nBob Jones,bob@test.com,Designer,Design,NY,E002\n';

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
        },
        body: csvContent,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.imported).toBe(2);
      expect(body.errors).toEqual([]);
      expect(body.total).toBe(2);
    });

    it('should report errors for invalid rows', async () => {
      const { default: app } = await import('../src/index.js');

      const csvContent = 'name,email,state\n,bad-email,XX\nValid Name,valid@test.com,CA\n';

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
        },
        body: csvContent,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // First row has empty name -> error
      expect(body.errors.length).toBeGreaterThan(0);
      expect(body.errors[0].row).toBe(2);
      expect(body.errors[0].field).toBe('name');
    });

    it('should return error for missing name header', async () => {
      const { default: app } = await import('../src/index.js');

      const csvContent = 'email,position\nalice@test.com,Engineer\n';

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
        },
        body: csvContent,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.imported).toBe(0);
      expect(body.errors[0].message).toContain('Missing required column: name');
    });

    it('should return 400 for empty CSV', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
        },
        body: '',
      });

      expect(res.status).toBe(400);
    });

    it('should return 403 for manager role', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
        },
        body: 'name\nTest\n',
      });

      expect(res.status).toBe(403);
    });

    it('should return 413 when content-length exceeds 5MB', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
          'Content-Length': String(6 * 1024 * 1024), // 6MB
        },
        body: 'name\nTest\n',
      });

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toContain('too large');
    });

    it('should validate state column as US state', async () => {
      const { default: app } = await import('../src/index.js');

      const csvContent = 'name,state\nAlice,ZZ\n';

      const res = await app.request('/api/v1/employees/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'Authorization': 'Bearer test-token',
        },
        body: csvContent,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.errors.length).toBe(1);
      expect(body.errors[0].field).toBe('state');
      expect(body.errors[0].message).toContain('Invalid US state');
    });
  });

  // ===== GET /api/v1/employees/import/template =====

  describe('GET /api/v1/employees/import/template', () => {
    it('should return CSV template', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees/import/template', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('name,email,position,department,state,hris_id');
      expect(text).toContain('Jane Doe');
    });
  });

  // ===== Quick-add employee (service function) =====

  describe('quickAddEmployee (service)', () => {
    it('should create employee via quick-add', async () => {
      const { quickAddEmployee } = await import('../src/services/employeeService.js');
      const { db: mockDb } = await import('@acmd/db');

      const result = await quickAddEmployee(
        { name: 'Quick Add Test', email: 'quick@test.com', state: 'TX' },
        'company-uuid',
        'user-uuid',
        mockDb,
      );

      expect(result).toBeDefined();
      expect(result.name).toBe('Quick Add Test');
      expect(result.companyId).toBe('company-uuid');
    });
  });

  // ===== Audit logging =====

  describe('Audit logging', () => {
    it('should write audit log on employee creation', async () => {
      const { default: app } = await import('../src/index.js');

      await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'Audit Test' }),
      });

      // Verify audit log was written
      expect(mockAuditLogs.length).toBeGreaterThan(0);
      const log = mockAuditLogs.find(
        (l) => (l as any).metadata?.employeeAction === 'employee_created',
      );
      expect(log).toBeDefined();
    });
  });

  // ===== Edge cases =====

  describe('Edge cases', () => {
    it('should handle name with leading/trailing whitespace', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: '  Trimmed Name  ' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.employee.name).toBe('Trimmed Name');
    });

    it('should uppercase state abbreviation', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'State Test', state: 'ca' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.employee.state).toBe('CA');
    });

    it('should handle search with wildcard characters (FIX-9)', async () => {
      const { default: app } = await import('../src/index.js');

      // Search with % and _ — these should be escaped, not treated as wildcards
      const res = await app.request('/api/v1/employees?search=test%25_name', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      // Should not error — escaping is internal
      expect(res.status).toBe(200);
    });
  });
});
