// @vollos/auth — Shared type definitions
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
  // RS-013: identity + entitlement claims ─────────────────────────────────
  // email — allows downstream products to display user identity without
  //   re-querying auth-service (e.g. header greetings, audit logs).
  // google_id — carries the Google-issued `sub` for traceability when
  //   users move between products; never exposed to end-users.
  // products — entitlement list fetched from auth.user_products at sign
  //   time; product apps authorize by checking membership of their own
  //   product key in this array (e.g. `payload.products.includes('acmd')`).
  email: string;
  google_id: string;
  products: string[];
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
  privateKey: KeyLike; // RSA private key for signing (RS256)
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
  /**
   * SEC-MEDIUM-4 (T-055): atomically claim and revoke a refresh token as
   * part of rotation. The implementation MUST perform a single atomic
   * operation (e.g. PostgreSQL `UPDATE ... WHERE token_hash=? AND
   * revoked_at IS NULL AND expires_at > NOW() RETURNING id`) so that only
   * ONE concurrent /auth/refresh request can succeed for a given token.
   *
   * Returns:
   *   - `true`  → caller won the race; token row existed, was not revoked,
   *               not expired, and is NOW marked revoked. Caller may mint
   *               a new pair.
   *   - `false` → token does not exist, is already revoked, or is past its
   *               server-side `expires_at`. Caller MUST respond 401 (lost
   *               the race, or token was never valid).
   *
   * MUST NOT be used for logout — logout uses `revokeToken` which succeeds
   * even on an already-revoked token (idempotent). This callback is only
   * for the rotation path where atomicity is required.
   *
   * Optional — when omitted, `rotateRefreshToken` falls back to the legacy
   * non-atomic `isTokenRevoked` + `revokeToken` pair. In-process test
   * harnesses (single-threaded JS) can safely omit this because their
   * revoke + check is already effectively atomic.
   */
  claimRefreshToken?: (tokenHash: string) => Promise<boolean>;
  /**
   * SEC-001 (RS-013-core-fix): fetch fresh identity + entitlement claims by
   * user UUID (`sub`) during refresh-token rotation. Refresh tokens now carry
   * ONLY `sub` + `token_type` (no PII), so the rotate flow must look up the
   * user to re-populate the access token's email/google_id/products/role/etc.
   *
   * Optional — if omitted, the rotated access token will be issued with
   * empty-string / empty-array defaults for identity claims (still signature-
   * verified; consumers that require PII will see `email === ''`).
   *
   * Return `null` if the user was deleted/revoked between login and refresh —
   * rotateRefreshToken will throw so the client re-authenticates.
   */
  findUserById?: (sub: string) => Promise<UserRecord | null>;
}

// -----------------------------------------------------------------------
// Auth configuration — product passes this when calling createAuthRoutes()
// -----------------------------------------------------------------------

export interface AuthConfig {
  googleClientId: string;
  privateKey: KeyLike; // RSA private key for signing JWTs (RS256)
  publicKey: KeyLike;  // RSA public key for verifying JWTs (RS256)
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
  // RS-013: identity + entitlement claims embedded in the JWT ─────────────
  // google_id — Google-issued "sub" claim, opaque identifier (no PII).
  // products — entitlement list (product keys) fetched from
  //   auth.user_products; surfaces in the JWT `products` claim so product
  //   apps can authorize without an extra DB round-trip.
  google_id: string;
  products: string[];
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
