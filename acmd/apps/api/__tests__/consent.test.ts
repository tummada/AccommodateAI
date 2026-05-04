/**
 * Tests for Phase 4C: AI Consent Workflow + Manual Fallback Path
 * Task: ACMD-072
 *
 * Covers:
 *   1. Record consent (given=true) — verify aiConsentGiven=true + timestamp + audit
 *   2. Record consent (given=false/declined) — verify aiConsentGiven=false + audit
 *   3. Classify WITH consent — succeeds
 *   4. Classify WITHOUT consent — returns fallback with consent error
 *   5. Revoke consent — aiConsentGiven=false + audit log
 *   6. Revoke after classification — existing classification preserved, new blocked
 *   7. Manual classify — sets type without calling AI + audit log
 *   8. Manual suggestions — inserted with source='manual_hr' + audit log
 *   9. No adverse effect: all non-AI features work with consent=false
 *  10. Role checks: manager cannot record consent, viewer cannot manual classify
 *  11. Edge cases: double consent, consent on non-existent case, revoke when already false
 *  12. getCaseById returns ai_consent_status field
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
const mockSuggestions: Record<string, unknown>[] = [];
const mockNotifications: Record<string, unknown>[] = [];
let suggestionIdCounter = 0;

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
      if (table === 'acmd_suggestions_table') {
        const items = Array.isArray(data) ? data : [data];
        const inserted = items.map((item: Record<string, unknown>) => {
          suggestionIdCounter++;
          const s = {
            id: `suggestion-uuid-${suggestionIdCounter}`,
            ...item,
            selected: false,
            selectedBy: null,
            selectedAt: null,
            selectionReason: null,
            janReferenceUrl: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockSuggestions.push(s);
          return s;
        });
        return { returning: vi.fn(() => Promise.resolve(inserted)) };
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
          aiConsentGiven: caseData.aiConsentGiven ?? false,
          aiConsentTimestamp: caseData.aiConsentTimestamp ?? null,
          pwfaPerSe: false,
          requestDescription: caseData.requestDescription ?? 'Test accommodation request for testing purposes',
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
    // Check if this is a consent-only select (has aiConsentGiven key)
    const isConsentSelect = args.length > 0 && args[0] && typeof args[0] === 'object' && 'aiConsentGiven' in args[0];

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: vi.fn((table: unknown) => {
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

        // Cases table
        return {
          where: vi.fn(() => {
            if (isCountQuery) {
              return Promise.resolve([{ count: mockCases.length }]);
            }
            if (isConsentSelect) {
              // Return consent fields only
              return {
                limit: vi.fn(() => {
                  if (mockCases.length > 0) {
                    return Promise.resolve([{
                      aiConsentGiven: mockCases[0]!['aiConsentGiven'],
                      aiConsentTimestamp: mockCases[0]!['aiConsentTimestamp'],
                    }]);
                  }
                  return Promise.resolve([]);
                }),
                then: (resolve: Function, reject?: Function) => {
                  if (mockCases.length > 0) {
                    return Promise.resolve([{
                      aiConsentGiven: mockCases[0]!['aiConsentGiven'],
                      aiConsentTimestamp: mockCases[0]!['aiConsentTimestamp'],
                    }]).then(resolve as any, reject as any);
                  }
                  return Promise.resolve([]).then(resolve as any, reject as any);
                },
              };
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
    status: 'intake',
    type: 'ada',
    aiConsentGiven: false,
    aiConsentTimestamp: null,
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
    assignedTo: '00000000-0000-4000-a000-000000000020',
    assignedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  mockCases.push(base);
  return base;
}

const CASE_ID = '00000000-0000-4000-a000-000000000001';

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('AI Consent Workflow (Phase 4C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockCases.length = 0;
    mockAuditLogs.length = 0;
    mockSuggestions.length = 0;
    mockNotifications.length = 0;
    suggestionIdCounter = 0;
  });

  // ====================================================================
  // 1. Record consent (given=true)
  // ====================================================================
  describe('POST /cases/:id/ai-consent — record consent', () => {
    it('should record consent given=true + set timestamp + audit log', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.consent_recorded).toBe(true);
      expect(body.consent_given).toBe(true);
      expect(body.case).toBeDefined();

      // Verify case was updated
      expect(mockCases[0]!['aiConsentGiven']).toBe(true);
      expect(mockCases[0]!['aiConsentTimestamp']).toBeDefined();
      expect(mockCases[0]!['aiConsentTimestamp']).not.toBeNull();

      // Verify audit log was written
      const consentLog = mockAuditLogs.find(
        (l) => l['action'] === 'ai_consent_given',
      );
      expect(consentLog).toBeDefined();
      expect((consentLog!['metadata'] as Record<string, unknown>)['consent_method']).toBe('web_form');
      expect((consentLog!['metadata'] as Record<string, unknown>)['consent_given']).toBe(true);
    });

    // ====================================================================
    // 2. Record consent (declined)
    // ====================================================================
    it('should record consent given=false (declined) + audit log', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: false, consentMethod: 'paper_form' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.consent_recorded).toBe(true);
      expect(body.consent_given).toBe(false);

      // Verify case was updated — consent declined
      expect(mockCases[0]!['aiConsentGiven']).toBe(false);
      expect(mockCases[0]!['aiConsentTimestamp']).not.toBeNull();

      // Verify audit log: ai_consent_declined
      const declinedLog = mockAuditLogs.find(
        (l) => l['action'] === 'ai_consent_declined',
      );
      expect(declinedLog).toBeDefined();
      expect((declinedLog!['metadata'] as Record<string, unknown>)['event']).toBe('consent_declined');
    });

    it('should accept consent with email method', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'email' }),
      });

      expect(res.status).toBe(200);
    });

    it('should accept consent with verbal_recorded method', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'verbal_recorded' }),
      });

      expect(res.status).toBe(200);
    });

    it('should return 400 for invalid consent method', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'invalid_method' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 for missing consentGiven field', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON body', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid case ID format', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/cases/not-a-uuid/ai-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid case ID format');
    });
  });

  // ====================================================================
  // 3-4. Classify with/without consent (defense in depth in aiClassifier)
  // ====================================================================
  describe('AI Classifier consent check (defense in depth)', () => {
    it('should block classification when consent not given', async () => {
      // Case with consent=false
      setupCase({ aiConsentGiven: false });

      const { classifyCase } = await import('../src/services/aiClassifier.js');
      const result = await classifyCase({
        requestDescription: 'Need ergonomic chair due to back pain',
        employeeName: 'Test Employee',
        caseId: CASE_ID,
        companyId: '00000000-0000-4000-a000-000000000010',
      });

      expect(result.success).toBe(false);
      expect(result.fallback).toBe(true);
      expect(result.error).toContain('Employee consent required');
    });

    it('should allow classification when consent given (consent check passes)', async () => {
      // Case with consent=true — the consent check should PASS
      // We only test that the consent gate does not block; AI provider may fail (that's OK)
      setupCase({ aiConsentGiven: true, aiConsentTimestamp: new Date() });

      const { classifyCase } = await import('../src/services/aiClassifier.js');

      // Call with very short timeout expectation — we only care that consent check passes
      // The AI provider mock returns empty, which eventually falls back, but the key assertion
      // is that the error is NOT about consent.
      const result = await classifyCase({
        requestDescription: 'Need ergonomic chair due to back pain',
        employeeName: 'Test Employee',
        caseId: CASE_ID,
        companyId: '00000000-0000-4000-a000-000000000010',
      });

      // If consent was blocking, error would contain "consent required"
      // Since consent is given, the function proceeds past consent check
      if (result.error) {
        expect(result.error).not.toContain('consent');
      }
      // Even if AI fails, fallback is true but NOT due to consent
      expect(result.success === true || result.fallback === true).toBe(true);
    }, 30_000); // 30s timeout to handle AI retry sleep delays
  });

  // ====================================================================
  // 5. Revoke consent
  // ====================================================================
  describe('POST /cases/:id/ai-consent-revoke — revoke consent', () => {
    it('should revoke consent + set aiConsentGiven=false + audit log', async () => {
      setupCase({ aiConsentGiven: true, aiConsentTimestamp: new Date() });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent-revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.consent_revoked).toBe(true);

      // Verify case updated
      expect(mockCases[0]!['aiConsentGiven']).toBe(false);

      // Verify audit log
      const revokeLog = mockAuditLogs.find(
        (l) => (l['metadata'] as Record<string, unknown>)?.['event'] === 'consent_revoked',
      );
      expect(revokeLog).toBeDefined();
      expect(revokeLog!['action']).toBe('ai_consent_declined');
      expect((revokeLog!['metadata'] as Record<string, unknown>)['previous_consent']).toBe(true);
    });

    // ====================================================================
    // 6. Revoke after classification — existing preserved
    // ====================================================================
    it('should preserve existing classification after revoke', async () => {
      const existingClassification = {
        law_type: 'ada',
        confidence: 0.92,
        reasoning: 'Already classified',
      };
      setupCase({
        aiConsentGiven: true,
        aiConsentTimestamp: new Date(),
        aiClassification: existingClassification,
        type: 'ada',
      });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent-revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);

      // Consent revoked but classification preserved
      expect(mockCases[0]!['aiConsentGiven']).toBe(false);
      expect(mockCases[0]!['aiClassification']).toEqual(existingClassification);
      expect(mockCases[0]!['type']).toBe('ada');
    });

    it('should return 400 for invalid case ID format', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/cases/not-a-uuid/ai-consent-revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ====================================================================
  // 7. Manual classify
  // ====================================================================
  describe('POST /cases/:id/manual-classify — manual classification', () => {
    it('should manually classify case type + audit log', async () => {
      setupCase({ aiConsentGiven: false });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
          type: 'pwfa',
          reason: 'Employee is pregnant and requested schedule modification under PWFA',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.classification_source).toBe('manual_hr');
      expect(body.case).toBeDefined();

      // Verify case type updated
      expect(mockCases[0]!['type']).toBe('pwfa');

      // Verify audit log
      const classifyLog = mockAuditLogs.find(
        (l) => l['action'] === 'case_classified' &&
          (l['metadata'] as Record<string, unknown>)?.['event'] === 'manual_classification',
      );
      expect(classifyLog).toBeDefined();
      expect((classifyLog!['metadata'] as Record<string, unknown>)['source']).toBe('manual_hr');
      expect((classifyLog!['metadata'] as Record<string, unknown>)['type']).toBe('pwfa');
    });

    it('should accept all valid case types', async () => {
      const types = ['ada', 'pwfa', 'state_law', 'multiple'] as const;
      for (const type of types) {
        mockCases.length = 0;
        mockAuditLogs.length = 0;
        setupCase();
        const { default: app } = await import('../src/index.js');

        const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
          body: JSON.stringify({
            type,
            reason: 'Manual classification reason for testing this specific type',
          }),
        });

        expect(res.status).toBe(200);
        expect(mockCases[0]!['type']).toBe(type);
      }
    });

    it('should return 400 for invalid type', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ type: 'invalid_type', reason: 'Some reason that is long enough' }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for short reason (< 10 chars)', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ type: 'ada', reason: 'short' }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid case ID format', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/cases/not-uuid/manual-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ type: 'ada', reason: 'Valid reason for manual classification' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ====================================================================
  // 8. Manual suggestions
  // ====================================================================
  describe('POST /cases/:id/manual-suggestions — manual suggestions', () => {
    it('should add manual suggestions with source=manual_hr + audit log', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
          suggestions: [
            {
              name: 'Ergonomic chair',
              description: 'Height-adjustable chair with lumbar support',
              costEstimate: '$300-$500',
              costRange: 'low',
              effectiveness: 'high',
            },
            {
              name: 'Standing desk converter',
              description: 'Adjustable desk riser for sit-stand work',
              costEstimate: '$150-$400',
              costRange: 'low',
              effectiveness: 'medium',
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.count).toBe(2);
      expect(body.source).toBe('manual_hr');
      expect(body.suggestions).toHaveLength(2);

      // Verify suggestions saved with source='manual_hr'
      expect(mockSuggestions).toHaveLength(2);
      expect(mockSuggestions[0]!['source']).toBe('manual_hr');
      expect(mockSuggestions[1]!['source']).toBe('manual_hr');

      // Verify audit log
      const suggestLog = mockAuditLogs.find(
        (l) => (l['metadata'] as Record<string, unknown>)?.['event'] === 'manual_suggestions_added',
      );
      expect(suggestLog).toBeDefined();
      const meta = suggestLog!['metadata'] as Record<string, unknown>;
      expect(meta['count']).toBe(2);
      expect(meta['source']).toBe('manual_hr');

      // SEC-008 (ACMD-118-B): CCPA data minimization — audit log metadata
      // MUST NOT include raw `suggestion_names` (HR-entered free text may
      // contain employee PII / medical context). It MUST include opaque
      // `suggestion_ids` instead so forensic joins back to acmd_suggestions
      // remain possible without persisting PII.
      expect(meta).not.toHaveProperty('suggestion_names');
      expect(meta).toHaveProperty('suggestion_ids');
      const ids = meta['suggestion_ids'] as string[];
      expect(Array.isArray(ids)).toBe(true);
      expect(ids).toHaveLength(2);
      // Opaque IDs only — raw name strings must not leak through IDs.
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(JSON.stringify(meta)).not.toContain('Ergonomic chair');
      expect(JSON.stringify(meta)).not.toContain('Standing desk converter');
    });

    it('should return 400 for empty suggestions array', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ suggestions: [] }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for suggestion without name', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
          suggestions: [{ description: 'Missing name field' }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should accept suggestions with minimal fields (name only)', async () => {
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
          suggestions: [{ name: 'Flexible schedule' }],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.count).toBe(1);
    });
  });

  // ====================================================================
  // 9. No adverse effect — non-AI features work with consent=false
  // ====================================================================
  describe('No adverse effect when consent=false', () => {
    it('should allow GET case detail when consent=false', async () => {
      setupCase({ aiConsentGiven: false });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.case).toBeDefined();
    });

    it('should allow PATCH case status when consent=false', async () => {
      setupCase({ aiConsentGiven: false, status: 'intake' });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ status: 'interactive_process' }),
      });

      expect(res.status).toBe(200);
    });

    it('should allow manual classification when consent=false', async () => {
      setupCase({ aiConsentGiven: false });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
          type: 'ada',
          reason: 'Manual classification because employee declined AI processing',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should allow manual suggestions when consent=false', async () => {
      setupCase({ aiConsentGiven: false });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({
          suggestions: [{ name: 'Schedule flexibility' }],
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  // ====================================================================
  // 10. Role checks
  // ====================================================================
  describe('Role-based access control', () => {
    it('should deny manager from recording consent (requires admin/hr)', async () => {
      mockRole = 'manager';
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(403);
    });

    it('should deny viewer from recording consent', async () => {
      mockRole = 'viewer';
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(403);
    });

    it('should deny manager from revoking consent', async () => {
      mockRole = 'manager';
      setupCase({ aiConsentGiven: true });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent-revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(403);
    });

    it('should deny viewer from manual classify', async () => {
      mockRole = 'viewer';
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ type: 'ada', reason: 'Manual classification attempt by viewer' }),
      });

      expect(res.status).toBe(403);
    });

    it('should deny manager from manual suggestions', async () => {
      mockRole = 'manager';
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ suggestions: [{ name: 'Test' }] }),
      });

      expect(res.status).toBe(403);
    });

    it('should allow hr role to record consent', async () => {
      mockRole = 'hr';
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(200);
    });

    it('should allow hr role to manual classify', async () => {
      mockRole = 'hr';
      setupCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ type: 'ada', reason: 'HR manual classification for this case' }),
      });

      expect(res.status).toBe(200);
    });
  });

  // ====================================================================
  // 11. Edge cases
  // ====================================================================
  describe('Edge cases', () => {
    it('should handle double consent (consent again after already given)', async () => {
      setupCase({ aiConsentGiven: true, aiConsentTimestamp: new Date() });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      // Should succeed — idempotent operation
      expect(res.status).toBe(200);
      expect(mockCases[0]!['aiConsentGiven']).toBe(true);

      // Audit log still records the action
      const logs = mockAuditLogs.filter((l) => l['action'] === 'ai_consent_given');
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle revoke when consent already false', async () => {
      setupCase({ aiConsentGiven: false, aiConsentTimestamp: null });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent-revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      });

      // Should succeed — idempotent
      expect(res.status).toBe(200);
      expect(mockCases[0]!['aiConsentGiven']).toBe(false);

      // Audit log records previous_consent=false
      const revokeLog = mockAuditLogs.find(
        (l) => (l['metadata'] as Record<string, unknown>)?.['event'] === 'consent_revoked',
      );
      expect(revokeLog).toBeDefined();
      expect((revokeLog!['metadata'] as Record<string, unknown>)['previous_consent']).toBe(false);
    });

    it('should return 404 for consent on non-existent case', async () => {
      // No case set up — mockCases is empty
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ consentGiven: true, consentMethod: 'web_form' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for revoke on non-existent case', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/ai-consent-revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for manual classify on non-existent case', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ type: 'ada', reason: 'Manual classify on missing case for testing' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for manual suggestions on non-existent case', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}/manual-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ suggestions: [{ name: 'Test' }] }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ====================================================================
  // 12. getCaseById returns ai_consent_status
  // ====================================================================
  describe('getCaseById — ai_consent_status field', () => {
    it('should return pending when no consent timestamp', async () => {
      const { deriveAiConsentStatus } = await import('../src/services/caseService.js');
      expect(deriveAiConsentStatus(false, null)).toBe('pending');
    });

    it('should return given when consent=true with timestamp', async () => {
      const { deriveAiConsentStatus } = await import('../src/services/caseService.js');
      expect(deriveAiConsentStatus(true, new Date())).toBe('given');
    });

    it('should return declined when consent=false with timestamp', async () => {
      const { deriveAiConsentStatus } = await import('../src/services/caseService.js');
      expect(deriveAiConsentStatus(false, new Date())).toBe('declined');
    });

    it('should include ai_consent_status in GET /cases/:id response', async () => {
      setupCase({ aiConsentGiven: true, aiConsentTimestamp: new Date() });
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${CASE_ID}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.case).toBeDefined();
      // The ai_consent_status should be present in the response
      expect(body.case.ai_consent_status).toBeDefined();
    });
  });
});
