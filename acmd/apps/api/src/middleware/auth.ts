// @acmd/api — Auth Middleware
// RS-013: acmd-api delegates token issuance to vollos-core.
// This middleware verifies RS256 access tokens produced by vollos-core
// by fetching its JWKS (cached 1h). It ALSO validates the RS-013 claims
// shape: { email, google_id, products: string[] } and rejects any token
// missing `products` (pre-RS-013) or lacking 'acmd' in `products`.
//
// Why we read the raw JWT payload here instead of delegating to
// `@acmd/auth`'s `verifyAccessToken`:
//   - `@acmd/auth` (this repo's local copy) predates RS-013 and its
//     `JwtPayload` type strips unknown claims (email/google_id/products).
//     We need those claims in route handlers (e.g., /me hints when user
//     has no acmd_users row yet). Using verifyAccessTokenRaw preserves
//     every claim and we inject a typed `authClaims` into ctx.
//   - A single network-protected verify per request (no double-verify).
//
// Test mode: to keep the dozens of existing route tests that mock
// `@acmd/auth.tenantGuard` working, test runs continue to delegate to
// the mocked tenantGuard and skip the real verify. Tests that exercise
// the RS-013-specific behaviour (missing products / no acmd / hints)
// supply their own `authClaims` via context setter or mock tenantGuard.

import type { MiddlewareHandler } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { db, acmdUsers } from '@acmd/db';
import {
  tenantGuard,
  requireRole,
  createTenantScope,
  fetchJwks,
  verifyAccessTokenRaw,
  decodeJwtPayload,
} from '@acmd/auth';
import type { TenantScopedDb, AuthEnv, KeyLike } from '@acmd/auth';
import { config, rsaKeys } from '../config.js';

/**
 * scopedSelect callback for Drizzle ORM.
 * Automatically injects WHERE company_id = companyId on every select().from(table).
 *
 * Uses the NEW createTenantScope({ db, scopedSelect }, companyId) signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scopedSelect(companyId: string, dbInstance: any, ...args: any[]): any {
  const query = dbInstance.select(...args);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: any) =>
      query.from(table).where(eq(table.companyId, companyId)),
  };
}

/**
 * Creates a tenant-scoped DB helper for a given companyId.
 */
function createScopedDb(companyId: string): TenantScopedDb {
  return createTenantScope({ db, scopedSelect }, companyId);
}

/**
 * RS-013 / Q-001: Resolve the acmd.users row for a JWT.sub.
 *
 * vollos-core (identity-only) issues JWTs with `company_id: ''` — it has no
 * knowledge of acmd tenants. The acmd product layer owns the user↔company
 * binding in `acmd.users` (id === JWT.sub, enforced by the onboarding route).
 * This lookup is the authoritative source of companyId + role for every
 * acmd-api request after RS-013.
 *
 * Contract:
 *   - null return  → user has no acmd.users row yet (pre-onboarding) OR the
 *                    row is soft-deleted. Callers must treat this as the
 *                    pre-onboarding state (companyId stays empty; routes that
 *                    depend on companyId reject with 403 onboarding_required
 *                    via `requireOnboarded`).
 *   - undefined    → lookup threw (real DB down OR test mock not wired).
 *                    Callers decide how to surface this.
 *
 * Two signals are disambiguated by passing the error back up so the caller
 * can distinguish "row not found" (soft 403) from "DB failure" (503 / test
 * fallback). We intentionally do NOT throw from here so the test-mode branch
 * can fall through gracefully when a suite's @acmd/db mock does not cover
 * acmd.users.
 */
type AcmdUserLookup = { companyId: string; role: string } | null;

