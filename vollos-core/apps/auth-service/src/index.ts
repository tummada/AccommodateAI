// auth-service — main entry point
// Wires RS256 key management, @vollos/auth-db, and createAuthRoutes()

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { eq, and, isNotNull, or, lte, gt, isNull } from 'drizzle-orm';
import {
  createAuthRoutes,
  generateRsaKeyPair,
  exportPublicKeyJwk,
  importPrivateKeyPem,
  importPublicKeyPem,
  parseAuthCorsOrigins,
  createAuthCors,
  assertProductionCorsConfigured,
} from '@vollos/auth';
import type { KeyLike } from 'jose';
import { db, users, refreshTokens, userProducts } from '@vollos/auth-db';
import {
  refreshRateLimiter,
  googleCallbackRateLimiter,
  logoutRateLimiter,
  meRateLimiter,
  onboardingRateLimiter,
} from './middleware/rateLimit.js';

// ─── Constants ────────────────────────────────────────────────────────────────
// RS-013 (Phase 1 / validate mode): every newly-provisioned user is granted
// the 'acmd' product automatically. Revisit when multi-product entitlement
// UX lands (owner will flip this to explicit provisioning).
const DEFAULT_PROVISIONED_PRODUCT = 'acmd';
const DEFAULT_PROVISIONED_STATUS = 'active';

// ─── Key Setup ────────────────────────────────────────────────────────────────

let privateKey: KeyLike;
let publicKey: KeyLike;

async function loadKeys(): Promise<void> {
  const privatePem = process.env['AUTH_RSA_PRIVATE_KEY'];
  const publicPem = process.env['AUTH_RSA_PUBLIC_KEY'];

  if (privatePem && publicPem) {
    // Production: load from PEM env vars
    privateKey = await importPrivateKeyPem(privatePem.replace(/\\n/g, '\n'));
    publicKey = await importPublicKeyPem(publicPem.replace(/\\n/g, '\n'));
    console.log('[auth-service] Loaded RSA keys from environment (production)');
  } else {
    // Development: generate ephemeral key pair (changes every restart)
    console.warn('[auth-service] WARNING: AUTH_RSA_PRIVATE_KEY not set — using ephemeral RSA key. All sessions will be invalidated on restart.');
    const pair = await generateRsaKeyPair();
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }
}

