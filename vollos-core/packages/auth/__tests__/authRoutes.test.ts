// Unit tests for createAuthRoutes() factory — RS256
// Tests POST /auth/google, /auth/refresh, /auth/logout
// Mocks google-auth-library + in-memory token store

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { KeyLike } from 'jose';
import { Hono } from 'hono';
import { createAuthRoutes } from '../src/authRoutes.js';
import { hashToken, createTokens, verifyAccessToken, generateRsaKeyPair } from '../src/jwt.js';
import type { AuthConfig, RefreshTokenCallbacks, UserRecord } from '../src/types.js';

// Shared mutable mock for verifyIdToken — updated per test
let mockVerifyIdTokenImpl: (() => Promise<unknown>) | null = null;

// Mock google-auth-library
vi.mock('google-auth-library', () => {
  return {
    OAuth2Client: function MockOAuth2Client(_clientId: string) {
      return {
        verifyIdToken: function (_opts: unknown) {
          if (!mockVerifyIdTokenImpl) throw new Error('mockVerifyIdTokenImpl not set');
          return mockVerifyIdTokenImpl();
        },
      };
    },
  };
});

// Shared RSA key pair — generated once for all tests
let testPrivateKey: KeyLike;
let testPublicKey: KeyLike;

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  testPrivateKey = pair.privateKey;
  testPublicKey = pair.publicKey;
});

const TEST_CLIENT_ID = 'test-google-client-id';

function makeInMemoryStore() {
  const store = new Map<string, boolean>(); // hash → false(stored) / true(revoked)
  const storeCalls: string[] = [];
  const revokeCalls: string[] = [];
  const claimCalls: string[] = [];

  const obj: RefreshTokenCallbacks & {
    store: Map<string, boolean>;
    storeCalls: string[];
    revokeCalls: string[];
    claimCalls: string[];
  } = {
    store,
    storeCalls,
    revokeCalls,
    claimCalls,
    async storeToken(hash: string): Promise<void> {
      storeCalls.push(hash);
      store.set(hash, false);
    },
    async revokeToken(hash: string): Promise<void> {
      revokeCalls.push(hash);
      store.set(hash, true);
    },
    async isTokenRevoked(hash: string): Promise<boolean> {
      return store.get(hash) === true;
    },
    // SEC-MEDIUM-4 (T-055): in-memory atomic claim. JavaScript is
    // single-threaded within a microtask, so a synchronous
    // Map.get + Map.set pair is itself atomic — a second caller that
    // awaits this same function will always observe the updated state.
    // This mirrors the PostgreSQL `UPDATE ... WHERE revoked_at IS NULL
    // RETURNING id` guarantee without a real DB.
    async claimRefreshToken(hash: string): Promise<boolean> {
      claimCalls.push(hash);
      const state = store.get(hash);
      if (state !== false) {
        // Unknown token, or already revoked
        return false;
      }
      store.set(hash, true);
      return true;
    },
  };

  vi.spyOn(obj, 'storeToken');
  vi.spyOn(obj, 'revokeToken');
  vi.spyOn(obj, 'claimRefreshToken');

  return obj;
}

type InMemoryStore = ReturnType<typeof makeInMemoryStore>;

const mockUser: UserRecord = {
  id: 'user-uuid-001',
  company_id: 'company-uuid-abc',
  role: 'admin',
  product: 'acmd',
  email: 'alice@company.com',
  name: 'Alice Smith',
  // RS-013: identity + entitlement claims carried into the JWT
  google_id: 'google-uid-001',
  products: ['acmd'],
};

function makeConfig(overrides?: Partial<AuthConfig>): {
  config: AuthConfig;
  store: InMemoryStore;
} {
  const store = makeInMemoryStore();
  const config: AuthConfig = {
    googleClientId: TEST_CLIENT_ID,
    privateKey: testPrivateKey,
    publicKey: testPublicKey,
    findUserByGoogleId: vi.fn(async () => mockUser),
    createUser: vi.fn(async () => mockUser),
    tokenCallbacks: store,
    ...overrides,
  };
  return { config, store };
}

function makeApp(config: AuthConfig): Hono {
  const app = new Hono();
  app.route('/auth', createAuthRoutes(config));
  return app;
}

// -----------------------------------------------------------------------
// POST /auth/google
// -----------------------------------------------------------------------

