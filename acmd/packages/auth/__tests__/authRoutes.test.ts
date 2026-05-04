// Unit tests for createAuthRoutes() factory
// Tests POST /auth/google, /auth/refresh, /auth/logout
// Mocks google-auth-library + in-memory token store
//
// RS256 end-to-end: createTokens uses privateKey, verify uses publicKey.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { KeyLike } from 'jose';
import { SignJWT } from 'jose';
import { createAuthRoutes } from '../src/authRoutes.js';
import { hashToken, generateRsaKeyPair } from '../src/jwt.js';
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

const TEST_CLIENT_ID = 'test-google-client-id';

// RSA key pair for RS256 sign + verify (end-to-end)
let privateKey: KeyLike;
let publicKey: KeyLike;

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

/** Mint an RS256 refresh token for /refresh and /logout tests */
async function mintRS256RefreshToken(
  payload: { sub: string; company_id: string; role: string; product: string },
  ttl = 2592000,
): Promise<string> {
  return new SignJWT({
    company_id: payload.company_id,
    role: payload.role,
    product: payload.product,
    token_type: 'refresh',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(privateKey);
}

function makeInMemoryStore() {
  const store = new Map<string, boolean>(); // hash → false(stored) / true(revoked)
  const storeCalls: string[] = [];
  const revokeCalls: string[] = [];

  const obj: RefreshTokenCallbacks & {
    store: Map<string, boolean>;
    storeCalls: string[];
    revokeCalls: string[];
  } = {
    store,
    storeCalls,
    revokeCalls,
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
  };

  vi.spyOn(obj, 'storeToken');
  vi.spyOn(obj, 'revokeToken');

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
};

function makeConfig(overrides?: Partial<AuthConfig>): {
  config: AuthConfig;
  store: InMemoryStore;
} {
  const store = makeInMemoryStore();
  const config: AuthConfig = {
    googleClientId: TEST_CLIENT_ID,
    privateKey, // RS256 private key for createTokens
    publicKey, // RS256 public key for verifyRefreshToken
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
// Uses RS256 refresh tokens (signed with privateKey, verified with publicKey)
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

  it('returns new accessToken on valid RS256 refresh token', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    // Create RS256 refresh token
    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    // Advance time by 2s so rotated tokens have different iat
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    vi.useRealTimers();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
  });

  it('returns 401 for revoked RS256 refresh token', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));
    await store.revokeToken(hash);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
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
});

// -----------------------------------------------------------------------
// POST /auth/logout
// Uses RS256 refresh tokens
// -----------------------------------------------------------------------

describe('POST /auth/logout', () => {
  it('returns 200 on logout', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Logged out/);
  });

  it('revokes the refresh token server-side on logout', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    expect(store.revokeCalls).toContain(hash);
  });

  it('clears refresh cookie on logout', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    const setCookieHeader = res.headers.get('Set-Cookie');
    expect(setCookieHeader).toBeTruthy();
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
  // SEC-002: logout MUST NOT swallow DB revoke errors
  // -----------------------------------------------------------------------
  it('SEC-002: returns 500 when tokenCallbacks.revokeToken throws (DB error)', async () => {
    const { config, store } = makeConfig();
    store.revokeToken = vi.fn(async () => {
      throw new Error('connection timeout');
    }) as typeof store.revokeToken;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const app = makeApp(config);
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Logout failed');
    expect(JSON.stringify(body)).not.toContain('connection timeout');

    expect(errSpy).toHaveBeenCalled();

    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    const cleared =
      setCookieHeader.includes('Max-Age=0') ||
      setCookieHeader.includes('max-age=0');
    expect(cleared).toBe(true);

    errSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // SEC-NEW-003: structured error log on revoke failure
  // -----------------------------------------------------------------------
  it('SEC-NEW-003: logs structured object with user_id/timestamp/error_type on revoke failure', async () => {
    const { config, store } = makeConfig();
    store.revokeToken = vi.fn(async () => {
      const err = new TypeError('db connection reset by peer');
      throw err;
    }) as typeof store.revokeToken;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-sec-new-003',
      company_id: 'co-xyz',
      role: 'admin',
      product: 'acmd',
    });

    const app = makeApp(config);
    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledTimes(1);

    const call = errSpy.mock.calls[0] as unknown[];
    expect(call[0]).toBe('[auth] logout revokeToken failed');
    const detail = call[1] as Record<string, unknown>;
    expect(detail).toBeDefined();
    expect(typeof detail).toBe('object');

    expect(detail.user_id).toBe('user-sec-new-003');
    expect(typeof detail.timestamp).toBe('string');
    expect(detail.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
    );
    expect(detail.error_type).toBe('TypeError');
    expect(detail.error_message).toBe('db connection reset by peer');

    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain(refreshToken);
    expect(serialised).not.toContain(hashToken(refreshToken));

    const body = await res.json();
    expect(body.error).toBe('Logout failed');
    expect(JSON.stringify(body)).not.toContain('db connection');

    errSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // SEC-001: expired/tampered token → clean 200 (no revoke, no 500)
  // -----------------------------------------------------------------------
  it('SEC-002: expired/tampered token is a clean 200 (no revoke, no 500)', async () => {
    const { config, store } = makeConfig();
    const app = makeApp(config);

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: 'refresh_token=not.a.valid.jwt' },
    });

    expect(res.status).toBe(200);
    expect(store.revokeCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// SEC-001: configurable cookiePath
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

    const { config } = makeConfig();
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

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    vi.useRealTimers();

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    expect(setCookieHeader).toContain('Path=/api/v1/auth');
  });

  it('logout: deleteCookie Path respects config.cookiePath', async () => {
    const { config, store } = makeConfig({ cookiePath: '/api/v1/auth' });
    const app = makeApp(config);

    const refreshToken = await mintRS256RefreshToken({
      sub: 'user-001',
      company_id: 'co-abc',
      role: 'admin',
      product: 'acmd',
    });

    const hash = hashToken(refreshToken);
    await store.storeToken(hash, 'user-001', new Date(Date.now() + 999999));

    const res = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('Set-Cookie') ?? '';
    expect(setCookieHeader).toContain('Path=/api/v1/auth');
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
    if (setCookieHeader) {
      expect(setCookieHeader).toContain('Path=/api/v1/auth');
    }
  });
});
