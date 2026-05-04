// Unit tests for JWT Service — RS256
// createTokens(), verifyAccessToken(), verifyRefreshToken(), rotateRefreshToken()
// No real DB needed — uses in-memory mock callbacks

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import type { KeyLike } from 'jose';
import {
  createTokens,
  verifyAccessToken,
  verifyRefreshToken,
  rotateRefreshToken,
  hashToken,
  generateRsaKeyPair,
  DEFAULT_ACCESS_TTL,
  DEFAULT_REFRESH_TTL,
} from '../src/jwt.js';
import type { RefreshTokenCallbacks } from '../src/types.js';

// Shared RSA key pair — generated once for all tests
let testPrivateKey: KeyLike;
let testPublicKey: KeyLike;

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  testPrivateKey = pair.privateKey;
  testPublicKey = pair.publicKey;
});

const basePayload = {
  sub: 'user-uuid-001',
  company_id: 'company-uuid-abc',
  role: 'admin',
  product: 'acmd',
};

// -----------------------------------------------------------------------
// createTokens()
// -----------------------------------------------------------------------

describe('createTokens()', () => {
  it('returns accessToken and refreshToken', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  it('access token contains correct claims', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });

    expect(decoded.sub).toBe('user-uuid-001');
    expect(decoded.company_id).toBe('company-uuid-abc');
    expect(decoded.role).toBe('admin');
    expect(decoded.product).toBe('acmd');
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('access token expires in ~15 minutes by default', async () => {
    const before = Math.floor(Date.now() / 1000);
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });
    const after = Math.floor(Date.now() / 1000);

    // exp should be ≈ now + 900 (±5s tolerance)
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(895);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(905);
    expect(decoded.iat).toBeGreaterThanOrEqual(before);
    expect(decoded.iat).toBeLessThanOrEqual(after);
  });

  it('refresh token expires in ~30 days by default', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const decoded = await verifyRefreshToken(tokens.refreshToken, { publicKey: testPublicKey });

    // exp - iat should be ≈ 2592000 (30 days) ±5s
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(2591995);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(2592005);
  });

  it('respects custom accessTTL and refreshTTL', async () => {
    const tokens = await createTokens(basePayload, {
      privateKey: testPrivateKey,
      accessTTL: 300, // 5 minutes
      refreshTTL: 1800, // 30 minutes
    });
    const accessDecoded = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });
    const refreshDecoded = await verifyRefreshToken(tokens.refreshToken, { publicKey: testPublicKey });

    expect(accessDecoded.exp - accessDecoded.iat).toBeGreaterThanOrEqual(295);
    expect(accessDecoded.exp - accessDecoded.iat).toBeLessThanOrEqual(305);
    expect(refreshDecoded.exp - refreshDecoded.iat).toBeGreaterThanOrEqual(1795);
    expect(refreshDecoded.exp - refreshDecoded.iat).toBeLessThanOrEqual(1805);
  });
});

// -----------------------------------------------------------------------
// verifyAccessToken()
// -----------------------------------------------------------------------

describe('verifyAccessToken()', () => {
  it('returns decoded payload for valid token', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });

    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
  });

  it('throws for tampered token', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const tampered = tokens.accessToken.slice(0, -5) + 'XXXXX';

    await expect(
      verifyAccessToken(tampered, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });

  it('throws for token signed with a different private key', async () => {
    // Generate a different key pair — tokens signed with wrongPrivateKey must fail verify with testPublicKey
    const { privateKey: wrongPrivateKey } = await generateRsaKeyPair();
    const tokens = await createTokens(basePayload, { privateKey: wrongPrivateKey });

    await expect(
      verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });

  it('throws for expired token', async () => {
    // Create a token whose exp is well outside the 30s clockTolerance (QA-2).
    // Using -120 puts exp 120 seconds in the past — far beyond the ±30s grace window.
    const tokens = await createTokens(basePayload, {
      privateKey: testPrivateKey,
      accessTTL: -120,
    });

    await expect(
      verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });

  // SEC-006 (ACMD-116-secfix): verifyAccessToken MUST reject refresh tokens
  // presented as access tokens.
  it('SEC-006: rejects a refresh token used as access token', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });

    // SEC-NEW-002: public message is the generic "Invalid token type"
    await expect(
      verifyAccessToken(tokens.refreshToken, { publicKey: testPublicKey }),
    ).rejects.toThrow('Invalid token type');
  });

  // SEC-006 regression: a genuine access token must still verify cleanly.
  it('SEC-006: accepts a genuine access token (regression)', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
  });
});

