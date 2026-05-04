// @acmd/api — Cookie Path Constants
//
// SEC-NEW-001 (ACMD-118-A): Single source of truth for the ACMD refresh-
// cookie Path attribute. acmd-api mounts the auth sub-app at
// `/api/v1/auth` (see `src/index.ts`), and the refresh cookie Path MUST
// match that mount path exactly. Prior to this file the path was
// duplicated as two inline string literals (in `routes/auth.ts`) plus the
// `@acmd/auth` library default of `/auth`, which was the root cause of
// SEC-001 (silent logout desync). Consolidating here prevents any future
// drift: change once, every `setCookie` / `deleteCookie` / `cookiePath`
// config follows.
//
// ⚠️ If you change this constant, you MUST also update the Hono mount
// point in `src/index.ts` (app.route('/api/v1/auth', ...)) or refresh/
// logout will stop working.

/**
 * Path attribute used for the ACMD refresh-token cookie.
 *
 * Mirrors the Hono mount point at `apps/acmd-api/src/index.ts` so that
 * browsers only send the refresh cookie to the auth sub-app and nowhere
 * else. See SEC-001 / SEC-NEW-001 for the failure modes this prevents.
 */
export const ACMD_AUTH_COOKIE_PATH = '/api/v1/auth' as const;