// ─── App Setup ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await loadKeys();

  const app = new Hono();

  // ─── CORS (RS-013) ───────────────────────────────────────────────────────────
  // Must be mounted BEFORE routes so preflight OPTIONS for /auth/* is
  // handled with the configured allowlist. `credentials: true` is required
  // because the refresh flow relies on the httpOnly cookie being sent
  // cross-origin from acmd-web (:3003) to auth-service (:3004). Helpers
  // live in @vollos/auth/src/cors.ts so they're unit-tested in isolation.
  //
  // SEC-002 (RS-013-core-fix): fail-closed in production. If NODE_ENV is
  // 'production' but AUTH_CORS_ORIGINS is unset/empty, parseAuthCorsOrigins
  // would silently fall back to http://localhost:3003 with credentials:true
  // — classic misconfiguration footgun (OWASP A05). Refuse to boot instead.
  const corsEnv = process.env['AUTH_CORS_ORIGINS'];
  assertProductionCorsConfigured(process.env['NODE_ENV'], corsEnv);
  const corsOrigins = parseAuthCorsOrigins(corsEnv);
  app.use('*', createAuthCors(corsOrigins));

  // ─── Rate Limits (T-021) ─────────────────────────────────────────────────────
  // Per-IP limits applied BEFORE route handlers. getTrustedIp reads the LAST
  // x-forwarded-for entry (Caddy-written, tamper-proof). On 429 the response
  // carries RateLimit-* + Retry-After headers (hono-rate-limiter draft-6).
  //
  // Rationale for path-level wiring (vs inside createAuthRoutes):
  //   - /me and /onboarding live outside @vollos/auth, so a package-level
  //     limiter cannot cover them.
  //   - /auth/google/callback is a planned route (OAuth server-flow landing);
  //     wiring the limiter here means the quota is already in place on the
  //     day the route ships.
  //   - /auth/google and /auth/refresh already have inline limiters inside
  //     @vollos/auth at tighter per-minute windows; this outer 5-minute
  //     limiter is defence-in-depth (whichever bucket is exhausted first
  //     short-circuits the request).
  app.use('/auth/refresh', refreshRateLimiter);
  app.use('/auth/google/callback', googleCallbackRateLimiter);
  app.use('/auth/logout', logoutRateLimiter);
  app.use('/me', meRateLimiter);
  app.use('/me/*', meRateLimiter);
  app.use('/onboarding', onboardingRateLimiter);
  app.use('/onboarding/*', onboardingRateLimiter);

  // ─── Auth Routes (/auth/*) ───────────────────────────────────────────────────
  const authRoutes = createAuthRoutes({
    googleClientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
    privateKey,
    publicKey,
    accessTTL: Number(process.env['ACCESS_TTL']) || undefined,
    refreshTTL: Number(process.env['REFRESH_TTL']) || undefined,
    secureCookie: process.env['NODE_ENV'] === 'production',
    cookiePath: '/auth',

    // ─── findUserByGoogleId ─────────────────────────────────────────────────
    findUserByGoogleId: async (googleId: string) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.googleId, googleId));
      if (!user) return null;

      // RS-013: fetch entitlement list from auth.user_products so the JWT
      // carries a `products` claim. Only 'active' entitlements are surfaced —
      // 'expired' / 'trial' handling lives in the product app (future work).
      const entitlements = await db
        .select({ product: userProducts.product })
        .from(userProducts)
        .where(
          and(
            eq(userProducts.userId, user.id),
            eq(userProducts.status, DEFAULT_PROVISIONED_STATUS),
          ),
        );

      return {
        id: user.id,
        company_id: '',      // auth-service is product-agnostic — products extend via RBAC
        role: 'viewer',
        product: 'vollos',
        email: user.email,
        name: user.name,
        google_id: user.googleId,
        products: entitlements.map((e) => e.product),
      };
    },

    // ─── createUser ─────────────────────────────────────────────────────────
    createUser: async (data) => {
      // RS-013: provision the user row AND the default entitlement row in
      // the same logical step. We use `onConflictDoNothing` on the unique
      // (user_id, product) index so a retried login (e.g. client timeout
      // → duplicate POST /auth/google) does not raise 500 on the INSERT.
      const [user] = await db
        .insert(users)
        .values({
          googleId: data.google_id,
          email: data.email,
          name: data.name,
        })
        .returning();

      await db
        .insert(userProducts)
        .values({
          userId: user.id,
          product: DEFAULT_PROVISIONED_PRODUCT,
          status: DEFAULT_PROVISIONED_STATUS,
        })
        .onConflictDoNothing();

      return {
        id: user.id,
        company_id: '',
        role: 'viewer',
        product: 'vollos',
        email: user.email,
        name: user.name,
        google_id: user.googleId,
        products: [DEFAULT_PROVISIONED_PRODUCT],
      };
    },

    // ─── tokenCallbacks ──────────────────────────────────────────────────────
    tokenCallbacks: {
      storeToken: async (tokenHash: string, userId: string, expiresAt: Date) => {
        await db.insert(refreshTokens).values({
          tokenHash,
          userId,
          expiresAt,
        });
      },
      revokeToken: async (tokenHash: string) => {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.tokenHash, tokenHash));
      },
      // SEC-MEDIUM-4 (T-055): atomic claim + revoke for refresh-token
      // rotation. Single PostgreSQL statement:
      //   UPDATE auth.refresh_tokens
      //     SET revoked_at = NOW()
      //     WHERE token_hash = $1
      //       AND revoked_at IS NULL
      //       AND expires_at > NOW()
      //     RETURNING id
      // Row-level locking + RETURNING guarantees that exactly one concurrent
      // caller observes a non-empty result set. All other racers see 0 rows
      // and must respond 401. Also subsumes the expiry check that the old
      // `isTokenRevoked` callback bundled in, so expired tokens → 401
      // without a separate round-trip. `new Date()` is the JS wall clock
      // at the start of the UPDATE — Postgres then enforces the atomicity,
      // not JS, so this is safe even under heavy concurrent load.
      claimRefreshToken: async (tokenHash: string): Promise<boolean> => {
        const now = new Date();
        const rows = await db
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(refreshTokens.tokenHash, tokenHash),
              isNull(refreshTokens.revokedAt),
              gt(refreshTokens.expiresAt, now),
            ),
          )
          .returning({ id: refreshTokens.id });
        return rows.length > 0;
      },
      isTokenRevoked: async (tokenHash: string) => {
        const [token] = await db
          .select()
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.tokenHash, tokenHash),
              or(
                isNotNull(refreshTokens.revokedAt),
                lte(refreshTokens.expiresAt, new Date()),
              ),
            ),
          );
        return !!token;
      },
      // SEC-001 (RS-013-core-fix): refresh tokens no longer carry email /
      // google_id / products. rotateRefreshToken uses this callback to
      // re-fetch current identity + entitlement claims by user UUID (`sub`)
      // so the new access token reflects fresh state (e.g. revoked
      // entitlements). Returns null → user deleted → client re-authenticates.
      findUserById: async (sub: string) => {
        const [user] = await db.select().from(users).where(eq(users.id, sub));
        if (!user) return null;

        const entitlements = await db
          .select({ product: userProducts.product })
          .from(userProducts)
          .where(
            and(
              eq(userProducts.userId, user.id),
              eq(userProducts.status, DEFAULT_PROVISIONED_STATUS),
            ),
          );

        return {
          id: user.id,
          company_id: '',
          role: 'viewer',
          product: 'vollos',
          email: user.email,
          name: user.name,
          google_id: user.googleId,
          products: entitlements.map((e) => e.product),
        };
      },
    },
  });

  // Mount auth routes at /auth
  app.route('/auth', authRoutes);

  // ─── JWKS Endpoint ────────────────────────────────────────────────────────
  app.get('/.well-known/jwks.json', async (c) => {
    const jwk = await exportPublicKeyJwk(publicKey);
    return c.json({ keys: [jwk] });
  });

  // ─── Health ───────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // ─── Start Server ──────────────────────────────────────────────────────────
  const PORT = Number(process.env['PORT']) || 3004;
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`auth-service listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[auth-service] Failed to start:', err);
  process.exit(1);
});
