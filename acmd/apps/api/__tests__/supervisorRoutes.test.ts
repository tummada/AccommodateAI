/**
 * Tests for Phase 7C: Supervisor Review Routes
 * Task: ACMD-159
 *
 * Covers:
 *   1. Happy path: supervisor-approve / supervisor-reject / supervisor-request-info
 *   2. Role gate: manager/hr get 403 (only super_admin allowed)
 *   3. Validation: missing reason/questions → 400
 *   4. Business rules: decision not found → 400; decisionType not 'denied' → 400
 *   5. UUID invalid → 400
 *   6. Audit log for all 3 supervisor actions
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
      generateContent: vi.fn().mockResolvedValue({ response: { candidates: [] } }),
    }));
  },
}));

// -----------------------------------------------------------------------
// Mock @anthropic-ai/sdk
// -----------------------------------------------------------------------
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
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
const mockAuditLogs: Record<string, unknown>[] = [];
const mockDecisions: Record<string, unknown>[] = [];
const mockSettings: Record<string, unknown>[] = [];
const mockNotifications: Record<string, unknown>[] = [];
const mockUsers: Record<string, unknown>[] = [];
let mockDecisionIdCounter = 0;
let mockSettingsIdCounter = 0;

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  let auditIdCounter = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertHandler = vi.fn((table: unknown) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: vi.fn((data: any) => {
      if (table === 'acmd_case_decisions_table') {
        mockDecisionIdCounter++;
        const dec = {
          id: `decision-uuid-${mockDecisionIdCounter}`,
          ...data,
          legalReviewed: data.legalReviewed ?? false,
          legalReviewedBy: null,
          legalReviewedAt: null,
          supervisorStatus: data.supervisorStatus ?? null,
          supervisorId: null,
          supervisorReviewedAt: null,
          supervisorRejectReason: null,
          supervisorInfoRequest: null,
          createdAt: new Date(),
        };
        mockDecisions.push(dec);
        return { returning: vi.fn(() => Promise.resolve([dec])) };
      }
      if (table === 'acmd_approval_settings_table') {
        mockSettingsIdCounter++;
        const s = {
          id: `settings-uuid-${mockSettingsIdCounter}`,
          ...data,
        };
        mockSettings.push(s);
        const returningFn = vi.fn(() => Promise.resolve([s]));
        return {
          returning: returningFn,
          onConflictDoUpdate: vi.fn(() => ({
            returning: returningFn,
          })),
        };
      }
      if (table === 'acmd_audit_logs_table') {
        const id = `audit-${auditIdCounter++}`;
        const log = { id, ...(data as Record<string, unknown>), createdAt: new Date() };
        mockAuditLogs.push(log);
        return { returning: vi.fn(() => Promise.resolve([log])) };
      }
      if (table === 'acmd_notifications_table') {
        mockNotifications.push(data as Record<string, unknown>);
        return { returning: vi.fn(() => Promise.resolve([])) };
      }
      if (table === 'acmd_cases_table') {
        const caseData = data as Record<string, unknown>;
        const newCase = {
          id: '00000000-0000-4000-a000-000000000001',
          ...caseData,
          status: caseData.status ?? 'intake',
          type: caseData.type ?? 'ada',
          pwfaPerSe: caseData.pwfaPerSe ?? false,
          requestDescription: caseData.requestDescription ?? 'Test accommodation request',
          medicalInfo: null,
          aiClassification: null,
          suggestedAccommodations: null,
          approvedAccommodation: null,
          denialReason: null,
          deadline: null,
          closedAt: null,
          deletedAt: null,
          assignedTo: caseData.assignedTo ?? '00000000-0000-4000-a000-000000000099',
          assignedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockCases.push(newCase);
        return { returning: vi.fn(() => Promise.resolve([newCase])) };
      }
      return { returning: vi.fn(() => Promise.resolve([])) };
    }),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateHandler = vi.fn(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set: vi.fn((data: any) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          // Decision update (supervisor review)
          if (mockDecisions.length > 0 && data.supervisorStatus !== undefined) {
            const updated = { ...mockDecisions[0], ...data };
            mockDecisions[0] = updated;
            return Promise.resolve([updated]);
          }
          // Settings update
          if (mockSettings.length > 0 && data.updatedAt) {
            const updated = { ...mockSettings[0], ...data };
            mockSettings[0] = updated;
            return Promise.resolve([updated]);
          }
          // Decision update (legal review)
          if (mockDecisions.length > 0 && data.legalReviewed !== undefined) {
            const updated = { ...mockDecisions[0], ...data };
            mockDecisions[0] = updated;
            return Promise.resolve([updated]);
          }
          // Cases update
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

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: vi.fn((table: unknown) => {
        // Approval settings
        if (table === 'acmd_approval_settings_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve(mockSettings.length > 0 ? [mockSettings[0]] : []),
              ),
            })),
          };
        }

        // Case decisions
        if (table === 'acmd_case_decisions_table') {
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() =>
                  Promise.resolve(mockDecisions.length > 0 ? [mockDecisions[0]] : []),
                ),
              })),
              limit: vi.fn(() =>
                Promise.resolve(mockDecisions.length > 0 ? [mockDecisions[0]] : []),
              ),
            })),
          };
        }

        // Users
        if (table === 'acmd_users_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve(mockUsers.length > 0 ? [mockUsers[0]] : []),
              ),
            })),
          };
        }

        // Employees
        if (table === 'acmd_employees_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{
                  id: '00000000-0000-4000-a000-000000000050',
                  name: 'Test Employee',
                  position: 'Engineer',
                  department: 'Engineering',
                  state: 'CA',
                  companyId: '00000000-0000-4000-a000-000000000010',
                }]),
              ),
            })),
          };
        }

        // Companies
        if (table === 'acmd_companies_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ defaultHrContactId: null }]),
              ),
            })),
          };
        }

        // Cases + default
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
                then: (resolve: Function, reject?: Function) =>
                  Promise.resolve(mockCases.length > 0 ? [mockCases[0]] : []).then(
                    resolve as any,
                    reject as any,
                  ),
              })),
              then: (resolve: Function, reject?: Function) =>
                Promise.resolve([...mockCases]).then(resolve as any, reject as any),
            };
          }),
        };
      }),
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactionHandler = vi.fn(async (fn: any) => {
    const txDb = {
      insert: insertHandler,
      update: updateHandler,
      select: selectHandler,
    };
    return fn(txDb);
  });

  return {
    db: {
      insert: insertHandler,
      update: updateHandler,
      select: selectHandler,
      transaction: transactionHandler,
    },
    acmdCases: 'acmd_cases_table',
    acmdCaseDecisions: 'acmd_case_decisions_table',
    acmdApprovalSettings: 'acmd_approval_settings_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdNotifications: 'acmd_notifications_table',
    acmdEmployees: 'acmd_employees_table',
    acmdUsers: 'acmd_users_table',
    acmdSuggestions: 'acmd_suggestions_table',
    acmdJanAccommodations: 'acmd_jan_accommodations_table',
    acmdCompanies: 'acmd_companies_table',
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
      c.set('userId', '00000000-0000-4000-a000-000000000020');
      c.set('companyId', '00000000-0000-4000-a000-000000000010');
      c.set('role', mockRole);
      c.set('product', 'acmd');
      c.set('tenantDb', { companyId: '00000000-0000-4000-a000-000000000010', select: vi.fn() });
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
  createTenantScope: vi.fn(() => ({ companyId: '00000000-0000-4000-a000-000000000010', select: vi.fn() })),
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
// Helpers
// -----------------------------------------------------------------------

const VALID_CASE_ID = '00000000-0000-4000-a000-000000000001';
const SUPERVISOR_APPROVE_URL = `/api/v1/cases/${VALID_CASE_ID}/decision/supervisor-approve`;
const SUPERVISOR_REJECT_URL = `/api/v1/cases/${VALID_CASE_ID}/decision/supervisor-reject`;
const SUPERVISOR_REQUEST_INFO_URL = `/api/v1/cases/${VALID_CASE_ID}/decision/supervisor-request-info`;

function setupDenialDecision(overrides: Record<string, unknown> = {}) {
  const dec = {
    id: '00000000-0000-4000-a000-000000000060',
    caseId: VALID_CASE_ID,
    companyId: '00000000-0000-4000-a000-000000000010',
    decisionType: 'denied',
    supervisorStatus: 'pending_review',
    supervisorId: null,
    supervisorReviewedAt: null,
    supervisorRejectReason: null,
    supervisorInfoRequest: null,
    legalReviewRequired: true,
    legalReviewed: false,
    decidedBy: '00000000-0000-4000-a000-000000000099',
    decidedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
  mockDecisions.push(dec);
  return dec;
}

// -----------------------------------------------------------------------
// Reset state between tests
// -----------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockCases.length = 0;
  mockAuditLogs.length = 0;
  mockDecisions.length = 0;
  mockSettings.length = 0;
  mockNotifications.length = 0;
  mockUsers.length = 0;
  mockDecisionIdCounter = 0;
  mockSettingsIdCounter = 0;
  mockRole = 'super_admin';
});

// =====================================================================
// 1. supervisor-approve — happy path
// =====================================================================

describe('POST /cases/:id/decision/supervisor-approve', () => {
  it('should return 200 with decision when super_admin approves a pending denial', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.supervisorStatus).toBe('approved');
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    expect(res.status).toBe(403);
  });

  it('should return 403 for hr role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    expect(res.status).toBe(403);
  });

  it('should return 400 when no decision exists', async () => {
    const app = (await import('../src/index.js')).default;
    // No decision in store

    const res = await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Decision not found');
  });

  it('should return 400 when decision is approved (not denied)', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision({ decisionType: 'approved', supervisorStatus: 'pending_review' });

    const res = await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No pending denial for supervisor review');
  });

  it('should return 400 when supervisor_status is already "approved"', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision({ supervisorStatus: 'approved' });

    const res = await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No pending denial for supervisor review');
  });

  it('should return 400 for invalid UUID', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/cases/not-a-uuid/decision/supervisor-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid case ID format');
  });

  it('should audit log supervisor_approved action', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    await app.request(SUPERVISOR_APPROVE_URL, { method: 'POST' });

    const supervisorLogs = mockAuditLogs.filter((l) => l.action === 'supervisor_approved');
    expect(supervisorLogs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 2. supervisor-reject — happy path + validation
// =====================================================================

describe('POST /cases/:id/decision/supervisor-reject', () => {
  it('should return 200 with decision when super_admin rejects a pending denial', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'The denial lacks sufficient justification for undue hardship.' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.supervisorStatus).toBe('rejected');
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'The denial is insufficient.' }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 403 for hr role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';

    const res = await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'The denial is insufficient.' }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 400 when reason is missing', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('should return 400 when reason is too short (< 10 chars)', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Short' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('should return 400 when no decision exists', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Insufficient justification provided for the denial decision.' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Decision not found');
  });

  it('should return 400 for invalid UUID', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/cases/not-a-uuid/decision/supervisor-reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Insufficient justification for denial.' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid case ID format');
  });

  it('should audit log supervisor_rejected action', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    await app.request(SUPERVISOR_REJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'The denial lacks sufficient justification for undue hardship.' }),
    });

    const supervisorLogs = mockAuditLogs.filter((l) => l.action === 'supervisor_rejected');
    expect(supervisorLogs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 3. supervisor-request-info — happy path + validation + repeat request
// =====================================================================

describe('POST /cases/:id/decision/supervisor-request-info', () => {
  it('should return 200 with decision when super_admin requests info on a pending denial', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please provide documentation of the financial analysis for this denial.' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.supervisorStatus).toBe('info_requested');
  });

  it('should allow re-requesting info when supervisor_status is already "info_requested"', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision({ supervisorStatus: 'info_requested' });

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please also provide the operational impact report from the facilities team.' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.supervisorStatus).toBe('info_requested');
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please provide more details about the decision rationale.' }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 403 for hr role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please provide more details about the decision rationale.' }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 400 when questions field is missing', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('should return 400 when questions is too short (< 10 chars)', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Why?' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('should return 400 when no decision exists', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please provide more details about the denial rationale and impact.' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Decision not found');
  });

  it('should return 400 for invalid UUID', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/cases/not-a-uuid/decision/supervisor-request-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please provide documentation for this denial decision.' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid case ID format');
  });

  it('should audit log supervisor_info_requested action', async () => {
    const app = (await import('../src/index.js')).default;
    setupDenialDecision();

    await app.request(SUPERVISOR_REQUEST_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: 'Please provide documentation of the financial analysis for this denial.' }),
    });

    const supervisorLogs = mockAuditLogs.filter((l) => l.action === 'supervisor_info_requested');
    expect(supervisorLogs.length).toBeGreaterThanOrEqual(1);
  });
});
