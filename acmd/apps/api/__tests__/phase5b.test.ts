/**
 * Phase 5B Tests — Auto-Status Transitions.
 *
 * Covers:
 *   - autoTransitionService.tryAutoTransition() — all 4 triggers
 *   - Checklist complete → review (happy path + guard)
 *   - Medical docs → interactive_process (from awaiting_medical only)
 *   - Manager input → interactive_process (from awaiting_input only)
 *   - PWFA fast-track → review
 *   - Race condition guard (concurrent transitions)
 *   - Tenant isolation
 *   - Status validation (VALID_STATUS_TRANSITIONS)
 *   - POST /cases/:id/medical-docs endpoint
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

// Track transaction calls for race condition testing
let transactionCallCount = 0;

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
          assignedTo: caseData.assignedTo ?? null,
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
            required: item.required !== undefined ? item.required : true,
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
              then: (resolve: any, reject?: any) =>
                Promise.resolve([...mockChecklistItems]).then(resolve, reject),
            })),
          };
        }

        // For users table
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

        // For notifications
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

        // For audit logs
        if (table === 'acmd_audit_logs_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          };
        }

        // For cases table (default)
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
    transaction: vi.fn(async (fn: any) => {
      transactionCallCount++;
      // Transaction uses the same db proxy (simplified mock)
      return fn(dbObj);
    }),
  };

  return {
    db: dbObj,
    acmdCases: 'acmd_cases_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdNotifications: 'acmd_notifications_table',
    acmdEmployees: 'acmd_employees_table',
    acmdUsers: 'acmd_users_table',
    acmdCompanies: { id: 'id', companyId: 'company_id', defaultHrContactId: 'default_hr_contact_id' },
    acmdRefreshTokens: { tokenHash: 'token_hash' },
    acmdApprovalSettings: 'acmd_approval_settings_table',
    acmdCaseDecisions: 'acmd_case_decisions_table',
    acmdDocuments: 'acmd_documents_table',
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

describe('Phase 5B: Auto-Status Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockCases.length = 0;
    mockChecklistItems.length = 0;
    mockAuditLogs.length = 0;
    mockNotifications.length = 0;
    mockUsers.length = 0;
    transactionCallCount = 0;
  });

  // -----------------------------------------------------------------------
  // 5B.1 — Checklist → Review
  // -----------------------------------------------------------------------

  describe('5B.1 — Checklist Complete → Review', () => {
    it('should auto-transition to review when all required items complete', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      // All required items complete
      mockChecklistItems.push(
        { id: 'cl-1', caseId: 'case-uuid-1', stepName: 'Step 1', stepOrder: 1, required: true, completed: true, completedAt: new Date(), completedBy: 'user-uuid' },
        { id: 'cl-2', caseId: 'case-uuid-1', stepName: 'Step 2', stepOrder: 2, required: true, completed: true, completedAt: new Date(), completedBy: 'user-uuid' },
        { id: 'cl-3', caseId: 'case-uuid-1', stepName: 'Optional', stepOrder: 3, required: false, completed: false, completedAt: null, completedBy: null },
      );

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'checklist_complete',
        'user-uuid',
      );

      expect(result.transitioned).toBe(true);
      expect(result.fromStatus).toBe('interactive_process');
      expect(result.toStatus).toBe('review');
      expect(result.trigger).toBe('checklist_complete');

      // Verify transaction was used
      expect(transactionCallCount).toBeGreaterThan(0);

      // Verify audit log was created
      const autoTransitionLogs = mockAuditLogs.filter(
        (l) => l.action === 'auto_status_transition',
      );
      expect(autoTransitionLogs.length).toBeGreaterThan(0);

      // Verify notification was created
      expect(mockNotifications.length).toBeGreaterThan(0);
      const notif = mockNotifications.find(
        (n) => (n.title as string).includes('Checklist complete'),
      );
      expect(notif).toBeDefined();
    });

    it('should NOT transition if required items are incomplete', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      // One required item incomplete
      mockChecklistItems.push(
        { id: 'cl-1', caseId: 'case-uuid-1', stepName: 'Step 1', stepOrder: 1, required: true, completed: true, completedAt: new Date(), completedBy: 'user-uuid' },
        { id: 'cl-2', caseId: 'case-uuid-1', stepName: 'Step 2', stepOrder: 2, required: true, completed: false, completedAt: null, completedBy: null },
      );

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'checklist_complete',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.reason).toContain('required checklist items');
    });

    it('should NOT transition if current status does not allow review', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'closed', // closed → review is NOT a valid transition
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      mockChecklistItems.push(
        { id: 'cl-1', caseId: 'case-uuid-1', stepName: 'Step 1', stepOrder: 1, required: true, completed: true, completedAt: new Date(), completedBy: 'user-uuid' },
      );

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'checklist_complete',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.reason).toContain('Invalid status transition');
    });

    it('should handle empty checklist (no items)', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      // No checklist items
      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'checklist_complete',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.reason).toContain('required checklist items');
    });
  });

  // -----------------------------------------------------------------------
  // 5B.2 — Medical Docs → Interactive Process
  // -----------------------------------------------------------------------

  describe('5B.2 — Medical Docs → Interactive Process', () => {
    it('should auto-transition from awaiting_medical to interactive_process', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_medical',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'medical_docs_received',
        'user-uuid',
        { filename: 'medical-cert.pdf' },
      );

      expect(result.transitioned).toBe(true);
      expect(result.fromStatus).toBe('awaiting_medical');
      expect(result.toStatus).toBe('interactive_process');
      expect(transactionCallCount).toBeGreaterThan(0);
    });

    it('should NOT transition if status is not awaiting_medical', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'review', // not awaiting_medical
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'medical_docs_received',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.toStatus).toBeNull();
    });

    it('should record audit log with medical docs metadata', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_medical',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'medical_docs_received',
        'user-uuid',
        { filename: 'cert.pdf' },
      );

      const auditLog = mockAuditLogs.find(
        (l) => l.action === 'auto_status_transition',
      );
      expect(auditLog).toBeDefined();
      expect((auditLog?.metadata as Record<string, unknown>)?.trigger).toBe('medical_docs_received');
      expect((auditLog?.metadata as Record<string, unknown>)?.from).toBe('awaiting_medical');
      expect((auditLog?.metadata as Record<string, unknown>)?.to).toBe('interactive_process');
    });
  });

  // -----------------------------------------------------------------------
  // 5B.3 — Manager Input → Interactive Process
  // -----------------------------------------------------------------------

  describe('5B.3 — Manager Input → Interactive Process', () => {
    it('should auto-transition from awaiting_input to interactive_process', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_input',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'manager_input_received',
        'user-uuid',
      );

      expect(result.transitioned).toBe(true);
      expect(result.fromStatus).toBe('awaiting_input');
      expect(result.toStatus).toBe('interactive_process');
    });

    it('should NOT transition if status is not awaiting_input', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process', // already in interactive_process
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'manager_input_received',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
    });

    it('should notify assigned HR after manager input transition', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_input',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'manager_input_received',
        'user-uuid',
      );

      const notif = mockNotifications.find(
        (n) => (n.title as string).includes('Manager input received'),
      );
      expect(notif).toBeDefined();
      expect(notif?.userId).toBe('hr-user-uuid');
    });
  });

  // -----------------------------------------------------------------------
  // 5B.4 — PWFA Fast-Track → Review
  // -----------------------------------------------------------------------

  describe('5B.4 — PWFA Fast-Track → Review', () => {
    it('should auto-transition PWFA per se to review', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process',
        type: 'pwfa',
        assignedTo: 'hr-user-uuid',
        pwfaPerSe: false,
      });

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'pwfa_fast_track',
        'user-uuid',
        { matchedAssessments: ['water', 'breaks'] },
      );

      expect(result.transitioned).toBe(true);
      expect(result.toStatus).toBe('review');
      expect(result.trigger).toBe('pwfa_fast_track');
    });

    it('should use pwfa_fast_track_approved audit action for PWFA fast-track', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process',
        type: 'pwfa',
        assignedTo: 'hr-user-uuid',
      });

      await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'pwfa_fast_track',
        'user-uuid',
        { matchedAssessments: ['schedule_change'] },
      );

      const auditLog = mockAuditLogs.find(
        (l) => l.action === 'pwfa_fast_track_approved',
      );
      expect(auditLog).toBeDefined();
      expect((auditLog?.metadata as Record<string, unknown>)?.trigger).toBe('pwfa_fast_track');
    });

    it('should NOT fast-track if status does not allow review', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'active', // active → review is NOT allowed
        type: 'pwfa',
        assignedTo: 'hr-user-uuid',
      });

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'pwfa_fast_track',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.reason).toContain('Invalid status transition');
    });
  });

  // -----------------------------------------------------------------------
  // Security: Tenant Isolation
  // -----------------------------------------------------------------------

  describe('Security — Tenant Isolation', () => {
    it('should return transitioned=false if case not found (wrong company)', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      // No case in mock = case not found
      const result = await tryAutoTransition(
        'case-uuid-nonexistent',
        'company-uuid',
        'checklist_complete',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.reason).toBe('Case not found');
    });
  });

  // -----------------------------------------------------------------------
  // Race Condition Guard
  // -----------------------------------------------------------------------

  describe('Race Condition — Transaction Guard', () => {
    it('should use DB transaction for every auto-transition', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');
      const { db } = await import('@acmd/db');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_medical',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      transactionCallCount = 0;
      await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'medical_docs_received',
        'user-uuid',
      );

      expect(transactionCallCount).toBe(1);
      expect(db.transaction).toHaveBeenCalledOnce();
    });

    it('should handle concurrent checklist completions safely', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'interactive_process',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      mockChecklistItems.push(
        { id: 'cl-1', caseId: 'case-uuid-1', stepName: 'Step 1', stepOrder: 1, required: true, completed: true, completedAt: new Date(), completedBy: 'user-uuid' },
      );

      // Simulate 2 concurrent calls
      const [result1, result2] = await Promise.all([
        tryAutoTransition('case-uuid-1', 'company-uuid', 'checklist_complete', 'user-1'),
        tryAutoTransition('case-uuid-1', 'company-uuid', 'checklist_complete', 'user-2'),
      ]);

      // Both should use transactions
      expect(transactionCallCount).toBe(2);

      // At least one should succeed (in real DB, second would see updated status)
      const transitioned = [result1, result2].filter((r) => r.transitioned);
      expect(transitioned.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // POST /cases/:id/medical-docs endpoint
  // -----------------------------------------------------------------------

  describe('POST /cases/:id/medical-docs', () => {
    it('should accept medical docs and return 201', async () => {
      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_medical',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
        medicalInfo: null,
        aiConsentGiven: false,
        aiConsentTimestamp: null,
        pwfaPerSe: false,
      });

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: 'medical-cert.pdf',
            fileType: 'application/pdf',
          }),
        },
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.document).toBeDefined();
      expect(body.document.filename).toBe('medical-cert.pdf');
    });

    it('should return 400 for invalid UUID', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/invalid-uuid/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename: 'test.pdf' }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for missing filename', async () => {
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 403 for manager role', async () => {
      mockRole = 'manager';
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename: 'test.pdf' }),
        },
      );

      expect(res.status).toBe(403);
    });

    it('should return 404 for case not found', async () => {
      // No cases in mock
      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename: 'test.pdf' }),
        },
      );

      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // ACMD-082 Fix 3c: XSS in medical docs filename + notes
  // -----------------------------------------------------------------------

  describe('Fix 3c — XSS sanitization: medical docs filename + notes', () => {
    it('should sanitize XSS in filename', async () => {
      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_medical',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
        medicalInfo: null,
        aiConsentGiven: false,
        aiConsentTimestamp: null,
        pwfaPerSe: false,
      });

      const { default: app } = await import('../src/index.js');
      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: 'medical<script>alert(1)</script>.pdf',
            notes: 'Doctor note <img src=x onerror=alert(2)> attached',
          }),
        },
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      // filename should be sanitized
      expect(body.document.filename).not.toContain('<script>');
      expect(body.document.filename).toBe('medicalalert(1).pdf');
    });
  });

  // -----------------------------------------------------------------------
  // ACMD-082 Fix 5: Medical docs audit action name
  // -----------------------------------------------------------------------

  describe('Fix 5 — Medical docs audit action: medical_docs_received', () => {
    it('should use medical_docs_received action in audit log', async () => {
      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'awaiting_medical',
        type: 'ada',
        assignedTo: 'hr-user-uuid',
        medicalInfo: null,
        aiConsentGiven: false,
        aiConsentTimestamp: null,
        pwfaPerSe: false,
      });

      const { default: app } = await import('../src/index.js');
      await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/medical-docs',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: 'medical-cert.pdf',
          }),
        },
      );

      // Verify audit log uses 'medical_docs_received' action (not 'case_updated')
      const medDocsLogs = mockAuditLogs.filter(
        (l) => l.action === 'medical_docs_received',
      );
      expect(medDocsLogs.length).toBeGreaterThanOrEqual(1);

      // Verify NO audit log with 'case_updated' action for this event
      const caseUpdatedLogs = mockAuditLogs.filter(
        (l) => l.action === 'case_updated' && (l.metadata as Record<string, unknown>)?.event === 'medical_docs_received',
      );
      expect(caseUpdatedLogs.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Status Validation
  // -----------------------------------------------------------------------

  describe('Status Validation — VALID_STATUS_TRANSITIONS', () => {
    it('should use validateStatusTransition for every trigger', async () => {
      const { tryAutoTransition } = await import('../src/services/autoTransitionService.js');

      // intake → review is a valid path only through interactive_process
      mockCases.push({
        id: 'case-uuid-1',
        companyId: 'company-uuid',
        status: 'intake', // intake → review is NOT allowed directly
        type: 'ada',
        assignedTo: 'hr-user-uuid',
      });

      mockChecklistItems.push(
        { id: 'cl-1', caseId: 'case-uuid-1', stepName: 'Step 1', stepOrder: 1, required: true, completed: true, completedAt: new Date(), completedBy: 'user-uuid' },
      );

      const result = await tryAutoTransition(
        'case-uuid-1',
        'company-uuid',
        'checklist_complete',
        'user-uuid',
      );

      expect(result.transitioned).toBe(false);
      expect(result.reason).toContain('Invalid status transition');
      expect(result.reason).toContain("from 'intake' to 'review'");
    });
  });
});
