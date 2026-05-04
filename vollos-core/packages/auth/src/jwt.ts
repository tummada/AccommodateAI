// @vollos/auth — JWT Service
// Uses `jose` library for standards-compliant JWT (RS256)
// RS256: sign with privateKey, verify with publicKey (asymmetric)
// auth-service holds the private key; all products verify via JWKS public key
//
// Task R02: createTokens(payload, { privateKey, publicKey, accessTTL, refreshTTL }) → { accessToken, refreshToken }
// Task R03: verifyAccessToken + verifyRefreshToken
// Task R04: Refresh token revocation via RefreshTokenCallbacks interface

import {
  SignJWT,
  jwtVerify,
  generateKeyPair,
  exportJWK,
  importPKCS8,
  importSPKI,
} from 'jose';
import type { KeyLike, JWK } from 'jose';
import { createHash } from 'node:crypto';
import type {
  JwtPayload,
  TokenPair,
  CreateTokensOptions,
  VerifyTokenOptions,
  RefreshTokenCallbacks,
} from './types.js';

// Default TTLs per roadmap spec — exported so downstream products can reuse
// the same source-of-truth values for cookie maxAge / DB expires_at / client
// schedulers. Changing the value here ripples to every consumer via the
// re-export in `./index.ts`, preventing drift between the JWT `exp` claim
// and the refresh-cookie `Max-Age`.
export const DEFAULT_ACCESS_TTL = 900;    // 15 minutes — industry standard for sensitive SaaS
export const DEFAULT_REFRESH_TTL = 2592000; // 30 days — rotation on every refresh

// QA-2 (ACMD-118-A): allow ±30s clock skew when verifying JWT exp/nbf.
const JWT_CLOCK_TOLERANCE_SECONDS = 30;

// Key ID constants for JWKS — allows clients to look up the correct public key
const ACCESS_KID = 'vollos-access-v1';
const REFRESH_KID = 'vollos-refresh-v1';

// ─── Key Management ──────────────────────────────────────────────────────────

/**
 * Generate a new RSA-2048 key pair for RS256.
 * Used at startup in development (ephemeral) or when no PEM env is provided.
 */
export async function generateRsaKeyPair(): Promise<{
  privateKey: KeyLike;
  publicKey: KeyLike;
}> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
  });
  return { privateKey, publicKey };
}

/**
 * Import RSA private key from PEM string (PKCS#8 format).
 * Used in production to load from AUTH_RSA_PRIVATE_KEY env var.
 */
export async function importPrivateKeyPem(pem: string): Promise<KeyLike> {
  return importPKCS8(pem, 'RS256') as Promise<KeyLike>;
}

/**
 * Import RSA public key from PEM string (SPKI format).
 * Used in production to load from AUTH_RSA_PUBLIC_KEY env var.
 */
export async function importPublicKeyPem(pem: string): Promise<KeyLike> {
  return importSPKI(pem, 'RS256') as Promise<KeyLike>;
}

/**
 * Export public key as JWK object for the JWKS endpoint.
 * Returns the public key in JSON Web Key format with kid set.
 */
export async function exportPublicKeyJwk(publicKey: KeyLike): Promise<JWK> {
  const jwk = await exportJWK(publicKey);
  return { ...jwk, kid: ACCESS_KID, alg: 'RS256', use: 'sig' };
}

// ─── Token Hashing ───────────────────────────────────────────────────────────

/**
 * Hash a refresh token for storage (SHA-256)
 * Never store the raw token — only the hash
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ─── Token Creation ───────────────────────────────────────────────────────────

/**
 * Create access + refresh token pair (RS256).
 *
 * SEC-001 (RS-013-core-fix): access and refresh tokens now carry DIFFERENT
 * payloads to minimise PII leakage. JWTs are base64url (not encrypted), so
 * any party that sees a token can decode its claims.
 *
 *   - Access token (15 min TTL): sub + company_id + role + product + email
 *     + google_id + products + token_type='access' — short-lived, sent via
 *     Authorization: Bearer, needs identity for product apps to render UI
 *     and authorize without an extra /me round-trip.
 *   - Refresh token (30 day TTL): sub + token_type='refresh' ONLY — no
 *     email, no google_id, no entitlements, no role/company. Refresh tokens
 *     are sent on every /auth/refresh call; long-lived; live in a httpOnly
 *     cookie that can still leak via proxy logs, crash reports, or error-
 *     tracking SaaS. The rotate flow re-fetches the user record to mint a
 *     fresh access token with current claims.
 */
