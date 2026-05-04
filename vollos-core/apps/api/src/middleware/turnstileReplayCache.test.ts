// turnstileReplayCache.test.ts — Unit tests for the in-memory replay cache
//
// Scenarios covered (per task T-054 acceptance criteria):
//   1. First use of a token is not reported as used
//   2. Replay of the same token within TTL is reported as used
//   3. A different token is not reported as used
//   4. After TTL expiry the token is treated as unused again

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isUsed, markUsed, sweepExpired, _resetForTests } from './turnstileReplayCache.js';

beforeEach(() => {
  _resetForTests();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  _resetForTests();
});

describe('turnstileReplayCache', () => {
  it('first use of a token — isUsed returns false before markUsed', () => {
    expect(isUsed('token-A')).toBe(false);
  });

  it('replay detection — isUsed returns true after markUsed (same token)', () => {
    markUsed('token-A');
    expect(isUsed('token-A')).toBe(true);
  });

  it('isolation — a different token is not reported as used', () => {
    markUsed('token-A');
    expect(isUsed('token-B')).toBe(false);
  });

  it('TTL expiry — token is treated as unused after ttlSeconds elapse', () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(start);

    markUsed('token-A', 300); // 5 min
    expect(isUsed('token-A')).toBe(true);

    // Advance past TTL
    vi.setSystemTime(new Date(start.getTime() + 300 * 1000 + 1));
    expect(isUsed('token-A')).toBe(false);
  });

  it('sweepExpired — proactively removes expired entries', () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(start);

    markUsed('token-A', 60);
    markUsed('token-B', 600);

    // Advance past token-A's TTL only
    vi.setSystemTime(new Date(start.getTime() + 61 * 1000));
    sweepExpired();

    expect(isUsed('token-A')).toBe(false);
    expect(isUsed('token-B')).toBe(true);
  });

  it('hash collision resistance — different tokens with long shared prefix stay isolated', () => {
    const base = 'cf-chl-token-'.repeat(10);
    markUsed(base + 'X');
    expect(isUsed(base + 'Y')).toBe(false);
    expect(isUsed(base + 'X')).toBe(true);
  });
});
