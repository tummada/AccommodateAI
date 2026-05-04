/**
 * RS-013 — Google OAuth boundary mock (E2E only).
 *
 * We mock the ONE boundary that cannot be automated in a real browser:
 * the Google Identity Services JavaScript SDK. Everything else in the
 * login flow runs through real servers (vollos-core auth-service,
 * acmd-api, acmd-web) so JWKS verification, DB writes, cross-origin
 * cookies, CORS preflights, and refresh rotation all exercise real code.
 *
 * Two layers of interception:
 *
 *   1. Script layer — `installGoogleIdentityMock(page)` serves a stub
 *      `window.google.accounts.id` object in place of the real GIS
 *      script. The stub captures the `callback` registered by
 *      @react-oauth/google's `GoogleLogin` component during
 *      `initialize(...)` and exposes it via `window.__triggerGoogleSignIn`
 *      so tests can fire the credential without clicking Google's iframe.
 *
 *   2. Network layer — `interceptVollosCoreGoogle(page, claims)` routes
 *      `POST http://localhost:3004/auth/google` through the provided
 *      claims. The response is an access token signed with the dev RSA
 *      private key (see test-jwt.ts) plus a `Set-Cookie: refresh_token`
 *      header bound to the :3004 origin with `Path=/auth` — matching
 *      the real vollos-core cookie contract.
 *
 * Paths NOT mocked (intentionally real):
 *   - GET  /api/v1/auth/me              (acmd-api, real JWKS verify)
 *   - POST /api/v1/onboarding           (acmd-api, real DB writes)
 *   - POST http://localhost:3004/auth/refresh
 *   - POST http://localhost:3004/auth/logout
 */
import type { Page } from '@playwright/test';
import { signTestJwt } from './test-jwt';

/**
 * Fake Google ID token handed to LoginPage's `handleGoogleSuccess`. It is
 * passed on to `authRequest('/auth/google', { idToken })`, and our network
 * interceptor (interceptVollosCoreGoogle) returns the real, signed access
 * token — so the opaque string here never reaches a real Google API.
 */
const FAKE_GOOGLE_ID_TOKEN = 'e2e.fake.google.id.token';

/**
 * Install a stub of `window.google.accounts.id` on the page BEFORE any
 * app JavaScript runs (`addInitScript` fires before every new document).
 *
 * Behaviour:
 *   - `initialize({ callback })` captures the callback in a page-global
 *     slot so a test can later fire it with a fake credential.
 *   - `renderButton(container)` renders a regular <button data-testid=
 *     "mock-google-signin"> that, when clicked, calls the captured
 *     callback with a `{ credential: <FAKE_GOOGLE_ID_TOKEN>, select_by }`
 *     object. This matches the shape of a real GIS credentialResponse
 *     so @react-oauth/google's `onSuccessRef.current(...)` receives the
 *     expected fields.
 *   - `prompt()` is a no-op — we don't use One Tap in tests.
 *   - We also bypass the real `https://accounts.google.com/gsi/client`
 *     script load by routing it to an empty 200 response (so that
 *     useLoadGsiScript's onload fires → `scriptLoadedSuccessfully=true`
 *     → GoogleLogin effect runs → `initialize` + `renderButton` hit
 *     our stubs above).
 */
export async function installGoogleIdentityMock(page: Page): Promise<void> {
  await page.route('https://accounts.google.com/gsi/client**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* GIS stubbed by Playwright (RS-013 E2E) */',
    });
  });

  await page.addInitScript(() => {
    // Shared module state: the callback captured during `initialize` is
    // exposed on window so renderButton's click handler and the E2E
    // helper can both fire it independently.
    type GoogleCallback = (credentialResponse: {
      credential: string;
      select_by?: string;
      clientId?: string;
    }) => void;

    const state: { callback: GoogleCallback | null; clientId: string | null } = {
      callback: null,
      clientId: null,
    };

    const idStub = {
      initialize: (opts: { client_id?: string; callback?: GoogleCallback }) => {
        state.callback = opts?.callback ?? null;
        state.clientId = opts?.client_id ?? null;
      },
      renderButton: (container: HTMLElement | null) => {
        if (!container) return;
        container.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-testid', 'mock-google-signin');
        btn.textContent = 'Sign in with Google (E2E mock)';
        btn.addEventListener('click', () => {
          state.callback?.({
            credential: 'e2e.fake.google.id.token',
            select_by: 'btn',
            clientId: state.clientId ?? 'e2e-client',
          });
        });
        container.appendChild(btn);
      },
      prompt: () => {
        /* no-op — One Tap disabled in tests */
      },
      cancel: () => {
        /* no-op */
      },
      disableAutoSelect: () => {
        /* no-op */
      },
    };

    // Attach to window exactly the way real GIS does.
    (window as unknown as { google: { accounts: { id: typeof idStub } } }).google =
      { accounts: { id: idStub } };

    // Optional escape hatch — fire the callback from outside the DOM.
    (window as unknown as { __triggerGoogleSignIn: (cred?: string) => void }).__triggerGoogleSignIn =
      (cred = 'e2e.fake.google.id.token') => {
        state.callback?.({ credential: cred, select_by: 'api', clientId: state.clientId ?? '' });
      };
  });
}