export async function createTokens(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  options: CreateTokensOptions,
): Promise<TokenPair> {
  const accessTTL = options.accessTTL ?? DEFAULT_ACCESS_TTL;
  const refreshTTL = options.refreshTTL ?? DEFAULT_REFRESH_TTL;

  // RS-013: copy products defensively so a caller mutation after sign()
  // cannot corrupt the issued JWT. Older call sites that pre-date RS-013
  // may not populate the new identity/entitlement claims — coerce to safe
  // defaults rather than throw, so non-login consumers (e.g. test
  // fixtures, backfills) keep working.
  //
  // SEC-001 (RS-013-core-fix): `accessPayload` carries full identity +
  // entitlement claims; `refreshPayload` is minimal (sub + token_type only).
  const accessPayload = {
    company_id: payload.company_id,
    role: payload.role,
    product: payload.product,
    email: payload.email ?? '',
    google_id: payload.google_id ?? '',
    products: Array.isArray(payload.products) ? [...payload.products] : [],
  };

  // SEC-006: tag access tokens with token_type='access' so verifyAccessToken
  // can reject refresh tokens presented as access tokens (and vice versa).
  const accessToken = await new SignJWT({ ...accessPayload, token_type: 'access' })
    .setProtectedHeader({ alg: 'RS256', kid: ACCESS_KID })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + accessTTL)
    .sign(options.privateKey);

  // SEC-001 (RS-013-core-fix): refresh token is a pure session handle —
  // `sub` (opaque UUID) + `token_type` only. Identity/entitlement claims are
  // re-fetched during rotateRefreshToken() so rotated access tokens reflect
  // current state (e.g. entitlement revoked since login).
  const refreshToken = await new SignJWT({ token_type: 'refresh' })
    .setProtectedHeader({ alg: 'RS256', kid: REFRESH_KID })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + refreshTTL)
    .sign(options.privateKey);

  return { accessToken, refreshToken };
}

// ─── Token Verification ───────────────────────────────────────────────────────

/**
 * Verify an access token (RS256 — uses publicKey).
 *
 * @throws if token is invalid, expired, or tampered
 * @returns decoded JwtPayload
 */
export async function verifyAccessToken(
  token: string,
  options: VerifyTokenOptions,
): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, options.publicKey, {
    algorithms: ['RS256'],
    clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
  });

  // SEC-006: reject refresh tokens presented as access tokens (CWE-345).
  // SEC-NEW-002: public message is generic — never leak token type expected.
  if (payload['token_type'] !== 'access') {
    const err = new Error('Invalid token type');
    Object.assign(err, { code: 'TOKEN_TYPE_MISMATCH_ACCESS' });
    throw err;
  }

  // RS-013: surface email/google_id/products. Older tokens issued before
  // RS-013 may lack the new claims — default to empty string / array rather
  // than undefined to keep the return type aligned with JwtPayload.
  const rawProducts = payload['products'];
  return {
    sub: payload.sub as string,
    company_id: payload['company_id'] as string,
    role: payload['role'] as string,
    product: payload['product'] as string,
    email: (payload['email'] as string) ?? '',
    google_id: (payload['google_id'] as string) ?? '',
    products: Array.isArray(rawProducts) ? (rawProducts as string[]) : [],
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}

/**
 * Verify a refresh token (RS256 — uses publicKey).
 * Also checks that token_type === 'refresh' to prevent access tokens
 * being used in refresh endpoint.
 *
 * SEC-001 (RS-013-core-fix): refresh tokens now carry ONLY `sub` +
 * `token_type` — no email/google_id/products/role/company_id/product. To
 * keep the return type aligned with `JwtPayload` (so existing callers that
 * destructure these fields don't crash at compile time), we coerce missing
 * identity claims to safe empty defaults. Callers that need fresh identity
 * MUST look it up via `RefreshTokenCallbacks.findUserById` (rotateRefreshToken
 * does this automatically).
 *
 * Legacy tokens issued before RS-013-core-fix still verify and decode with
 * the old claims intact (signature is still valid). This is a forward-
 * compatible change — rotate flow will upgrade them on first refresh.
 *
 * @throws if token is invalid, expired, tampered, or wrong type
 * @returns decoded JwtPayload with empty defaults for identity claims
 */
export async function verifyRefreshToken(
  token: string,
  options: VerifyTokenOptions,
): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, options.publicKey, {
    algorithms: ['RS256'],
    clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
  });

  // SEC-NEW-002: same public message for both token-type checks.
  if (payload['token_type'] !== 'refresh') {
    const err = new Error('Invalid token type');
    Object.assign(err, { code: 'TOKEN_TYPE_MISMATCH_REFRESH' });
    throw err;
  }

  // SEC-001 (RS-013-core-fix): refresh tokens no longer carry identity or
  // entitlement claims. Return empty defaults so the JwtPayload shape is
  // preserved — callers MUST NOT trust any of these fields from a refresh
  // token; they exist here only to satisfy the shared return type. Legacy
  // tokens (pre-fix) may still have these claims populated; treat them as
  // advisory only. Defensive-copy `products` to prevent cross-token mutation.
  const rawProducts = payload['products'];
  return {
    sub: payload.sub as string,
    company_id: (payload['company_id'] as string) ?? '',
    role: (payload['role'] as string) ?? '',
    product: (payload['product'] as string) ?? '',
    email: (payload['email'] as string) ?? '',
    google_id: (payload['google_id'] as string) ?? '',
    products: Array.isArray(rawProducts) ? [...(rawProducts as string[])] : [],
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}

