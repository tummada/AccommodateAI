/**
 * Integration tests for Letter routes.
 *
 * Covers:
 *   - POST /api/v1/cases/:id/letters — generate letter
 *   - GET /api/v1/cases/:id/letters — list letters
 *   - PATCH /api/v1/cases/:id/letters/:letterId — edit draft
 *   - POST /api/v1/cases/:id/letters/:letterId/send — send email
 *   - GET /api/v1/cases/:id/letters/:letterId/pdf — download PDF
 *   - Role enforcement: viewer can GET but not POST/PATCH/send
 *   - Validation: invalid UUID, missing fields, invalid body
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
// Mock @google-cloud/vertexai (Vertex AI SDK — ADC, no API key)
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
                text: 'Dear Employee,\n\nWe have received your accommodation request.\n\nThis letter is for informational purposes only.\n\nSincerely,\nHR Department',
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
const mockAiCreate = vi.fn().mockResolvedValue({
  content: [{
    type: 'text',
    text: 'Dear Employee,\n\nWe have received your accommodation request.\n\nThis letter is for informational purposes only.\n\nSincerely,\nHR Department',
  }],
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockAiCreate };
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
// Mock pdfkit
// -----------------------------------------------------------------------
vi.mock('pdfkit', () => {
  const { EventEmitter } = require('events');
  return {
    default: class MockPDFDocument extends EventEmitter {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_opts?: any) {
        super();
      }
      fontSize() { return this; }
      font() { return this; }
      text() { return this; }
      moveDown() { return this; }
      strokeColor() { return this; }
      lineWidth() { return this; }
      moveTo() { return this; }
      lineTo() { return this; }
      stroke() { return this; }
      fillColor() { return this; }
      get y() { return 100; }
      end() {
        // Emit a small buffer as PDF content
        const buf = Buffer.from('%PDF-1.4 mock pdf content');
        process.nextTick(() => {
          this.emit('data', buf);
          this.emit('end');
        });
      }
    },
  };
});

// -----------------------------------------------------------------------
// Mock stores
// -----------------------------------------------------------------------
const mockCases: Record<string, unknown>[] = [];
const mockLetters: Record<string, unknown>[] = [];
const mockAuditLogs: Record<string, unknown>[] = [];
let mockLetterIdCounter = 0;

// -----------------------------------------------------------------------
// Mock @acmd/db
// -----------------------------------------------------------------------
vi.mock('@acmd/db', () => {
  const insertHandler = vi.fn((table: unknown) => ({
    values: vi.fn((data: unknown) => {
      if (table === 'acmd_letters_table') {
        mockLetterIdCounter++;
        const letterData = data as Record<string, unknown>;
        const letter = {
          id: `letter-uuid-${mockLetterIdCounter}`,
          ...letterData,
          status: letterData.status ?? 'draft',
          sentAt: null,
          sentToEmail: null,
          pdfUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockLetters.push(letter);
        return { returning: vi.fn(() => Promise.resolve([letter])) };
      }
      if (table === 'acmd_audit_logs_table') {
        mockAuditLogs.push(data as Record<string, unknown>);
      }
      return { returning: vi.fn(() => Promise.resolve([])) };
    }),
  }));

  const updateHandler = vi.fn(() => ({
    set: vi.fn((data: Record<string, unknown>) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          // For letter update
          if (mockLetters.length > 0) {
            const letter = mockLetters[0]!;
            Object.assign(letter, data);
            return Promise.resolve([{ ...letter }]);
          }
          return Promise.resolve([]);
        }),
      })),
    })),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectHandler = vi.fn((..._args: any[]) => ({
    from: vi.fn((table: unknown) => {
      // Companies
      if (table === 'acmd_companies_table') {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([{
                id: 'company-uuid',
                name: 'Test Company',
              }]),
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
                id: 'emp-uuid',
                name: 'Test Employee',
                email: 'employee@test.com',
                position: 'Engineer',
                department: 'Engineering',
                state: 'CA',
                companyId: 'company-uuid',
              }]),
            ),
          })),
        };
      }

      // Letters
      if (table === 'acmd_letters_table') {
        return {
          where: vi.fn(() => {
            // Check if this is a single letter query (with limit) or list query
            return {
              limit: vi.fn(() =>
                Promise.resolve(mockLetters.length > 0 ? [mockLetters[0]] : []),
              ),
              then: (resolve: any, reject?: any) =>
                Promise.resolve([...mockLetters]).then(resolve, reject),
            };
          }),
        };
      }

      // Cases (default)
      return {
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve(mockCases.length > 0 ? [mockCases[0]] : []),
          ),
          then: (resolve: any, reject?: any) =>
            Promise.resolve([...mockCases]).then(resolve, reject),
        })),
      };
    }),
  }));

  return {
    db: {
      insert: insertHandler,
      update: updateHandler,
      select: selectHandler,
    },
    acmdCases: 'acmd_cases_table',
    acmdLetters: 'acmd_letters_table',
    acmdAuditLogs: 'acmd_audit_logs_table',
    acmdEmployees: 'acmd_employees_table',
    acmdCompanies: 'acmd_companies_table',
    acmdUsers: 'acmd_users_table',
    acmdChecklistItems: 'acmd_checklist_items_table',
    acmdNotifications: 'acmd_notifications_table',
    acmdSuggestions: 'acmd_suggestions_table',
    acmdJanAccommodations: 'acmd_jan_accommodations_table',
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
// Helper
// -----------------------------------------------------------------------

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const VALID_LETTER_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function seedCase() {
  mockCases.push({
    id: 'case-uuid-1',
    companyId: 'company-uuid',
    employeeId: 'emp-uuid',
    status: 'intake',
    type: 'ada',
    requestDescription: 'Employee needs ergonomic workstation',
    aiClassification: { law_type: 'ada' },
    approvedAccommodation: null,
    denialReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function seedLetter() {
  mockLetters.push({
    id: 'letter-uuid-1',
    caseId: 'case-uuid-1',
    type: 'acknowledgment',
    content: 'Dear Employee, We received your request...',
    status: 'draft',
    sentAt: null,
    sentToEmail: null,
    pdfUrl: null,
    createdBy: 'user-uuid',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('Letter Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'super_admin';
    mockCases.length = 0;
    mockLetters.length = 0;
    mockAuditLogs.length = 0;
    mockLetterIdCounter = 0;
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
  });

  // ---- POST /api/v1/cases/:id/letters ----

  describe('POST /api/v1/cases/:id/letters', () => {
    it('should generate a letter for valid case (admin)', async () => {
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'acknowledgment' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.letter).toBeDefined();
      expect(body.source).toBeDefined();
      expect(body.letter.type).toBe('acknowledgment');
      expect(body.letter.status).toBe('draft');
    });

    it('should generate all 5 letter types', async () => {
      const types = ['acknowledgment', 'medical_request', 'approval', 'denial', 'follow_up'] as const;
      const { default: app } = await import('../src/index.js');

      for (const type of types) {
        seedCase();
        mockLetters.length = 0;

        const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ type }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.letter.type).toBe(type);
        mockCases.length = 0;
      }
    });

    it('should accept customInstructions', async () => {
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          type: 'acknowledgment',
          customInstructions: 'Please use formal tone',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should return 404 for non-existent case', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'acknowledgment' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/cases/bad-uuid/letters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'acknowledgment' }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid letter type', async () => {
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'invalid_type' }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON body', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });

    it('should return 403 for unknown role on POST letters', async () => {
      mockRole = 'viewer'; // legacy role — no longer valid
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'acknowledgment' }),
      });

      expect(res.status).toBe(403);
    });

    it('should allow manager role', async () => {
      mockRole = 'manager';
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'acknowledgment' }),
      });

      expect(res.status).toBe(201);
    });

    it('should use fallback when AI provider is unknown', async () => {
      process.env['ACMD_AI_PROVIDER'] = 'unknown_provider';
      const { resetProviderCache } = await import('../src/services/aiProvider.js');
      resetProviderCache();
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ type: 'acknowledgment' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.source).toBe('fallback');

      // Restore default provider
      delete process.env['ACMD_AI_PROVIDER'];
      resetProviderCache();
    });
  });

  // ---- GET /api/v1/cases/:id/letters ----

  describe('GET /api/v1/cases/:id/letters', () => {
    it('should list letters for a case', async () => {
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.letters).toBeDefined();
      expect(Array.isArray(body.letters)).toBe(true);
    });

    it('should allow hr role to list letters', async () => {
      mockRole = 'hr';
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(`/api/v1/cases/${VALID_UUID}/letters`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(200);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request('/api/v1/cases/bad-uuid/letters', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ---- PATCH /api/v1/cases/:id/letters/:letterId ----

  describe('PATCH /api/v1/cases/:id/letters/:letterId', () => {
    it('should edit a draft letter', async () => {
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: 'Updated letter content with edits from HR.' }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.letter).toBeDefined();
    });

    it('should return 404 when letter not found', async () => {
      // No letters seeded
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: 'New content' }),
        },
      );

      expect(res.status).toBe(404);
    });

    it('should return 400 for empty content', async () => {
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: '' }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/bad/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: 'Test' }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid letter UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/bad`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: 'Test' }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 403 for unknown role on PATCH letter', async () => {
      mockRole = 'viewer'; // legacy role — no longer valid
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: 'Test' }),
        },
      );

      expect(res.status).toBe(403);
    });

    it('should return 400 for invalid JSON body', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: 'not-json',
        },
      );

      expect(res.status).toBe(400);
    });

    it('should write audit log on successful edit (Fix 6)', async () => {
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ content: 'Edited letter content for audit log test.' }),
        },
      );

      expect(res.status).toBe(200);
      // Verify audit log was written
      const editAudit = mockAuditLogs.find(
        (a) => (a.metadata as Record<string, unknown>)?.event === 'letter_edited',
      );
      expect(editAudit).toBeDefined();
      expect(editAudit?.action).toBe('case_updated');
    });
  });

  // ---- POST /api/v1/cases/:id/letters/:letterId/send ----

  describe('POST /api/v1/cases/:id/letters/:letterId/send', () => {
    it('should send a letter (placeholder email)', async () => {
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}/send`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.letter).toBeDefined();
      expect(body.emailSent).toBe(true);
    });

    it('should return 404 when letter not found', async () => {
      // No letters seeded, but case exists
      seedCase();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}/send`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/bad/letters/${VALID_LETTER_UUID}/send`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid letter UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/bad/send`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 403 for unknown role on send letter', async () => {
      mockRole = 'viewer'; // legacy role — no longer valid
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}/send`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(403);
    });
  });

  // ---- GET /api/v1/cases/:id/letters/:letterId/pdf ----

  describe('GET /api/v1/cases/:id/letters/:letterId/pdf', () => {
    it('should return PDF binary for valid letter', async () => {
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}/pdf`,
        {
          method: 'GET',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('.pdf');

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(0);
    });

    it('should return 404 when letter not found', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}/pdf`,
        {
          method: 'GET',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid case UUID', async () => {
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/bad/letters/${VALID_LETTER_UUID}/pdf`,
        {
          method: 'GET',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(400);
    });

    it('should allow hr role to download PDF', async () => {
      mockRole = 'hr';
      seedCase();
      seedLetter();
      const { default: app } = await import('../src/index.js');

      const res = await app.request(
        `/api/v1/cases/${VALID_UUID}/letters/${VALID_LETTER_UUID}/pdf`,
        {
          method: 'GET',
          headers: { 'Authorization': 'Bearer test-token' },
        },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
    });
  });
});