describe('POST /auth/google', () => {
  beforeEach(() => {
    mockVerifyIdTokenImpl = null;
  });

  it('returns 400 when idToken is missing', async () => {
    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('returns 401 when Google token is invalid', async () => {
    mockVerifyIdTokenImpl = async () => {
      throw new Error('Token signature mismatch');
    };

    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'bad.token' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    // SKILL.md L88: must not expose error detail
    expect(body.error).toBe('Token verification failed');
  });

  it('returns 200 with accessToken on valid Google token', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-001',
        email: 'alice@company.com',
        name: 'Alice Smith',
        email_verified: true,
      }),
    });

    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
  });

  it('sets httpOnly refresh cookie on successful login', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-001',
        email: 'alice@company.com',
        name: 'Alice Smith',
        email_verified: true,
      }),
    });

    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    const setCookieHeader = res.headers.get('Set-Cookie');
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain('refresh_token=');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Strict');
  });

  it('stores refresh token hash in token store', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-001',
        email: 'alice@company.com',
        name: 'Alice Smith',
        email_verified: true,
      }),
    });

    const { config, store } = makeConfig();
    const app = makeApp(config);

    await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    expect(store.storeCalls).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------
// POST /auth/refresh
// -----------------------------------------------------------------------

describe('POST /auth/refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 401 when refresh cookie is missing', async () => {
    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/refresh', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Refresh token missing/);
  });

  it('returns new accessToken on valid refresh token', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    // Create a valid refresh token at time T
    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    // Store it so revocation check passes
    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    // Advance time by 2s so rotated tokens have different iat
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    vi.useRealTimers();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
  });

  it('returns 401 for revoked refresh token', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    // Store and immediately revoke
    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));
    await store.revokeToken(hash);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid or revoked/);
  });

  it('returns 401 for tampered refresh token', async () => {
    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refresh_token=tampered.jwt.here' },
    });

    expect(res.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // SEC-MEDIUM-4 (T-055): concurrent /auth/refresh with the same token
  // MUST NOT succeed more than once.
  //
  // Before the fix, the sequence below issued N fresh token pairs because
  // the SELECT isTokenRevoked + UPDATE revokeToken pair was not atomic.
  // After the fix, `claimRefreshToken` is a single atomic operation so
  // exactly one caller wins and the remaining N-1 get 401.
  // -----------------------------------------------------------------------
  it('SEC-MEDIUM-4: 5 concurrent refresh requests with same token → exactly 1 succeeds, 4 get 401', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-race', company_id: 'co-race', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-race', new Date(Date.now() + 999999));

    // Advance time by 2s so rotated tokens have different iat → different hash
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    // Fire 5 concurrent /auth/refresh with the SAME refresh cookie.
    const fire = () =>
      app.request('/auth/refresh', {
        method: 'POST',
        headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
      });
    const responses = await Promise.all([fire(), fire(), fire(), fire(), fire()]);

    vi.useRealTimers();

    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 200).length;
    const unauthorizedCount = statuses.filter((s) => s === 401).length;

    expect(successCount).toBe(1);
    expect(unauthorizedCount).toBe(4);
    // claimRefreshToken invoked exactly once per request
    expect(store.claimCalls.length).toBe(5);
    // Server-side token state: the original hash is marked revoked.
    expect(store.store.get(hash)).toBe(true);

    // The single winner's response body carries a valid accessToken string.
    const winnerIdx = statuses.indexOf(200);
    const winnerBody = (await responses[winnerIdx]!.json()) as { accessToken: string };
    expect(typeof winnerBody.accessToken).toBe('string');
    expect(winnerBody.accessToken.length).toBeGreaterThan(10);
  });
});

// -----------------------------------------------------------------------
// POST /auth/logout
// -----------------------------------------------------------------------

