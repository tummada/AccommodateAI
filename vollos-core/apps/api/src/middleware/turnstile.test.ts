// turnstile.test.ts — Unit tests for verifyTurnstile helper

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyTurnstile } from './turnstile.js';
import { _resetForTests as resetReplayCache } from './turnstileReplayCache.js';

// Save and restore env
const originalEnv = process.env['TURNSTILE_SECRET_KEY'];

beforeEach(() => {
  process.env['TURNSTILE_SECRET_KEY'] = 'test-secret';
  resetReplayCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetReplayCache();
  if (originalEnv === undefined) {
    delete process.env['TURNSTILE_SECRET_KEY'];
  } else {
    process.env['TURNSTILE_SECRET_KEY'] = originalEnv;
  }
});

describe('verifyTurnstile', () => {
  it('resolves when Cloudflare returns success=true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    }));

    await expect(verifyTurnstile('valid-token', '1.2.3.4')).resolves.toBeUndefined();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const body = init.body as string;
    expect(body).toContain('response=valid-token');
    expect(body).toContain('remoteip=1.2.3.4');
    expect(body).toContain('secret=test-secret');
  });

  it('throws "Turnstile verification failed" when success=false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    }));

    await expect(verifyTurnstile('bad-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile verification failed'
    );
  });

  it('throws "Turnstile service unavailable" when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network error')));

    await expect(verifyTurnstile('any-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile service unavailable'
    );
  });

  it('throws "Turnstile service unavailable" when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    }));

    await expect(verifyTurnstile('any-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile service unavailable'
    );
  });

  it('throws "Turnstile service unavailable" when response JSON is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error('invalid json'); },
    }));

    await expect(verifyTurnstile('any-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile service unavailable'
    );
  });

  // Replay prevention (audit MEDIUM-6 / T-054)
  it('rejects a replayed token after the first successful verify', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // First use — succeeds and marks token as consumed
    await expect(verifyTurnstile('replay-token', '1.2.3.4')).resolves.toBeUndefined();

    // Second use — rejected locally, WITHOUT a second siteverify call
    await expect(verifyTurnstile('replay-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile token already consumed'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does NOT mark a token as consumed when siteverify fails', async () => {
    const fetchMock = vi
      .fn()
      // First call — Cloudflare rejects the token
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      // Second call — same string resubmitted (e.g. attacker retry with valid token-shaped input)
      // should reach Cloudflare again because we never marked it.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyTurnstile('bad-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile verification failed'
    );
    await expect(verifyTurnstile('bad-token', '1.2.3.4')).rejects.toThrow(
      'Turnstile verification failed'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
