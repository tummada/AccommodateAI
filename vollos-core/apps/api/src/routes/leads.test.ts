// leads.test.ts — Unit tests for POST /api/leads and POST /api/leads/google
// Tests: happy path, honeypot, duplicate email, validation fail, consent fail, Google One Tap

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @vollos/db ──────────────────────────────────────────────────────────
function makeInsertChain(returnVal: object[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnVal),
    }),
  };
}

function makeInsertAuditChain() {
  return {
    values: vi.fn().mockResolvedValue([]),
  };
}

function makeSelectChain(rows: object[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  };
}

vi.mock('@vollos/db', () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  leads: 'leads_table',
  auditLogs: 'audit_logs_table',
}));

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col) => ({ isNull: col })),
}));

// Mock hono-rate-limiter to pass through
vi.mock('hono-rate-limiter', () => ({
  rateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Mock sanitize-html to strip tags
vi.mock('sanitize-html', () => ({
  default: (input: string) => input.replace(/<[^>]*>/g, ''),
}));

// Mock sendEmail — fire-and-forget, should not block
vi.mock('../email/sender.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock buildAutoReply
vi.mock('../email/templates/autoReply.js', () => ({
  buildAutoReply: vi.fn().mockReturnValue({
    subject: 'Test Subject',
    html: '<p>Test</p>',
    text: 'Test',
  }),
}));

// Mock verifyGoogleToken
vi.mock('../auth/googleJwt.js', () => ({
  verifyGoogleToken: vi.fn(),
}));

// Mock verifyTurnstile — pass through by default
vi.mock('../middleware/turnstile.js', () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(undefined),
}));

// Mock unsubscribe config — avoid env var check at import time.
// Provide stubs for the token helpers leads.ts calls; verification is tested separately
// in signedToken.test.ts, so leads tests only need deterministic emission.
vi.mock('../config/unsubscribe.js', () => ({
  UNSUBSCRIBE_SECRET: 'test-unsubscribe-secret',
  generateSignedToken: (leadId: string) => `stub-ts.stub-hmac-${leadId}`,
  verifySignedToken: () => true,
  SIGNED_TOKEN_RE: /^[0-9a-z]{1,12}\.[0-9a-f]{64}$/,
  TOKEN_TTL_SECONDS: 30 * 24 * 60 * 60,
}));

import { db } from '@vollos/db';
import { verifyGoogleToken } from '../auth/googleJwt.js';
import { verifyTurnstile } from '../middleware/turnstile.js';

// Import app AFTER mocks are set up
const { leadsRouter } = await import('./leads.js');
import { Hono } from 'hono';

function buildApp() {
  const app = new Hono();
  app.route('/', leadsRouter);
  return app;
}

const validBody = {
  email: 'test@example.com',
  name: 'Test User',
  source: 'form',
  productSlug: 'vollos-pro',
  consentGiven: true,
  turnstileToken: 'test-turnstile-token',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/leads', () => {
  it('happy path — creates lead and returns 201', async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never);
    vi.mocked(db.insert)
      .mockReturnValueOnce(makeInsertChain([{ id: 'new-uuid' }]) as never)
      .mockReturnValueOnce(makeInsertAuditChain() as never);

    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('honeypot — returns 200 silently when _hp is set', async () => {
    vi.mocked(db.insert).mockReturnValueOnce(makeInsertAuditChain() as never);

    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, _hp: 'bot-value' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(db.select).not.toHaveBeenCalled();
    // honeypot still logs to audit_logs
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('duplicate email — audit logs duplicate and returns 200', async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([{ id: 'existing-uuid', unsubscribedAt: null }]) as never);
    vi.mocked(db.insert).mockReturnValueOnce(makeInsertAuditChain() as never);

    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('validation fail — returns 422 for invalid email', async () => {
    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, email: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Validation failed');
  });

  it('consent required — returns 422 when consentGiven is false', async () => {
    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, consentGiven: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Consent is required');
  });

  it('missing body — returns 422', async () => {
    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
  });

  it('missing turnstileToken — returns 422 validation error', async () => {
    const app = buildApp();
    const { turnstileToken: _tt, ...bodyWithoutToken } = validBody;
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(bodyWithoutToken),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Validation failed');
  });

  it('Turnstile failure — returns 422 human verification failed', async () => {
    vi.mocked(verifyTurnstile).mockRejectedValueOnce(new Error('Turnstile verification failed'));

    const app = buildApp();
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Human verification failed');
  });

  it('company field is optional — creates lead without company', async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never);
    vi.mocked(db.insert)
      .mockReturnValueOnce(makeInsertChain([{ id: 'new-uuid' }]) as never)
      .mockReturnValueOnce(makeInsertAuditChain() as never);

    const app = buildApp();
    const { ...bodyWithoutCompany } = validBody;
    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify(bodyWithoutCompany),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/leads/google', () => {
  const validGoogleBody = {
    credential: 'valid.google.jwt',
    productSlug: 'vollos-pro',
    consentGiven: true,
    turnstileToken: 'test-turnstile-token',
  };

  it('happy path — verifies token, creates lead, returns 201', async () => {
    vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
      email: 'google@example.com',
      name: 'Google User',
      googleId: 'gid-123',
    });
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never);
    vi.mocked(db.insert)
      .mockReturnValueOnce(makeInsertChain([{ id: 'google-lead-uuid' }]) as never)
      .mockReturnValueOnce(makeInsertAuditChain() as never);

    const app = buildApp();
    const res = await app.request('/google', {
      method: 'POST',
      body: JSON.stringify(validGoogleBody),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('invalid token — returns 401', async () => {
    vi.mocked(verifyGoogleToken).mockRejectedValueOnce(new Error('Token expired'));

    const app = buildApp();
    const res = await app.request('/google', {
      method: 'POST',
      body: JSON.stringify(validGoogleBody),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Invalid Google token');
  });

  it('validation fail — returns 422 when credential is missing', async () => {
    const app = buildApp();
    const res = await app.request('/google', {
      method: 'POST',
      body: JSON.stringify({ productSlug: 'vollos-pro', consentGiven: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Validation failed');
  });

  it('duplicate email (Google) — audit log lead_duplicate, returns 200', async () => {
    vi.mocked(verifyGoogleToken).mockResolvedValueOnce({
      email: 'existing@example.com',
      name: 'Existing User',
      googleId: 'gid-existing',
    });
    vi.mocked(db.select).mockReturnValue(makeSelectChain([{ id: 'existing-uuid', unsubscribedAt: null }]) as never);
    vi.mocked(db.insert).mockReturnValueOnce(makeInsertAuditChain() as never);

    const app = buildApp();
    const res = await app.request('/google', {
      method: 'POST',
      body: JSON.stringify(validGoogleBody),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('consent required — returns 422 when consentGiven is false', async () => {
    const app = buildApp();
    const res = await app.request('/google', {
      method: 'POST',
      body: JSON.stringify({ ...validGoogleBody, consentGiven: false }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Consent is required');
  });

  it('invalid JSON body — returns 422', async () => {
    const app = buildApp();
    const res = await app.request('/google', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(422);
  });
});
