/**
 * T-069 / F-005 — Vitest unit suite for src/lib/api.ts.
 *
 * Each test mocks `fetch` to assert the contract against the verified
 * apps/api/src/routes/beta-signup.ts behaviour:
 *   200 + { status: "redeemed" }                       → ok=true / redeemed
 *   202 + { status: "waitlisted", waitlistId }         → ok=true / waitlisted
 *   400 + { error: "Invite token has expired" }        → token_expired
 *   400 + { error: "Invite token has already been used" } → token_used
 *   400 + { error: "Invalid invite token" }            → invalid_token
 *   400 + { error: "Validation failed" }               → validation_error
 *   429                                                → rate_limited
 *   500                                                → server_error
 *   network reject                                     → network_error
 *
 * Also asserts the OUTGOING request body has the field name `token` (NOT
 * `invite_token`, F-001 fix), and the GPC `Sec-GPC: 1` header is included
 * iff `navigator.globalPrivacyControl === true` (COMP-001 fix).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitBetaSignup, getGpcHeaders } from './api';

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type CapturedCall = {
  url: string;
  init: FetchInit;
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
let captured: CapturedCall[] = [];

function mockFetchResponse(opts: {
  status: number;
  body?: unknown;
  bodyIsInvalidJson?: boolean;
}): void {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      captured.push({
        url: typeof input === 'string' ? input : (input as URL).toString(),
        init: (init ?? {}) as FetchInit,
      });
      const headers = new Headers({ 'Content-Type': 'application/json' });
      const text = opts.bodyIsInvalidJson
        ? '<<not json>>'
        : JSON.stringify(opts.body ?? {});
      return new Response(text, { status: opts.status, headers });
    });
}

function mockFetchNetworkError(): void {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource');
    });
}

beforeEach(() => {
  captured = [];
  // Ensure GPC is OFF unless a test sets it.
  Object.defineProperty(globalThis.navigator, 'globalPrivacyControl', {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  fetchSpy?.mockRestore();
  Object.defineProperty(globalThis.navigator, 'globalPrivacyControl', {
    configurable: true,
    value: undefined,
  });
});

describe('submitBetaSignup — request body shape (F-001 fix)', () => {
  it('serializes the JSON field as `token` (not `invite_token`) and matches backend Zod schema', async () => {
    mockFetchResponse({
      status: 200,
      body: { status: 'redeemed', message: 'ok' },
    });
    await submitBetaSignup({ email: 'beta@example.com', token: 'invite-tok-1' });

    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe('http://api.test.local/api/v1/beta-signup');
    expect(call.init.method).toBe('POST');
    const body = JSON.parse(call.init.body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['email', 'token']);
    expect(body.token).toBe('invite-tok-1');
    expect(body.email).toBe('beta@example.com');
    // F-001 regression guard: must NEVER carry the deprecated key.
    expect(body).not.toHaveProperty('invite_token');
  });

  it('preserves token case (does NOT toUpperCase) — backend matches case-sensitively', async () => {
    mockFetchResponse({
      status: 200,
      body: { status: 'redeemed', message: 'ok' },
    });
    await submitBetaSignup({
      email: 'beta@example.com',
      token: 'aB_cD-9eFg',
    });
    const body = JSON.parse(captured[0]!.init.body ?? '{}') as { token: string };
    expect(body.token).toBe('aB_cD-9eFg');
  });

  it('trims whitespace on token + email before sending', async () => {
    mockFetchResponse({
      status: 200,
      body: { status: 'redeemed', message: 'ok' },
    });
    await submitBetaSignup({
      email: '  beta@example.com  ',
      token: '  invite-tok-1  ',
    });
    const body = JSON.parse(captured[0]!.init.body ?? '{}') as {
      email: string;
      token: string;
    };
    expect(body.email).toBe('beta@example.com');
    expect(body.token).toBe('invite-tok-1');
  });
});

describe('submitBetaSignup — 200 redeemed', () => {
  it('returns ok=true with status="redeemed"', async () => {
    mockFetchResponse({
      status: 200,
      body: {
        status: 'redeemed',
        message: 'Invite accepted — sign in with Google to finish setup',
      },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'invite-tok-1',
    });
    expect(result).toEqual({ ok: true, status: 'redeemed' });
  });
});

describe('submitBetaSignup — 202 waitlisted (F-002 fix)', () => {
  it('returns ok=true with status="waitlisted" and surfaces waitlistId', async () => {
    mockFetchResponse({
      status: 202,
      body: {
        status: 'waitlisted',
        message: 'Beta full — added to waitlist',
        waitlistId: 'wl-abc-123',
      },
    });
    const result = await submitBetaSignup({
      email: 'wait@example.com',
      token: 'invite-tok-cap',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('waitlisted');
      if (result.status === 'waitlisted') {
        expect(result.waitlistId).toBe('wl-abc-123');
        expect(result.message).toContain('#wl-abc-123');
        expect(result.message).toContain("We'll email you");
      }
    }
  });

  it('handles 202 without waitlistId gracefully (null) and shows generic copy', async () => {
    mockFetchResponse({
      status: 202,
      body: { status: 'waitlisted', message: 'ok', waitlistId: null },
    });
    const result = await submitBetaSignup({
      email: 'wait@example.com',
      token: 'invite-tok-cap',
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.status === 'waitlisted') {
      expect(result.waitlistId).toBeNull();
      expect(result.message).not.toContain('#');
      expect(result.message.toLowerCase()).toContain("we'll email you");
    }
  });
});

describe('submitBetaSignup — 400 error mapping (F-003 fix)', () => {
  it('maps `Invite token has expired` → token_expired', async () => {
    mockFetchResponse({
      status: 400,
      body: { error: 'Invite token has expired' },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'expired-tok',
    });
    expect(result).toEqual({
      ok: false,
      code: 'token_expired',
      message: 'This Beta token has expired.',
    });
  });

  it('maps `Invite token has already been used` → token_used', async () => {
    mockFetchResponse({
      status: 400,
      body: { error: 'Invite token has already been used' },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'used-tok',
    });
    expect(result).toEqual({
      ok: false,
      code: 'token_used',
      message: 'This Beta token has already been used.',
    });
  });

  it('maps `Invalid invite token` → invalid_token', async () => {
    mockFetchResponse({
      status: 400,
      body: { error: 'Invalid invite token' },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'unknown-tok',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_token');
      expect(result.message).toContain("isn't valid");
    }
  });

  it('maps `Validation failed` → validation_error with friendly copy', async () => {
    mockFetchResponse({
      status: 400,
      body: { error: 'Validation failed', issues: [] },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    expect(result).toEqual({
      ok: false,
      code: 'validation_error',
      message: 'Please check your email and token format.',
    });
  });

  it('maps `Invalid JSON body` (and any other 400 string) → validation_error', async () => {
    mockFetchResponse({
      status: 400,
      body: { error: 'Invalid JSON body' },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('validation_error');
  });
});

describe('submitBetaSignup — 429 rate limit', () => {
  it('returns rate_limited with hour copy', async () => {
    mockFetchResponse({
      status: 429,
      body: { error: 'Too many requests', retryAfter: 3600 },
    });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    expect(result).toEqual({
      ok: false,
      code: 'rate_limited',
      message: 'Too many attempts. Please try again in an hour.',
    });
  });
});

describe('submitBetaSignup — 5xx server failure', () => {
  it('maps 500 → server_error', async () => {
    mockFetchResponse({ status: 500, body: { error: 'Beta signup failed' } });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('server_error');
      expect(result.message).toContain('Something went wrong');
    }
  });

  it('treats malformed JSON body as server_error (non-2xx + parse fail)', async () => {
    mockFetchResponse({ status: 502, bodyIsInvalidJson: true });
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('server_error');
  });
});

describe('submitBetaSignup — network failure', () => {
  it('returns network_error with offline-friendly copy when fetch throws', async () => {
    mockFetchNetworkError();
    const result = await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network_error');
      expect(result.message).toContain('Something went wrong');
    }
  });
});

describe('GPC header (COMP-001 fix)', () => {
  it('omits Sec-GPC when navigator.globalPrivacyControl is undefined', () => {
    expect(getGpcHeaders()).toEqual({});
  });

  it('omits Sec-GPC when navigator.globalPrivacyControl is false', () => {
    Object.defineProperty(globalThis.navigator, 'globalPrivacyControl', {
      configurable: true,
      value: false,
    });
    expect(getGpcHeaders()).toEqual({});
  });

  it('emits Sec-GPC: 1 when navigator.globalPrivacyControl is true', () => {
    Object.defineProperty(globalThis.navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    });
    expect(getGpcHeaders()).toEqual({ 'Sec-GPC': '1' });
  });

  it('forwards Sec-GPC: 1 on the live fetch when GPC is enabled', async () => {
    Object.defineProperty(globalThis.navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    });
    mockFetchResponse({
      status: 200,
      body: { status: 'redeemed', message: 'ok' },
    });
    await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    const headers = (captured[0]!.init.headers ?? {}) as Record<string, string>;
    expect(headers['Sec-GPC']).toBe('1');
  });

  it('does NOT forward Sec-GPC when GPC is disabled', async () => {
    mockFetchResponse({
      status: 200,
      body: { status: 'redeemed', message: 'ok' },
    });
    await submitBetaSignup({
      email: 'beta@example.com',
      token: 'tok',
    });
    const headers = (captured[0]!.init.headers ?? {}) as Record<string, string>;
    expect(headers['Sec-GPC']).toBeUndefined();
  });
});
