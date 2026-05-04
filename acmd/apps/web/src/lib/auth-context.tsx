import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  AUTH_LOGOUT_PATH,
  AUTH_REFRESH_PATH,
  ME_PATH,
  NetworkError,
  apiRequest,
  authRequest,
  createAuthenticatedClient,
  type AuthenticatedClient,
} from './api-client';
import { createAuthBroadcast, type AuthBroadcastHandle } from './auth-broadcast';

// Module-level singleton to deduplicate concurrent /refresh calls.
// React StrictMode fires useEffect twice simultaneously in dev mode.
// Without this, two concurrent refresh requests would cause the server
// to rotate the token on the first call and invalidate it for the second,
// producing a spurious 401 → unauthenticated redirect.
let _pendingRefreshPromise: Promise<{ accessToken: string } | null> | null = null;

function deduplicatedRefresh(): Promise<{ accessToken: string } | null> {
  if (!_pendingRefreshPromise) {
    // RS-013: refresh is served by vollos-core at AUTH_BASE_URL, not
    // acmd-api. Use authRequest so the correct origin + cookie scope
    // are hit during bootstrap.
    _pendingRefreshPromise = authRequest<{ accessToken: string }>(AUTH_REFRESH_PATH, {
      method: 'POST',
      // Intentionally no AbortSignal — the promise is shared across both
      // StrictMode invocations. If Effect 1 aborts its signal, Effect 2
      // still needs the same underlying request to complete.
    })
      .finally(() => {
        _pendingRefreshPromise = null;
      });
  }
  return _pendingRefreshPromise;
}

/**
 * TEST ONLY — reset the module-level deduplication singleton between tests.
 * Needed because module state persists across test cases in Vitest; a
 * never-resolving promise from one test (e.g. ProtectedRoute pending test)
 * would otherwise bleed into subsequent tests.
 */
export function __resetPendingRefresh(): void {
  _pendingRefreshPromise = null;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  companyId: string;
  name?: string;
  avatarUrl?: string;
  onboardingRequired?: boolean;
  /**
   * T-118 / T-101: backend signals `needs_beta_invite: true` on /me when the
   * user has authenticated via Google but has no matching beta-redemption
   * row. The FE uses this to route the user to /redeem-invite (mandatory
   * gate) BEFORE evaluating onboardingRequired. Field is optional because
   * onboarded users (and never-needed-beta-invite cases) omit it.
   */
  needsBetaInvite?: boolean;
}

/**
 * RS-013: hints returned by /me when the user still needs onboarding.
 *
 * Backend envelope for an onboarding-required user is:
 *   { onboarding_required: true,
 *     profile: { user_id, email, name, google_id } }
 *
 * `name` can be empty — vollos-core's JWT does not carry a display name by
 * design. `google_id` is opaque to the frontend; we keep it only for
 * symmetry with backend responses and do NOT send it back in any POST.
 */
export interface OnboardingHints {
  userId: string;
  email: string;
  name: string;
  googleId?: string;
}

/**
 * RS-013: internal normalized /me shape.
 *
 * The backend returns an envelope `{ onboarding_required, profile }`
 * where the `profile` fields differ depending on onboarding status
 * (see apps/api/src/routes/auth.ts):
 *   - onboardingRequired=false → profile: { id, email, name, role, companyId }
 *   - onboardingRequired=true  → profile: { user_id, email, name, google_id }
 *
 * We flatten both shapes into `MeResponse`; callers use
 * `onboardingRequired` to branch (when true, role/companyId/id are blank
 * because the acmd_users row does not exist yet).
 */
interface MeResponse {
  /** acmd_users.id when onboarded, JWT.sub when not. Always a user id. */
  userId: string;
  email: string;
  name: string;
  /** '' when onboardingRequired=true — acmd_users row has no role yet. */
  role: string;
  /** '' when onboardingRequired=true — company has not been created yet. */
  companyId: string;
  onboardingRequired: boolean;
  /** Only present when onboardingRequired=true — for form prefill. */
  googleId?: string;
  /**
   * T-118 / T-101: backend includes `needs_beta_invite: true` when the user
   * authenticated successfully but has no acmd.beta_invite_redemption_log
   * row claiming their email. FE routes them to /redeem-invite. Absent /
   * undefined for onboarded users.
   */
  needsBetaInvite?: boolean;
}

function userFromMe(me: MeResponse, override?: Partial<AuthUser>): AuthUser {
  return {
    id: me.userId,
    email: me.email,
    name: me.name,
    role: me.role,
    companyId: me.companyId,
    onboardingRequired: override?.onboardingRequired ?? me.onboardingRequired,
    ...(me.needsBetaInvite !== undefined
      ? { needsBetaInvite: me.needsBetaInvite }
      : {}),
  };
}