// -----------------------------------------------------------------------
// verifyRefreshToken()
// -----------------------------------------------------------------------

describe('verifyRefreshToken()', () => {
  it('returns decoded payload for valid refresh token', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const decoded = await verifyRefreshToken(tokens.refreshToken, { publicKey: testPublicKey });

    // SEC-001 (RS-013-core-fix): refresh token carries only `sub` +
    // `token_type`. Identity claims (company_id/role/product/email/google_id/
    // products) are stripped — `verifyRefreshToken` returns empty defaults.
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe('');
    expect(decoded.role).toBe('');
    expect(decoded.product).toBe('');
    expect(decoded.email).toBe('');
    expect(decoded.google_id).toBe('');
    expect(decoded.products).toEqual([]);
  });

  it('throws when access token is used as refresh token', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });

    // access token does NOT have token_type: 'refresh' — must be rejected.
    // SEC-NEW-002: generic public message only.
    await expect(
      verifyRefreshToken(tokens.accessToken, { publicKey: testPublicKey }),
    ).rejects.toThrow('Invalid token type');
  });

  it('throws for tampered refresh token', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const tampered = tokens.refreshToken.slice(0, -5) + 'XXXXX';

    await expect(
      verifyRefreshToken(tampered, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------
// SEC-NEW-002 (ACMD-118-B): token-type error messages MUST be
// indistinguishable between verifyAccessToken and verifyRefreshToken
// -----------------------------------------------------------------------

describe('SEC-NEW-002: token-type error indistinguishability', () => {
  async function captureError(fn: () => Promise<unknown>): Promise<Error> {
    try {
      await fn();
    } catch (e) {
      return e as Error;
    }
    throw new Error('expected function to throw');
  }

  it('verifyAccessToken and verifyRefreshToken throw identical public messages', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });

    const accessErr = await captureError(() =>
      verifyAccessToken(tokens.refreshToken, { publicKey: testPublicKey }),
    );
    const refreshErr = await captureError(() =>
      verifyRefreshToken(tokens.accessToken, { publicKey: testPublicKey }),
    );

    // Strict equality — any drift breaks this.
    expect(accessErr.message).toBe('Invalid token type');
    expect(refreshErr.message).toBe('Invalid token type');
    expect(accessErr.message === refreshErr.message).toBe(true);

    // Neither message may leak the word "access" or "refresh".
    expect(accessErr.message).not.toMatch(/access/i);
    expect(accessErr.message).not.toMatch(/refresh/i);
    expect(refreshErr.message).not.toMatch(/access/i);
    expect(refreshErr.message).not.toMatch(/refresh/i);
  });

  it('internal code field differentiates the two paths for operator logging', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });

    const accessErr = (await captureError(() =>
      verifyAccessToken(tokens.refreshToken, { publicKey: testPublicKey }),
    )) as Error & { code?: string };
    const refreshErr = (await captureError(() =>
      verifyRefreshToken(tokens.accessToken, { publicKey: testPublicKey }),
    )) as Error & { code?: string };

    expect(accessErr.code).toBe('TOKEN_TYPE_MISMATCH_ACCESS');
    expect(refreshErr.code).toBe('TOKEN_TYPE_MISMATCH_REFRESH');
    expect(accessErr.code).not.toBe(refreshErr.code);
  });
});

// -----------------------------------------------------------------------
// hashToken()
// -----------------------------------------------------------------------

