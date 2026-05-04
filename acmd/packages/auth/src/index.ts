// @acmd/auth — Public Package Exports
// Product-agnostic auth package for all VOLLOS products
//
// Usage:
//   import { verifyGoogleToken, createTokens, tenantGuard, requireRole, createAuthRoutes } from '@acmd/auth';
//   import type { AuthVariables, AuthConfig, JwtPayload } from '@acmd/auth';

// Google Token Verification
export { verifyGoogleToken } from './googleAuth.js';
export type { VerifyGoogleTokenOptions } from './googleAuth.js';

// JWT Service
export {
  createTokens,
  verifyAccessToken,
  verifyAccessTokenRaw,
  decodeJwtPayload,
  verifyRefreshToken,
  rotateRefreshToken,
  hashToken,
  generateRsaKeyPair,
  importPrivateKeyPem,
  importPublicKeyPem,
  DEFAULT_ACCESS_TTL,
  DEFAULT_REFRESH_TTL,
} from './jwt.js';

// JWKS Fetch + Cache Utility
export { fetchJwks, clearJwksCache } from './jwks.js';

// Tenant Guard Middleware
export { tenantGuard, createTenantScope } from './tenantGuard.js';
export type { TenantGuardOptions } from './tenantGuard.js';

// Role Guard Middleware
export { requireRole } from './roleGuard.js';

// Auth Route Factory
export { createAuthRoutes } from './authRoutes.js';

// Rate Limit Middleware
export { googleAuthRateLimit, refreshRateLimit } from './rateLimit.js';

// Types
export type {
  JwtPayload,
  GoogleVerifiedPayload,
  CreateTokensOptions,
  TokenPair,
  VerifyTokenOptions,
  RefreshTokenCallbacks,
  AuthConfig,
  UserRecord,
  CreateUserData,
  TenantScopedDb,
  CreateTenantScopeOptions,
  AuthVariables,
  AuthEnv,
  AuthContext,
} from './types.js';

// Re-export KeyLike so consumers can type RSA keys without a direct jose dependency
export type { KeyLike } from 'jose';

// Re-export SignJWT so tests (e.g. apps/api integration tests that sign
// tokens with custom claims) can build a JWT without taking a direct jose
// dependency. Not for use in production paths — use `createTokens` instead.
export { SignJWT } from 'jose';
