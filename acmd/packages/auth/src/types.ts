// @acmd/auth — Shared type definitions
// All types are product-agnostic — no hardcoded product names or table names

import type { Context, Env } from 'hono';
import type { KeyLike } from 'jose';

// -----------------------------------------------------------------------
// JWT Payload (standard across all VOLLOS products)
// -----------------------------------------------------------------------

export interface JwtPayload {
  sub: string; // user UUID
  company_id: string; // tenant UUID
  role: string; // product-defined role (e.g. 'admin' | 'manager' | 'viewer')
  product: string; // product identifier (e.g. 'acmd' | 'vollos')
  /**
   * Optional entitlement list — downstream products (e.g. acmd-api
   * `acmdTenantGuard`) gate access on `products.includes('acmd')`. Added
   * additively post-RS-013 so /test-login can mint tokens locally without
   * going through vollos-core. Keep the singular `product` claim for
   * backward compatibility with middleware that reads it for logging/audit.
   */
  products?: string[];
  iat: number;
  exp: number;
}

// -----------------------------------------------------------------------
// Google Token Verify
// -----------------------------------------------------------------------

export interface GoogleVerifiedPayload {
  email: string;
  name: string;
  google_id: string; // Google's "sub" claim
  email_verified: boolean;
}

// -----------------------------------------------------------------------
// Token creation options
// -----------------------------------------------------------------------

export interface CreateTokensOptions {
  privateKey: KeyLike; // RSA private key for RS256 signing
  accessTTL?: number; // seconds, default 900 (15 minutes)
  refreshTTL?: number; // seconds, default 2592000 (30 days)
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface VerifyTokenOptions {
  publicKey: KeyLike; // RSA public key for verification (RS256)
}

// -----------------------------------------------------------------------
// Refresh Token Revocation callbacks
// Product implements these against their own DB table
// -----------------------------------------------------------------------

export interface RefreshTokenCallbacks {
  /** Store a new refresh token hash (called on login/refresh) */
  storeToken: (tokenHash: string, userId: string, expiresAt: Date) => Promise<void>;
  /** Revoke a refresh token by hash (called on logout) */
  revokeToken: (tokenHash: string) => Promise<void>;
  /** Check if a refresh token hash has been revoked */
  isTokenRevoked: (tokenHash: string) => Promise<boolean>;
}

// -----------------------------------------------------------------------
// Auth configuration — product passes this when calling createAuthRoutes()
// -----------------------------------------------------------------------

export interface AuthConfig {
  googleClientId: string;
  /** RS256 private key for createTokens() — used for token signing */
  privateKey: KeyLike;
  /** RS256 public key for verifyAccessToken / verifyRefreshToken (from JWKS) */
  publicKey: KeyLike;
  accessTTL?: number; // seconds
  refreshTTL?: number; // seconds
  /**
   * Cookie `Path` attribute for the refresh token cookie. Must match the
   * mount path of the auth sub-app in the consuming product so the browser
   * actually sends the cookie back on /refresh and /logout calls.
   *
   * Default: `/auth` (legacy — kept for backward compatibility with consumers
   * that mount the sub-app at `app.route('/auth', createAuthRoutes(...))`).
   *
   * Products mounting at a different path (e.g., acmd-api at `/api/v1/auth`)
   * MUST pass their mount path here so set/delete cookie headers agree.
   * A desync silently orphans sessions (SEC-001, CWE-613).
   */
  cookiePath?: string;
  /**
   * Whether to set the Secure attribute on the refresh cookie.
   * Default: true (production-safe). Pass false in local dev (HTTP).
   */
  secureCookie?: boolean;
  /** Find existing user by Google ID — product-specific DB query */
  findUserByGoogleId: (googleId: string) => Promise<UserRecord | null>;
  /** Create a new user — product-specific DB insert */
  createUser: (data: CreateUserData) => Promise<UserRecord>;
  /** Refresh token revocation callbacks */
  tokenCallbacks: RefreshTokenCallbacks;
}

export interface UserRecord {
  id: string; // UUID
  company_id: string;
  role: string;
  product: string;
  email: string;
  name: string;
}

export interface CreateUserData {
  google_id: string;
  email: string;
  name: string;
  company_id: string;
  role: string;
  product: string;
}

// -----------------------------------------------------------------------
// Hono Context Variables — typed context injected by auth middleware
// -----------------------------------------------------------------------

/**
 * Scoped DB helper type — middleware injects this so route handlers
 * never access the raw DB client directly (correct-by-construction).
 * Product provides the actual implementation.
 *
 * `select()` auto-injects WHERE company_id = companyId on every query.
 * Product implements the actual scoping logic via the `scopedSelect` callback
 * passed to `createTenantScope()`.
 */
export interface TenantScopedDb {
  readonly companyId: string;
  /**
   * Execute a select query automatically scoped to this tenant.
   * The underlying implementation MUST inject WHERE company_id = companyId.
   * Route handlers do NOT need to add .where(company_id) manually.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: (...args: any[]) => any;
}

/**
 * Options for createTenantScope().
 * Product provides the scopedSelect callback that knows how to inject
 * WHERE company_id = companyId using their own ORM/query builder.
 */
export interface CreateTenantScopeOptions {
  /**
   * Raw DB instance from product's packages/db.
   * Typed as `any` because this package is ORM-agnostic.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /**
   * Callback that wraps db.select() with automatic WHERE company_id = companyId.
   * Product implements this using their ORM (e.g., Drizzle's eq() + .where()).
   *
   * Example (Drizzle):
   *   scopedSelect: (companyId, db, ...args) => {
   *     const query = db.select(...args);
   *     return {
   *       from: (table: any) => query.from(table).where(eq(table.company_id, companyId)),
   *     };
   *   }
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scopedSelect: (companyId: string, db: any, ...args: any[]) => any;
}

/**
 * Hono typed context variables injected by tenantGuard() + requireRole()
 *
 * Usage:
 *   const app = new Hono<{ Variables: AuthVariables }>();
 *   // c.get('companyId') returns string (type-safe)
 */
export interface AuthVariables {
  userId: string;
  companyId: string;
  role: string;
  product: string;
  tenantDb: TenantScopedDb;
}

// -----------------------------------------------------------------------
// Hono Env helper
// -----------------------------------------------------------------------

export type AuthEnv = Env & { Variables: AuthVariables };

export type AuthContext = Context<AuthEnv>;
