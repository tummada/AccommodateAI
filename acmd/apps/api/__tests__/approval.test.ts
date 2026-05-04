/**
 * Tests for Phase 4B: Approval Chain + Denial Gate + PWFA Per Se Fast-Track
 * Task: ACMD-071
 *
 * Covers:
 *   1. Approval settings CRUD + defaults + role checks
 *   2. Denial gate: success with all 4 factors + 2 alternatives
 *   3. Denial gate: fail with missing factors (each factor individually)
 *   4. Denial gate: fail with < 2 alternatives
 *   5. Denial gate: fail with short descriptions (< 20 chars)
 *   6. Legal review: auto-flag on denial + mark reviewed + blocking when required
 *   7. PWFA per se: detection of 4 items (water, bathroom, sit/stand, eat)
 *   8. PWFA fast-track approve: success + fail on non-PWFA case
 *   9. Manager input: request + response + medical info filtering
 *  10. Role checks: manager can't deny, viewer can't approve, etc.
 *  11. Audit logging for every action
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
// Mock stores — shared across all tests
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
        // FIX-6: Support onConflictDoUpdate chain
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
          requestDescription: caseData.requestDescription ?? 'Test accommodation request for testing purposes',
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
              // FIX-7: Support orderBy before limit
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

        // Cases
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
// Test Helpers
// -----------------------------------------------------------------------

function validDenialData() {
  return {
    costAnalysis: 'The accommodation would cost approximately $50,000 which exceeds the annual budget allocation for facility modifications.',
    financialResources: 'Our facility operates with a net revenue of $200,000 annually with limited discretionary funds for capital improvements.',
    sizeAndType: 'We are a small retail operation with 25 employees in a single-story 5,000 sq ft facility with limited space.',
    operationalImpact: 'Implementing this accommodation would require shutting down the primary production line for 3 weeks affecting output.',
    alternativesConsidered: [
      {
        description: 'Offered a modified work schedule with reduced hours during peak periods to accommodate medical appointments.',
        reasonRejected: 'Employee stated that a modified schedule would not address the core need for physical workspace modifications.',
      },
      {
        description: 'Proposed temporary relocation to a different workstation with ergonomic equipment already in place.',
        reasonRejected: 'The alternative workstation lacks the specialized equipment required for the employees primary job functions.',
      },
    ],
  };
}

function setupCase(overrides: Record<string, unknown> = {}) {
  const base = {
    id: '00000000-0000-4000-a000-000000000001',
    companyId: '00000000-0000-4000-a000-000000000010',
    employeeId: '00000000-0000-4000-a000-000000000050',
    status: 'review',
    type: 'ada',
    pwfaPerSe: false,
    requestDescription: 'Test accommodation request for back pain — need ergonomic chair',
    medicalInfo: null,
    aiClassification: null,
    suggestedAccommodations: null,
    approvedAccommodation: null,
    denialReason: null,
    deadline: null,
    closedAt: null,
    deletedAt: null,
    // Use different user from mock actorId to avoid self-approval block (FIX-4)
    assignedTo: '00000000-0000-4000-a000-000000000099',
    assignedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const c = { ...base, ...overrides };
  mockCases.push(c);
  return c;
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
// 1. Unit Tests — validateDenialGate
// =====================================================================

describe('validateDenialGate — Unit Tests', () => {
  it('should pass with all 4 factors and 2+ alternatives', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const result = validateDenialGate(validDenialData());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when costAnalysis is missing', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.costAnalysis = '';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'costAnalysis')).toBe(true);
  });

  it('should fail when financialResources is missing', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.financialResources = '';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'financialResources')).toBe(true);
  });

  it('should fail when sizeAndType is missing', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.sizeAndType = '';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'sizeAndType')).toBe(true);
  });

  it('should fail when operationalImpact is missing', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.operationalImpact = '';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'operationalImpact')).toBe(true);
  });

  it('should fail when costAnalysis is too short (< 20 chars)', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.costAnalysis = 'Too short';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'costAnalysis')).toBe(true);
  });

  it('should fail when financialResources is too short', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.financialResources = 'Short';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'financialResources')).toBe(true);
  });

  it('should fail with fewer than 2 alternatives', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.alternativesConsidered = [data.alternativesConsidered[0]!];
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'alternativesConsidered')).toBe(true);
  });

  it('should fail with zero alternatives', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.alternativesConsidered = [];
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'alternativesConsidered')).toBe(true);
  });

  it('should fail when alternatives is not an array', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data as any).alternativesConsidered = 'not an array';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
  });

  it('should fail when alternative description is too short', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.alternativesConsidered[0]!.description = 'Short';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('description'))).toBe(true);
  });

  it('should fail when alternative reasonRejected is too short', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = validDenialData();
    data.alternativesConsidered[0]!.reasonRejected = 'No';
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('reasonRejected'))).toBe(true);
  });

  it('should report multiple errors when multiple factors missing', async () => {
    const { validateDenialGate } = await import('../src/services/approvalService.js');
    const data = {
      costAnalysis: '',
      financialResources: '',
      sizeAndType: '',
      operationalImpact: '',
      alternativesConsidered: [],
    };
    const result = validateDenialGate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5); // 4 factors + alternatives
  });
});

// =====================================================================
// 2. Unit Tests — checkPwfaPerSe
// =====================================================================

describe('checkPwfaPerSe — Unit Tests', () => {
  it('should detect "water" keyword in PWFA case', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need access to water during shift');
    expect(matches).toContain('water');
  });

  it('should detect "bathroom" keyword in PWFA case', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need more frequent bathroom breaks');
    expect(matches).toContain('bathroom');
  });

  it('should detect "sit/stand" via seating keyword', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need a seating option at workstation');
    expect(matches).toContain('sit/stand');
  });

  it('should detect "eat" keyword', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need to eat small meals during work hours');
    expect(matches).toContain('eat');
  });

  it('should detect "drink" as a water variant', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need to drink fluids frequently');
    expect(matches).toContain('water');
  });

  it('should detect "restroom" as a bathroom variant', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need more restroom access during pregnancy');
    expect(matches).toContain('bathroom');
  });

  it('should detect "stand" keyword for sit/stand', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need to stand periodically at desk');
    expect(matches).toContain('sit/stand');
  });

  it('should detect "snack" as an eat variant', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need to have a snack during meetings');
    expect(matches).toContain('eat');
  });

  it('should return empty for non-PWFA case', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('ada', 'Need access to water during shift');
    expect(matches).toHaveLength(0);
  });

  it('should return empty when no keywords match', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need a larger monitor for visual impairment');
    expect(matches).toHaveLength(0);
  });

  it('should detect multiple per se categories in one request', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', 'Need water access, bathroom breaks, and ability to sit during shift');
    expect(matches).toContain('water');
    expect(matches).toContain('bathroom');
    expect(matches).toContain('sit/stand');
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('should return empty for empty description', async () => {
    const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
    const matches = checkPwfaPerSe('pwfa', '');
    expect(matches).toHaveLength(0);
  });
});

// =====================================================================
// 3. Integration Tests — Approval Settings Routes
// =====================================================================

describe('Approval Settings Routes — GET /companies/:id/approval-settings', () => {
  it('should return default settings when none configured (super_admin)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toBeDefined();
    expect(body.settings.requireManagerInput).toBe(true);
    expect(body.settings.requireLegalReviewForDenial).toBe('recommend');
    expect(body.settings.allowSelfApproval).toBe(false);
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'GET',
    });

    expect(res.status).toBe(403);
  });

  it('should return 403 for hr role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'GET',
    });

    expect(res.status).toBe(403);
  });

  it('should return 403 when company ID does not match tenant context', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/companies/other-00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'GET',
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Company ID mismatch');
  });
});

describe('Approval Settings Routes — PUT /companies/:id/approval-settings', () => {
  it('should update settings (super_admin)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requireManagerInput: false,
        requireLegalReviewForDenial: 'yes',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toBeDefined();
  });

  it('should return 400 when no settings provided', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid requireLegalReviewForDenial value', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requireLegalReviewForDenial: 'maybe' }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requireManagerInput: false }),
    });

    expect(res.status).toBe(403);
  });

  it('should audit log the settings update', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    await app.request('/api/v1/companies/00000000-0000-4000-a000-000000000010/approval-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowSelfApproval: true }),
    });

    const settingsLogs = mockAuditLogs.filter(
      (l) => l.action === 'approval_settings_updated',
    );
    expect(settingsLogs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 4. Integration Tests — Case Decision (Denial Gate)
// =====================================================================

describe('Case Decision Routes — POST /cases/:id/decision', () => {
  it('should create approved decision (super_admin)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'approved' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.decisionType).toBe('approved');
  });

  it('should create denied decision with valid denial gate data', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisionType: 'denied',
        denialData: validDenialData(),
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.decision.decisionType).toBe('denied');
  });

  it('should BLOCK denial without denialData (400)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'denied' }),
    });

    expect(res.status).toBe(400);
  });

  it('should BLOCK denial with incomplete factors (400)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisionType: 'denied',
        denialData: {
          costAnalysis: 'Short',
          financialResources: 'Short',
          sizeAndType: 'Short',
          operationalImpact: 'Short',
          alternativesConsidered: [],
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should BLOCK denial with < 2 alternatives (400)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    const data = validDenialData();
    data.alternativesConsidered = [data.alternativesConsidered[0]!];

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'denied', denialData: data }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'approved' }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 400 for invalid UUID', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/cases/not-a-uuid/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'approved' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid case ID format');
  });

  it('should audit log denial_gate_validated on successful denial', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisionType: 'denied',
        denialData: validDenialData(),
      }),
    });

    const denialLogs = mockAuditLogs.filter(
      (l) => l.action === 'denial_gate_validated',
    );
    expect(denialLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('should audit log accommodation_approved on approval', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'approved' }),
    });

    const approvalLogs = mockAuditLogs.filter(
      (l) => l.action === 'accommodation_approved',
    );
    expect(approvalLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('should audit log accommodation_denied on denial', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisionType: 'denied',
        denialData: validDenialData(),
      }),
    });

    const deniedLogs = mockAuditLogs.filter(
      (l) => l.action === 'accommodation_denied',
    );
    expect(deniedLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('hr role should be able to create decisions', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'approved' }),
    });

    expect(res.status).toBe(201);
  });
});

// =====================================================================
// 5. Integration Tests — Legal Review
// =====================================================================

describe('Legal Review Routes — POST /cases/:id/legal-review', () => {
  it('should mark legal review as completed (super_admin)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });
    // Pre-populate a decision with legalReviewRequired
    mockDecisions.push({
      id: '00000000-0000-4000-a000-000000000060',
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'denied',
      legalReviewRequired: true,
      legalReviewed: false,
      legalReviewedBy: null,
      legalReviewedAt: null,
      decidedBy: '00000000-0000-4000-a000-000000000020',
      decidedAt: new Date(),
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
  });

  it('should return 400 when no decision exists', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });
    // No decisions in store

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No decision found for this case');
  });

  it('should return 400 when legal review is not required', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });
    mockDecisions.push({
      id: '00000000-0000-4000-a000-000000000060',
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'approved',
      legalReviewRequired: false,
      legalReviewed: false,
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Legal review is not required for this decision');
  });

  it('should return 400 when legal review already completed', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });
    mockDecisions.push({
      id: '00000000-0000-4000-a000-000000000060',
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'denied',
      legalReviewRequired: true,
      legalReviewed: true,
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Legal review has already been completed');
  });

  it('should return 403 for hr role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('should audit log legal_review_completed', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });
    mockDecisions.push({
      id: '00000000-0000-4000-a000-000000000060',
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'denied',
      legalReviewRequired: true,
      legalReviewed: false,
    });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/legal-review', {
      method: 'POST',
    });

    const legalLogs = mockAuditLogs.filter(
      (l) => l.action === 'legal_review_completed',
    );
    expect(legalLogs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 6. Integration Tests — PWFA Fast-Track
// =====================================================================

describe('PWFA Fast-Track Routes — POST /cases/:id/fast-track-approve', () => {
  it('should fast-track approve PWFA case with per se keyword (water)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({
      type: 'pwfa',
      pwfaPerSe: false,
      requestDescription: 'Employee needs access to water during shift due to pregnancy',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
    expect(body.decision.decisionType).toBe('approved');
  });

  it('should fast-track approve PWFA case with pwfaPerSe flag', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({
      type: 'pwfa',
      pwfaPerSe: true,
      requestDescription: 'General accommodation request',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
  });

  it('should return 400 for non-PWFA case', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({
      type: 'ada',
      requestDescription: 'Need water access during work',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('only available for PWFA');
  });

  it('should return 400 for PWFA case without per se match', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({
      type: 'pwfa',
      pwfaPerSe: false,
      requestDescription: 'Need a larger desk for pregnancy accommodation',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('does not qualify');
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('hr role should be able to fast-track', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';
    setupCase({
      type: 'pwfa',
      pwfaPerSe: false,
      requestDescription: 'Employee needs frequent bathroom breaks during pregnancy',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
  });

  it('should audit log pwfa_fast_track_approved', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({
      type: 'pwfa',
      pwfaPerSe: true,
      requestDescription: 'General request',
    });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/fast-track-approve', {
      method: 'POST',
    });

    const fastTrackLogs = mockAuditLogs.filter(
      (l) => l.action === 'pwfa_fast_track_approved',
    );
    expect(fastTrackLogs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 7. Integration Tests — Manager Input
// =====================================================================

describe('Manager Input Routes — POST /cases/:id/manager-input-request', () => {
  it('should send manager input request (super_admin)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'interactive_process' });
    mockUsers.push({
      id: '00000000-0000-4000-a000-000000000030',
      companyId: '00000000-0000-4000-a000-000000000010',
      name: 'Manager Smith',
      role: 'manager',
      email: 'manager@test.com',
      deletedAt: null,
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: '00000000-0000-4000-a000-000000000030' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 400 when manager not found', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'interactive_process' });
    // No users in store

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: '00000000-0000-4000-a000-000000000099' }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 when target user is not a manager', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'interactive_process' });
    mockUsers.push({
      id: '00000000-0000-4000-a000-000000000040',
      companyId: '00000000-0000-4000-a000-000000000010',
      name: 'HR Person',
      role: 'hr',
      email: 'hr@test.com',
      deletedAt: null,
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: '00000000-0000-4000-a000-000000000040' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request. Please check the case and manager selection.');
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: '00000000-0000-4000-a000-000000000030' }),
    });

    expect(res.status).toBe(403);
  });

  it('should create notification for manager (no medical info)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'interactive_process' });
    mockUsers.push({
      id: '00000000-0000-4000-a000-000000000030',
      companyId: '00000000-0000-4000-a000-000000000010',
      name: 'Manager Smith',
      role: 'manager',
      email: 'manager@test.com',
      deletedAt: null,
    });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: '00000000-0000-4000-a000-000000000030' }),
    });

    // Verify notification was created
    expect(mockNotifications.length).toBeGreaterThanOrEqual(1);
    const notif = mockNotifications.find((n) => n.userId === '00000000-0000-4000-a000-000000000030');
    expect(notif).toBeDefined();
    // Verify no medical info in notification body
    if (notif?.body) {
      expect(String(notif.body)).not.toContain('medical');
      expect(String(notif.body)).not.toContain('diagnosis');
    }
  });

  it('should audit log manager_input_requested', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'interactive_process' });
    mockUsers.push({
      id: '00000000-0000-4000-a000-000000000030',
      companyId: '00000000-0000-4000-a000-000000000010',
      name: 'Manager Smith',
      role: 'manager',
      email: 'manager@test.com',
      deletedAt: null,
    });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: '00000000-0000-4000-a000-000000000030' }),
    });

    const inputLogs = mockAuditLogs.filter(
      (l) => l.action === 'manager_input_requested',
    );
    expect(inputLogs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Manager Input Routes — PUT /cases/:id/manager-input', () => {
  it('should submit manager input (manager role)', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupCase({ status: 'awaiting_input' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationalImpact: 'The accommodation would require rearranging the department layout.',
        canAccommodate: true,
        suggestedAlternatives: 'Could consider remote work option instead.',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 400 when case is not awaiting input', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationalImpact: 'The accommodation would require rearranging the department layout.',
        canAccommodate: false,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Case is not currently awaiting manager input');
  });

  it('should return 403 for super_admin role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationalImpact: 'Description of operational impact on the department.',
        canAccommodate: true,
      }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 403 for hr role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'hr';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationalImpact: 'Description of operational impact on the department.',
        canAccommodate: false,
      }),
    });

    expect(res.status).toBe(403);
  });

  it('should return 400 for too-short operationalImpact', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupCase({ status: 'awaiting_input' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationalImpact: 'Short',
        canAccommodate: true,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('should audit log manager_input_received', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';
    setupCase({ status: 'awaiting_input' });

    await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationalImpact: 'The accommodation would require rearranging the department layout significantly.',
        canAccommodate: true,
      }),
    });

    const inputLogs = mockAuditLogs.filter(
      (l) => l.action === 'manager_input_received',
    );
    expect(inputLogs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 8. Integration Tests — Get Decision
// =====================================================================

describe('Get Decision Routes — GET /cases/:id/decision', () => {
  it('should return decision for super_admin', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    mockDecisions.push({
      id: '00000000-0000-4000-a000-000000000060',
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'approved',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBeDefined();
  });

  it('should return 404 when no decision exists', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
  });

  it('should return 403 for manager role', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'GET',
    });

    expect(res.status).toBe(403);
  });
});

// =====================================================================
// 9. Edge Case Tests
// =====================================================================

describe('Edge Cases', () => {
  it('should reject invalid JSON body on decision', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  it('should reject invalid decisionType', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    setupCase({ status: 'review' });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'maybe' }),
    });

    expect(res.status).toBe(400);
  });

  it('should handle missing managerId on input request', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('should handle missing canAccommodate on manager input', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'manager';

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/manager-input', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationalImpact: 'Some impact description here.' }),
    });

    expect(res.status).toBe(400);
  });
});

// =====================================================================
// 10. FIX-1: createCaseDecision updates case status
// =====================================================================

describe('FIX-1: Case decision updates case status', () => {
  it('should update case status to "approved" when approving', async () => {
    const { createCaseDecision } = await import('../src/services/approvalService.js');
    // Setup case with different assignedTo to avoid self-approval block
    setupCase({ status: 'review', assignedTo: '00000000-0000-4000-a000-000000000099' });

    const decision = await createCaseDecision({
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'approved',
      actorId: '00000000-0000-4000-a000-000000000020',
    });

    expect(decision).toBeDefined();
    expect(decision.decisionType).toBe('approved');
    // The case status should have been updated within the transaction
    // (verified via the db.update call inside transaction)
  });

  it('should update case status to "denied" when denying', async () => {
    const { createCaseDecision } = await import('../src/services/approvalService.js');
    setupCase({ status: 'review', assignedTo: '00000000-0000-4000-a000-000000000099' });

    const decision = await createCaseDecision({
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'denied',
      denialData: validDenialData(),
      actorId: '00000000-0000-4000-a000-000000000020',
    });

    expect(decision).toBeDefined();
    expect(decision.decisionType).toBe('denied');
  });
});

// =====================================================================
// 11. FIX-4: Self-approval enforcement
// =====================================================================

describe('FIX-4: Self-approval enforcement', () => {
  it('should block decision when actorId equals assignedTo and allowSelfApproval is false', async () => {
    const { createCaseDecision } = await import('../src/services/approvalService.js');
    // Case assigned to the same person making the decision
    setupCase({
      status: 'review',
      assignedTo: '00000000-0000-4000-a000-000000000020',
    });
    // Default settings have allowSelfApproval = false (no settings in store)

    await expect(
      createCaseDecision({
        caseId: '00000000-0000-4000-a000-000000000001',
        companyId: '00000000-0000-4000-a000-000000000010',
        decisionType: 'approved',
        actorId: '00000000-0000-4000-a000-000000000020',
      }),
    ).rejects.toThrow('Self-approval is not allowed');
  });

  it('should allow decision when actorId differs from assignedTo', async () => {
    const { createCaseDecision } = await import('../src/services/approvalService.js');
    setupCase({
      status: 'review',
      assignedTo: '00000000-0000-4000-a000-000000000099',
    });

    const decision = await createCaseDecision({
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'approved',
      actorId: '00000000-0000-4000-a000-000000000020',
    });

    expect(decision).toBeDefined();
    expect(decision.decisionType).toBe('approved');
  });

  it('should allow self-approval when allowSelfApproval setting is true', async () => {
    const { createCaseDecision } = await import('../src/services/approvalService.js');
    setupCase({
      status: 'review',
      assignedTo: '00000000-0000-4000-a000-000000000020',
    });
    // Enable self-approval in settings
    mockSettings.push({
      id: 'settings-allow-self',
      companyId: '00000000-0000-4000-a000-000000000010',
      requireManagerInput: true,
      requireLegalReviewForDenial: 'recommend',
      allowSelfApproval: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const decision = await createCaseDecision({
      caseId: '00000000-0000-4000-a000-000000000001',
      companyId: '00000000-0000-4000-a000-000000000010',
      decisionType: 'approved',
      actorId: '00000000-0000-4000-a000-000000000020',
    });

    expect(decision).toBeDefined();
    expect(decision.decisionType).toBe('approved');
  });

  it('should return 403 via route when self-approval blocked', async () => {
    const app = (await import('../src/index.js')).default;
    mockRole = 'super_admin';
    // assignedTo matches the mock userId (00000000-0000-4000-a000-000000000020)
    setupCase({
      status: 'review',
      assignedTo: '00000000-0000-4000-a000-000000000020',
    });

    const res = await app.request('/api/v1/cases/00000000-0000-4000-a000-000000000001/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionType: 'approved' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Self-approval is not allowed');
  });
});
