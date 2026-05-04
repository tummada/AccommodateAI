// @acmd/auth — JWT Service
// Uses `jose` library for standards-compliant JWT
// - createTokens: RS256 (privateKey — dev ephemeral or production PEM)
// - verifyAccessToken / verifyRefreshToken: RS256 (publicKey from JWKS or ephemeral)
//
// Task R02: createTokens(payload, { privateKey, accessTTL, refreshTTL }) → { accessToken, refreshToken }
// Task R03: verifyAccessToken + verifyRefreshToken (RS256)
// Task R04: Refresh token revocation via RefreshTokenCallbacks interface

import { SignJWT, jwtVerify, generateKeyPair, importPKCS8, importSPKI, decodeJwt as joseDecodeJwt } from 'jose';
import type { KeyLike } from 'jose';
import { createHash } from 'node:crypto';

/**
 * Decode a JWT payload WITHOUT verifying the signature.
 *
 * Re-exported here so downstream products can read extension claims that
 * `verifyAccessToken` strips (e.g. the RS-013 `products` array) AFTER the
 * signature has been verified separately. Never call this on a token whose
 * signature hasn't already been verified — it bypasses all auth checks.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  return joseDecodeJwt(token) as Record<string, unknown>;
}
import type {
  JwtPayload,
  TokenPair,
  CreateTokensOptions,
  VerifyTokenOptions,
  RefreshTokenCallbacks,
} from './types.js';

// Default TTLs per roadmap spec — exported so downstream products can reuse
// the same source-of-truth values for cookie maxAge / DB expires_at / client
// schedulers (see QA-1 in ACMD-118-A). Changing the value here ripples to
// every consumer via the re-export in `./index.ts`, preventing drift between
// the JWT `exp` claim and the refresh-cookie `Max-Age`.
export const DEFAULT_ACCESS_TTL = 900; // 15 minutes — industry standard for sensitive SaaS
export const DEFAULT_REFRESH_TTL = 2592000; // 30 days — rotation on every refresh

// QA-2 (ACMD-118-A): allow ±30s clock skew when verifying JWT exp/nbf.
// With a 15-minute access TTL even a few seconds of drift between the API
// host and the issuer host can produce spurious 401s on freshly-issued
// tokens. 30s is the industry-standard tolerance used by e.g. Auth0,
// AWS Cognito, and OIDC Conformance.
const JWT_CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Generate a new RSA-2048 key pair for RS256.
 * Used in tests and in development for ephemeral key generation.
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
 * Hash a refresh token for storage (SHA-256)
 * Never store the raw token — only the hash
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create access + refresh token pair (RS256).
 *
 * JWT Payload contains: sub, company_id, role, product, iat, exp
 * - Access token: short-lived (default 15 minutes), sent via Authorization: Bearer
 * - Refresh token: long-lived (default 30 days), stored in httpOnly cookie
 *
 * Both tokens are signed with RS256 using the provided privateKey.
 * Use generateRsaKeyPair() in dev mode for an ephemeral key pair.
 */
export async function createTokens(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  options: CreateTokensOptions,
): Promise<TokenPair> {
  const accessTTL = options.accessTTL ?? DEFAULT_ACCESS_TTL;
  const refreshTTL = options.refreshTTL ?? DEFAULT_REFRESH_TTL;

  const basePayload: {
    company_id: string;
    role: string;
    product: string;
    products?: string[];
  } = {
    company_id: payload.company_id,
    role: payload.role,
    product: payload.product,
  };

  // Include optional `products` entitlement array only when the caller
  // provides a non-empty list. Downstream consumers (acmd-api
  // `acmdTenantGuard`) require `Array.isArray(payload.products)` — adding
  // the claim here lets /test-login mint tokens that satisfy that guard
  // without forcing every caller to pass it.
  if (Array.isArray(payload.products) && payload.products.length > 0) {
    basePayload.products = payload.products;
  }

  // SEC-006: tag access tokens with token_type='access' so verifyAccessToken
  // can reject refresh tokens presented as access tokens (and vice versa).
  const accessToken = await new SignJWT({ ...basePayload, token_type: 'access' })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + accessTTL)
    .sign(options.privateKey);

  const refreshToken = await new SignJWT({ ...basePayload, token_type: 'refresh' })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + refreshTTL)
    .sign(options.privateKey);

  return { accessToken, refreshToken };
}