/**
 * ACMD-116 bootstrap lifecycle — `pending` during the initial refresh
 * probe, then either `authenticated` (refresh cookie was valid) or
 * `unauthenticated` (no cookie / expired / revoked).
 *
 * `network_error` is a transient state used only during bootstrap when
 * we cannot reach the backend at all (offline, DNS down). This is
 * intentionally NOT the same as `unauthenticated` — flashing the login
 * page when the user just lost wifi for a second would be a UX bug.
 */
export type BootstrapState = 'pending' | 'authenticated' | 'unauthenticated' | 'network_error';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  bootstrap: BootstrapState;
  /**
   * RS-013: profile hints used by OnboardingPage to prefill the form.
   * Populated from /me when `onboarding_required: true`; `null` for
   * already-onboarded users so a stale prefill never leaks across
   * sessions.
   */
  onboardingHints: OnboardingHints | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  /**
   * Called by LoginPage after POST /auth/google. The refresh cookie is
   * already set by the backend at this point.
   *
   * ACMD-124: now fetches GET /auth/me so the user object contains the
   * real name/email from the server (instead of decoding the access
   * token on the client). Throws on /me failure so LoginPage can
   * surface the error to the user.
   *
   * T-118: returns the resolved AuthUser so LoginPage can synchronously
   * inspect `needsBetaInvite` (and `onboardingRequired`) for routing
   * without waiting for the React state update to flush.
   */
  login: (accessToken: string, onboardingRequired: boolean) => Promise<AuthUser>;
  /**
   * Full logout — calls backend /auth/logout, clears local state, and
   * broadcasts to sibling tabs. Resolves after local state is cleared;
   * backend failures are swallowed so the user can always escape.
   */
  logout: () => Promise<void>;
  /**
   * RS-013: re-fetch GET /me and update the in-memory user + onboarding
   * hints. Called by OnboardingPage after a successful POST /onboarding
   * so the OnboardingGuard releases the user into the dashboard. Throws
   * on /me failure so the caller can surface the error.
   */
  refreshMe: () => Promise<AuthUser>;
  /**
   * Authenticated fetch wrapper bound to the current AuthProvider. Use
   * this (via `useApiClient`) for every call that needs a bearer token;
   * it handles the 401 → refresh → retry dance automatically.
   */
  client: AuthenticatedClient;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const BOOTSTRAP_TIMEOUT_MS = 5_000;
const BOOTSTRAP_RETRY_DELAY_MS = 400;

/**
 * ACMD-124: fetch the current user profile from GET /api/v1/auth/me.
 *
 * This replaces the ACMD-116 client-side JWT decode stopgap — the
 * access token payload only carries opaque identifiers (sub, role,
 * companyId) so name/email MUST come from a server round-trip.
 *
 * SECURITY:
 * - Uses Authorization: Bearer <token> — no cookies involved.
 * - Validates the payload shape before handing it to React state so a
 *   compromised proxy cannot inject arbitrary fields into the user
 *   object.
 */
