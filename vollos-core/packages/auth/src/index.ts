// @vollos/auth — Public Package Exports
// Product-agnostic auth package for all VOLLOS products
//
// Usage:
//   import { verifyGoogleToken, createTokens, tenantGuard, requireRole, createAuthRoutes } from '@vollos/auth';
//   import type { AuthVariables, AuthConfig, JwtPayload } from '@vollos/auth';

// Google Token Verification
export { verifyGoogleToken } from './googleAuth.js';
export type { VerifyGoogleTokenOptions } from './googleAuth.js';

// JWT Service
export {
  createTokens,
  verifyAccessToken,
  verifyRefreshToken,
  rotateRefreshToken,
  hashToken,
  generateRsaKeyPair,
  exportPublicKeyJwk,
  importPrivateKeyPem,
  importPublicKeyPem,
  DEFAULT_ACCESS_TTL,
  DEFAULT_REFRESH_TTL,
} from './jwt.js';

// Tenant Guard Middleware
export { tenantGuard, createTenantScope } from './tenantGuard.js';
export type { TenantGuardOptions } from './tenantGuard.js';

// Role Guard Middleware
export { requireRole } from './roleGuard.js';

// Auth Route Factory
export { createAuthRoutes } from './authRoutes.js';

// Rate Limit Middleware
export { googleAuthRateLimit, refreshRateLimit } from './rateLimit.js';

// CORS (RS-013) — shared config + middleware factory for auth-service
export {
  parseAuthCorsOrigins,
  createAuthCors,
  assertProductionCorsConfigured,
  DEFAULT_AUTH_CORS_ORIGIN,
  PRODUCTION_CORS_MISSING_ERROR,
} from './cors.js';

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
