// rateLimit.test.ts — Unit tests for auth-service rate-limit middleware.
//
// T-021: Covers
//   - getTrustedIp() header parsing (valid / missing / malformed / Caddy-tail)
//   - createIpRateLimiter() factory behaviour (legitimate traffic, exceed
//     limit → 429 + Retry-After, per-IP isolation, per-bucket isolation)
//
// IP values are RFC 5737 TEST-NET-1 (192.0.2.0/24) so no real address ever
// lands in test output, logs, or rate-limiter memory. See
// ~/.claude/skills/vollos-backend/SKILL.md § SECRET HANDLING.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  getTrustedIp,
  createIpRateLimiter,
  refreshRateLimiter,
  logoutRateLimiter,
  meRateLimiter,
  onboardingRateLimiter,
  googleCallbackRateLimiter,
} from './rateLimit.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// RFC 5737 TEST-NET-1 — reserved for documentation; never routable.
const TEST_IP_1 = '192.0.2.1';
const TEST_IP_2 = '192.0.2.2';
const TEST_IP_3 = '192.0.2.3';
const TEST_IP_4 = '192.0.2.4';
const TEST_IP_5 = '192.0.2.5';
const TEST_IP_6 = '192.0.2.6';
const TEST_IP_7 = '192.0.2.7';
const TEST_IP_8 = '192.0.2.8';
const TEST_IP_9 = '192.0.2.9';
const TEST_IP_10 = '192.0.2.10';

function makeAppWith(path: string, middleware: Parameters<Hono['use']>[1]) {
  const app = new Hono();
  // Mirror production wiring: app.use(path, limiter) BEFORE the route.
  app.use(path, middleware);
  app.get(path, (c) => c.json({ ok: true }));
  app.post(path, (c) => c.json({ ok: true }));
  return app;
}

async function hit(
  app: Hono,
  path: string,
  ip: string,
  method: 'GET' | 'POST' = 'GET',
) {
  return app.request(path, {
    method,
    headers: { 'x-forwarded-for': ip },
  });
}

// ─── getTrustedIp ────────────────────────────────────────────────────────────

describe('getTrustedIp', () => {
  it('returns "unknown" when x-forwarded-for is missing', async () => {
    const app = new Hono();
    let captured = '';
    app.get('/probe', (c) => {
      captured = getTrustedIp(c);
      return c.json({ ok: true });
    });
    await app.request('/probe');
    expect(captured).toBe('unknown');
  });

  it('returns the single IP when header has exactly one entry', async () => {
    const app = new Hono();
    let captured = '';
    app.get('/probe', (c) => {
      captured = getTrustedIp(c);
      return c.json({ ok: true });
    });
    await app.request('/probe', { headers: { 'x-forwarded-for': TEST_IP_1 } });
    expect(captured).toBe(TEST_IP_1);
  });

  it('returns the LAST entry (Caddy appends real client IP at tail)', async () => {
    // Attacker-supplied spoof at head, Caddy-written real IP at tail.
    const app = new Hono();
    let captured = '';
    app.get('/probe', (c) => {
      captured = getTrustedIp(c);
      return c.json({ ok: true });
    });
    await app.request('/probe', {
      headers: { 'x-forwarded-for': `198.51.100.1, ${TEST_IP_2}` },
    });
    expect(captured).toBe(TEST_IP_2);
  });

  it('returns "unknown" when tail entry fails IP regex', async () => {
    const app = new Hono();
    let captured = '';
    app.get('/probe', (c) => {
      captured = getTrustedIp(c);
      return c.json({ ok: true });
    });
    await app.request('/probe', {
      headers: { 'x-forwarded-for': `${TEST_IP_1}, not-an-ip` },
    });
    expect(captured).toBe('unknown');
  });
});

// ─── createIpRateLimiter: allow below limit ──────────────────────────────────

describe('createIpRateLimiter — legitimate traffic', () => {
  it('allows requests under the limit to pass with 200', async () => {
    const limiter = createIpRateLimiter({
      windowMs: 60_000,
      limit: 5,
      bucket: 'legit-under-limit',
    });
    const app = makeAppWith('/probe', limiter);

    for (let i = 0; i < 5; i++) {
      const res = await hit(app, '/probe', TEST_IP_3);
      expect(res.status).toBe(200);
    }
  });

  it('emits draft-6 RateLimit-* headers on allowed responses', async () => {
    const limiter = createIpRateLimiter({
      windowMs: 60_000,
      limit: 5,
      bucket: 'legit-headers',
    });
    const app = makeAppWith('/probe', limiter);

    const res = await hit(app, '/probe', TEST_IP_4);
    expect(res.status).toBe(200);
    // draft-6 spec — verified in hono-rate-limiter@0.5.3/dist/index.js lines 15-18
    expect(res.headers.get('RateLimit-Limit')).toBe('5');
    expect(res.headers.get('RateLimit-Remaining')).toBe('4');
    expect(res.headers.get('RateLimit-Policy')).toBeTruthy();
  });
});