async function fetchMe(accessToken: string, init?: { signal?: AbortSignal }): Promise<MeResponse> {
  const raw = await apiRequest<unknown>(ME_PATH, {
    method: 'GET',
    token: accessToken,
    signal: init?.signal,
  });
  if (!raw || typeof raw !== 'object') {
    throw new ApiError(500, 'ME_BAD_RESPONSE', 'Profile response was not an object');
  }
  const obj = raw as Record<string, unknown>;

  // RS-013: backend envelope — { onboarding_required, profile }.
  // When the acmd_users row does not exist (onboarding_required=true)
  // the profile contains { user_id, email, name, google_id }; when the
  // row exists it contains { id, email, name, role, companyId }.
  if (
    typeof obj.onboarding_required !== 'boolean' ||
    !obj.profile ||
    typeof obj.profile !== 'object'
  ) {
    throw new ApiError(500, 'ME_BAD_RESPONSE', 'Profile response missing envelope');
  }
  const onboardingRequired = obj.onboarding_required;
  // T-118: validate optional needs_beta_invite envelope field. Reject any
  // non-boolean shape (e.g. truthy string) so a compromised proxy cannot
  // bypass the gate by sending `needs_beta_invite: 0`. Absent = undefined.
  const needsBetaInviteRaw = obj.needs_beta_invite;
  if (needsBetaInviteRaw !== undefined && typeof needsBetaInviteRaw !== 'boolean') {
    throw new ApiError(500, 'ME_BAD_RESPONSE', 'needs_beta_invite must be boolean');
  }
  const needsBetaInvite =
    typeof needsBetaInviteRaw === 'boolean' ? needsBetaInviteRaw : undefined;
  const p = obj.profile as Record<string, unknown>;
  const email = typeof p.email === 'string' ? p.email : undefined;
  const name = typeof p.name === 'string' ? p.name : undefined;
  if (email === undefined || name === undefined) {
    throw new ApiError(500, 'ME_BAD_RESPONSE', 'Profile missing email or name');
  }

  if (onboardingRequired) {
    const userId = typeof p.user_id === 'string' ? p.user_id : undefined;
    if (userId === undefined) {
      throw new ApiError(500, 'ME_BAD_RESPONSE', 'Onboarding hints missing user_id');
    }
    const googleId = typeof p.google_id === 'string' ? p.google_id : undefined;
    return {
      userId,
      email,
      name,
      role: '',
      companyId: '',
      onboardingRequired: true,
      ...(googleId !== undefined ? { googleId } : {}),
      ...(needsBetaInvite !== undefined ? { needsBetaInvite } : {}),
    };
  }

  // onboarded branch — require the full acmd_users columns.
  const id = typeof p.id === 'string' ? p.id : undefined;
  const role = typeof p.role === 'string' ? p.role : undefined;
  const companyId = typeof p.companyId === 'string' ? p.companyId : undefined;
  if (id === undefined || role === undefined || companyId === undefined) {
    throw new ApiError(500, 'ME_BAD_RESPONSE', 'Profile missing required fields');
  }
  return {
    userId: id,
    email,
    name,
    role,
    companyId,
    onboardingRequired: false,
    ...(needsBetaInvite !== undefined ? { needsBetaInvite } : {}),
  };
}

