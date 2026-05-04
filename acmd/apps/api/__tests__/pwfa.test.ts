/**
 * Tests for Phase 4E: PWFA Safeguards
 * Task: ACMD-073
 *
 * Covers:
 *   1. Interim accommodation: record offered + description + audit log
 *   2. Interim reminder: PWFA case >5 business days without interim → reminder generated
 *   3. Business days calculation: skip weekends correctly
 *   4. Leave-forcing: PWFA case + "leave" accommodation → blocked without alternatives
 *   5. Leave-forcing: PWFA case + "leave" + confirmed alternatives → proceeds
 *   6. Leave-forcing: ADA case + "leave" → no block (PWFA rule doesn't apply to ADA)
 *   7. Medical doc template: ADA → 7 fields, PWFA → 6 fields
 *   8. Template block: PWFA case requesting ADA template → 400
 *   9. Per se skip: pwfaPerSe=true → required: false + reason
 *  10. Role checks on all endpoints
 *  11. Audit logging for interim + leave actions
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

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  let auditIdCounter = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertHandler = vi.fn((table: unknown) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: vi.fn((data: any) => {
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
      if (table === 'acmd_case_decisions_table') {
        const dec = {
          id: 'decision-uuid-1',
          ...data,
          legalReviewed: data.legalReviewed ?? false,
          createdAt: new Date(),
        };
        mockDecisions.push(dec);
        return { returning: vi.fn(() => Promise.resolve([dec])) };
      }
      if (table === 'acmd_cases_table') {
        const caseData = data as Record<string, unknown>;
        const newCase = {
          id: '00000000-0000-4000-a000-000000000001',
          ...caseData,
          status: caseData.status ?? 'intake',
          type: caseData.type ?? 'ada',
          pwfaPerSe: caseData.pwfaPerSe ?? false,
          interimAccommodationOffered: caseData.interimAccommodationOffered ?? false,
          interimAccommodationDescription: caseData.interimAccommodationDescription ?? null,
          interimOfferedAt: caseData.interimOfferedAt ?? null,
          requestDescription: caseData.requestDescription ?? 'Test request',
          medicalInfo: null,
          aiClassification: null,
          suggestedAccommodations: null,
          approvedAccommodation: null,
          denialReason: null,
          deadline: null,
          closedAt: null,
          deletedAt: null,
          assignedTo: caseData.assignedTo ?? '00000000-0000-4000-a000-000000000020',
          assignedAt: new Date(),
          aiConsentGiven: false,
          aiConsentTimestamp: null,
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

function setupCase(overrides: Record<string, unknown> = {}) {
  const base = {
    id: '00000000-0000-4000-a000-000000000001',
    companyId: '00000000-0000-4000-a000-000000000010',
    employeeId: '00000000-0000-4000-a000-000000000050',
    status: 'interactive_process',
    type: 'pwfa',
    pwfaPerSe: false,
    interimAccommodationOffered: false,
    interimAccommodationDescription: null,
    interimOfferedAt: null,
    requestDescription: 'Need flexible schedule due to pregnancy-related morning sickness',
    medicalInfo: null,
    aiClassification: null,
    suggestedAccommodations: null,
    approvedAccommodation: null,
    denialReason: null,
    deadline: null,
    closedAt: null,
    deletedAt: null,
    assignedTo: '00000000-0000-4000-a000-000000000020',
    assignedAt: new Date(),
    aiConsentGiven: false,
    aiConsentTimestamp: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  mockCases.push(base);
  return base;
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

beforeEach(() => {
  mockCases.length = 0;
  mockAuditLogs.length = 0;
  mockDecisions.length = 0;
  mockSettings.length = 0;
  mockNotifications.length = 0;
  mockUsers.length = 0;
  mockRole = 'super_admin';
});

// =======================================================================
// Tests
// =======================================================================

describe('PWFA Safeguards — Phase 4E (ACMD-073)', () => {
  // =====================================================================
  // 1. Business Days Calculation
  // =====================================================================
  describe('calculateBusinessDays()', () => {
    it('should count Mon-Fri only, skipping weekends', async () => {
      const { calculateBusinessDays } = await import('../src/services/pwfaService.js');
      // Mon Jan 6 2025 to Fri Jan 10 2025 = 4 business days
      const mon = new Date('2025-01-06T00:00:00Z');
      const fri = new Date('2025-01-10T00:00:00Z');
      expect(calculateBusinessDays(mon, fri)).toBe(4);
    });

    it('should return 5 for a full Mon-Fri week', async () => {
      const { calculateBusinessDays } = await import('../src/services/pwfaService.js');
      // Mon Jan 6 to Mon Jan 13 = 5 business days
      const mon1 = new Date('2025-01-06T00:00:00Z');
      const mon2 = new Date('2025-01-13T00:00:00Z');
      expect(calculateBusinessDays(mon1, mon2)).toBe(5);
    });

    it('should return 0 for same day', async () => {
      const { calculateBusinessDays } = await import('../src/services/pwfaService.js');
      const d = new Date('2025-01-06T00:00:00Z');
      expect(calculateBusinessDays(d, d)).toBe(0);
    });

    it('should skip weekends correctly over 2 weeks', async () => {
      const { calculateBusinessDays } = await import('../src/services/pwfaService.js');
      // Mon Jan 6 to Mon Jan 20 = 10 business days
      const start = new Date('2025-01-06T00:00:00Z');
      const end = new Date('2025-01-20T00:00:00Z');
      expect(calculateBusinessDays(start, end)).toBe(10);
    });

    it('should handle start on weekend (Sat to Mon = 0 business days)', async () => {
      const { calculateBusinessDays } = await import('../src/services/pwfaService.js');
      const sat = new Date('2025-01-04T00:00:00Z');
      const mon = new Date('2025-01-06T00:00:00Z');
      expect(calculateBusinessDays(sat, mon)).toBe(0);
    });

    it('should handle start on Saturday to Friday = 4 business days', async () => {
      const { calculateBusinessDays } = await import('../src/services/pwfaService.js');
      // Sat Jan 4 to Fri Jan 10 = Mon-Thu = 4
      const sat = new Date('2025-01-04T00:00:00Z');
      const fri = new Date('2025-01-10T00:00:00Z');
      expect(calculateBusinessDays(sat, fri)).toBe(4);
    });
  });

  // =====================================================================
  // 2. Leave-Forcing Validation
  // =====================================================================
  describe('validateLeaveAccommodation()', () => {
    it('should allow leave for ADA cases without restriction', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const result = validateLeaveAccommodation('ada', 'take medical leave', false, null);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('only applies to PWFA');
    });

    it('should allow PWFA accommodation that does not mention leave', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const result = validateLeaveAccommodation('pwfa', 'flexible schedule', false, null);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('does not involve leave');
    });

    it('should BLOCK PWFA + leave without confirmed alternatives', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const result = validateLeaveAccommodation('pwfa', 'take medical leave', false, null);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('42 USC 2000gg-1(4)');
      expect(result.reason).toContain('Cannot force leave');
    });

    it('should BLOCK PWFA + leave with short alternatives_documented', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const result = validateLeaveAccommodation('pwfa', 'take medical leave', true, 'short');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('at least 50 characters');
    });

    it('should ALLOW PWFA + leave with confirmed alternatives + sufficient doc', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const alternatives = 'We explored flexible scheduling, remote work, and modified duties before concluding that medical leave is the only viable option.';
      const result = validateLeaveAccommodation('pwfa', 'take medical leave', true, alternatives);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('approved with documented alternatives');
    });

    it('should match "leave" case-insensitively', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const result = validateLeaveAccommodation('pwfa', 'Take LEAVE immediately', false, null);
      expect(result.allowed).toBe(false);
    });

    it('should match "leave" as word boundary only — "leaves" should NOT trigger', async () => {
      const { validateLeaveAccommodation } = await import('../src/services/pwfaService.js');
      const result = validateLeaveAccommodation('pwfa', 'employee leaves early', false, null);
      expect(result.allowed).toBe(true);
    });
  });

  // =====================================================================
  // 3. Medical Documentation Templates
  // =====================================================================
  describe('getMedicalDocTemplate()', () => {
    it('should return ADA template with 7 fields for ADA case', async () => {
      const { getMedicalDocTemplate, ADA_TEMPLATE } = await import('../src/services/pwfaService.js');
      const result = getMedicalDocTemplate('ada', false, []);
      expect(result.template).toEqual(ADA_TEMPLATE);
      expect(result.fieldCount).toBe(7);
      expect(result.required).toBe(true);
    });

    it('should return PWFA template with 6 fields for PWFA case', async () => {
      const { getMedicalDocTemplate, PWFA_TEMPLATE } = await import('../src/services/pwfaService.js');
      const result = getMedicalDocTemplate('pwfa', false, []);
      expect(result.template).toEqual(PWFA_TEMPLATE);
      expect(result.fieldCount).toBe(6);
      expect(result.required).toBe(true);
      expect(result.reason).toContain('ADA template must not be used');
    });

    it('should return required=false for PWFA per se (flagged)', async () => {
      const { getMedicalDocTemplate } = await import('../src/services/pwfaService.js');
      const result = getMedicalDocTemplate('pwfa', true, []);
      expect(result.required).toBe(false);
      expect(result.reason).toContain('per se');
      expect(result.reason).toContain('not required');
    });

    it('should return required=false for PWFA per se (matched items)', async () => {
      const { getMedicalDocTemplate } = await import('../src/services/pwfaService.js');
      const result = getMedicalDocTemplate('pwfa', false, ['water', 'bathroom']);
      expect(result.required).toBe(false);
      expect(result.reason).toContain('water, bathroom');
      expect(result.reason).toContain('29 CFR 1636.3(j)(4)');
    });

    it('should return ADA template for state_law cases', async () => {
      const { getMedicalDocTemplate, ADA_TEMPLATE } = await import('../src/services/pwfaService.js');
      const result = getMedicalDocTemplate('state_law', false, []);
      expect(result.template).toEqual(ADA_TEMPLATE);
      expect(result.fieldCount).toBe(7);
    });

    it('ADA template should have diagnosis field, NOT known_limitation', async () => {
      const { ADA_TEMPLATE } = await import('../src/services/pwfaService.js');
      const fields = ADA_TEMPLATE.map((f) => f.field);
      expect(fields).toContain('diagnosis');
      expect(fields).not.toContain('known_limitation');
    });

    it('PWFA template should have known_limitation field, NOT diagnosis', async () => {
      const { PWFA_TEMPLATE } = await import('../src/services/pwfaService.js');
      const fields = PWFA_TEMPLATE.map((f) => f.field);
      expect(fields).toContain('known_limitation');
      expect(fields).not.toContain('diagnosis');
    });
  });

  // =====================================================================
  // 4. PWFA Per Se Detection (from approvalService)
  // =====================================================================
  describe('checkPwfaPerSe() — per se skip medical docs', () => {
    it('should match water for PWFA case', async () => {
      const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
      const matches = checkPwfaPerSe('pwfa', 'I need access to water during shifts');
      expect(matches).toContain('water');
    });

    it('should match bathroom for PWFA case', async () => {
      const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
      const matches = checkPwfaPerSe('pwfa', 'Need additional bathroom breaks');
      expect(matches).toContain('bathroom');
    });

    it('should match sit/stand for PWFA case', async () => {
      const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
      const matches = checkPwfaPerSe('pwfa', 'Need a chair to sit during work');
      expect(matches).toContain('sit/stand');
    });

    it('should match eat for PWFA case', async () => {
      const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
      const matches = checkPwfaPerSe('pwfa', 'Need to eat snacks during shift');
      expect(matches).toContain('eat');
    });

    it('should return empty for ADA case even with matching keywords', async () => {
      const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
      const matches = checkPwfaPerSe('ada', 'Need water access');
      expect(matches).toEqual([]);
    });

    it('should return empty for non-matching PWFA description', async () => {
      const { checkPwfaPerSe } = await import('../src/services/approvalService.js');
      const matches = checkPwfaPerSe('pwfa', 'Need a parking spot closer to the building');
      expect(matches).toEqual([]);
    });
  });

  // =====================================================================
  // 5. API: POST /cases/:id/interim-accommodation
  // =====================================================================
  describe('POST /cases/:id/interim-accommodation', () => {
    it('should record interim accommodation with description', async () => {
      setupCase({ type: 'pwfa' });
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/interim-accommodation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offered: true,
            description: 'Provided temporary remote work arrangement during pregnancy',
          }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.interim_recorded).toBe(true);
      expect(body.offered).toBe(true);
    });

    it('should create audit log when recording interim accommodation', async () => {
      setupCase({ type: 'pwfa' });
      mockRole = 'hr';
      mockAuditLogs.length = 0;

      const { default: app } = await import('../src/index.js');
      await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/interim-accommodation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offered: true, description: 'Temporary schedule change' }),
        },
      );

      const interimLog = mockAuditLogs.find(
        (log) => log.action === 'pwfa_interim_recorded',
      );
      expect(interimLog).toBeTruthy();
      expect((interimLog as Record<string, unknown>).metadata).toMatchObject({
        offered: true,
        description: 'Temporary schedule change',
      });
    });

    it('should return 404 for non-existent case', async () => {
      // No case in mock store
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000099/interim-accommodation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offered: true }),
        },
      );

      expect(res.status).toBe(404);
    });

    it('should reject manager role (403)', async () => {
      setupCase({ type: 'pwfa' });
      mockRole = 'manager';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/interim-accommodation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offered: true }),
        },
      );

      expect(res.status).toBe(403);
    });

    it('should reject invalid UUID', async () => {
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/not-a-uuid/interim-accommodation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offered: true }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject missing offered field (validation error)', async () => {
      setupCase({ type: 'pwfa' });
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/interim-accommodation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: 'test' }),
        },
      );

      expect(res.status).toBe(400);
    });
  });

  // =====================================================================
  // 6. API: GET /cases/:id/medical-doc-template
  // =====================================================================
  describe('GET /cases/:id/medical-doc-template', () => {
    it('should return ADA template (7 fields) for ADA case', async () => {
      setupCase({ type: 'ada' });
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template',
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.caseType).toBe('ada');
      expect(body.fieldCount).toBe(7);
      expect(body.required).toBe(true);
    });

    it('should return PWFA template (6 fields) for PWFA case', async () => {
      setupCase({ type: 'pwfa' });
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template',
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.caseType).toBe('pwfa');
      expect(body.fieldCount).toBe(6);
      expect(body.required).toBe(true);
    });

    it('should return required=false for PWFA per se case', async () => {
      setupCase({ type: 'pwfa', pwfaPerSe: true, requestDescription: 'Need water access' });
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template',
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.required).toBe(false);
      expect(body.reason).toContain('per se');
    });

    it('should return 400 when force_ada=true for PWFA case', async () => {
      setupCase({ type: 'pwfa' });
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template?force_ada=true',
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('MUST NOT be used for PWFA');
    });

    it('should allow force_ada=true for ADA case (no block)', async () => {
      setupCase({ type: 'ada' });
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template?force_ada=true',
      );

      expect(res.status).toBe(200);
    });

    it('should return per se matches in response', async () => {
      setupCase({ type: 'pwfa', requestDescription: 'Need bathroom breaks during pregnancy' });
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template',
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.perSeMatches).toContain('bathroom');
    });

    it('should allow manager role (all authenticated roles allowed)', async () => {
      setupCase({ type: 'ada' });
      mockRole = 'manager';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001/medical-doc-template',
      );

      expect(res.status).toBe(200);
    });

    it('should return 404 for non-existent case', async () => {
      mockRole = 'hr';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000099/medical-doc-template',
      );

      expect(res.status).toBe(404);
    });
  });

  // =====================================================================
  // 7. API: PATCH /cases/:id — Leave-forcing integration
  // =====================================================================
  describe('PATCH /cases/:id — PWFA leave-forcing safeguard', () => {
    it('should BLOCK (400) PWFA + leave accommodation without alternatives', async () => {
      setupCase({ type: 'pwfa', status: 'interactive_process' });
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAccommodation: 'Employee should take medical leave for the remainder of pregnancy',
          }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('PWFA leave-forcing blocked');
      expect(body.error).toContain('42 USC 2000gg-1(4)');
    });

    it('should create audit log for blocked leave-forcing attempt', async () => {
      setupCase({ type: 'pwfa', status: 'interactive_process' });
      mockRole = 'super_admin';
      mockAuditLogs.length = 0;

      const { default: app } = await import('../src/index.js');
      await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAccommodation: 'Take leave immediately',
          }),
        },
      );

      const blockLog = mockAuditLogs.find(
        (log) => log.action === 'pwfa_leave_forcing_blocked',
      );
      expect(blockLog).toBeTruthy();
      expect((blockLog as Record<string, unknown>).metadata).toMatchObject({
        legalCitation: '42 USC 2000gg-1(4)',
      });
    });

    it('should ALLOW PWFA + leave with confirmed alternatives', async () => {
      setupCase({ type: 'pwfa', status: 'interactive_process' });
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAccommodation: 'Employee will take medical leave for 6 weeks',
            leave_alternatives_confirmed: true,
            alternatives_documented: 'We explored remote work, flexible scheduling, temporary reassignment, and modified duties. None were viable because the employee requires full bed rest per doctor orders.',
          }),
        },
      );

      expect(res.status).toBe(200);
    });

    it('should create audit log for approved leave-forcing', async () => {
      setupCase({ type: 'pwfa', status: 'interactive_process' });
      mockRole = 'super_admin';
      mockAuditLogs.length = 0;

      const { default: app } = await import('../src/index.js');
      await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAccommodation: 'Medical leave for 4 weeks',
            leave_alternatives_confirmed: true,
            alternatives_documented: 'Explored remote work option but employee needs bed rest. Explored part-time schedule but doctor said no. No other alternatives viable.',
          }),
        },
      );

      const approveLog = mockAuditLogs.find(
        (log) => log.action === 'pwfa_leave_forcing_approved',
      );
      expect(approveLog).toBeTruthy();
      expect((approveLog as Record<string, unknown>).metadata).toMatchObject({
        legalCitation: '42 USC 2000gg-1(4)',
      });
    });

    it('should NOT block leave for ADA cases', async () => {
      setupCase({ type: 'ada', status: 'interactive_process' });
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAccommodation: 'Take medical leave for recovery',
          }),
        },
      );

      expect(res.status).toBe(200);
    });

    it('should BLOCK PWFA + leave with alternatives_documented too short', async () => {
      setupCase({ type: 'pwfa', status: 'interactive_process' });
      mockRole = 'super_admin';

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/00000000-0000-4000-a000-000000000001',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAccommodation: 'Take leave for 2 weeks',
            leave_alternatives_confirmed: true,
            alternatives_documented: 'Tried remote work',
          }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('PWFA leave-forcing blocked');
    });
  });

  // =====================================================================
  // 8. Interim Reminder Check (unit test)
  // =====================================================================
  describe('checkPwfaInterimReminder()', () => {
    it('should return reminderNeeded=true for PWFA case >5 business days without interim', async () => {
      const { checkPwfaInterimReminder } = await import('../src/services/pwfaService.js');

      // Setup a case created 10 calendar days ago (>5 business days)
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      setupCase({
        type: 'pwfa',
        interimAccommodationOffered: false,
        createdAt: tenDaysAgo,
      });

      const result = await checkPwfaInterimReminder(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000010',
      );

      expect(result).not.toBeNull();
      expect(result!.reminderNeeded).toBe(true);
      expect(result!.businessDaysSinceCreation).toBeGreaterThan(5);
    });

    it('should return reminderNeeded=false for PWFA case with interim already offered', async () => {
      const { checkPwfaInterimReminder } = await import('../src/services/pwfaService.js');

      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      setupCase({
        type: 'pwfa',
        interimAccommodationOffered: true,
        createdAt: tenDaysAgo,
      });

      const result = await checkPwfaInterimReminder(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000010',
      );

      expect(result).not.toBeNull();
      expect(result!.reminderNeeded).toBe(false);
    });

    it('should return reminderNeeded=false for ADA case (even if >5 days)', async () => {
      const { checkPwfaInterimReminder } = await import('../src/services/pwfaService.js');

      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      setupCase({
        type: 'ada',
        interimAccommodationOffered: false,
        createdAt: tenDaysAgo,
      });

      const result = await checkPwfaInterimReminder(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000010',
      );

      expect(result).not.toBeNull();
      expect(result!.reminderNeeded).toBe(false);
    });

    it('should return null for non-existent case', async () => {
      const { checkPwfaInterimReminder } = await import('../src/services/pwfaService.js');

      const result = await checkPwfaInterimReminder(
        '00000000-0000-4000-a000-000000000099',
        '00000000-0000-4000-a000-000000000010',
      );

      expect(result).toBeNull();
    });
  });
});
