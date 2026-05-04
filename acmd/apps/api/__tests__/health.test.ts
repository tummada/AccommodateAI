/**
 * Unit tests for GET /health endpoint.
 */

import { describe, it, expect, vi } from 'vitest';

// -----------------------------------------------------------------------
// Mock dotenv (must be before any imports that trigger dotenv)
// -----------------------------------------------------------------------
vi.mock('dotenv/config', () => ({}));

// -----------------------------------------------------------------------
// Mock config to avoid requireEnv throwing at module load time
// -----------------------------------------------------------------------
vi.mock('../src/config.js', () => ({
  config: {
    googleClientId: 'test-google-client-id',
    jwtSecret: 'test-jwt-secret-at-least-32-chars-long!',
    port: 3001,
    nodeEnv: 'test',
    corsOrigins: ['http://localhost:3003'],
  },
}));

// -----------------------------------------------------------------------
// Mock heavy external dependencies
// -----------------------------------------------------------------------
vi.mock('@google-cloud/vertexai', () => ({
  VertexAI: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts?: any) {}
    preview = { getGenerativeModel: vi.fn() };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts?: any) {}
  },
}));

vi.mock('@acmd/crypto', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
  validateKey: vi.fn(),
}));

vi.mock('@acmd/db', () => ({
  db: {},
  acmdUsersTable: 'acmd_users_table',
  acmdCompaniesTable: 'acmd_companies_table',
  acmdCasesTable: 'acmd_cases_table',
  acmdChecklistItemsTable: 'acmd_checklist_items_table',
  acmdJanAccommodationsTable: 'acmd_jan_accommodations_table',
  acmdCaseSuggestionsTable: 'acmd_case_suggestions_table',
  acmdCaseLettersTable: 'acmd_case_letters_table',
  acmdAuditLogsTable: 'acmd_audit_logs_table',
  acmdDeadlinesTable: 'acmd_deadlines_table',
  acmdNotificationsTable: 'acmd_notifications_table',
  acmdEmployeesTable: 'acmd_employees_table',
  acmdApprovalSettingsTable: 'acmd_approval_settings_table',
  acmdMedicalRequestsTable: 'acmd_medical_requests_table',
}));

// -----------------------------------------------------------------------
// Set env vars (for any module that reads process.env directly)
// -----------------------------------------------------------------------
process.env['ACMD_GOOGLE_CLIENT_ID'] = 'test-google-client-id';
process.env['ACMD_JWT_SECRET'] = 'test-jwt-secret-at-least-32-chars-long!';
process.env['VITEST'] = 'true';
process.env['ACMD_ENCRYPTION_KEY'] = 'a'.repeat(64);

// -----------------------------------------------------------------------
// Import app after all mocks are set up
// -----------------------------------------------------------------------
import app from '../src/index.js';

describe('GET /health', () => {
  it('returns 200 with status ok and service name', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('acmd-api');
    expect(typeof body.timestamp).toBe('string');
  });
});