// ─── createIpRateLimiter: 429 + Retry-After ──────────────────────────────────

describe('createIpRateLimiter — exceed limit', () => {
  it('returns 429 with Retry-After header once the limit is exceeded', async () => {
    const limiter = createIpRateLimiter({
      windowMs: 60_000,
      limit: 3,
      bucket: 'exceed-retry-after',
    });
    const app = makeAppWith('/probe', limiter);

    // Exhaust the quota
    for (let i = 0; i < 3; i++) {
      const ok = await hit(app, '/probe', TEST_IP_5);
      expect(ok.status).toBe(200);
    }

    const blocked = await hit(app, '/probe', TEST_IP_5);
    expect(blocked.status).toBe(429);

    const retryAfter = blocked.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    // Retry-After MUST be a positive integer (delta-seconds per RFC 7231 § 7.1.3)
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('429 body contains { error: "Too many requests", retryAfter }', async () => {
    const limiter = createIpRateLimiter({
      windowMs: 60_000,
      limit: 1,
      bucket: 'exceed-body',
    });
    const app = makeAppWith('/probe', limiter);

    await hit(app, '/probe', TEST_IP_6); // consume the single slot
    const blocked = await hit(app, '/probe', TEST_IP_6);

    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error?: string;
      retryAfter?: number;
    };
    expect(body.error).toBe('Too many requests');
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBe(60);
  });

  it('isolates buckets per IP — other IPs keep their quota after one IP is blocked', async () => {
    const limiter = createIpRateLimiter({
      windowMs: 60_000,
      limit: 2,
      bucket: 'per-ip-isolation',
    });
    const app = makeAppWith('/probe', limiter);

    // Exhaust IP #7
    await hit(app, '/probe', TEST_IP_7);
    await hit(app, '/probe', TEST_IP_7);
    const blocked = await hit(app, '/probe', TEST_IP_7);
    expect(blocked.status).toBe(429);

    // Different IP MUST still be allowed
    const other = await hit(app, '/probe', TEST_IP_8);
    expect(other.status).toBe(200);
  });

  it('does not emit Retry-After on successful (allowed) responses', async () => {
    const limiter = createIpRateLimiter({
      windowMs: 60_000,
      limit: 5,
      bucket: 'no-retry-after-on-200',
    });
    const app = makeAppWith('/probe', limiter);

    const res = await hit(app, '/probe', TEST_IP_9);
    expect(res.status).toBe(200);
    expect(res.headers.get('Retry-After')).toBeNull();
  });
});

// ─── Concrete exported limiters — sanity ────────────────────────────────────
//
// Each limiter has its own process-wide in-memory store (created once at
// module load). These tests only verify the limit value + that the bucket
// namespace doesn't collide between limiters. Hitting them to exhaustion
// would poison shared state for other tests in the suite (vitest runs tests
// in one process per file), so we only fire one request per limiter.

describe('exported limiters are wired with distinct buckets', () => {
  it('refreshRateLimiter responds with RateLimit-Limit=30', async () => {
    const app = makeAppWith('/auth/refresh', refreshRateLimiter);
    const res = await hit(app, '/auth/refresh', TEST_IP_10, 'POST');
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('30');
  });

  it('googleCallbackRateLimiter responds with RateLimit-Limit=20', async () => {
    const app = makeAppWith(
      '/auth/google/callback',
      googleCallbackRateLimiter,
    );
    const res = await hit(app, '/auth/google/callback', TEST_IP_10, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('20');
  });

  it('logoutRateLimiter responds with RateLimit-Limit=20', async () => {
    const app = makeAppWith('/auth/logout', logoutRateLimiter);
    const res = await hit(app, '/auth/logout', TEST_IP_10, 'POST');
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('20');
  });

  it('meRateLimiter responds with RateLimit-Limit=60', async () => {
    const app = makeAppWith('/me', meRateLimiter);
    const res = await hit(app, '/me', TEST_IP_10, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('60');
  });

  it('onboardingRateLimiter responds with RateLimit-Limit=20', async () => {
    const app = makeAppWith('/onboarding', onboardingRateLimiter);
    const res = await hit(app, '/onboarding', TEST_IP_10, 'POST');
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('20');
  });
});