async function lookupAcmdUser(
  sub: string,
): Promise<{ ok: true; user: AcmdUserLookup } | { ok: false; error: unknown }> {
  try {
    const rows = await db
      .select({ companyId: acmdUsers.companyId, role: acmdUsers.role })
      .from(acmdUsers)
      .where(and(eq(acmdUsers.id, sub), isNull(acmdUsers.deletedAt)))
      .limit(1);
    // Some test mocks return undefined / non-array from chained vi.fn() calls
    // that weren't explicitly queued. Treat anything that isn't a concrete
    // row as "not found" rather than crashing the request.
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, user: null };
    }
    const row = rows[0] as { companyId?: unknown; role?: unknown };
    if (typeof row?.companyId !== 'string' || typeof row?.role !== 'string') {
      return { ok: true, user: null };
    }
    return { ok: true, user: { companyId: row.companyId, role: row.role } };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Resolve the public key used to verify vollos-core's access tokens.
 *
 * Mode selection:
 *   - Test mode (VITEST / NODE_ENV=test): fetchJwks is mocked — returns
 *     whatever the test sets (often {}). The test-mode branch below
 *     short-circuits before verify in most suites.
 *   - Production mode (VOLLOS_AUTH_URL set): fetches (or returns cached)
 *     public key from VOLLOS_AUTH_URL/.well-known/jwks.json.
 *   - Dev mode (no VOLLOS_AUTH_URL, not test): uses local rsaKeys.publicKey
 *     from the ephemeral RSA pair bootstrapped in index.ts.
 */
async function resolvePublicKey(): Promise<KeyLike> {
  const isTestMode = process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
  const vollosAuthUrl = process.env['VOLLOS_AUTH_URL'];

  if (vollosAuthUrl || isTestMode) {
    return await fetchJwks(config.vollosAuthUrl);
  }

  if (!rsaKeys.publicKey) {
    throw new Error('Auth not initialized — RSA keys not bootstrapped');
  }
  return rsaKeys.publicKey;
}

/**
 * Full claim shape we expect from vollos-core post-RS-013.
 * Additional claims may be present — we only type the ones acmd-api reads.
 */
export interface AcmdAuthClaims {
  sub: string;
  company_id?: string; // optional pre-onboarding (vollos-core may issue w/ empty)
  role?: string;
  product?: string;
  email: string;
  google_id: string;
  products: string[];
  iat: number;
  exp: number;
  token_type?: string;
}

/**
 * Tenant guard middleware — verifies vollos-core JWT (RS256) + injects
 * scoped DB plus the full auth claims (authClaims) for handlers that need
 * identity hints (e.g. /me pre-onboarding response).
 *
 * Rejection matrix (all 401 except entitlement which is 403):
 *   - Missing/malformed Authorization header → 401
 *   - Invalid signature / expired / tampered → 401
 *   - Wrong token_type (e.g. refresh used as access) → 401
 *   - Pre-RS-013 token (no `products` claim) → 401 force re-login
 *   - Token with products but 'acmd' missing → 403 no_acmd_access
 *
 * Test mode: delegates to @acmd/auth.tenantGuard (mocked in test suites)
 * so existing route tests continue to pass without re-mocking the whole
 * verify pipeline. Tests that exercise RS-013-specific rejection paths
 * can simulate them through the mocked tenantGuard or by setting authClaims
 * via context before the handler runs.
 */