describe('POST /auth/logout', () => {
  it('returns 200 on logout', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Logged out/);
  });

  it('revokes the refresh token server-side on logout', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    // Server-side revocation — not just cookie deletion
    expect(store.revokeCalls).toContain(hash);
  });

  it('clears refresh cookie on logout', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    const setCookieHeader = res.headers.get('Set-Cookie');
    // Cookie should be cleared (max-age=0 or expires in past)
    expect(setCookieHeader).toBeTruthy();
    // Hono's deleteCookie sets Max-Age=0 or similar
    const cookieStr = setCookieHeader ?? '';
    const isCleared =
      cookieStr.includes('Max-Age=0') ||
      cookieStr.includes('max-age=0') ||
      cookieStr.includes('refresh_token=;') ||
      cookieStr.includes('refresh_token=,');
    expect(isCleared).toBe(true);
  });

  it('returns 200 even when no cookie is present (idempotent)', async () => {
    const { config } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  // -----------------------------------------------------------------------
  // SEC-002 (ACMD-116-secfix): logout MUST NOT swallow DB revoke errors.
  // -----------------------------------------------------------------------
  it('SEC-002: returns 500 when tokenCallbacks.revokeToken throws (DB error)', async () => {
    const { config, store } = makeConfig();
    // Force revokeToken to throw (simulate DB outage / RLS denial)
    store.revokeToken = vi.fn(async () => {
      throw new Error('connection timeout');
    }) as typeof store.revokeToken;

    // Silence the expected console.error so test output stays clean
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const app = makeApp(config);
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Must not leak internal error details
    expect(body.error).toBe('Logout failed');
    expect(JSON.stringify(body)).not.toContain('connection timeout');

    // Error MUST be logged for operator audit trail
    expect(errSpy).toHaveBeenCalled();

    // Client cookie MUST still be cleared (defense in depth)
    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    const cleared =
      setCookieHeader.includes('Max-Age=0') ||
      setCookieHeader.includes('max-age=0');
    expect(cleared).toBe(true);

    errSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // SEC-NEW-003 (ACMD-118-B): structured log with user_id/timestamp/error_type
  // -----------------------------------------------------------------------
  it('SEC-NEW-003: logs structured object with user_id/timestamp/error_type on revoke failure', async () => {
    const { config, store } = makeConfig();
    store.revokeToken = vi.fn(async () => {
      const err = new TypeError('db connection reset by peer');
      throw err;
    }) as typeof store.revokeToken;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tokens = await createTokens(
      { sub: 'user-sec-new-003', company_id: 'co-xyz', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const app = makeApp(config);
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledTimes(1);

    // Second positional arg MUST be a structured object (not a raw Error)
    const call = errSpy.mock.calls[0] as unknown[];
    expect(call[0]).toBe('[auth] logout revokeToken failed');
    const detail = call[1] as Record<string, unknown>;
    expect(detail).toBeDefined();
    expect(typeof detail).toBe('object');

    // Required fields
    expect(detail.user_id).toBe('user-sec-new-003');
    expect(typeof detail.timestamp).toBe('string');
    expect(detail.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
    );
    expect(detail.error_type).toBe('TypeError');
    expect(detail.error_message).toBe('db connection reset by peer');

    // MUST NOT leak the raw refresh token or its hash
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain(tokens.refreshToken);
    expect(serialised).not.toContain(hashToken(tokens.refreshToken));

    const body = await res.json();
    expect(body.error).toBe('Logout failed');
    expect(JSON.stringify(body)).not.toContain('db connection');

    errSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // SEC-001: expired/tampered token should still be a clean 200
  // -----------------------------------------------------------------------
  it('SEC-002: expired/tampered token is a clean 200 (no revoke, no 500)', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: 'refresh_token=not.a.valid.jwt' },
    });

    expect(res.status).toBe(200);
    // revokeToken must NOT have been invoked for an unverifiable token
    expect(store.revokeCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// SEC-001 (ACMD-116-secfix): cookie path desync
// -----------------------------------------------------------------------

describe('SEC-001: configurable cookiePath', () => {
  beforeEach(() => {
    mockVerifyIdTokenImpl = null;
  });

  it('login: Set-Cookie Path respects config.cookiePath', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-001',
        email: 'alice@company.com',
        name: 'Alice Smith',
        email_verified: true,
      }),
    });

    const { config } = makeConfig({ cookiePath: '/api/v1/auth' });
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    expect(setCookieHeader).toContain('Path=/api/v1/auth');
    // Must not still emit the legacy default
    expect(setCookieHeader).not.toContain('Path=/auth;');
    expect(setCookieHeader).not.toContain('Path=/auth,');
  });

  it('login: defaults to Path=/auth when cookiePath not provided (backward compat)', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-001',
        email: 'alice@company.com',
        name: 'Alice Smith',
        email_verified: true,
      }),
    });

    const { config } = makeConfig(); // no cookiePath
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    expect(setCookieHeader).toContain('Path=/auth');
  });

  it('refresh: rotated Set-Cookie Path respects config.cookiePath', async () => {
    const { config, store } = makeConfig({ cookiePath: '/api/v1/auth' });
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    vi.useRealTimers();

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    expect(setCookieHeader).toContain('Path=/api/v1/auth');
  });

  it('logout: deleteCookie Path respects config.cookiePath', async () => {
    const { config, store } = makeConfig({ cookiePath: '/api/v1/auth' });
    const app = makeApp(config);

    const tokens = await createTokens(
      { sub: 'user-001', company_id: 'co-abc', role: 'admin', product: 'acmd' },
      { privateKey: testPrivateKey },
    );

    const hash = hashToken(tokens.refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${tokens.refreshToken}` },
    });

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    expect(setCookieHeader).toContain('Path=/api/v1/auth');
    // And it's a delete (Max-Age=0)
    const cleared =
      setCookieHeader.includes('Max-Age=0') ||
      setCookieHeader.includes('max-age=0');
    expect(cleared).toBe(true);
  });

  it('refresh: invalid-cookie cleanup path respects config.cookiePath', async () => {
    const { config } = makeConfig({ cookiePath: '/api/v1/auth' });
    const app = makeApp(config);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refresh_token=tampered.jwt.here' },
    });

    expect(res.status).toBe(401);
    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    // Cleanup cookie MUST target the configured path, not hardcoded /auth
    if (setCookieHeader) {
      expect(setCookieHeader).toContain('Path=/api/v1/auth');
    }
  });
});

// -----------------------------------------------------------------------
// RS-013: /auth/google mint flow propagates email/google_id/products into JWT
// -----------------------------------------------------------------------

describe('RS-013: /auth/google mint flow carries identity + entitlement claims', () => {
  beforeEach(() => {
    mockVerifyIdTokenImpl = null;
  });

  it('existing user path → decoded access token exposes email, google_id, products from findUserByGoogleId', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-001',
        email: 'existing@company.com',
        name: 'Existing User',
        email_verified: true,
      }),
    });

    const existingUser: UserRecord = {
      id: 'user-uuid-existing',
      company_id: 'co-existing',
      role: 'admin',
      product: 'acmd',
      email: 'existing@company.com',
      name: 'Existing User',
      google_id: 'google-uid-001',
      products: ['acmd', 'pfasguard'],
    };

    const findUserByGoogleId = vi.fn(async () => existingUser);
    const createUser = vi.fn(async () => {
      throw new Error('createUser should not be called — user exists');
    }) as unknown as AuthConfig['createUser'];

    const { config } = makeConfig({ findUserByGoogleId, createUser });
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };

    const decoded = await verifyAccessToken(body.accessToken, {
      publicKey: testPublicKey,
    });
    expect(decoded.email).toBe('existing@company.com');
    expect(decoded.google_id).toBe('google-uid-001');
    expect(decoded.products).toEqual(['acmd', 'pfasguard']);
    expect(findUserByGoogleId).toHaveBeenCalledTimes(1);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('new user path → createUser callback is invoked; decoded token reflects returned products', async () => {
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        sub: 'google-uid-new',
        email: 'new@company.com',
        name: 'New User',
        email_verified: true,
      }),
    });

    const newUser: UserRecord = {
      id: 'user-uuid-new',
      company_id: 'co-new',
      role: 'viewer',
      product: 'vollos',
      email: 'new@company.com',
      name: 'New User',
      google_id: 'google-uid-new',
      products: ['acmd'],
    };

    const findUserByGoogleId = vi.fn(async () => null);
    const createUser = vi.fn(async () => newUser);

    const { config } = makeConfig({ findUserByGoogleId, createUser });
    const app = makeApp(config);

    const res = await app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid.google.token' }),
    });

    expect(res.status).toBe(200);
    expect(findUserByGoogleId).toHaveBeenCalledWith('google-uid-new');
    expect(createUser).toHaveBeenCalledTimes(1);

    // createUser receives the expected new-user payload (auto-provision for 'acmd'
    // happens in the product callback, so we only assert the input contract here).
    const createUserArgs = createUser.mock.calls[0]?.[0];
    expect(createUserArgs?.google_id).toBe('google-uid-new');
    expect(createUserArgs?.email).toBe('new@company.com');
    expect(createUserArgs?.name).toBe('New User');

    const body = (await res.json()) as { accessToken: string };
    const decoded = await verifyAccessToken(body.accessToken, {
      publicKey: testPublicKey,
    });
    expect(decoded.email).toBe('new@company.com');
    expect(decoded.google_id).toBe('google-uid-new');
    expect(decoded.products).toEqual(['acmd']);
  });
});
