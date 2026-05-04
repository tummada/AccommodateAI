/**
 * Tests for Case Timeline — Phase 4D (ACMD-069)
 *
 * Covers:
 *   - GET /api/v1/cases/:id/timeline — pagination, filtering, role visibility
 *   - getEventVisibility: visibility mapping for all 31 event types
 *   - Role-based access: super_admin sees all, hr sees all, manager sees limited
 *   - Edge cases: invalid UUID, case not found, empty timeline
 *   - Event type filter via ?eventType= query parameter
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

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  let auditIdCounter = 1;

  const insertHandler = vi.fn((table: unknown) => ({
    values: vi.fn((data: unknown) => {
      if (table === 'acmd_audit_logs_table') {
        const id = `audit-${auditIdCounter++}`;
        const log = { id, ...(data as Record<string, unknown>), createdAt: new Date() };
        mockAuditLogs.push(log);
        return { returning: vi.fn(() => Promise.resolve([log])) };
      }
      return { returning: vi.fn(() => Promise.resolve([])) };
    }),
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
        if (table === 'acmd_cases_table') {
          return {
            where: vi.fn(() => {
              if (isCountQuery) {
                return Promise.resolve([{ count: mockCases.length }]);
              }
              return {
                limit: vi.fn(() => {
                  if (mockCases.length > 0) {
                    return Promise.resolve([mockCases[0]]);
                  }
                  return Promise.resolve([]);
                }),
                then: (resolve: any, reject?: any) =>
                  Promise.resolve([...mockCases]).then(resolve, reject),
              };
            }),
          };
        }
        if (table === 'acmd_audit_logs_table') {
          return {
            where: vi.fn(() => {
              if (isCountQuery) {
                return Promise.resolve([{ count: mockAuditLogs.length }]);
              }
              return {
                orderBy: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    offset: vi.fn(() => Promise.resolve([...mockAuditLogs])),
                  })),
                })),
                limit: vi.fn(() => Promise.resolve(mockAuditLogs.length > 0 ? [mockAuditLogs[0]] : [])),
                then: (resolve: any, reject?: any) =>
                  Promise.resolve([...mockAuditLogs]).then(resolve, reject),
              };
            }),
          };
        }
        if (table === 'acmd_employees_table') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([{
                id: 'emp-uuid', name: 'Test', position: 'Eng', department: 'Eng', state: 'CA',
              }])),
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
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
            then: (resolve: any) => Promise.resolve([]).then(resolve),
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
    acmdCases: 'acmd_cases_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdNotifications: 'acmd_notifications_table',
    acmdEmployees: 'acmd_employees_table',
    acmdCompanies: 'acmd_companies_table',
    acmdUsers: 'acmd_users_table',
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

describe('Case Timeline (Phase 4D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockCases.length = 0;
    mockAuditLogs.length = 0;
  });

  // ----- GET /api/v1/cases/:id/timeline -----

  describe('GET /api/v1/cases/:id/timeline', () => {
    it('should return timeline events for a valid case (super_admin)', async () => {
      // Seed mock data
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });
      mockAuditLogs.push({
        id: 'audit-1',
        caseId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        action: 'case_created',
        actorId: 'user-uuid',
        metadata: { source: 'api' },
        visibility: ['super_admin', 'hr', 'manager'],
        createdAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.total).toBeTypeOf('number');
      expect(body.limit).toBeTypeOf('number');
      expect(body.offset).toBeTypeOf('number');
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/cases/not-a-uuid/timeline', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid case ID format');
    });

    it('should return 404 when case does not exist', async () => {
      // No case seeded — empty mockCases
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Case not found');
    });

    it('should return empty events when no audit logs exist', async () => {
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should support pagination with limit and offset', async () => {
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline?limit=10&offset=5',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(5);
    });

    it('should support eventType filter', async () => {
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline?eventType=case_created,case_updated',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeDefined();
    });

    it('should return 400 for invalid limit parameter', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline?limit=0',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid query parameters');
    });

    it('should return 400 for limit exceeding max (101)', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline?limit=101',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
    });

    it('should work for hr role', async () => {
      mockRole = 'hr';
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });
      mockAuditLogs.push({
        id: 'audit-1',
        caseId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        action: 'medical_docs_received',
        actorId: 'user-uuid',
        metadata: {},
        visibility: ['super_admin', 'hr'],
        createdAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeDefined();
    });

    it('should work for manager role (limited visibility)', async () => {
      mockRole = 'manager';
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });
      mockAuditLogs.push({
        id: 'audit-1',
        caseId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        action: 'implementation_completed',
        actorId: 'user-uuid',
        metadata: {},
        visibility: ['super_admin', 'hr', 'manager'],
        createdAt: new Date(),
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeDefined();
    });

    it('should default limit to 50 and offset to 0', async () => {
      mockCases.push({
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        companyId: 'company-uuid',
        status: 'intake',
      });

      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        '/api/v1/cases/f47ac10b-58cc-4372-a567-0e02b2c3d479/timeline',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });
  });

  // ----- getEventVisibility -----

  describe('getEventVisibility', () => {
    it('should return correct visibility for all 31 event types', async () => {
      const { getEventVisibility, EVENT_VISIBILITY_MAP } = await import('../src/services/timelineService.js');

      // Medical events — super_admin + hr only
      const medicalOnlyEvents = [
        'medical_docs_requested',
        'medical_docs_received',
        'medical_info_accessed',
        'interactive_process_started',
        'employee_meeting_logged',
        'accommodation_denied',
        'accommodation_modified',
        'legal_review_requested',
        'document_uploaded',
        'document_deleted',
        'ai_classification_completed',
        'ai_suggestions_generated',
        'ai_consent_given',
        'ai_consent_declined',
        'escalation_triggered',
        'notification_sent',
        'audit_exported',
        'case_updated',
        'case_assigned',
        'case_reassigned',
      ];

      for (const evt of medicalOnlyEvents) {
        const vis = getEventVisibility(evt);
        expect(vis).toContain('super_admin');
        expect(vis).toContain('hr');
        expect(vis).not.toContain('manager');
      }

      // Implementation + lifecycle events — include manager
      const managerVisibleEvents = [
        'case_created',
        'case_status_changed',
        'case_closed',
        'manager_input_requested',
        'manager_input_received',
        'accommodation_approved',
        'implementation_started',
        'implementation_completed',
        'follow_up_scheduled',
        'follow_up_completed',
        'deadline_approaching',
        'deadline_overdue',
      ];

      for (const evt of managerVisibleEvents) {
        const vis = getEventVisibility(evt);
        expect(vis).toContain('super_admin');
        expect(vis).toContain('hr');
        expect(vis).toContain('manager');
      }

      // Total unique event types in map should be >= 31
      const totalTypes = Object.keys(EVENT_VISIBILITY_MAP).length;
      expect(totalTypes).toBeGreaterThanOrEqual(31);
    });

    it('should return default visibility for unknown event types', async () => {
      const { getEventVisibility } = await import('../src/services/timelineService.js');
      const vis = getEventVisibility('unknown_event');
      expect(vis).toEqual(['super_admin', 'hr']);
    });
  });

  // ----- Enum coverage -----

  describe('Audit action enum', () => {
    it('should have all 31 required event types (plus legacy)', async () => {
      // Verify the EVENT_VISIBILITY_MAP covers all 31 required types
      const { EVENT_VISIBILITY_MAP } = await import('../src/services/timelineService.js');

      const required31 = [
        // Case lifecycle (6)
        'case_created', 'case_updated', 'case_assigned', 'case_reassigned',
        'case_status_changed', 'case_closed',
        // Interactive process (6)
        'interactive_process_started', 'medical_docs_requested', 'medical_docs_received',
        'manager_input_requested', 'manager_input_received', 'employee_meeting_logged',
        // Decision (4)
        'accommodation_approved', 'accommodation_denied', 'accommodation_modified',
        'legal_review_requested',
        // Implementation (4)
        'implementation_started', 'implementation_completed',
        'follow_up_scheduled', 'follow_up_completed',
        // Documents (2)
        'document_uploaded', 'document_deleted',
        // AI (4)
        'ai_classification_completed', 'ai_suggestions_generated',
        'ai_consent_given', 'ai_consent_declined',
        // System (5)
        'deadline_approaching', 'deadline_overdue', 'escalation_triggered',
        'notification_sent', 'audit_exported',
      ];

      expect(required31).toHaveLength(31);

      for (const action of required31) {
        expect(EVENT_VISIBILITY_MAP).toHaveProperty(action);
        const vis = EVENT_VISIBILITY_MAP[action];
        expect(vis).toBeDefined();
        expect(vis.length).toBeGreaterThan(0);
        expect(vis).toContain('super_admin');
        expect(vis).toContain('hr');
      }
    });
  });

  // ----- Visibility security -----

  describe('Visibility security', () => {
    it('medical events should NEVER include manager in visibility', async () => {
      const { EVENT_VISIBILITY_MAP } = await import('../src/services/timelineService.js');

      const medicalEvents = [
        'medical_docs_requested',
        'medical_docs_received',
        'medical_info_accessed',
      ];

      for (const evt of medicalEvents) {
        const vis = EVENT_VISIBILITY_MAP[evt];
        expect(vis).not.toContain('manager');
        expect(vis).toContain('super_admin');
        expect(vis).toContain('hr');
      }
    });

    it('implementation events should include manager in visibility', async () => {
      const { EVENT_VISIBILITY_MAP } = await import('../src/services/timelineService.js');

      const implEvents = [
        'implementation_started',
        'implementation_completed',
        'follow_up_scheduled',
        'follow_up_completed',
      ];

      for (const evt of implEvents) {
        const vis = EVENT_VISIBILITY_MAP[evt];
        expect(vis).toContain('manager');
        expect(vis).toContain('super_admin');
        expect(vis).toContain('hr');
      }
    });

    it('all events should include super_admin and hr', async () => {
      const { EVENT_VISIBILITY_MAP } = await import('../src/services/timelineService.js');

      for (const [action, vis] of Object.entries(EVENT_VISIBILITY_MAP)) {
        expect(vis).toContain('super_admin');
        expect(vis).toContain('hr');
      }
    });
  });
});
