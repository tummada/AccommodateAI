// @vollos/auth — Auth Route Factory (Hono)
//
// Task R07: createAuthRoutes() factory → POST /auth/google, /auth/refresh, /auth/logout
// Roadmap 5: "createAuthRoutes({ googleClientId, privateKey, publicKey, findUserByGoogleId, createUser, ... })"
// Constraint: "refresh token in httpOnly cookie (SameSite=Strict), access token via Authorization: Bearer"
// Constraint: "logout → revoke refresh token server-side (not just clear cookie)"

import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { verifyGoogleToken } from './googleAuth.js';
import { createTokens, verifyRefreshToken, hashToken, rotateRefreshToken } from './jwt.js';
import { googleAuthRateLimit, refreshRateLimit } from './rateLimit.js';
import type { AuthConfig } from './types.js';

const REFRESH_COOKIE_NAME = 'refresh_token';
const DEFAULT_REFRESH_TTL = 2592000; // 30 days in seconds — rotation on every refresh
const DEFAULT_COOKIE_PATH = '/auth'; // Legacy default — SEC-001: products with a different mount path MUST override via config.cookiePath

/**
 * createAuthRoutes() — factory that returns a Hono sub-app with auth routes.
 *
 * Mount into your product's Hono app:
 *   app.route('/auth', createAuthRoutes(config))
 *
 * Routes:
 *   POST /auth/google    — verify Google id_token → return JWT access token + set refresh cookie
 *   POST /auth/refresh   — exchange refresh cookie for new token pair
 *   POST /auth/logout    — revoke server-side refresh token + clear cookie
 */
