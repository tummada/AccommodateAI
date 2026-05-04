/**
 * Default MSW handlers for ACMD-116 tests.
 *
 * Individual tests override these via `server.use(...)` to simulate
 * 401, 500, network errors, etc. The baseline is "unauthenticated" so
 * a test that forgets to override `/auth/refresh` fails closed rather
 * than silently succeeding.
 */
import { http, HttpResponse } from 'msw';

// RS-013: api-client was split. acmd-api (data + /me) and vollos-core
// (auth) run at different origins; tests mirror that with two MSW bases.
const API = 'http://localhost:3000'; // acmd-api (data + /me)
const AUTH = 'http://localhost:3002'; // vollos-core auth-service

/**
 * Mint a plausible JWT access token string for tests that need a
 * Bearer token to pass through the api-client. Signature is intentionally
 * fake — the frontend never verifies it (ACMD-124 removed the client-side
 * decoder; the payload is here purely so HTTP logs look realistic).
 */
export function makeFakeAccessToken(
  overrides: Partial<{
    sub: string;
    email: string;
    name: string;
    role: string;
    company_id: string;
  }> = {},
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: overrides.sub ?? 'user-123',
    email: overrides.email ?? 'hr@example.com',
    name: overrides.name ?? 'HR Admin',
    role: overrides.role ?? 'hr_admin',
    company_id: overrides.company_id ?? 'company-abc',
    product: 'acmd',
    token_type: 'access',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };
  const b64 = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64(header)}.${b64(payload)}.sig`;
}

export const defaultHandlers = [
  // RS-013: refresh + logout now served by vollos-core at AUTH origin.
  // Default = 401 so bootstrap probes fail closed unless a test
  // overrides with a happy-path handler.
  http.post(`${AUTH}/auth/refresh`, () =>
    HttpResponse.json({ error: 'Refresh token missing' }, { status: 401 }),
  ),
  http.post(`${AUTH}/auth/logout`, () =>
    HttpResponse.json({ message: 'Logged out successfully' }, { status: 200 }),
  ),
  // ACMD-124: /me defaults to a valid response so existing tests that
  // synthetically call login() (logout + broadcast-sync tests) don't
  // need to know about the new /me round-trip. Individual bootstrap
  // tests override this to simulate 401 / network error scenarios.
  //
  // RS-013: /me now returns an envelope `{ onboarding_required, profile }`
  // that matches apps/api/src/routes/auth.ts. Tests that want to assert
  // the onboarded user shape use `profile: { id, email, name, role,
  // companyId }`; the onboarding-required variant uses
  // `profile: { user_id, email, name, google_id }`.
  http.get(`${API}/api/v1/auth/me`, () =>
    HttpResponse.json(
      {
        onboarding_required: false,
        profile: {
          id: 'user-default',
          email: 'default@example.com',
          name: 'Default User',
          role: 'super_admin',
          companyId: 'company-default',
        },
      },
      { status: 200 },
    ),
  ),
];