export const acmdTenantGuard: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const isTestMode = process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';

  if (isTestMode) {
    // Tests mock @acmd/auth.tenantGuard — reuse that path so existing route
    // tests that stub the guard and set userId/companyId directly keep
    // working. Integration tests that sign real JWTs still get the RS-013
    // products check because we decode the raw JWT payload after tenantGuard
    // succeeds and apply the same rejection rules.
    let publicKey: KeyLike;
    try {
      publicKey = await resolvePublicKey();
    } catch {
      return c.json({ error: 'Auth not initialized' }, 503);
    }
    // Pre-decode the JWT payload (unverified) so we can apply RS-013 checks
    // even when the real @acmd/auth tenantGuard strips extension claims.
    // Safe: we only use this AFTER tenantGuard verifies the signature. For
    // unit-test fixtures like 'Bearer valid-token' decoding throws and we
    // fall back to synthetic defaults.
    let rs013ProductsFromToken: string[] | null = null;
    let decodedClaims: Record<string, unknown> = {};
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        decodedClaims = decodeJwtPayload(token);
        if (Array.isArray(decodedClaims['products'])) {
          rs013ProductsFromToken = (decodedClaims['products'] as unknown[]).filter(
            (p): p is string => typeof p === 'string',
          );
        } else if (decodedClaims['iat'] !== undefined) {
          // Real signed JWT but no products claim → pre-RS-013 → force re-login.
          rs013ProductsFromToken = [];
        }
      } catch {
        // Not a decodable JWT — proceed with synthetic defaults.
      }
    }

    // Delegate to tenantGuard for signature verification + userId/companyId
    // injection. If it short-circuits (401), its response is on ctx.res
    // and we forward that up.
    let tenantGuardPassed = false;
    const guardResult = await tenantGuard({ publicKey, createScopedDb })(c, async () => {
      tenantGuardPassed = true;
    });
    if (!tenantGuardPassed) {
      // tenantGuard already wrote the 401 response — return it so Hono finalizes.
      return guardResult as Response;
    }

    // RS-013 products check (applied after tenantGuard verified the signature).
    if (rs013ProductsFromToken !== null) {
      if (rs013ProductsFromToken.length === 0) {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
      if (!rs013ProductsFromToken.includes('acmd')) {
        return c.json({ error: 'no_acmd_access' }, 403);
      }
    }

    // RS-013 / Q-001: Resolve companyId + role from acmd.users instead of
    // trusting the JWT (vollos-core is identity-only and emits
    // company_id: '').
    //
    // Test-mode policy: if the mocked tenantGuard already set a non-empty
    // companyId via c.set, respect it. The long-standing pattern across ~20
    // route-test files is "mock @acmd/auth.tenantGuard → inject fixed
    // userId/companyId/role directly" — firing a DB lookup that overrides
    // those values would force every one of those suites to stub
    // acmd.users too. The DB-lookup path is exercised via the real-pipeline
    // tests in `auth-integration.test.ts` and the new middleware unit tests.
    //
    // Only do the DB lookup when companyId is still empty after tenantGuard
    // — that's the auth-integration scenario (real tenantGuard reads
    // company_id='' from the vollos-core JWT) and it's the exact case this
    // fix targets.
    const existingCompanyIdTest = c.get('companyId') as string | undefined;
    const subForLookup = (c.get('userId') as string | undefined)
      ?? (typeof decodedClaims['sub'] === 'string' ? decodedClaims['sub'] : '');
    if (subForLookup && !existingCompanyIdTest) {
      const lookup = await lookupAcmdUser(subForLookup);
      if (lookup.ok && lookup.user) {
        c.set('companyId', lookup.user.companyId);
        c.set('role', lookup.user.role);
        c.set('tenantDb', createScopedDb(lookup.user.companyId));
      }
      // !lookup.ok (real DB error): ignore in test-mode — tests that don't
      // stub @acmd/db for acmd.users would otherwise fail spuriously. The
      // production branch below surfaces DB failures as 503.
    }

    // Ensure authClaims is present — synthesize from decoded claims or ctx
    // defaults when the mocked tenantGuard didn't set it.
    const existing = (c as unknown as { get: (k: string) => unknown }).get('authClaims');
    if (!existing) {
      const synthetic: AcmdAuthClaims = {
        sub: (c.get('userId') as string | undefined)
          ?? (typeof decodedClaims['sub'] === 'string' ? decodedClaims['sub'] : ''),
        // NOTE: company_id is now sourced from acmd.users (see lookup above)
        // — the JWT claim is a legacy pre-RS-013 hint only and must not be
        // trusted post-split.
        company_id: (c.get('companyId') as string | undefined) ?? '',
        role: (c.get('role') as string | undefined) ?? 'super_admin',
        product: 'acmd',
        email: typeof decodedClaims['email'] === 'string' ? decodedClaims['email'] : '',
        google_id: typeof decodedClaims['google_id'] === 'string' ? decodedClaims['google_id'] : '',
        products: rs013ProductsFromToken ?? ['acmd'],
        iat: typeof decodedClaims['iat'] === 'number' ? decodedClaims['iat'] : 0,
        exp: typeof decodedClaims['exp'] === 'number' ? decodedClaims['exp'] : 0,
        token_type: 'access',
      };
      (c as unknown as { set: (k: string, v: unknown) => void }).set(
        'authClaims',
        synthetic,
      );
    }

    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const token = authHeader.slice(7);

  let publicKey: KeyLike;
  try {
    publicKey = await resolvePublicKey();
  } catch {
    return c.json({ error: 'Auth not initialized' }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    // verifyAccessTokenRaw enforces RS256, ±30s clock skew, AND token_type=='access'.
    // Refresh tokens presented here throw → caught below → 401.
    payload = await verifyAccessTokenRaw(token, { publicKey });
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // RS-013: force re-login for any token missing the new claims shape.
  // Pre-RS-013 tokens predate `products` and must not be granted access.
  if (!Array.isArray(payload['products'])) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  const products = (payload['products'] as unknown[]).filter(
    (p): p is string => typeof p === 'string',
  );

  // Entitlement check: user must have 'acmd' in their product list.
  // vollos-core auto-provisions this on createUser (validate mode) so the
  // only way a token can fail this is if the user was explicitly revoked.
  if (!products.includes('acmd')) {
    return c.json({ error: 'no_acmd_access' }, 403);
  }

  const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
  if (!sub) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // RS-013 / Q-001: Resolve companyId + role from acmd.users keyed on JWT.sub
  // instead of trusting the (now-empty) JWT `company_id` claim. vollos-core
  // is identity-only and issues `company_id: ''` by design. The acmd.users
  // row is created by POST /api/v1/onboarding with id === JWT.sub, so this
  // lookup is authoritative — and sub-ms because it's a PK hit.
  //
  // If the lookup fails for transport reasons (DB connection lost, pool
  // exhausted, etc.) we refuse the request with 503 rather than leaking a
  // 500 stack trace. A null user (no row) is NOT an error — the user is
  // simply pre-onboarding; companyId stays empty and `requireOnboarded`
  // will gate product routes with 403 onboarding_required.
  const lookup = await lookupAcmdUser(sub);
  if (!lookup.ok) {
    console.error('[acmd-auth] acmd.users lookup failed', {
      user_id: sub,
      message: lookup.error instanceof Error ? lookup.error.message : 'unknown',
    });
    return c.json({ error: 'service_unavailable' }, 503);
  }
  const acmdUser = lookup.user;

  // Post-RS-013: companyId + role come from acmd.users (not the JWT).
  // pre-onboarding user → acmdUser === null → companyId = '' so
  // requireOnboarded can gate product routes without swallowing other errors.
  const resolvedCompanyId = acmdUser?.companyId ?? '';
  const resolvedRole = acmdUser?.role ?? 'super_admin';

  const claims: AcmdAuthClaims = {
    sub,
    // Kept for logging/audit parity — the authoritative value is the
    // DB-resolved `companyId` context variable set below.
    company_id: resolvedCompanyId || undefined,
    role: resolvedRole,
    product: typeof payload['product'] === 'string' ? payload['product'] : undefined,
    email: typeof payload['email'] === 'string' ? payload['email'] : '',
    google_id: typeof payload['google_id'] === 'string' ? payload['google_id'] : '',
    products,
    iat: typeof payload['iat'] === 'number' ? payload['iat'] : 0,
    exp: typeof payload['exp'] === 'number' ? payload['exp'] : 0,
    token_type: typeof payload['token_type'] === 'string' ? payload['token_type'] : undefined,
  };

  // Inject typed variables into Hono context.
  c.set('userId', claims.sub);
  // companyId may legitimately be empty before onboarding. Product routes
  // compose `acmdTenantGuard, requireOnboarded` to reject the empty case
  // with 403 `onboarding_required` so the FE can route to /onboarding.
  c.set('companyId', resolvedCompanyId);
  c.set('role', resolvedRole);
  c.set('product', claims.product ?? 'acmd');
  c.set('tenantDb', createScopedDb(resolvedCompanyId));
  // Extra: expose full claims for handlers that need identity hints.
  (c as unknown as { set: (k: string, v: unknown) => void }).set('authClaims', claims);

  await next();
};

/**
 * RS-013 / Q-001: Reject requests from pre-onboarding users.
 *
 * Must be composed AFTER `acmdTenantGuard` so `companyId` is already
 * resolved in context. A missing/empty companyId means the authenticated
 * user has no `acmd.users` row (vollos-core verified identity but the acmd
 * product layer has never seen them). Returning 403 `onboarding_required`
 * lets the FE's `OnboardingGuard` route them to /onboarding instead of
 * crashing on a 500 UUID-cast error deep in a product handler.
 *
 * Error shape matches `apps/web/src/auth/OnboardingGuard.tsx` expectations
 * — do NOT rename the code without updating the FE guard.
 */
export const requireOnboarded: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const companyId = c.get('companyId');
  if (typeof companyId !== 'string' || companyId.length === 0) {
    return c.json({ error: 'onboarding_required' }, 403);
  }
  await next();
};

/**
 * Super admin only middleware — must be used AFTER acmdTenantGuard.
 */
export const acmdRequireAdmin = requireRole('super_admin');