export function createAuthRoutes(config: AuthConfig): Hono {
  const auth = new Hono();

  const refreshTTL = config.refreshTTL ?? DEFAULT_REFRESH_TTL;
  // SEC-001: cookie path MUST match the product's auth sub-app mount path
  // (e.g., acmd-api passes '/api/v1/auth'). Defaults to '/auth' for legacy
  // consumers that mount via `app.route('/auth', createAuthRoutes(...))`.
  const cookiePath = config.cookiePath ?? DEFAULT_COOKIE_PATH;
  const secureCookie = config.secureCookie ?? true;

  // ------------------------------------------------------------------
  // POST /auth/google
  // Body: { idToken: string }
  // ------------------------------------------------------------------
  auth.post('/google', googleAuthRateLimit, async (c) => {
    let idToken: string;
    try {
      const body = await c.req.json<{ idToken: string }>();
      idToken = body?.idToken;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!idToken || typeof idToken !== 'string') {
      return c.json({ error: 'idToken is required' }, 400);
    }

    // 1. Verify Google token
    let googlePayload;
    try {
      googlePayload = await verifyGoogleToken(idToken, {
        clientId: config.googleClientId,
      });
    } catch {
      // SKILL.md L88: "catch → return 401, never expose error detail"
      return c.json({ error: 'Token verification failed' }, 401);
    }

    // 2. Find or create user
    let user = await config.findUserByGoogleId(googlePayload.google_id);
    if (!user) {
      // New user — product's createUser handles DB insert
      // company_id and role are determined by the product's business logic
      // In practice, createUser may derive company from email domain etc.
      user = await config.createUser({
        google_id: googlePayload.google_id,
        email: googlePayload.email,
        name: googlePayload.name,
        company_id: '', // Product must override this — this default triggers error
        role: 'viewer',
        product: '',
      });
    }

    // 3. Issue token pair
    // RS-013: email/google_id/products are part of the JWT so product apps
    // can authorize without an extra DB round-trip. Callbacks (findUserByGoogleId
    // / createUser) are responsible for populating `products` from
    // auth.user_products.
    const tokenPair = await createTokens(
      {
        sub: user.id,
        company_id: user.company_id,
        role: user.role,
        product: user.product,
        email: user.email,
        google_id: user.google_id,
        products: user.products,
      },
      {
        privateKey: config.privateKey,
        accessTTL: config.accessTTL,
        refreshTTL,
      },
    );

    // 4. Store refresh token hash server-side
    const refreshHash = hashToken(tokenPair.refreshToken);
    const expiresAt = new Date(Date.now() + refreshTTL * 1000);
    await config.tokenCallbacks.storeToken(refreshHash, user.id, expiresAt);

    // 5. Set refresh token as httpOnly cookie
    setCookie(c, REFRESH_COOKIE_NAME, tokenPair.refreshToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'Strict',
      maxAge: refreshTTL,
      path: cookiePath,
    });

    return c.json({ accessToken: tokenPair.accessToken }, 200);
  });

  // ------------------------------------------------------------------
  // POST /auth/refresh
  // Reads refresh token from httpOnly cookie
  // ------------------------------------------------------------------
  auth.post('/refresh', refreshRateLimit, async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      return c.json({ error: 'Refresh token missing' }, 401);
    }

    // Verify, check revocation, rotate
    let newPair;
    try {
      newPair = await rotateRefreshToken(
        refreshToken,
        {
          privateKey: config.privateKey,
          publicKey: config.publicKey,
          accessTTL: config.accessTTL,
          refreshTTL,
        },
        config.tokenCallbacks,
      );
    } catch {
      // Clear the invalid cookie
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: cookiePath });
      return c.json({ error: 'Invalid or revoked refresh token' }, 401);
    }

    // Set new refresh cookie
    setCookie(c, REFRESH_COOKIE_NAME, newPair.refreshToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'Strict',
      maxAge: refreshTTL,
      path: cookiePath,
    });

    return c.json({ accessToken: newPair.accessToken }, 200);
  });

  // ------------------------------------------------------------------
  // POST /auth/logout
  // Revokes refresh token server-side + clears cookie
  // ------------------------------------------------------------------
  auth.post('/logout', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE_NAME);

    // SEC-002: split error handling so DB revoke failures are surfaced as 500,
    // not silently swallowed as 200. Expired/invalid tokens are still a clean
    // logout (client-side cookie cleared), but an unexpected revoke failure
    // (DB error, network timeout, RLS denial) MUST fail loud so operators see
    // orphaned server-side sessions.
    //
    // Order:
    //   1. deleteCookie regardless — browser-side state is always cleaned up
    //      even if the server-side revocation fails (defense-in-depth: a
    //      compromised cookie is better than leaving it in the browser).
    //   2. If a token was presented, verify (tolerate expiry/invalid silently)
    //      then revoke in an ISOLATED try/catch that returns 500 on failure.
    deleteCookie(c, REFRESH_COOKIE_NAME, {
      path: cookiePath,
      secure: secureCookie,
      sameSite: 'Strict',
    });

    if (refreshToken) {
      // Stage 1: structural verification — expired/tampered tokens are a
      // no-op (user is already effectively logged out), NOT a 500.
      //
      // SEC-NEW-003 (ACMD-118-B): capture the decoded payload so the
      // Stage 2 error log can attribute any revoke failure to a specific
      // user_id. Without this, an operator investigating an orphaned
      // server-side session has no way to identify which user it belonged
      // to. `decoded.sub` is the user UUID (opaque, not PII).
      let tokenHash: string | null = null;
      let decodedSub: string | null = null;
      try {
        const decoded = await verifyRefreshToken(refreshToken, {
          publicKey: config.publicKey,
        });
        decodedSub = decoded.sub;
        tokenHash = hashToken(refreshToken);
      } catch {
        // Token expired / tampered / wrong type — client cookie is already
        // cleared above. Nothing to revoke server-side; return clean logout.
        return c.json({ message: 'Logged out successfully' }, 200);
      }

      // Stage 2: server-side revocation — DB/network failures MUST surface.
      try {
        await config.tokenCallbacks.revokeToken(tokenHash);
      } catch (err) {
        // SEC-002 + SEC-NEW-003 (ACMD-118-B): structured audit log for
        // operator forensics. Fields:
        //   - user_id    → who owned the orphaned session
        //   - timestamp  → precise ISO-8601 for timeline correlation
        //   - error_type → class name (e.g. TypeError, DatabaseError) so
        //                  transient vs permanent failures are greppable
        //   - error_message → sanitised Error.message (no stack, no query)
        // MUST NOT log: raw refresh token, its hash, SQL/query text, or
        // any other secret — DB errors can expose schema detail and token
        // hashes are session-bearer equivalents.
        // eslint-disable-next-line no-console
        console.error('[auth] logout revokeToken failed', {
          user_id: decodedSub,
          timestamp: new Date().toISOString(),
          error_type:
            err instanceof Error ? err.constructor.name : typeof err,
          error_message: err instanceof Error ? err.message : String(err),
        });
        return c.json({ error: 'Logout failed' }, 500);
      }
    }

    return c.json({ message: 'Logged out successfully' }, 200);
  });

  return auth;
}
