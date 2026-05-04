// @vollos/auth — Multi-Tenant Guard Middleware (Hono)
//
// Task R05: tenantGuard() — extract company_id from JWT → inject scoped DB client
// Roadmap 3: "createTenantScope(db, companyId) → scoped query helper"
// Constraint: "ห้ามใช้ db ตรงๆ ใน application code → ต้องใช้ scopedDb เท่านั้น"

import type { MiddlewareHandler } from 'hono';
import type { KeyLike } from 'jose';
import { verifyAccessToken } from './jwt.js';
import type { AuthEnv, TenantScopedDb, CreateTenantScopeOptions } from './types.js';

export interface TenantGuardOptions {
  publicKey: KeyLike; // RSA public key for verifying access tokens (RS256)
  /**
   * Factory to create a tenant-scoped DB helper.
   * Product provides this — package does NOT import DB directly.
   */
  createScopedDb: (companyId: string) => TenantScopedDb;
}

/**
 * tenantGuard() — Hono middleware
 *
 * 1. Reads Authorization: Bearer <token>
 * 2. Verifies JWT (signature + expiry)
 * 3. Injects userId, companyId, role, product into Hono context
 * 4. Injects tenantDb (scoped DB client) so route handlers never call raw DB
 *
 * Returns 401 if token is missing or invalid.
 * Returns 403 if company_id in token does not match route param (if checked by route).
 *
 * Cross-tenant access prevention:
 * The tenantDb is always scoped to the JWT's company_id — the handler cannot
 * accidentally query another tenant's data (correct-by-construction).
 */
export function tenantGuard(options: TenantGuardOptions): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader.slice(7);

    let payload;
    try {
      payload = await verifyAccessToken(token, { publicKey: options.publicKey });
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    // Inject typed variables into Hono context
    c.set('userId', payload.sub);
    c.set('companyId', payload.company_id);
    c.set('role', payload.role);
    c.set('product', payload.product);
    c.set('tenantDb', options.createScopedDb(payload.company_id));

    await next();
  };
}

/**
 * createTenantScope() — wrap a raw DB client with automatic company_id scoping.
 *
 * Product passes their own DB client + a scopedSelect callback that knows how
 * to inject WHERE company_id = companyId using their ORM.
 * Returns a TenantScopedDb where select() auto-injects the tenant filter.
 *
 * Note: This is application-level enforcement.
 * Full RLS enforcement should be done at the DB layer (PostgreSQL RLS) as defense-in-depth.
 *
 * @param options - { db, scopedSelect } from product
 * @param companyId - tenant's company UUID from JWT
 *
 * @example (Drizzle ORM)
 * ```ts
 * import { eq } from 'drizzle-orm';
 *
 * createTenantScope({
 *   db: drizzleClient,
 *   scopedSelect: (companyId, db, ...args) => {
 *     const query = db.select(...args);
 *     return {
 *       from: (table: any) => query.from(table).where(eq(table.company_id, companyId)),
 *     };
 *   },
 * }, companyId);
 * ```
 */
export function createTenantScope(
  options: CreateTenantScopeOptions,
  companyId: string,
): TenantScopedDb;
/**
 * @deprecated Use the options-based signature: createTenantScope({ db, scopedSelect }, companyId)
 * Legacy signature kept for backward compatibility — acts as passthrough (no auto-scoping).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTenantScope(db: any, companyId: string): TenantScopedDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTenantScope(dbOrOptions: any, companyId: string): TenantScopedDb {
  // Detect new options-based call vs legacy call
  if (
    dbOrOptions !== null &&
    typeof dbOrOptions === 'object' &&
    'scopedSelect' in dbOrOptions &&
    typeof dbOrOptions.scopedSelect === 'function'
  ) {
    const { db, scopedSelect } = dbOrOptions as CreateTenantScopeOptions;
    return {
      companyId,
      select(...args: unknown[]) {
        return scopedSelect(companyId, db, ...args);
      },
    };
  }

  // Legacy passthrough (deprecated) — no auto-scoping
  // MUST migrate to options-based signature before production launch
  console.warn(
    '[DEPRECATED] createTenantScope(db, companyId) does not auto-inject WHERE company_id. ' +
      'Use createTenantScope({ db, scopedSelect }, companyId) instead.',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = dbOrOptions as any;
  return {
    companyId,
    select(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (db as any).select(...args);
    },
  };
}
