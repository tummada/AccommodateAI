/**
 * Landing page API client. Talks ONLY to acmd-api at the
 * accommodate-api.vollos.ai subdomain (Architecture Rule A1/A3 — multi-repo
 * isolation, no cross-repo imports). The base URL is read from VITE_API_URL
 * at build time so the same bundle can target dev (localhost:3101) and
 * production (accommodate-api.vollos.ai) with the standard Vite mode flag.
 *
 * Contract source of truth: apps/api/src/routes/beta-signup.ts
 *  - Request body: { token: string, email: string }  (NOT invite_token)
 *  - 200 + { status: "redeemed", message }              → full Beta redemption
 *  - 202 + { status: "waitlisted", message, waitlistId } → cap full
 *  - 400 + { error: <string> }                          → invalid / expired / used / validation
 *  - 429 + { error: "Too many requests", retryAfter }   → rate limited
 *  - 500 + { error: <string> }                          → server-side failure
 *
 * The backend never emits 409 / 410 / 422 / 503 — earlier T-060 mapping that
 * branched on those codes was dead code. T-069 removes it and maps off the
 * actual {status, error} body strings.
 */

const RAW_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3101';

// Strip trailing slash so callers can append `/api/v1/...` without doubling.
const BASE_URL = RAW_BASE_URL.replace(/\/$/, '');

if (import.meta.env.DEV && !import.meta.env.VITE_API_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[acmd-landing] VITE_API_URL is not set — falling back to http://localhost:3101. ' +
      'Copy .env.example to .env.local and set the right value for your environment.',
  );
}

export type BetaSignupRequest = {
  email: string;
  /**
   * Beta invite token. Sent as the `token` JSON field — backend Zod schema
   * accepts only that key (apps/api/src/routes/beta-signup.ts:L126-L131).
   * Tokens are URL-safe (RFC 4648 §5 base64url alphabet) — keep case as
   * issued; do NOT toUpperCase() on the wire.
   */
  token: string;
};

export type BetaSignupErrorCode =
  | 'invalid_token'
  | 'token_expired'
  | 'token_used'
  | 'rate_limited'
  | 'validation_error'
  | 'server_error'
  | 'network_error';

export type RedemptionResult = {
  ok: true;
  status: 'redeemed';
};

export type WaitlistedResult = {
  ok: true;
  status: 'waitlisted';
  waitlistId: string | null;
  message: string;
};

export type BetaSignupErrorResult = {
  ok: false;
  code: BetaSignupErrorCode;
  message: string;
};

export type BetaSignupResult =
  | RedemptionResult
  | WaitlistedResult
  | BetaSignupErrorResult;

/**
 * Map an HTTP response (or network failure) to a UX-ready BetaSignupResult.
 *
 * Per acmd-ux brief §5.4 ("Submit fail" copy) and the verified backend
 * contract above:
 *   200 + { status: "redeemed" }     → full redemption
 *   202 + { status: "waitlisted" }   → waitlisted (do NOT redirect)
 *   400 + error message text         → invalid / expired / used / validation
 *   429                              → rate limited
 *   5xx / parse-fail / network       → server_error / network_error
 */
async function mapResponseToResult(
  response: Response | null,
  networkError?: unknown,
): Promise<BetaSignupResult> {
  if (response === null) {
    return {
      ok: false,
      code: 'network_error',
      message:
        'Something went wrong. Please try again, or email beta@accommodate.vollos.ai.',
    };
  }

  // Best-effort body parse for both success and error paths. Backend always
  // emits JSON so a parse failure means the response is malformed.
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }

  const status = response.status;
  const errorText = readErrorText(body);

  if (status === 200) {
    return { ok: true, status: 'redeemed' };
  }

  if (status === 202) {
    const waitlistId = readWaitlistId(body);
    const baseMessage =
      "You're on the waitlist — we'll email you when capacity opens.";
    const message =
      waitlistId !== null
        ? `You're on the waitlist (#${waitlistId}). We'll email you when capacity opens.`
        : baseMessage;
    return {
      ok: true,
      status: 'waitlisted',
      waitlistId,
      message,
    };
  }

  if (status === 400) {
    if (/expired/i.test(errorText)) {
      return {
        ok: false,
        code: 'token_expired',
        message: 'This Beta token has expired.',
      };
    }
    if (/already been used|already used/i.test(errorText)) {
      return {
        ok: false,
        code: 'token_used',
        message: 'This Beta token has already been used.',
      };
    }
    if (/invalid invite token|invalid token/i.test(errorText)) {
      return {
        ok: false,
        code: 'invalid_token',
        message:
          "That token isn't valid. Check your invite email or email beta@accommodate.vollos.ai.",
      };
    }
    // Validation failed / Invalid JSON body / unknown 400 — friendly fallback.
    return {
      ok: false,
      code: 'validation_error',
      message: 'Please check your email and token format.',
    };
  }

  if (status === 429) {
    return {
      ok: false,
      code: 'rate_limited',
      message: 'Too many attempts. Please try again in an hour.',
    };
  }

  // Suppress unused-variable lint without leaking the original error to UI —
  // we only use it to decide between network vs server failure.
  void networkError;
  return {
    ok: false,
    code: 'server_error',
    message:
      'Something went wrong. Please try again, or email beta@accommodate.vollos.ai.',
  };
}

/** Best-effort extract `error` field as string (backend shape is `{error: string}`). */
function readErrorText(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const raw = (body as { error: unknown }).error;
    if (typeof raw === 'string') return raw;
  }
  return '';
}

/** Best-effort extract `waitlistId` from a 202 response body. */
function readWaitlistId(body: unknown): string | null {
  if (body && typeof body === 'object' && 'waitlistId' in body) {
    const raw = (body as { waitlistId: unknown }).waitlistId;
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return null;
}

/**
 * Detect the Global Privacy Control browser signal (CCPA §1798.135 — CPPA
 * 2026 enforcement vector). When set we forward the standard `Sec-GPC: 1`
 * request header so the backend can record the opt-out preference.
 *
 * Public reference: https://globalprivacycontrol.org/
 */
function isGpcEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true;
}

export function getGpcHeaders(): Record<string, string> {
  return isGpcEnabled() ? { 'Sec-GPC': '1' } : {};
}

export async function submitBetaSignup(
  payload: BetaSignupRequest,
): Promise<BetaSignupResult> {
  let response: Response | null = null;
  try {
    response = await fetch(`${BASE_URL}/api/v1/beta-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...getGpcHeaders(),
      },
      body: JSON.stringify({
        // Field names MUST match backend Zod schema
        // (apps/api/src/routes/beta-signup.ts:L126-L131): { token, email }.
        token: payload.token.trim(),
        email: payload.email.trim(),
      }),
    });
    return await mapResponseToResult(response);
  } catch (err) {
    return mapResponseToResult(null, err);
  }
}

/**
 * URL of the dashboard /login page on the sibling subdomain. Read from
 * VITE_WEB_URL at build time; default points at the production host so an
 * accidentally-unset value in CI still ends up at the correct page.
 */
export const WEB_LOGIN_URL = `${(
  import.meta.env.VITE_WEB_URL ?? 'https://accommodate-app.vollos.ai'
).replace(/\/$/, '')}/login`;
