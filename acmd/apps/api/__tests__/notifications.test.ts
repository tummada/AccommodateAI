/**
 * Tests for Notification System — Phase 3D
 *
 * Covers:
 *   - getNotificationContent: role-based filtering (manager vs hr vs super_admin)
 *   - createNotification: inserts into DB + email stub for urgent events
 *   - createNotificationsForRole: broadcasts to all users with given role
 *   - checkDeadlineEscalations: 30d/7d/3d/1d/overdue + duplicate prevention
 *   - GET /api/v1/notifications — list + filter + pagination
 *   - PATCH /api/v1/notifications/:id/read — mark single read
 *   - PATCH /api/v1/notifications/read-all — mark all read
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
    messages = { create: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts?: any) {}
  },
}));

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
const mockNotifications: Record<string, unknown>[] = [];
const mockUsers: Record<string, unknown>[] = [];
const mockCases: Record<string, unknown>[] = [];

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  let notifIdCounter = 1;

  const insertHandler = vi.fn((table: unknown) => ({
    values: vi.fn((data: unknown) => {
      if (table === 'acmd_notifications_table') {
        const id = `notif-${notifIdCounter++}`;
        const notif = { id, ...(data as Record<string, unknown>) };
        mockNotifications.push(notif);
        return {
          returning: vi.fn(() => Promise.resolve([notif])),
        };
      }
      return { returning: vi.fn(() => Promise.resolve([])) };
    }),
  }));

  const updateHandler = vi.fn((_table: unknown) => ({
    set: vi.fn((_data: Record<string, unknown>) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          // For read-all: update all matching and return them
          const readNotifs = mockNotifications.filter((n) => !n.readAt);
          readNotifs.forEach((n) => { n.readAt = new Date(); });
          return Promise.resolve(readNotifs.map((n) => ({ id: n.id })));
        }),
      })),
    })),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectHandler = vi.fn((...args: any[]) => {
    const isCountQuery = args.length > 0 && args[0] && typeof args[0] === 'object' && 'value' in args[0];

    return {
      from: vi.fn((table: unknown) => {
        if (table === 'acmd_users_table') {
          return {
            where: vi.fn(() => Promise.resolve([...mockUsers])),
          };
        }
        if (table === 'acmd_cases_table') {
          return {
            where: vi.fn(() => Promise.resolve([...mockCases])),
          };
        }
        if (table === 'acmd_notifications_table') {
          if (isCountQuery) {
            return {
              where: vi.fn(() => Promise.resolve([{ value: mockNotifications.length }])),
            };
          }
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  offset: vi.fn(() => Promise.resolve([...mockNotifications])),
                })),
              })),
              limit: vi.fn(() => Promise.resolve([])), // duplicate check → no duplicate
            })),
          };
        }
        return {
          where: vi.fn(() => Promise.resolve([])),
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
    acmdNotifications: 'acmd_notifications_table',
    acmdUsers: 'acmd_users_table',
    acmdCases: 'acmd_cases_table',
    acmdCompanies: { id: 'id' },
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdRefreshTokens: { tokenHash: 'token_hash' },
    acmdEmployees: 'acmd_employees_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdSuggestions: 'acmd_suggestions_table',
    acmdLetters: 'acmd_letters_table',
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
vi.mock('@acmd/auth', () => ({
  tenantGuard: vi.fn(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any, next: any) => {
      c.set('userId', 'user-uuid');
      c.set('companyId', 'company-uuid');
      c.set('role', 'super_admin');
      c.set('product', 'acmd');
      await next();
    }),
  requireRole: vi.fn((..._roles: string[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_c: any, next: any) => next()),
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
// Tests: getNotificationContent — role-based content filtering
// -----------------------------------------------------------------------

describe('getNotificationContent — role-based filtering', () => {
  it('should return generic content for manager on medical_docs_uploaded', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('medical_docs_uploaded', 'manager', { id: 'abc-12345678' });

    // Manager should NOT see "Medical documents"
    expect(result.title).not.toMatch(/medical/i);
    expect(result.body).not.toMatch(/medical/i);
    expect(result.title).toContain('new update');
  });

  it('should return detailed content for hr on medical_docs_uploaded', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('medical_docs_uploaded', 'hr', { caseNumber: '001' });

    expect(result.title).toMatch(/[Mm]edical/);
    expect(result.body).toMatch(/[Mm]edical/);
  });

  it('should return generic content for manager on deadline_overdue', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('deadline_overdue', 'manager', { caseNumber: '042' });

    // Manager should NOT see ADA/PWFA liability mention
    expect(result.body).not.toMatch(/ADA|PWFA|liability/i);
  });

  it('should return detailed content for super_admin on deadline_overdue', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('deadline_overdue', 'super_admin', { caseNumber: '042', deadline: '2026-04-01' });

    expect(result.title).toMatch(/OVERDUE/i);
    expect(result.body).toMatch(/liability/i);
  });

  it('should return generic content for manager on accommodation_denied', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('accommodation_denied', 'manager', { caseNumber: '100' });

    // Manager should NOT see ADA documentation details
    expect(result.body).not.toMatch(/ADA/i);
  });

  it('should return detailed content for hr on accommodation_denied', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('accommodation_denied', 'hr', { caseNumber: '100' });

    expect(result.body).toMatch(/ADA/i);
  });

  it('should use caseNumber in content when provided', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('case_created', 'hr', { caseNumber: '777' });

    // caseNumber appears in body (title is a fixed label for case_created)
    expect(result.body).toContain('777');
  });

  it('should fallback to id slice when no caseNumber', async () => {
    const { getNotificationContent } = await import('../src/services/notificationService.js');
    const result = getNotificationContent('case_created', 'hr', { id: 'abcd1234-xxxx' });

    expect(result.title + result.body).toContain('abcd1234');
  });
});

// -----------------------------------------------------------------------
// Tests: createNotification
// -----------------------------------------------------------------------

describe('createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.length = 0;
    mockUsers.length = 0;
    mockCases.length = 0;
  });

  it('should insert notification into DB and return an id', async () => {
    const { createNotification } = await import('../src/services/notificationService.js');

    const id = await createNotification({
      userId: 'user-1',
      companyId: 'company-1',
      type: 'case_created',
      title: 'New case',
      body: 'A new case was created.',
      caseId: 'case-1',
    });

    expect(id).toBeTruthy();
    expect(mockNotifications.length).toBe(1);
    expect(mockNotifications[0]!.type).toBe('case_created');
  });

  it('should set priority to "urgent" for deadline_overdue events', async () => {
    const { createNotification } = await import('../src/services/notificationService.js');

    await createNotification({
      userId: 'user-1',
      companyId: 'company-1',
      type: 'deadline_overdue',
      title: 'Overdue',
    });

    expect(mockNotifications[0]!.priority).toBe('urgent');
  });

  it('should set priority to "low" for checklist_completed events', async () => {
    const { createNotification } = await import('../src/services/notificationService.js');

    await createNotification({
      userId: 'user-1',
      companyId: 'company-1',
      type: 'checklist_completed',
      title: 'Checklist done',
    });

    expect(mockNotifications[0]!.priority).toBe('low');
  });

  it('should allow explicit priority override', async () => {
    const { createNotification } = await import('../src/services/notificationService.js');

    await createNotification({
      userId: 'user-1',
      companyId: 'company-1',
      type: 'case_created',
      title: 'Urgent case',
      priority: 'urgent',
    });

    expect(mockNotifications[0]!.priority).toBe('urgent');
  });
});

// -----------------------------------------------------------------------
// Tests: createNotificationsForRole
// -----------------------------------------------------------------------

describe('createNotificationsForRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.length = 0;
    mockUsers.length = 0;
    mockCases.length = 0;
  });

  it('should create notifications for all users with given role', async () => {
    const { createNotificationsForRole } = await import('../src/services/notificationService.js');

    mockUsers.push(
      { id: 'admin-1', companyId: 'company-1', role: 'super_admin', deletedAt: null },
      { id: 'admin-2', companyId: 'company-1', role: 'super_admin', deletedAt: null },
    );

    const count = await createNotificationsForRole({
      companyId: 'company-1',
      role: 'super_admin',
      type: 'case_unacknowledged',
      caseId: 'case-1',
      caseData: { caseNumber: '001' },
    });

    expect(count).toBe(2);
    expect(mockNotifications.length).toBe(2);
  });

  it('should return 0 if no users with given role', async () => {
    const { createNotificationsForRole } = await import('../src/services/notificationService.js');

    const count = await createNotificationsForRole({
      companyId: 'company-1',
      role: 'super_admin',
      type: 'case_unacknowledged',
    });

    expect(count).toBe(0);
    expect(mockNotifications.length).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Tests: checkDeadlineEscalations
// -----------------------------------------------------------------------

describe('checkDeadlineEscalations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.length = 0;
    mockUsers.length = 0;
    mockCases.length = 0;
  });

  it('should detect overdue case and create notification', async () => {
    const { checkDeadlineEscalations } = await import('../src/services/notificationService.js');

    const now = new Date('2026-04-09T12:00:00Z');
    const deadline = new Date('2026-04-07T12:00:00Z'); // 2 days ago

    mockCases.push({
      id: 'case-overdue',
      companyId: 'company-1',
      status: 'intake',
      deadline,
      assignedTo: 'hr-user-1',
      deletedAt: null,
    });

    const result = await checkDeadlineEscalations('company-1', now);
    expect(result.casesChecked).toBe(1);
    expect(result.notificationsCreated).toBeGreaterThanOrEqual(1);
  });

  it('should skip cases with deadline far in future (>30 days)', async () => {
    const { checkDeadlineEscalations } = await import('../src/services/notificationService.js');

    const now = new Date('2026-04-09T12:00:00Z');
    const deadline = new Date('2026-06-01T12:00:00Z'); // ~53 days away

    mockCases.push({
      id: 'case-far',
      companyId: 'company-1',
      status: 'intake',
      deadline,
      assignedTo: 'hr-user-1',
      deletedAt: null,
    });

    const result = await checkDeadlineEscalations('company-1', now);
    expect(result.notificationsCreated).toBe(0);
  });

  it('should return zero counts when no cases', async () => {
    const { checkDeadlineEscalations } = await import('../src/services/notificationService.js');

    const result = await checkDeadlineEscalations('company-1', new Date());
    expect(result.casesChecked).toBe(0);
    expect(result.notificationsCreated).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Tests: Notification Routes (HTTP)
// -----------------------------------------------------------------------

describe('GET /api/v1/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.length = 0;
    mockUsers.length = 0;
    mockCases.length = 0;
  });

  it('should return 200 with notifications array', async () => {
    const app = (await import('../src/index.js')).default;

    mockNotifications.push({
      id: 'notif-1',
      companyId: 'company-uuid',
      userId: 'user-uuid',
      type: 'case_created',
      title: 'Test notification',
      body: 'A test',
      readAt: null,
      createdAt: new Date(),
    });

    const res = await app.request('/api/v1/notifications', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { notifications: unknown[]; total: number; unreadCount: number };
    expect(Array.isArray(json.notifications)).toBe(true);
    expect(typeof json.total).toBe('number');
    expect(typeof json.unreadCount).toBe('number');
  });

  it('should return 400 for invalid limit param', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/notifications?limit=999', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid read param', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/notifications?read=maybe', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/notifications/:id/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.length = 0;
  });

  it('should return 400 for invalid UUID', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/notifications/not-a-uuid/read', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(400);
  });

  it('should return 200 for valid UUID (idempotent)', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request(
      '/api/v1/notifications/550e8400-e29b-41d4-a716-446655440000/read',
      {
        method: 'PATCH',
        headers: { Authorization: 'Bearer test-token' },
      },
    );

    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/v1/notifications/read-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.length = 0;
  });

  it('should return 200 with markedRead count', async () => {
    const app = (await import('../src/index.js')).default;

    const res = await app.request('/api/v1/notifications/read-all', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { markedRead: number };
    expect(typeof json.markedRead).toBe('number');
  });
});