/**
 * Verify an access token (RS256 — uses publicKey from JWKS).
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
  // Mirror the token_type guard used by verifyRefreshToken below.
  //
  // SEC-NEW-002 (ACMD-118-B): the public Error message MUST be identical
  // to the one thrown by verifyRefreshToken below. Distinguishable strings
  // (`expected access token` vs `expected refresh token`) let an attacker
  // probe endpoints and figure out which token type each path expects
  // (timing / log / response-correlation side channel). A private `code`
  // field is attached for internal logging — never include it in any
  // response body.
  if (payload['token_type'] !== 'access') {
    const err = new Error('Invalid token type');
    Object.assign(err, { code: 'TOKEN_TYPE_MISMATCH_ACCESS' });
    throw err;
  }

  return {
    sub: payload.sub as string,
    company_id: payload['company_id'] as string,
    role: payload['role'] as string,
    product: payload['product'] as string,
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}

/**
 * Verify an access token and return the FULL raw JWT payload (all claims
 * preserved, no field filtering).
 *
 * Why this exists: `verifyAccessToken` returns a strictly-typed JwtPayload
 * and drops unknown claims. Downstream products (notably acmd-api post
 * RS-013) need extension claims from vollos-core such as `email`,
 * `google_id`, and `products`. Instead of widening the shared JwtPayload
 * shape — which would ripple into every consumer — this helper preserves
 * the raw payload so callers can read the claims they need defensively.
 *
 * All safety checks from `verifyAccessToken` apply: RS256 only, 30s clock
 * tolerance, and token_type must be 'access'.
 *
 * @throws if token is invalid, expired, tampered, or wrong type
 * @returns raw jwt payload (unknown-keyed)
 */
export async function verifyAccessTokenRaw(
  token: string,
  options: VerifyTokenOptions,
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, options.publicKey, {
    algorithms: ['RS256'],
    clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
  });

  if (payload['token_type'] !== 'access') {
    const err = new Error('Invalid token type');
    Object.assign(err, { code: 'TOKEN_TYPE_MISMATCH_ACCESS' });
    throw err;
  }

  return payload as Record<string, unknown>;
}

/**
 * Verify a refresh token (RS256 — uses publicKey from JWKS).
 * Also checks that token_type === 'refresh' to prevent access tokens
 * being used in refresh endpoint.
 *
 * @throws if token is invalid, expired, tampered, or wrong type
 * @returns decoded JwtPayload
 */
export async function verifyRefreshToken(
  token: string,
  options: VerifyTokenOptions,
): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, options.publicKey, {
    algorithms: ['RS256'],
    clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
  });

  // SEC-NEW-002 (ACMD-118-B): the public Error message MUST match the one
  // thrown by verifyAccessToken so the two code paths are indistinguishable
  // from outside. Internal `code` differentiates for structured logging.
  if (payload['token_type'] !== 'refresh') {
    const err = new Error('Invalid token type');
    Object.assign(err, { code: 'TOKEN_TYPE_MISMATCH_REFRESH' });
    throw err;
  }

  return {
    sub: payload.sub as string,
    company_id: payload['company_id'] as string,
    role: payload['role'] as string,
    product: payload['product'] as string,
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}

/**
 * Rotate a refresh token — verify old token, check revocation,
 * revoke old token, issue new token pair.
 *
 * @throws if token is invalid/revoked
 * @returns new TokenPair
 */
export async function rotateRefreshToken(
  refreshToken: string,
  options: VerifyTokenOptions & CreateTokensOptions,
  callbacks: RefreshTokenCallbacks,
): Promise<TokenPair> {
  // 1. Verify the token is structurally valid
  const decoded = await verifyRefreshToken(refreshToken, options);

  // 2. Check server-side revocation
  const tokenHash = hashToken(refreshToken);
  const isRevoked = await callbacks.isTokenRevoked(tokenHash);
  if (isRevoked) {
    throw new Error('Refresh token has been revoked');
  }

  // 3. Revoke the old token (one-time use)
  await callbacks.revokeToken(tokenHash);

  // 4. Issue new token pair
  const refreshTTL = options.refreshTTL ?? DEFAULT_REFRESH_TTL;
  const newPair = await createTokens(
    {
      sub: decoded.sub,
      company_id: decoded.company_id,
      role: decoded.role,
      product: decoded.product,
    },
    options,
  );

  // 5. Store the new refresh token hash
  const newRefreshHash = hashToken(newPair.refreshToken);
  const expiresAt = new Date(Date.now() + refreshTTL * 1000);
  await callbacks.storeToken(newRefreshHash, decoded.sub, expiresAt);

  return newPair;
}
