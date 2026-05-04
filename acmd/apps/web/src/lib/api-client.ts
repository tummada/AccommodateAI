/**
 * API client — fetch wrapper for the ACMD backend.
 *
 * ACMD-116: this module implements the 2-tier token flow.
 *
 *  1. `apiRequest` — low-level fetch that attaches the Authorization header
 *     (if a token is given) and ALWAYS sends credentials so the refresh
 *     cookie travels with every request.
 *
 *  2. `createAuthenticatedClient` — higher-level wrapper that:
 *       - reads the access token through a getter (stale-closure guard,
 *         ACMD-116 R4)
 *       - on 401, calls the refresh coordinator exactly once per burst
 *         (dedup, ACMD-116 R2)
 *       - retries the original request with the new token one time only
 *       - on refresh failure / "refresh → 401" loops, logs out exactly
 *         once (ACMD-116 infinite-loop guard)
 *
 * SECURITY:
 * - `credentials: 'include'` is mandatory so the browser sends the
 *   httpOnly refresh cookie. Backend CORS whitelist + SameSite=Strict
 *   keep this safe against CSRF.
 * - The refresh endpoint path is hard-coded to match backend
 *   `ACMD_AUTH_COOKIE_PATH` (`/api/v1/auth`) so the browser includes
 *   the cookie on refresh/logout.
 * - Access tokens never touch JS storage — they flow through the React
 *   state holder exposed by AuthProvider via a getter function.
 * - Error bodies are normalised to `{ code, message }` (SEC-004 hold-over
 *   from the previous ACMD-115 client) so raw server errors never leak
 *   into toasts / Sentry / the console.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

// SEC-002: enforce https:// in production builds. DEV still allows
// http://localhost for vite + backend on the same box.
if (import.meta.env.PROD && BASE_URL && !BASE_URL.startsWith('https://')) {
  throw new Error(
    `[api-client] Insecure VITE_API_BASE_URL in production build: "${BASE_URL}". ` +
      'Production builds must use https://.',
  );
}

// RS-013 (Phase 3 — api-client split):
// Auth endpoints (/auth/google, /auth/refresh, /auth/logout) moved from
// acmd-api to the shared vollos-core auth-service. Data endpoints (incl.
// /api/v1/auth/me) still live on acmd-api. The two services therefore
// run at different origins — AUTH_BASE_URL is used for auth traffic and
// BASE_URL for everything else.
//
// SEC-002 parity: the same https:// guard applies to AUTH_BASE_URL so a
// production build can never ship a plain-http auth endpoint.
export const AUTH_BASE_URL = (import.meta.env.VITE_VOLLOS_AUTH_URL ?? '').replace(/\/$/, '');

if (import.meta.env.PROD && AUTH_BASE_URL && !AUTH_BASE_URL.startsWith('https://')) {
  throw new Error(
    `[api-client] Insecure VITE_VOLLOS_AUTH_URL in production build: "${AUTH_BASE_URL}". ` +
      'Production builds must use https://.',
  );
}

// Paths served by vollos-core auth-service (prefix: AUTH_BASE_URL).
// Mount contract: vollos-core mounts createAuthRoutes() at the service
// root, so the public paths are /auth/google, /auth/refresh, /auth/logout.
export const GOOGLE_PATH = '/auth/google';
export const AUTH_REFRESH_PATH = '/auth/refresh';
export const AUTH_LOGOUT_PATH = '/auth/logout';

/**
 * Aggregated export for callers that prefer an object over named constants.
 * Kept alongside the individual constants so existing `import { AUTH_REFRESH_PATH }`
 * forms keep working — both reference the same source of truth.
 */
export const AUTH_URLS = {
  GOOGLE_PATH,
  AUTH_REFRESH_PATH,
  AUTH_LOGOUT_PATH,
} as const;

// ACMD-124: shared path constant for GET /auth/me — used by
// auth-context bootstrap + login. Hard-coded to match the backend
// mount in apps/acmd-api/src/index.ts (ACMD_AUTH_COOKIE_PATH + '/me').
// RS-013: /me STAYS on acmd-api (BASE_URL) — it reads product-specific
// onboarding state that only acmd-api knows about.
export const ME_PATH = '/api/v1/auth/me';

