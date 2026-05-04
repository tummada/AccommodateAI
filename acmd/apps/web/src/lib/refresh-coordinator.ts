/**
 * refresh-coordinator — single in-flight refresh Promise.
 *
 * ACMD-116 R2: when many requests hit 401 concurrently, we must call
 * `POST /api/v1/auth/refresh` exactly once and let every caller await the
 * same Promise. Without this, N parallel requests trigger N refreshes,
 * which the backend will partially reject because of refresh-token rotation
 * (only the first rotation wins; the rest see "revoked").
 *
 * The coordinator is intentionally module-level (not per-AuthProvider)
 * because 401 dedup must also span Provider re-mounts and lazy routes.
 * It holds no tokens — only a Promise handle — so it is safe at module
 * scope. The caller passes the actual refresh executor each time, which
 * keeps the coordinator decoupled from api-client / auth-context.
 *
 * SECURITY:
 * - Never stores the access token.
 * - Never logs the access token (returned value is passed through, not
 *   printed).
 * - Never retains a failed Promise beyond the current call (cleared in
 *   finally so a later 401 can try again after backoff/logout decisions).
 */

type RefreshFn = () => Promise<string>;

let inFlight: Promise<string> | null = null;

/**
 * Coalesce concurrent refresh calls into a single shared Promise.
 * Returns the new access token on success. On failure the rejection is
 * re-thrown to every awaiting caller and the shared slot is cleared so
 * the next 401 cycle can decide independently whether to retry.
 */
export function coalesceRefresh(refreshFn: RefreshFn): Promise<string> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      return await refreshFn();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Test-only helper — clears any in-flight refresh. Not exported from the
 * public index so production code cannot accidentally reset state mid-flight.
 */
export function __resetRefreshCoordinatorForTests(): void {
  inFlight = null;
}