// ─── Refresh Token Rotation ───────────────────────────────────────────────────

/**
 * Rotate a refresh token — verify old token, check revocation,
 * revoke old token, issue new token pair.
 *
 * SEC-001 (RS-013-core-fix): refresh tokens carry only `sub` + `token_type`.
 * To mint a new access token with up-to-date identity/entitlement claims we
 * look up the user record by `sub` via `callbacks.findUserById(sub)`.
 *
 *   - If `findUserById` is provided and returns a record → the new access
 *     token carries fresh claims (preferred path; reflects revoked
 *     entitlements, role changes, etc.).
 *   - If `findUserById` is provided and returns `null` → user was deleted /
 *     deactivated; throw so the client re-authenticates.
 *   - If `findUserById` is NOT provided → fall back to whatever claims the
 *     decoded refresh token carried (empty defaults for fix-era tokens;
 *     legacy claims for pre-fix tokens). This preserves backward
 *     compatibility for test fixtures and non-login consumers.
 *
 * @throws if token is invalid/revoked, or if findUserById returns null
 * @returns new TokenPair
 */
export async function rotateRefreshToken(
  refreshToken: string,
  options: VerifyTokenOptions & CreateTokensOptions,
  callbacks: RefreshTokenCallbacks,
): Promise<TokenPair> {
  // 1. Verify the token is structurally valid
  const decoded = await verifyRefreshToken(refreshToken, options);

  // 2+3. Atomically claim + revoke the old refresh token (one-time use).
  //
  // SEC-MEDIUM-4 (T-055): the previous implementation performed
  //   SELECT isTokenRevoked → (if not revoked) UPDATE revokeToken
  // as two separate round-trips. Two concurrent /auth/refresh requests
  // carrying the same refresh token could both read `revoked_at IS NULL`
  // before either UPDATEd, and BOTH would proceed to mint new token pairs.
  // A stolen refresh token could therefore be multiplied, and the
  // one-refresh-per-rotation invariant was broken.
  //
  // Fix: prefer `claimRefreshToken`, which performs a single atomic
  // `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash=? AND
  // revoked_at IS NULL AND expires_at > NOW() RETURNING id`. PostgreSQL
  // guarantees that at most one concurrent UPDATE can match a row with
  // `revoked_at IS NULL` (row-level lock + RETURNING), so only ONE caller
  // observes `true`. All other racers see `false` → 401.
  //
  // Legacy fallback (no `claimRefreshToken`): the old two-step dance is
  // preserved for in-process test harnesses where JS single-threaded
  // execution makes it effectively atomic. Production callers (auth-service)
  // MUST supply `claimRefreshToken`.
  const tokenHash = hashToken(refreshToken);
  if (callbacks.claimRefreshToken) {
    const claimed = await callbacks.claimRefreshToken(tokenHash);
    if (!claimed) {
      // Lost the race, or token was already revoked / past server-side exp.
      // Error message intentionally matches the legacy path so the route
      // handler in authRoutes.ts treats both failure modes identically.
      throw new Error('Refresh token has been revoked');
    }
  } else {
    const isRevoked = await callbacks.isTokenRevoked(tokenHash);
    if (isRevoked) {
      throw new Error('Refresh token has been revoked');
    }
    await callbacks.revokeToken(tokenHash);
  }

  // 4. Assemble fresh identity claims for the new access token
  // SEC-001 (RS-013-core-fix): refresh token carries only `sub`; re-fetch the
  // user record to get current email/google_id/products/role. Falling back to
  // `decoded.*` preserves backward compatibility for pre-fix callers.
  let claims: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: decoded.sub,
    company_id: decoded.company_id,
    role: decoded.role,
    product: decoded.product,
    email: decoded.email,
    google_id: decoded.google_id,
    products: decoded.products,
  };

  if (callbacks.findUserById) {
    const user = await callbacks.findUserById(decoded.sub);
    if (!user) {
      // User deleted / revoked since the refresh token was issued.
      // Throw so the client is forced to re-authenticate via /auth/google.
      throw new Error('User not found for refresh token');
    }
    claims = {
      sub: user.id,
      company_id: user.company_id,
      role: user.role,
      product: user.product,
      email: user.email,
      google_id: user.google_id,
      products: Array.isArray(user.products) ? [...user.products] : [],
    };
  }

  // 5. Issue new token pair
  const refreshTTL = options.refreshTTL ?? DEFAULT_REFRESH_TTL;
  const newPair = await createTokens(claims, options);

  // 6. Store the new refresh token hash
  const newRefreshHash = hashToken(newPair.refreshToken);
  const expiresAt = new Date(Date.now() + refreshTTL * 1000);
  await callbacks.storeToken(newRefreshHash, decoded.sub, expiresAt);

  return newPair;
}