// RS-013: POST /api/v1/onboarding — creates the acmd_users + acmd_companies
// rows for a newly-authenticated vollos-core user. Body: { name, companyName? }.
// email / google_id / user_id come from the JWT and MUST NOT be sent by the
// client (see apps/api/src/routes/onboarding.ts).
export const ONBOARDING_PATH = '/api/v1/onboarding';

/**
 * ApiError — thrown for non-2xx responses.
 *
 * SEC-004: `details` is a whitelisted shape ({ code, message }) and never
 * the raw server body.
 */
export interface ApiErrorDetails {
  code: string;
  message: string;
}

export class ApiError extends Error {
  public readonly details: ApiErrorDetails;

  constructor(
    public status: number,
    public code: string,
    message: string,
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = 'ApiError';
    this.details = details ?? { code, message };
  }
}

/**
 * NetworkError — distinguishes a transient connectivity failure (no
 * response at all) from a real 4xx/5xx.  The bootstrap flow (ACMD-116 R3)
 * uses this to avoid flashing the login screen when the user's wifi
 * blipped between app mount and `/auth/refresh` resolving.
 */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  token?: string | null;
}

/**
 * Internal: perform a fetch against a specific base URL. Shared by
 * `apiRequest` (BASE_URL → acmd-api) and `authRequest` (AUTH_BASE_URL →
 * vollos-core).
 *
 * RS-013: Split kept intentionally thin — the cookie/credential + error
 * normalisation logic must be identical on both sides so callers do not
 * have to reason about which service they are hitting. The ONLY
 * difference is the base URL prefix and the env-var consistency check.
 */
async function requestWithBase<T>(
  baseUrl: string,
  baseUrlLabel: string,
  path: string,
  options: RequestOptions,
): Promise<T> {
  const { body, token, headers, ...rest } = options;
  if (!baseUrl) {
    // Fail loud — a missing env var should never fall back to "same origin"
    // because we would silently ship auth traffic to the wrong service in
    // production (RS-013 Edge case #3).
    throw new Error(
      `[api-client] ${baseUrlLabel} is not configured. Set the corresponding ` +
        'environment variable in .env.local (dev) or the deploy pipeline (prod).',
    );
  }
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  if (body !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  if (token) {
    finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      // ACMD-116 + RS-013: cookies must travel for refresh-token flows.
      // Cross-origin cookies require credentials:'include' + the auth
      // server to allow the acmd-web origin via Access-Control-Allow-Origin
      // (explicit, not wildcard) and Access-Control-Allow-Credentials:true.
      credentials: 'include',
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // fetch() only rejects on true network failures (DNS, offline, CORS
    // preflight abort). Convert to NetworkError so callers can distinguish.
    throw new NetworkError('Network request failed', err);
  }

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    // T-118: backend handlers vary in error envelope shape — some return
    // `{ code, message }` (the agreed format), others legacy `{ error: '...' }`
    // (e.g. apps/api/src/routes/onboarding.ts:178-184 returns `{ error:
    // 'beta_invite_required' }` for the beta-gate). Read both so callers can
    // dispatch on a stable `code` regardless of which envelope landed.
    const code =
      (data as { code?: string } | null)?.code
      ?? (typeof (data as { error?: unknown } | null)?.error === 'string'
        ? ((data as { error: string }).error)
        : null)
      ?? `HTTP_${response.status}`;
    const message =
      (data as { message?: string } | null)?.message ?? mapStatusToMessage(response.status);
    throw new ApiError(response.status, code, message, { code, message });
  }

  return data as T;
}

/**
 * apiRequest — fetch wrapper prefixed with VITE_API_BASE_URL (acmd-api).
 * Use for /api/v1/auth/me and every product data endpoint.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestWithBase<T>(BASE_URL, 'VITE_API_BASE_URL', path, options);
}

/**
 * authRequest — fetch wrapper prefixed with VITE_VOLLOS_AUTH_URL
 * (vollos-core auth-service). Use ONLY for /auth/google, /auth/refresh,
 * /auth/logout. Cookies are sent cross-origin; vollos-core must whitelist
 * the acmd-web origin in CORS.
 */
export async function authRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestWithBase<T>(AUTH_BASE_URL, 'VITE_VOLLOS_AUTH_URL', path, options);
}

