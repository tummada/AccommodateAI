// Unit tests for JWT Service
// createTokens(), verifyAccessToken(), verifyRefreshToken(), rotateRefreshToken()
// No real DB needed — uses in-memory mock callbacks
//
// RS256 end-to-end: tokens are signed with privateKey and verified with publicKey
// createTokens() uses RS256 (same key pair as verify path)

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
import { SignJWT } from 'jose';

// RSA key pair shared across all tests in this file
let privateKey: KeyLike;
let publicKey: KeyLike;

const basePayload = {
  sub: 'user-uuid-001',
  company_id: 'company-uuid-abc',
  role: 'admin',
  product: 'acmd',
};

beforeAll(async () => {
  const pair = await generateRsaKeyPair();
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

// Helper: mint an RS256 token directly (bypass createTokens HS256)
async function mintRS256Token(
  payload: typeof basePayload & { token_type: string },
  ttl: number,
): Promise<string> {
  return new SignJWT({
    company_id: payload.company_id,
    role: payload.role,
    product: payload.product,
    token_type: payload.token_type,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(privateKey);
}

// -----------------------------------------------------------------------
// createTokens()
// -----------------------------------------------------------------------

describe('createTokens()', () => {
  it('returns accessToken and refreshToken', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  it('access token is a valid 3-part JWT string (RS256)', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    expect(tokens.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('refresh token is a valid 3-part JWT string (RS256)', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    expect(tokens.refreshToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('RS256 access token can be verified by verifyAccessToken', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
    expect(decoded.role).toBe(basePayload.role);
    expect(decoded.product).toBe(basePayload.product);
  });

  it('RS256 refresh token can be verified by verifyRefreshToken', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    const decoded = await verifyRefreshToken(tokens.refreshToken, { publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
  });

  it('respects custom accessTTL and refreshTTL', async () => {
    const tokens = await createTokens(basePayload, { privateKey, accessTTL: 300, refreshTTL: 1800 });
    const accessDecoded = await verifyAccessToken(tokens.accessToken, { publicKey });
    const refreshDecoded = await verifyRefreshToken(tokens.refreshToken, { publicKey });

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
  it('returns decoded payload for valid RS256 access token', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);
    const decoded = await verifyAccessToken(token, { publicKey });

    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
    expect(decoded.role).toBe(basePayload.role);
    expect(decoded.product).toBe(basePayload.product);
  });

  it('throws for tampered token', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);
    const tampered = token.slice(0, -5) + 'XXXXX';

    await expect(
      verifyAccessToken(tampered, { publicKey }),
    ).rejects.toThrow();
  });

  it('throws for token signed with wrong private key', async () => {
    const wrongPair = await generateRsaKeyPair();
    const wrongToken = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);
    // Verify with correct publicKey but token was signed with wrongPair.privateKey
    // Actually the token above was signed with wrongPair.privateKey, so verify with publicKey fails
    const tokenFromWrong = await new SignJWT({
      company_id: basePayload.company_id,
      role: basePayload.role,
      product: basePayload.product,
      token_type: 'access',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(basePayload.sub)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(wrongPair.privateKey);

    await expect(
      verifyAccessToken(tokenFromWrong, { publicKey }),
    ).rejects.toThrow();
  });

  it('throws for expired token', async () => {
    // -120s TTL — far outside 30s clock tolerance
    const token = await mintRS256Token({ ...basePayload, token_type: 'access' }, -120);
    await expect(
      verifyAccessToken(token, { publicKey }),
    ).rejects.toThrow();
  });

  // SEC-006: verifyAccessToken MUST reject refresh tokens presented as access tokens
  it('SEC-006: rejects a refresh token used as access token', async () => {
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 900);

    await expect(
      verifyAccessToken(refreshToken, { publicKey }),
    ).rejects.toThrow('Invalid token type');
  });

  it('SEC-006: accepts a genuine access token (regression)', async () => {
    const accessToken = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);
    const decoded = await verifyAccessToken(accessToken, { publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
  });
});

// -----------------------------------------------------------------------
// verifyRefreshToken()
// -----------------------------------------------------------------------

describe('verifyRefreshToken()', () => {
  it('returns decoded payload for valid RS256 refresh token', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 2592000);
    const decoded = await verifyRefreshToken(token, { publicKey });

    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
  });

  it('throws when access token is used as refresh token', async () => {
    const accessToken = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);

    await expect(
      verifyRefreshToken(accessToken, { publicKey }),
    ).rejects.toThrow('Invalid token type');
  });

  it('throws for tampered refresh token', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 2592000);
    const tampered = token.slice(0, -5) + 'XXXXX';

    await expect(
      verifyRefreshToken(tampered, { publicKey }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------
// SEC-NEW-002: token-type error indistinguishability
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
    const accessToken = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 900);

    const accessErr = await captureError(() =>
      verifyAccessToken(refreshToken, { publicKey }),
    );
    const refreshErr = await captureError(() =>
      verifyRefreshToken(accessToken, { publicKey }),
    );

    expect(accessErr.message).toBe('Invalid token type');
    expect(refreshErr.message).toBe('Invalid token type');
    expect(accessErr.message === refreshErr.message).toBe(true);

    expect(accessErr.message).not.toMatch(/access/i);
    expect(accessErr.message).not.toMatch(/refresh/i);
    expect(refreshErr.message).not.toMatch(/access/i);
    expect(refreshErr.message).not.toMatch(/refresh/i);
  });

  it('internal code field differentiates the two paths for operator logging', async () => {
    const accessToken = await mintRS256Token({ ...basePayload, token_type: 'access' }, 900);
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 900);

    const accessErr = (await captureError(() =>
      verifyAccessToken(refreshToken, { publicKey }),
    )) as Error & { code?: string };
    const refreshErr = (await captureError(() =>
      verifyRefreshToken(accessToken, { publicKey }),
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
// rotateRefreshToken needs both publicKey (verify) and secret (createTokens)
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
    const store = new Map<string, boolean>();
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
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 2592000);

    const origHash = hashToken(refreshToken);
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const newPair = await rotateRefreshToken(
      refreshToken,
      { publicKey, privateKey },
      callbacks,
    );

    vi.useRealTimers();

    expect(newPair).toHaveProperty('accessToken');
    expect(newPair).toHaveProperty('refreshToken');
    expect(newPair.accessToken).not.toBe(refreshToken);
  });

  it('revokes the old refresh token after rotation', async () => {
    const callbacks = makeCallbacks();
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 2592000);
    const origHash = hashToken(refreshToken);
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    await rotateRefreshToken(refreshToken, { publicKey, privateKey }, callbacks);

    vi.useRealTimers();

    expect(callbacks.revokeCalls).toContain(origHash);
    expect(callbacks.store.get(origHash)).toBe(true);
  });

  it('stores the new refresh token hash after rotation', async () => {
    const callbacks = makeCallbacks();
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 2592000);
    const origHash = hashToken(refreshToken);
    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));

    const newPair = await rotateRefreshToken(
      refreshToken,
      { publicKey, privateKey },
      callbacks,
    );

    const newHash = hashToken(newPair.refreshToken);
    expect(callbacks.storeCalls).toContain(newHash);
  });

  it('rejects already-revoked refresh token', async () => {
    const callbacks = makeCallbacks();
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 2592000);
    const origHash = hashToken(refreshToken);

    await callbacks.storeToken(origHash, basePayload.sub, new Date(Date.now() + 999999));
    await callbacks.revokeToken(origHash);

    await expect(
      rotateRefreshToken(refreshToken, { publicKey, privateKey }, callbacks),
    ).rejects.toThrow('Refresh token has been revoked');
  });

  it('rejects structurally invalid refresh token', async () => {
    const callbacks = makeCallbacks();

    await expect(
      rotateRefreshToken('not.a.valid.jwt', { publicKey, privateKey }, callbacks),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------
// RS256 end-to-end: createTokens produces tokens verifiable by verifyAccessToken
// -----------------------------------------------------------------------

describe('RS256 end-to-end: createTokens + verifyAccessToken/verifyRefreshToken', () => {
  it('access token from createTokens is verifiable with matching publicKey', async () => {
    const pair = await generateRsaKeyPair();
    const tokens = await createTokens(basePayload, { privateKey: pair.privateKey });
    const decoded = await verifyAccessToken(tokens.accessToken, { publicKey: pair.publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.company_id).toBe(basePayload.company_id);
  });

  it('access token from createTokens is NOT verifiable with a different publicKey', async () => {
    const pairA = await generateRsaKeyPair();
    const pairB = await generateRsaKeyPair();
    const tokens = await createTokens(basePayload, { privateKey: pairA.privateKey });

    await expect(
      verifyAccessToken(tokens.accessToken, { publicKey: pairB.publicKey }),
    ).rejects.toThrow();
  });

  it('refresh token from createTokens is verifiable with matching publicKey', async () => {
    const pair = await generateRsaKeyPair();
    const tokens = await createTokens(basePayload, { privateKey: pair.privateKey });
    const decoded = await verifyRefreshToken(tokens.refreshToken, { publicKey: pair.publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
  });

  it('access token has token_type=access (rejects as refresh token)', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    await expect(
      verifyRefreshToken(tokens.accessToken, { publicKey }),
    ).rejects.toThrow('Invalid token type');
  });

  it('refresh token has token_type=refresh (rejects as access token)', async () => {
    const tokens = await createTokens(basePayload, { privateKey });
    await expect(
      verifyAccessToken(tokens.refreshToken, { publicKey }),
    ).rejects.toThrow('Invalid token type');
  });
});

// -----------------------------------------------------------------------
// QA-1: Default TTL constants are exported
// -----------------------------------------------------------------------

describe('QA-1: exported default TTL constants', () => {
  it('DEFAULT_ACCESS_TTL is 900 seconds (15 minutes)', () => {
    expect(DEFAULT_ACCESS_TTL).toBe(900);
  });

  it('DEFAULT_REFRESH_TTL is 2592000 seconds (30 days)', () => {
    expect(DEFAULT_REFRESH_TTL).toBe(2592000);
  });

  it('RS256 tokens have correct exp-iat values matching DEFAULT TTLs', async () => {
    const accessToken = await mintRS256Token({ ...basePayload, token_type: 'access' }, DEFAULT_ACCESS_TTL);
    const refreshToken = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, DEFAULT_REFRESH_TTL);

    const access = await verifyAccessToken(accessToken, { publicKey });
    const refresh = await verifyRefreshToken(refreshToken, { publicKey });

    expect(access.exp - access.iat).toBe(DEFAULT_ACCESS_TTL);
    expect(refresh.exp - refresh.iat).toBe(DEFAULT_REFRESH_TTL);
  });
});

// -----------------------------------------------------------------------
// QA-2: clockTolerance on jwtVerify (30s)
// -----------------------------------------------------------------------

describe('QA-2: jwtVerify clockTolerance (30s)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies an access token that expired 20s ago (within tolerance)', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'access' }, 5);

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 25_000);

    const decoded = await verifyAccessToken(token, { publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.product).toBe(basePayload.product);
  });

  it('rejects an access token that expired 60s ago (outside tolerance)', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'access' }, 5);

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 65_000);

    await expect(
      verifyAccessToken(token, { publicKey }),
    ).rejects.toThrow();
  });

  it('refresh token verify also honors 30s clockTolerance', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 5);

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 25_000);

    const decoded = await verifyRefreshToken(token, { publicKey });
    expect(decoded.sub).toBe(basePayload.sub);
  });

  it('refresh token rejected at 60s past exp (outside tolerance)', async () => {
    const token = await mintRS256Token({ ...basePayload, token_type: 'refresh' }, 5);

    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.now() + 65_000);

    await expect(
      verifyRefreshToken(token, { publicKey }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------
// generateRsaKeyPair()
// -----------------------------------------------------------------------

describe('generateRsaKeyPair()', () => {
  it('returns a privateKey and publicKey', async () => {
    const pair = await generateRsaKeyPair();
    expect(pair.privateKey).toBeTruthy();
    expect(pair.publicKey).toBeTruthy();
  });

  it('generated key pair can sign and verify RS256 tokens', async () => {
    const pair = await generateRsaKeyPair();
    const token = await new SignJWT({ company_id: 'c', role: 'r', product: 'p', token_type: 'access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(pair.privateKey);

    const decoded = await verifyAccessToken(token, { publicKey: pair.publicKey });
    expect(decoded.sub).toBe('user-1');
  });

  it('publicKey from one pair cannot verify tokens from another pair', async () => {
    const pairA = await generateRsaKeyPair();
    const pairB = await generateRsaKeyPair();

    const token = await new SignJWT({ company_id: 'c', role: 'r', product: 'p', token_type: 'access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(pairA.privateKey);

    await expect(
      verifyAccessToken(token, { publicKey: pairB.publicKey }),
    ).rejects.toThrow();
  });
});
