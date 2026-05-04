// health.test.ts — verify /health and /api/v1/health return identical payload.
// /health kept for Docker HEALTHCHECK + infra/monitor.sh (backwards compat);
// /api/v1/health added per CLAUDE.md K2 ("API ใหม่ทุกตัวอยู่ใต้ /api/v1/").
//
// Mocks @vollos/db + rate limiter (same pattern as leads.test.ts) so importing
// index.ts does not open a real DB connection or TCP listener (VITEST guard
// in index.ts skips `serve()` under vitest).

import { describe, it, expect, vi } from 'vitest';

// Stub env vars required by modules imported via index.ts (routes/config).
// Placeholder values only — never real secrets.
process.env['UNSUBSCRIBE_SECRET'] =
  process.env['UNSUBSCRIBE_SECRET'] ?? 'test-unsubscribe-secret';

vi.mock('@vollos/db', () => ({
  db: { insert: vi.fn(), select: vi.fn(), update: vi.fn() },
  leads: 'leads_table',
  auditLogs: 'audit_logs_table',
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock('hono-rate-limiter', () => ({
  rateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const { default: app } = await import('./index.js');

describe('health endpoints', () => {
  it('GET /health returns 200 with healthy payload', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'healthy', service: 'vollos-api' });
  });

  it('GET /api/v1/health returns identical payload to /health', async () => {
    const res1 = await app.request('/health');
    const res2 = await app.request('/api/v1/health');
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(await res1.json());
  });
});
