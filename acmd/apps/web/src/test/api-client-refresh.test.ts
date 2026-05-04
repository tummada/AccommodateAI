/**
 * ACMD-116 §7 — api-client refresh-and-retry tests.
 *
 * Covers:
 *  - 401 → refresh success → retry → 200
 *  - 401 → refresh fail → onAuthLost invoked
 *  - 5 concurrent 401s → single refresh call (dedup)
 *  - retry uses NEW token (stale-closure guard)
 *  - full login → expiry → silent refresh → success (integration)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createAuthenticatedClient } from '@/lib/api-client';
import { __resetRefreshCoordinatorForTests } from '@/lib/refresh-coordinator';
import { server } from './server';

// RS-013: split — data on acmd-api (port 3000), auth on vollos-core (port 3002).
const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';
const PROTECTED = `${API}/api/v1/cases`;

beforeEach(() => {
  __resetRefreshCoordinatorForTests();
});

describe('authenticated client', () => {
  it('401 → refresh 200 → retry → success', async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    server.use(
      http.get(PROTECTED, ({ request }) => {
        protectedCalls += 1;
        const auth = request.headers.get('authorization');
        if (auth === 'Bearer old-token') {
          return HttpResponse.json({ error: 'expired' }, { status: 401 });
        }
        if (auth === 'Bearer new-token') {
          return HttpResponse.json({ items: ['ok'] }, { status: 200 });
        }
        return HttpResponse.json({ error: 'wrong token' }, { status: 401 });
      }),
      http.post(`${AUTH}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: 'new-token' }, { status: 200 });
      }),
    );

    let currentToken: string | null = 'old-token';
    const onRefreshed = vi.fn((t: string) => {
      currentToken = t;
    });
    const onAuthLost = vi.fn();
    const client = createAuthenticatedClient({
      getAccessToken: () => currentToken,
      onTokenRefreshed: onRefreshed,
      onAuthLost,
    });

    const data = await client.request<{ items: string[] }>('/api/v1/cases');
    expect(data.items).toEqual(['ok']);
    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(2);
    expect(onRefreshed).toHaveBeenCalledWith('new-token');
    expect(onAuthLost).not.toHaveBeenCalled();
  });

  it('401 → refresh 401 → onAuthLost called, does NOT retry refresh', async () => {
    let refreshCalls = 0;
    server.use(
      http.get(PROTECTED, () => HttpResponse.json({ error: 'nope' }, { status: 401 })),
      http.post(`${AUTH}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ error: 'revoked' }, { status: 401 });
      }),
    );

    const onRefreshed = vi.fn();
    const onAuthLost = vi.fn();
    const client = createAuthenticatedClient({
      getAccessToken: () => 'old-token',
      onTokenRefreshed: onRefreshed,
      onAuthLost,
    });

    await expect(client.request('/api/v1/cases')).rejects.toThrow();
    expect(refreshCalls).toBe(1);
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('5 concurrent 401s → single refresh call (dedup)', async () => {
    let refreshCalls = 0;
    const protectedHandler = ({ request }: { request: Request }) => {
      const auth = request.headers.get('authorization');
      if (auth === 'Bearer fresh') {
        return HttpResponse.json({ ok: true }, { status: 200 });
      }
      return HttpResponse.json({ error: 'expired' }, { status: 401 });
    };
    server.use(
      http.get(`${API}/api/v1/a`, protectedHandler),
      http.get(`${API}/api/v1/b`, protectedHandler),
      http.get(`${API}/api/v1/c`, protectedHandler),
      http.get(`${API}/api/v1/d`, protectedHandler),
      http.get(`${API}/api/v1/e`, protectedHandler),
      http.post(`${AUTH}/auth/refresh`, async () => {
        refreshCalls += 1;
        // Give concurrent callers time to queue up behind the
        // in-flight promise.
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ accessToken: 'fresh' }, { status: 200 });
      }),
    );

    let currentToken: string | null = 'stale';
    const client = createAuthenticatedClient({
      getAccessToken: () => currentToken,
      onTokenRefreshed: (t) => {
        currentToken = t;
      },
      onAuthLost: vi.fn(),
    });

    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((p) => client.request<{ ok: true }>(`/api/v1/${p}`)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('retry uses NEW token (stale-closure guard)', async () => {
    const seenTokens: string[] = [];
    server.use(
      http.get(PROTECTED, ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        seenTokens.push(auth);
        if (auth === 'Bearer stale') {
          return HttpResponse.json({ error: 'expired' }, { status: 401 });
        }
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: 'rotated' }, { status: 200 }),
      ),
    );

    // The getter intentionally returns 'stale' EVEN after refresh —
    // simulating a React state update that hasn't flushed yet. The
    // client must still retry with the freshly-refreshed 'rotated'
    // value, because it passes the new token explicitly.
    const client = createAuthenticatedClient({
      getAccessToken: () => 'stale',
      onTokenRefreshed: () => {
        /* pretend the setState is pending */
      },
      onAuthLost: vi.fn(),
    });

    await client.request('/api/v1/cases');
    expect(seenTokens).toEqual(['Bearer stale', 'Bearer rotated']);
  });

  it('integration: initial request 200 → later expiry → silent refresh → 200', async () => {
    let refreshCalls = 0;
    let expired = false;
    server.use(
      http.get(PROTECTED, ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        if (!expired && auth === 'Bearer first') {
          return HttpResponse.json({ phase: 1 }, { status: 200 });
        }
        if (expired && auth === 'Bearer first') {
          return HttpResponse.json({ error: 'expired' }, { status: 401 });
        }
        if (auth === 'Bearer second') {
          return HttpResponse.json({ phase: 2 }, { status: 200 });
        }
        return HttpResponse.json({ error: 'bad' }, { status: 401 });
      }),
      http.post(`${AUTH}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: 'second' }, { status: 200 });
      }),
    );

    let currentToken: string | null = 'first';
    const client = createAuthenticatedClient({
      getAccessToken: () => currentToken,
      onTokenRefreshed: (t) => {
        currentToken = t;
      },
      onAuthLost: vi.fn(),
    });

    const a = await client.request<{ phase: number }>('/api/v1/cases');
    expect(a.phase).toBe(1);
    expect(refreshCalls).toBe(0);

    // Now simulate token expiry server-side.
    expired = true;

    const b = await client.request<{ phase: number }>('/api/v1/cases');
    expect(b.phase).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(currentToken).toBe('second');
  });
});