export interface GoogleMockClaims {
  sub: string;
  email: string;
  google_id: string;
  name?: string;
  products: string[];
  /** `true` → response sets onboarding_required true in the payload. */
  onboardingRequired?: boolean;
  /**
   * Optional TTL override — defaults to 15 min. The Scenario 4 test lowers
   * this to force the in-browser 401 → refresh → retry path.
   */
  ttlSeconds?: number;
}

/**
 * Intercept `POST http://localhost:3004/auth/google` and respond with:
 *   - `accessToken`: an RS256-signed JWT whose kid matches vollos-core's
 *     JWKS entry so acmd-api's `verifyAccessTokenRaw` passes.
 *   - `Set-Cookie: refresh_token=e2e-refresh; Path=/auth; HttpOnly;
 *     SameSite=None` — the path MUST be `/auth` (not `/api/v1/auth`)
 *     because /auth/refresh lives on vollos-core at that prefix. The
 *     cookie is bound to the :3004 origin so the browser only sends it
 *     back on subsequent /auth/* calls — matching the real contract.
 *
 * Why SameSite=None instead of Strict (as the real server uses):
 *   Playwright's cross-origin cookie semantics treat Strict cookies set
 *   via `route.fulfill` as session-scoped inside the test context only,
 *   which fails the `refresh` path during Scenario 4. `None; Secure=false`
 *   keeps the cookie travelling on the top-level navigation the dashboard
 *   triggers from :3003 → :3004. The *real* server still issues Strict
 *   cookies — only the mocked /auth/google response differs.
 *
 * Non-mocked origin traffic is passed through unchanged so the rest of
 * the flow (including /auth/refresh, /auth/logout, /me, /onboarding)
 * hits real servers.
 */
export async function interceptVollosCoreGoogle(
  page: Page,
  claims: GoogleMockClaims,
): Promise<void> {
  await page.route('http://localhost:3004/auth/google', async (route) => {
    const req = route.request();

    // CORS preflight — real vollos-core handles this via hono/cors but our
    // stub must answer for the browser's cross-origin OPTIONS request.
    if (req.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3003',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '600',
        },
      });
      return;
    }

    const accessToken = await signTestJwt({
      sub: claims.sub,
      email: claims.email,
      google_id: claims.google_id,
      products: claims.products,
      ...(claims.name !== undefined ? { name: claims.name } : {}),
      ...(claims.ttlSeconds !== undefined ? { ttlSeconds: claims.ttlSeconds } : {}),
    });
    const body = JSON.stringify({
      accessToken,
      onboarding_required: Boolean(claims.onboardingRequired),
    });
    // Path MUST be `/auth` — real vollos-core mounts createAuthRoutes there
    // (see apps/auth-service/src/index.ts:216: cookiePath = '/auth') so a
    // subsequent `POST /auth/refresh` receives the cookie. SameSite=Lax
    // (not Strict) is pragmatic: route.fulfill's synthetic cookie fails
    // Playwright's Strict partitioning on top-level navigation otherwise.
    const setCookie =
      'refresh_token=e2e-refresh-' +
      claims.sub +
      '; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=2592000';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3003',
        'Access-Control-Allow-Credentials': 'true',
        'Set-Cookie': setCookie,
      },
      body,
    });
  });
}

/**
 * Click the stub Google button rendered by `installGoogleIdentityMock`.
 * Kept as a discrete helper so tests can await the in-flight POST
 * /auth/google BEFORE the click fires, avoiding a race where the
 * network interceptor is registered after the request is issued.
 */
export async function clickMockGoogleSignIn(page: Page): Promise<void> {
  await page.getByTestId('mock-google-signin').click();
}

export const __internals = { FAKE_GOOGLE_ID_TOKEN };