/**
 * AuthProvider — owns the in-memory access token, bootstraps the session
 * from the refresh cookie, and coordinates cross-tab logout.
 *
 * SECURITY: the JWT lives ONLY in React state + a ref used by the client
 * factory. It is never written to localStorage, sessionStorage, cookies,
 * or IndexedDB. The ref exists purely to defeat stale closures inside
 * createAuthenticatedClient.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    bootstrap: 'pending',
    onboardingHints: null,
  });

  // ACMD-116 R4: the ref is the source of truth for createAuthenticatedClient
  // so concurrent 401 retries always use the freshest token rather than a
  // closed-over React state snapshot.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    tokenRef.current = state.token;
  }, [state.token]);

  // Broadcast channel ref — managed entirely by the useEffect below so that
  // React StrictMode's cleanup/remount cycle always gets a fresh channel.
  // The ref is kept for synchronous access from logout() (postLogout call).
  const broadcastRef = useRef<AuthBroadcastHandle | null>(null);

  const clearLocalState = useCallback(() => {
    tokenRef.current = null;
    setState({
      user: null,
      token: null,
      bootstrap: 'unauthenticated',
      onboardingHints: null,
    });
  }, []);

  /**
   * Internal: swap in a freshly refreshed access token WITHOUT refetching
   * the profile. This is the silent-refresh path — an already-logged-in
   * user's 401 → refresh → retry loop in api-client. The user shell is
   * preserved from whatever the last /me call populated; only the token
   * changes.
   *
   * ACMD-124: previously this function would re-derive the user from
   * the JWT payload. The stopgap decoder is gone, so we keep the
   * existing user object untouched here — the profile only updates on
   * bootstrap, login, or an explicit /me refresh.
   */
  const setAccessToken = useCallback((accessToken: string) => {
    tokenRef.current = accessToken;
    setState((prev) => ({
      user: prev.user,
      token: accessToken,
      bootstrap: 'authenticated',
      onboardingHints: prev.onboardingHints,
    }));
  }, []);

  const onAuthLost = useCallback(() => {
    clearLocalState();
  }, [clearLocalState]);

  // Build the authenticated client exactly once. It reads the token
  // through tokenRef so it never captures a stale value.
  const client = useMemo<AuthenticatedClient>(
    () =>
      createAuthenticatedClient({
        getAccessToken: () => tokenRef.current,
        onTokenRefreshed: setAccessToken,
        onAuthLost,
      }),
    [setAccessToken, onAuthLost],
  );

  // --- Bootstrap: refresh probe on mount -----------------------------------
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // ACMD-116 R5: 5s hard cap — after this we fall through to
      // unauthenticated so the user is not stuck behind a skeleton.
      controller.abort();
    }, BOOTSTRAP_TIMEOUT_MS);

    /**
     * Bootstrap is a 2-step flow:
     *   1. POST /auth/refresh with the httpOnly refresh cookie to mint
     *      a fresh access token.
     *   2. GET  /auth/me with that bearer token to fetch the full user
     *      profile (ACMD-124 — replaces JWT client-side decode).
     *
     * Paths:
     *   - /me 200 → authenticated (happy path)
     *   - /me 401/403/404 → hard logout (token unusable OR user deleted;
     *     treat like no session). ACMD-124-fix: 404 added because a
     *     deleted user with a still-valid refresh cookie would otherwise
     *     loop on the network_error banner forever.
     *   - /me network error / 5xx → retry once (attempt), otherwise
     *     surface network_error so ProtectedRoute renders the
     *     recoverable panel — NOT unauthenticated.
     */
    async function fetchMeForBootstrap(
      accessToken: string,
      attempt: number,
    ): Promise<void> {
      try {
        const me = await fetchMe(accessToken, { signal: controller.signal });
        if (cancelled) return;
        tokenRef.current = accessToken;
        // RS-013: capture prefill hints only when the user still needs
        // onboarding. Onboarded users reset hints to null so a stale
        // prefill can never leak into a future onboarding session.
        const hints: OnboardingHints | null = me.onboardingRequired
          ? {
              userId: me.userId,
              email: me.email,
              name: me.name,
              ...(me.googleId !== undefined ? { googleId: me.googleId } : {}),
            }
          : null;
        setState({
          user: userFromMe(me),
          token: accessToken,
          bootstrap: 'authenticated',
          onboardingHints: hints,
        });
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof ApiError &&
          (err.status === 401 || err.status === 403 || err.status === 404)
        ) {
          // /me said the token is bad (401/403) or the user no longer
          // exists (404 — deleted in DB while refresh cookie still
          // valid). Either way this is a hard logout: clear local
          // state and broadcast so sibling tabs also bounce to /login.
          // We intentionally do NOT try to refresh here; the refresh
          // succeeded seconds ago, so this response means the session
          // is structurally unusable.
          tokenRef.current = null;
          try {
            broadcastRef.current?.postLogout();
          } catch {
            /* no-op */
          }
          setState({
            user: null,
            token: null,
            bootstrap: 'unauthenticated',
            onboardingHints: null,
          });
          return;
        }
        if (err instanceof NetworkError && attempt === 0) {
          // ACMD-124 §Frontend requirements: retry /me once on pure
          // network failure before surfacing the error banner.
          await new Promise((r) => setTimeout(r, BOOTSTRAP_RETRY_DELAY_MS));
          if (cancelled) return;
          return fetchMeForBootstrap(accessToken, 1);
        }
        // Any other failure (NetworkError after retry, abort, 5xx,
        // malformed body) → network_error. Do NOT auto-logout — the
        // refresh cookie is still valid and the user can recover.
        setState({
          user: null,
          token: null,
          bootstrap: 'network_error',
          onboardingHints: null,
        });
      }
    }

    async function probe(attempt: number): Promise<void> {
      let accessToken: string;
      try {
        // deduplicatedRefresh() shares one in-flight POST /refresh across
        // both StrictMode effect invocations, preventing the race where the
        // server rotates the token on the first request and invalidates it
        // for the second. Errors still propagate so we can distinguish
        // 401 (no session) from network failures.
        const data = await deduplicatedRefresh();
        if (cancelled) return;
        if (!data?.accessToken) {
          // Malformed response — treat as unauthenticated.
          setState({
            user: null,
            token: null,
            bootstrap: 'unauthenticated',
            onboardingHints: null,
          });
          return;
        }
        accessToken = data.accessToken;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          // Real "no session" — go straight to login.
          setState({
            user: null,
            token: null,
            bootstrap: 'unauthenticated',
            onboardingHints: null,
          });
          return;
        }
        if (err instanceof NetworkError && attempt === 0) {
          // ACMD-116 R3: retry refresh once on pure network failure.
          await new Promise((r) => setTimeout(r, BOOTSTRAP_RETRY_DELAY_MS));
          if (cancelled) return;
          return probe(1);
        }
        // Any other failure (NetworkError after retry, abort, 5xx) —
        // surface network_error so UI can show a recoverable state.
        setState({
          user: null,
          token: null,
          bootstrap: 'network_error',
          onboardingHints: null,
        });
        return;
      }

      // Step 2: refresh succeeded — now fetch /me.
      await fetchMeForBootstrap(accessToken, 0);
    }

    void probe(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // Intentionally run only on mount. No deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Cross-tab logout listener -------------------------------------------
  // --- Cross-tab logout listener + channel lifecycle -----------------------
  // IMPORTANT: channel creation, subscription, and teardown are all in ONE
  // effect so React StrictMode's cleanup → remount cycle works correctly.
  //
  // Previous design (inline createAuthBroadcast + separate close effect) had
  // a StrictMode ordering bug: Effect 3 cleanup set broadcastRef to null BEFORE
  // Effect 2 re-ran, so the re-mount's Effect 2 saw bc=null and bailed without
  // subscribing. The fix: create and close the channel INSIDE this single effect
  // so each remount gets a fresh, subscribed channel.
  useEffect(() => {
    const bc = createAuthBroadcast();
    broadcastRef.current = bc;
    const unsubscribe = bc.subscribe((msg) => {
      if (msg.type === 'logout') {
        clearLocalState();
      }
    });
    return () => {
      unsubscribe();
      bc.close();
      broadcastRef.current = null;
    };
  }, [clearLocalState]);

  const login = useCallback(
    async (accessToken: string, onboardingRequired: boolean) => {
      // ACMD-124: fetch the real profile from /me — we no longer trust
      // the access token payload for display fields. onboardingRequired
      // from the /auth/google response still wins over the /me value so
      // brand-new users hit the onboarding wizard on first login even
      // if the company row is still being provisioned.
      const me = await fetchMe(accessToken);
      tokenRef.current = accessToken;
      // RS-013: if the caller said onboardingRequired:true (or /me agrees)
      // we must retain the profile hints so OnboardingPage can prefill.
      const effectiveOnboarding = onboardingRequired || me.onboardingRequired;
      const hints: OnboardingHints | null = effectiveOnboarding
        ? {
            userId: me.userId,
            email: me.email,
            name: me.name,
            ...(me.googleId !== undefined ? { googleId: me.googleId } : {}),
          }
        : null;
      const nextUser = userFromMe(me, { onboardingRequired });
      setState({
        user: nextUser,
        token: accessToken,
        bootstrap: 'authenticated',
        onboardingHints: hints,
      });
      return nextUser;
    },
    [],
  );

  /**
   * RS-013: re-fetch /me and update React state. Called by OnboardingPage
   * after a successful POST /api/v1/onboarding so the OnboardingGuard
   * releases the user. Also safe to call from any context that needs a
   * fresh profile view (e.g. after a server-driven role change).
   *
   * Requires an active access token; throws if called while logged out.
   * /me failures propagate so the caller can surface them — this method
   * does NOT flip the bootstrap state on error because the user is
   * already past bootstrap and we must not yank them back to the login
   * skeleton on a transient blip.
   */
  const refreshMe = useCallback(async (): Promise<AuthUser> => {
    const token = tokenRef.current;
    if (!token) {
      throw new ApiError(401, 'NO_SESSION', 'No active session for refreshMe');
    }
    const me = await fetchMe(token);
    const hints: OnboardingHints | null = me.onboardingRequired
      ? {
          userId: me.userId,
          email: me.email,
          name: me.name,
          ...(me.googleId !== undefined ? { googleId: me.googleId } : {}),
        }
      : null;
    const nextUser = userFromMe(me);
    setState((prev) => ({
      user: nextUser,
      token: prev.token,
      bootstrap: prev.bootstrap,
      onboardingHints: hints,
    }));
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    // ACMD-116 §4: always hit backend first so the server-side refresh
    // row is revoked. Swallow failures — the user must be able to sign
    // out even if the API is unreachable.
    try {
      // RS-013: /auth/logout is served by vollos-core (AUTH_BASE_URL).
      // acmd-api no longer has a /logout handler. `credentials: 'include'`
      // is set inside authRequest so the refresh cookie (bound to the
      // vollos-core origin) accompanies the request.
      await authRequest(AUTH_LOGOUT_PATH, { method: 'POST' });
    } catch {
      /* network/revoke failure is non-fatal for client logout */
    }
    // Broadcast BEFORE clearing local state so the current tab's
    // listener (bound to the same channel) can safely ignore its own
    // message — BroadcastChannel does not echo to the same instance.
    try {
      broadcastRef.current?.postLogout();
    } catch {
      /* no-op */
    }
    clearLocalState();
  }, [clearLocalState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: state.bootstrap === 'authenticated' && Boolean(state.token),
      login,
      logout,
      refreshMe,
      client,
    }),
    [state, login, logout, refreshMe, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