describe('hashToken()', () => {
  it('returns a hex string', () => {
    const hash = hashToken('some-token-value');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('is different for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});

// -----------------------------------------------------------------------
// rotateRefreshToken()
// -----------------------------------------------------------------------

describe('rotateRefreshToken()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeCallbacks(): RefreshTokenCallbacks & {
    store: Map<string, boolean>;
    revokeCalls: string[];
    storeCalls: string[];
  } {
    const store = new Map<string, boolean>(); // hash → false(stored) / true(revoked)
    const revokeCalls: string[] = [];
    const storeCalls: string[] = [];

    return {
      store,
      revokeCalls,
      storeCalls,
      async storeToken(hash: string, _userId: string, _expiresAt: Date): Promise<void> {
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
  }

  it('returns new token pair on valid refresh token', async () => {
    const callbacks = makeCallbacks();
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });

    // Register the original token
    const origHash = hashToken(tokens.refreshToken);
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

    // Advance time by 2 seconds so new tokens have a different iat
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const newPair = await rotateRefreshToken(
      tokens.refreshToken,
      { privateKey: testPrivateKey, publicKey: testPublicKey },
      callbacks,
    );

    vi.useRealTimers();

    expect(newPair).toHaveProperty('accessToken');
    expect(newPair).toHaveProperty('refreshToken');
    expect(newPair.accessToken).not.toBe(tokens.accessToken);
    expect(newPair.refreshToken).not.toBe(tokens.refreshToken);
  });

  it('revokes the old refresh token after rotation', async () => {
    const callbacks = makeCallbacks();
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const origHash = hashToken(tokens.refreshToken);
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

    // Advance time so new tokens have different iat → different hash
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    await rotateRefreshToken(
      tokens.refreshToken,
      { privateKey: testPrivateKey, publicKey: testPublicKey },
      callbacks,
    );

    vi.useRealTimers();

    // Verify revokeToken was called with the correct hash
    expect(callbacks.revokeCalls).toContain(origHash);
    // Verify the underlying store marks origHash as revoked
    expect(callbacks.store.get(origHash)).toBe(true);
  });

  it('stores the new refresh token hash after rotation', async () => {
    const callbacks = makeCallbacks();
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const origHash = hashToken(tokens.refreshToken);
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

    const newPair = await rotateRefreshToken(
      tokens.refreshToken,
      { privateKey: testPrivateKey, publicKey: testPublicKey },
      callbacks,
    );

    const newHash = hashToken(newPair.refreshToken);
    // storeCalls[0] = manual pre-store, storeCalls[1] = rotateRefreshToken stores new hash
    expect(callbacks.storeCalls).toContain(newHash);
  });

  it('rejects already-revoked refresh token', async () => {
    const callbacks = makeCallbacks();
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const origHash = hashToken(tokens.refreshToken);

    // Revoke it first (simulate prior logout)
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));
    await callbacks.revokeToken(origHash);

    await expect(
      rotateRefreshToken(
        tokens.refreshToken,
        { privateKey: testPrivateKey, publicKey: testPublicKey },
        callbacks,
      ),
    ).rejects.toThrow('Refresh token has been revoked');
  });

  it('rejects structurally invalid refresh token', async () => {
    const callbacks = makeCallbacks();

    await expect(
      rotateRefreshToken(
        'not.a.valid.jwt',
        { privateKey: testPrivateKey, publicKey: testPublicKey },
        callbacks,
      ),
    ).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // SEC-MEDIUM-4 (T-055): atomic claimRefreshToken path
  // -----------------------------------------------------------------------
  describe('SEC-MEDIUM-4: atomic claimRefreshToken', () => {
    it('uses claimRefreshToken when provided (skips isTokenRevoked + revokeToken)', async () => {
      const base = makeCallbacks();
      const claimCalls: string[] = [];
      const callbacks: RefreshTokenCallbacks = {
        ...base,
        // Record only; delegate state to the base in-memory store.
        async claimRefreshToken(hash: string) {
          claimCalls.push(hash);
          const state = base.store.get(hash);
          if (state !== false) return false;
          base.store.set(hash, true);
          return true;
        },
      };

      const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
      const origHash = hashToken(tokens.refreshToken);
      await base.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 2000);

      const newPair = await rotateRefreshToken(
        tokens.refreshToken,
        { privateKey: testPrivateKey, publicKey: testPublicKey },
        callbacks,
      );

      vi.useRealTimers();

      expect(newPair.accessToken).toBeTruthy();
      expect(claimCalls).toEqual([origHash]);
      // Legacy calls must NOT be invoked in the atomic path
      expect(base.revokeCalls).toHaveLength(0);
    });

    it('throws when claimRefreshToken returns false (lost race / already revoked)', async () => {
      const base = makeCallbacks();
      const callbacks: RefreshTokenCallbacks = {
        ...base,
        async claimRefreshToken() {
          return false; // Simulate a losing concurrent racer
        },
      };

      const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
      const origHash = hashToken(tokens.refreshToken);
      await base.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

      await expect(
        rotateRefreshToken(
          tokens.refreshToken,
          { privateKey: testPrivateKey, publicKey: testPublicKey },
          callbacks,
        ),
      ).rejects.toThrow('Refresh token has been revoked');

      // Legacy fallback must not engage when atomic path is available
      expect(base.revokeCalls).toHaveLength(0);
    });

    it('legacy fallback (no claimRefreshToken) still works — used by older products', async () => {
      const callbacks = makeCallbacks();
      // No claimRefreshToken on this callbacks object → fallback path
      const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
      const origHash = hashToken(tokens.refreshToken);
      await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 2000);

      const newPair = await rotateRefreshToken(
        tokens.refreshToken,
        { privateKey: testPrivateKey, publicKey: testPublicKey },
        callbacks,
      );

      vi.useRealTimers();

      expect(newPair.accessToken).toBeTruthy();
      // Legacy path DID engage
      expect(callbacks.revokeCalls).toContain(origHash);
    });

    it('concurrent rotateRefreshToken with same token → exactly one succeeds (in-memory atomic)', async () => {
      const base = makeCallbacks();
      const callbacks: RefreshTokenCallbacks = {
        ...base,
        async claimRefreshToken(hash: string) {
          // JS single-threaded atomicity: get-then-set runs synchronously
          // within the microtask so two awaited callers serialise cleanly.
          const state = base.store.get(hash);
          if (state !== false) return false;
          base.store.set(hash, true);
          return true;
        },
      };

      const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
      const origHash = hashToken(tokens.refreshToken);
      await base.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 2000);

      const results = await Promise.allSettled(
        [1, 2, 3, 4, 5].map(() =>
          rotateRefreshToken(
            tokens.refreshToken,
            { privateKey: testPrivateKey, publicKey: testPublicKey },
            callbacks,
          ),
        ),
      );

      vi.useRealTimers();

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason.message).toMatch(
          /Refresh token has been revoked/,
        );
      }
    });
  });
});