/**
 * Authenticated client factory.
 *
 * Called from AuthProvider with three dependencies:
 *  - `getAccessToken()` — always returns the LATEST in-memory token
 *    (stale closure guard, R4).
 *  - `onTokenRefreshed(token)` — writes a new token into React state.
 *  - `onAuthLost()` — called exactly once when refresh fails or the
 *    refresh endpoint itself returns 401 (infinite-loop guard).
 */
export interface AuthenticatedClientDeps {
  getAccessToken: () => string | null;
  onTokenRefreshed: (accessToken: string) => void;
  onAuthLost: () => void;
  /** Injected for tests; coalesceRefresh by default. */
  coalesceRefresh?: (fn: () => Promise<string>) => Promise<string>;
}

export interface AuthenticatedClient {
  request: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  /** Directly call the refresh endpoint — shared by bootstrap + 401 handler. */
  refreshOnce: () => Promise<string>;
}

import { coalesceRefresh as defaultCoalesce } from './refresh-coordinator';

export function createAuthenticatedClient(deps: AuthenticatedClientDeps): AuthenticatedClient {
  const { getAccessToken, onTokenRefreshed, onAuthLost } = deps;
  const coalesce = deps.coalesceRefresh ?? defaultCoalesce;

  const refreshOnce = (): Promise<string> =>
    coalesce(async () => {
      // Call /auth/refresh directly — cannot use `request` here because
      // we must never recursively try to refresh the refresh call.
      interface RefreshResponse {
        accessToken: string;
      }
      let data: RefreshResponse;
      try {
        // RS-013: /auth/refresh lives on vollos-core (AUTH_BASE_URL) —
        // NOT acmd-api. Use authRequest so the right origin (and cookie
        // scope) is hit.
        data = await authRequest<RefreshResponse>(AUTH_REFRESH_PATH, { method: 'POST' });
      } catch (err) {
        // ACMD-116 infinite-loop guard: if refresh itself returns 401/403
        // the session is irrecoverable. We do NOT attempt another refresh.
        // NetworkError bubbles up unchanged so the bootstrap path can
        // distinguish "server said no" from "offline".
        throw err;
      }
      if (!data?.accessToken) {
        throw new ApiError(500, 'REFRESH_BAD_RESPONSE', 'Refresh response missing access token');
      }
      onTokenRefreshed(data.accessToken);
      return data.accessToken;
    });

  const request = async <T>(
    path: string,
    options: Omit<RequestOptions, 'token'> = {},
  ): Promise<T> => {
    // R4: always read the latest token via getter — never capture it.
    const token = getAccessToken();
    try {
      return await apiRequest<T>(path, { ...options, token });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        throw err;
      }

      // Got a 401 — try to refresh once.
      let newToken: string;
      try {
        newToken = await refreshOnce();
      } catch (refreshErr) {
        // Refresh failed (either 401/403 from backend, or NetworkError).
        // For 4xx we must logout. For NetworkError we also logout because
        // the user is already past bootstrap; the original request is
        // unrecoverable without a fresh token.
        onAuthLost();
        throw refreshErr instanceof Error ? refreshErr : new Error(String(refreshErr));
      }

      // Retry the original request exactly once with the new token.
      // R4: pass the freshly-refreshed token explicitly — do not rely on
      // getAccessToken() here because the caller's React state may not
      // have flushed yet.
      try {
        return await apiRequest<T>(path, { ...options, token: newToken });
      } catch (retryErr) {
        if (retryErr instanceof ApiError && retryErr.status === 401) {
          // Refresh "succeeded" but the retry still 401 — this should
          // never happen in practice (would mean the new token is
          // already invalid). Treat as auth lost.
          onAuthLost();
        }
        throw retryErr;
      }
    }
  };

  return { request, refreshOnce };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapStatusToMessage(status: number): string {
  switch (status) {
    case 400:
      return 'The request was invalid. Please check your input and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'The requested resource was not found.';
    case 409:
      return 'This record already exists.';
    case 429:
      return 'Too many requests. Please try again shortly.';
    case 500:
    case 502:
    case 503:
      return 'The server is temporarily unavailable. Please try again later.';
    default:
      return 'An unexpected error occurred.';
  }
}