// -----------------------------------------------------------------------
// QA-1 (ACMD-118-A): Default TTL constants are exported
// -----------------------------------------------------------------------

describe('QA-1: exported default TTL constants', () => {
  it('DEFAULT_ACCESS_TTL is 900 seconds (15 minutes)', () => {
    expect(DEFAULT_ACCESS_TTL).toBe(900);
  });

  it('DEFAULT_REFRESH_TTL is 2592000 seconds (30 days)', () => {
    expect(DEFAULT_REFRESH_TTL).toBe(2592000);
  });

  it('createTokens() defaults match the exported constants', async () => {
    const tokens = await createTokens(basePayload, { privateKey: testPrivateKey });
    const access = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });
    const refresh = await verifyRefreshToken(tokens.refreshToken, { publicKey: testPublicKey });

    expect(access.exp - access.iat).toBe(DEFAULT_ACCESS_TTL);
    expect(refresh.exp - refresh.iat).toBe(DEFAULT_REFRESH_TTL);
  });
});

// -----------------------------------------------------------------------
// QA-2 (ACMD-118-A): clockTolerance on jwtVerify
// -----------------------------------------------------------------------

describe('QA-2: jwtVerify clockTolerance (30s)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies an access token that expired 20s ago (within tolerance)', async () => {
    const tokens = await createTokens(basePayload, {
      privateKey: testPrivateKey,
      accessTTL: 5,
    });

    // Advance wall clock to 25s after issue — token is 20s past exp.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 25_000);

    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey });
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.product).toBe(basePayload.product);
  });

  it('rejects an access token that expired 60s ago (outside tolerance)', async () => {
    const tokens = await createTokens(basePayload, {
      privateKey: testPrivateKey,
      accessTTL: 5,
    });

    // Advance wall clock to 65s after issue — token is 60s past exp,
    // which is twice the 30s tolerance.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 65_000);

    await expect(
      verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });

  it('refresh token verify also honors 30s clockTolerance', async () => {
    const tokens = await createTokens(basePayload, {
      privateKey: testPrivateKey,
      refreshTTL: 5,
    });

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 25_000);

    const decoded = await verifyRefreshToken(tokens.refreshToken, { publicKey: testPublicKey });
    expect(decoded.sub).toBe(basePayload.sub);
  });

  it('refresh token rejected at 60s past exp (outside tolerance)', async () => {
    const tokens = await createTokens(basePayload, {
      privateKey: testPrivateKey,
      refreshTTL: 5,
    });

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 65_000);

    await expect(
      verifyRefreshToken(tokens.refreshToken, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------
// RS256 specific: tokens signed with wrong key must fail verification
// -----------------------------------------------------------------------

describe('RS256: key pair integrity', () => {
  it('token signed with wrong private key fails verification', async () => {
    const { privateKey: otherPrivateKey } = await generateRsaKeyPair();
    const tokens = await createTokens(basePayload, { privateKey: otherPrivateKey });

    await expect(
      verifyAccessToken(tokens.accessToken, { publicKey: testPublicKey }),
    ).rejects.toThrow();
  });

  it('generateRsaKeyPair returns distinct key pairs each call', async () => {
    const pair1 = await generateRsaKeyPair();
    const pair2 = await generateRsaKeyPair();

    // Tokens from pair1 cannot be verified with pair2 public key
    const tokens = await createTokens(basePayload, { privateKey: pair1.privateKey });
    await expect(
      verifyAccessToken(tokens.accessToken, { publicKey: pair2.publicKey }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------
// RS-013: createTokens must embed email + google_id + products claims
// -----------------------------------------------------------------------

describe('RS-013: identity + entitlement claims', () => {
  const fullPayload = {
    sub: 'user-uuid-rs013',
    company_id: 'company-uuid-rs013',
    role: 'admin',
    product: 'acmd',
    email: 'alice@rs013.example',
    google_id: 'google-sub-rs013',
    products: ['acmd', 'pfasguard'],
  };

  it('access token decode exposes email, google_id, and products', async () => {
    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, {
      publicKey: testPublicKey,
    });

    expect(decoded.email).toBe('alice@rs013.example');
    expect(decoded.google_id).toBe('google-sub-rs013');
    expect(decoded.products).toEqual(['acmd', 'pfasguard']);
  });

  // SEC-001 (RS-013-core-fix): refresh tokens no longer carry identity/
  // entitlement claims. This test asserts the minimisation — refresh token
  // decode must return empty defaults for email / google_id / products even
  // when the input payload had them populated.
  it('SEC-001: refresh token decode has NO email, google_id, or products', async () => {
    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    const decoded = await verifyRefreshToken(tokens.refreshToken, {
      publicKey: testPublicKey,
    });

    // sub + token_type are the only real claims carried in the refresh token.
    expect(decoded.sub).toBe('user-uuid-rs013');
    // Identity claims must be stripped to empty defaults.
    expect(decoded.email).toBe('');
    expect(decoded.google_id).toBe('');
    expect(decoded.products).toEqual([]);
    expect(decoded.company_id).toBe('');
    expect(decoded.role).toBe('');
    expect(decoded.product).toBe('');
  });

  it('SEC-001: refresh token raw JWT payload does NOT contain email/google_id/products claims', async () => {
    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    // Decode the refresh token WITHOUT using verifyRefreshToken so we inspect
    // the wire-level claim set directly. We split on '.' and base64url-decode
    // the middle segment — this mirrors what any attacker with the token
    // string would see in a browser / proxy log.
    const segments = tokens.refreshToken.split('.');
    expect(segments).toHaveLength(3);
    const payloadJson = Buffer.from(segments[1]!, 'base64url').toString('utf8');
    const raw = JSON.parse(payloadJson) as Record<string, unknown>;

    // Required claims only
    expect(raw.sub).toBe('user-uuid-rs013');
    expect(raw.token_type).toBe('refresh');

    // SEC-001: PII-adjacent claims MUST be absent from the wire payload.
    expect(raw).not.toHaveProperty('email');
    expect(raw).not.toHaveProperty('google_id');
    expect(raw).not.toHaveProperty('products');
    expect(raw).not.toHaveProperty('company_id');
    expect(raw).not.toHaveProperty('role');
    expect(raw).not.toHaveProperty('product');
  });

  it('SEC-001: access token raw JWT payload DOES contain email/google_id/products (regression)', async () => {
    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    const segments = tokens.accessToken.split('.');
    const payloadJson = Buffer.from(segments[1]!, 'base64url').toString('utf8');
    const raw = JSON.parse(payloadJson) as Record<string, unknown>;

    expect(raw.token_type).toBe('access');
    expect(raw.email).toBe('alice@rs013.example');
    expect(raw.google_id).toBe('google-sub-rs013');
    expect(raw.products).toEqual(['acmd', 'pfasguard']);
  });

  it('products claim is copied defensively — post-sign mutation does not leak', async () => {
    const productsIn = ['acmd'];
    const tokens = await createTokens(
      { ...fullPayload, products: productsIn },
      { privateKey: testPrivateKey },
    );

    // Mutate caller array after sign; issued token must NOT reflect the mutation.
    productsIn.push('pfasguard');

    const decoded = await verifyAccessToken(tokens.accessToken, {
      publicKey: testPublicKey,
    });
    expect(decoded.products).toEqual(['acmd']);
  });

  // SEC-001 (RS-013-core-fix): refresh tokens carry only `sub`, so rotate
  // re-fetches the user record via `findUserById` to mint a fresh access
  // token with current identity/entitlement claims.
  it('SEC-001: rotated access token carries FRESH claims from findUserById lookup', async () => {
    const freshUser = {
      id: 'user-uuid-rs013',
      company_id: 'company-uuid-rs013',
      role: 'admin',
      product: 'acmd',
      email: 'alice@rs013.example',
      name: 'Alice',
      google_id: 'google-sub-rs013',
      // Entitlement changed since login — rotate MUST reflect the new list.
      products: ['acmd'], // pfasguard revoked
    };
    const findUserById = vi.fn(async (_sub: string) => freshUser);

    const callbacks = {
      store: new Map<string, boolean>(),
      async storeToken(hash: string) {
        this.store.set(hash, false);
      },
      async revokeToken(hash: string) {
        this.store.set(hash, true);
      },
      async isTokenRevoked(hash: string) {
        return this.store.get(hash) === true;
      },
      findUserById,
    };

    // Original payload at login had 2 products; entitlement revoked since.
    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    await callbacks.storeToken(
      (await import('../src/jwt.js')).hashToken(tokens.refreshToken),
    );

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const newPair = await rotateRefreshToken(
      tokens.refreshToken,
      { privateKey: testPrivateKey, publicKey: testPublicKey },
      callbacks,
    );

    vi.useRealTimers();

    // findUserById MUST be called with the `sub` from the refresh token.
    expect(findUserById).toHaveBeenCalledTimes(1);
    expect(findUserById).toHaveBeenCalledWith('user-uuid-rs013');

    // Rotated access token reflects the FRESH lookup (not the cached payload).
    const decoded = await verifyAccessToken(newPair.accessToken, {
      publicKey: testPublicKey,
    });
    expect(decoded.email).toBe('alice@rs013.example');
    expect(decoded.google_id).toBe('google-sub-rs013');
    expect(decoded.products).toEqual(['acmd']); // entitlement revocation honored

    // And the new refresh token is still PII-free.
    const refreshDecoded = await verifyRefreshToken(newPair.refreshToken, {
      publicKey: testPublicKey,
    });
    expect(refreshDecoded.sub).toBe('user-uuid-rs013');
    expect(refreshDecoded.email).toBe('');
    expect(refreshDecoded.google_id).toBe('');
    expect(refreshDecoded.products).toEqual([]);
  });

  it('SEC-001: rotate throws when findUserById returns null (user deleted)', async () => {
    const findUserById = vi.fn(async (_sub: string) => null);
    const callbacks = {
      store: new Map<string, boolean>(),
      async storeToken(hash: string) {
        this.store.set(hash, false);
      },
      async revokeToken(hash: string) {
        this.store.set(hash, true);
      },
      async isTokenRevoked(hash: string) {
        return this.store.get(hash) === true;
      },
      findUserById,
    };

    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    await callbacks.storeToken(
      (await import('../src/jwt.js')).hashToken(tokens.refreshToken),
    );

    await expect(
      rotateRefreshToken(
        tokens.refreshToken,
        { privateKey: testPrivateKey, publicKey: testPublicKey },
        callbacks,
      ),
    ).rejects.toThrow('User not found for refresh token');
  });

  it('SEC-001: rotate without findUserById falls back to empty identity claims (backward compat)', async () => {
    const callbacks = {
      store: new Map<string, boolean>(),
      async storeToken(hash: string) {
        this.store.set(hash, false);
      },
      async revokeToken(hash: string) {
        this.store.set(hash, true);
      },
      async isTokenRevoked(hash: string) {
        return this.store.get(hash) === true;
      },
      // findUserById intentionally omitted — pre-fix consumers keep working.
    };

    const tokens = await createTokens(fullPayload, { privateKey: testPrivateKey });
    await callbacks.storeToken(
      (await import('../src/jwt.js')).hashToken(tokens.refreshToken),
    );

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const newPair = await rotateRefreshToken(
      tokens.refreshToken,
      { privateKey: testPrivateKey, publicKey: testPublicKey },
      callbacks,
    );

    vi.useRealTimers();

    // Without findUserById the access token inherits whatever the refresh
    // decode surfaced — which is empty defaults under SEC-001.
    const decoded = await verifyAccessToken(newPair.accessToken, {
      publicKey: testPublicKey,
    });
    expect(decoded.sub).toBe('user-uuid-rs013');
    expect(decoded.email).toBe('');
    expect(decoded.google_id).toBe('');
    expect(decoded.products).toEqual([]);
  });
});
