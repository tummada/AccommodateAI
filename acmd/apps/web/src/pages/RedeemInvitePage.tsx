/**
 * RedeemInvitePage — T-118
 *
 * Beta-gate page that appears after Google login when /me reports
 * `needs_beta_invite: true`. The user pastes their invite token, the FE
 * POSTs to the PUBLIC `/api/v1/beta-signup` endpoint (no Authorization
 * header — confirmed by T-116 backend audit), and on success calls
 * refreshMe() then navigates to /onboarding.
 *
 * Layout/UX is inherited from OnboardingPage chromeless pattern:
 *   - flex min-h-screen flex-col items-center justify-start gap-6 bg-bg
 *     px-4 pt-[12vh] pb-12
 *   - brand header (Shield icon + h1 "AccommodateAI" + subtitle)
 *   - Card with token input + submit + error banner + helper text
 *   - footer with "Don't have a token?" mailto + Log out button
 *
 * SCOPE LOCK (per task.md): no countdown timer, no notify-form, no request
 * form route, no ACMD-XXXX format hint. Those are post-Beta T-119/T-120/
 * T-121. English copy only — Thai strings exist in T-117 brief but are
 * NOT rendered.
 *
 * SECURITY:
 *   - Token is sent as JSON body to the public endpoint. No JWT / Bearer
 *     header (T-116 confirmed `betaSignup.post('/', betaSignupRateLimit,...)`
 *     has no auth guard at apps/api/src/routes/beta-signup.ts:180).
 *   - Token is NEVER logged or stored in localStorage / sessionStorage —
 *     it lives in React state only.
 *   - Error messages are rendered with React's default escaping
 *     (textContent semantics) — no innerHTML / dangerouslySetInnerHTML.
 *   - Submit button disables itself the instant the request starts +
 *     aria-busy=true to prevent double-submit (per Frontend SKILL.md
 *     §Form Flow rule 5).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TOKEN_MAX = 256;
const BETA_SIGNUP_PATH = '/api/v1/beta-signup';
const SUPPORT_MAILTO = 'mailto:support@vollos.ai';

/**
 * The PUBLIC beta-signup endpoint lives on acmd-api at VITE_API_BASE_URL.
 * We resolve it the same way api-client.ts does (env -> trim trailing
 * slash) but call fetch() directly — NOT the authenticated client — per
 * T-116 finding (beta-signup is unauthenticated).
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * Mapped error categories. Backend currently returns 400 for invalid /
 * expired / used (see apps/api/src/routes/beta-signup.ts:248,263,276,378),
 * 202 for capacity_full (waitlisted body), 429 for rate_limited, 500 for
 * server. T-117 brief Section 4 lists 7 user-facing error states; we map
 * by both HTTP status AND error message text from the JSON body, falling
 * back to a generic message.
 */
type ErrorKind =
  | 'empty'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'capacity_full'
  | 'rate_limited'
  | 'network'
  | 'server';

const ERROR_COPY: Record<Exclude<ErrorKind, 'empty'>, string> = {
  invalid:
    "That token isn't valid. Check your invite email and try again.",
  expired:
    'This token expired. Email support@vollos.ai for a new one.',
  used:
    "This token has already been used. If you think that's a mistake, email support@vollos.ai.",
  capacity_full:
    "Beta is full. We added you to the waitlist — we'll email you when a spot opens.",
  rate_limited:
    'Too many attempts. Please wait and try again in an hour.',
  network:
    "We couldn't reach the server. Check your connection and try again.",
  server:
    'Something went wrong on our end. Please try again, or email support@vollos.ai.',
};

const EMPTY_TOKEN_COPY = 'Please enter your invite token.';

/**
 * Map a 400-class JSON body to the appropriate `ErrorKind`. Backend uses
 * a single 400 status for invalid / expired / used — the differentiator
 * is the `error` field of the response body (see beta-signup.ts:248,263,
 * 276,378).
 */
function mapErrorMessage(body: unknown): ErrorKind {
  if (body && typeof body === 'object') {
    const errStr = typeof (body as { error?: unknown }).error === 'string'
      ? ((body as { error: string }).error).toLowerCase()
      : '';
    if (errStr.includes('expired')) return 'expired';
    if (errStr.includes('already been used') || errStr.includes('used'))
      return 'used';
    if (errStr.includes('invalid')) return 'invalid';
  }
  return 'invalid';
}

export function RedeemInvitePage() {
  const { isAuthenticated, user, bootstrap, refreshMe, logout } = useAuth();
  const navigate = useNavigate();

  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  // Permanent-block flag: set after capacity_full so the submit button +
  // token input stay disabled (the user has been waitlisted — no other
  // token will help). NOT set for rate_limited (that uses rateLimitBlock
  // below with a 60s timed reset per T-117 brief Section 5).
  const [permanentBlock, setPermanentBlock] = useState(false);
  // Rate-limit block — silent 60s re-enable per T-117 brief Section 5
  // ("[after 60 s] → re-enable input + button" + "Rate-limit UI note: On
  // 429, disable button + input for 60 seconds then restore. Do NOT count
  // down visually — Just restore silently"). The countdown timer is the
  // T-121 deferral; the silent re-enable is in scope for T-118.
  const [rateLimitBlock, setRateLimitBlock] = useState(false);
  // Success transient state — T-117 brief Section 4 + Section 5 require a
  // 300ms "✓ Token accepted" flash on the button before refreshMe +
  // navigate, so the user sees confirmation feedback before route change.
  const [success, setSuccess] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // ─────────────────────────────────────────────────────────────────────
  // Cleanup: track any pending setTimeout so unmount aborts the timer
  // (prevents "setState on unmounted component" warnings + memory leaks).
  // ─────────────────────────────────────────────────────────────────────
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current !== null) {
        clearTimeout(rateLimitTimerRef.current);
        rateLimitTimerRef.current = null;
      }
    };
  }, []);

  // Auto-focus token input on mount — matches OnboardingPage.tsx:160-174
  // pattern. Wait until bootstrap resolves + user is authenticated so we
  // do not focus an unmounted input.
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (
      bootstrap !== 'pending'
      && isAuthenticated
      && user?.needsBetaInvite !== false
      && tokenInputRef.current
    ) {
      tokenInputRef.current.focus();
    }
    // Only re-fire if bootstrap status changes (matches OnboardingPage
    // useEffect comment). eslint-disable preserves the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, isAuthenticated]);

  // Move focus to error banner when one appears (matches OnboardingPage.
  // tsx:146-151 pattern).
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (errorKind && errorRef.current) {
      errorRef.current.focus();
    }
  }, [errorKind]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }, [logout, loggingOut]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Guard: ignore re-fires while submitting OR while either block
      // flag is set. The DOM uses aria-disabled (per T-117 brief WCAG
      // 4.1.2), so the button is keyboard-focusable AND announcable as
      // "unavailable" — but the click handler must still no-op.
      if (submitting || permanentBlock || rateLimitBlock) return;

      const trimmedToken = token.trim();
      if (trimmedToken.length === 0) {
        setErrorKind('empty');
        return;
      }
      if (!user?.email) {
        // Defensive — every authenticated user should have an email. If
        // we somehow lost it, show server error so the user can email
        // support. Should never fire in practice.
        setErrorKind('server');
        return;
      }

      setErrorKind(null);
      setSubmitting(true);
      try {
        if (!API_BASE_URL) {
          throw new Error('VITE_API_BASE_URL is not configured');
        }
        // T-116 confirmed: PUBLIC endpoint — NO Authorization header.
        // Body shape per beta-signup.ts:126-133 Zod schema.
        const res = await fetch(`${API_BASE_URL}${BETA_SIGNUP_PATH}`, {
          method: 'POST',
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            token: trimmedToken,
            email: user.email,
          }),
        });

        // Successful redemption is HTTP 200 with body { status: 'redeemed' }
        // (beta-signup.ts:407-413). Capacity-full path is HTTP 202 with
        // body { status: 'waitlisted' } and is treated as a permanent end
        // state for this session.
        const body = await res.json().catch(() => null);

        if (res.status === 200) {
          // T-117 brief Section 4 + Section 5: show "✓ Token accepted"
          // transient state for 300ms before refreshMe + navigate so the
          // user sees confirmation feedback before the route change.
          setSuccess(true);
          await new Promise((resolve) => setTimeout(resolve, 300));
          // Refresh /me so OnboardingGuard sees needs_beta_invite=false +
          // onboarding_required=true (the flow advances). Then navigate.
          await refreshMe();
          navigate('/onboarding', { replace: true });
          return;
        }

        if (res.status === 202) {
          // Capacity-full / waitlisted — permanent block per T-117 brief
          // Section 5: "Once the user is on the waitlist, disable the form
          // permanently for that session." Simple text per scope lock —
          // no email form (post-Beta T-121).
          setErrorKind('capacity_full');
          setPermanentBlock(true);
          return;
        }

        if (res.status === 429) {
          // Rate-limited — T-117 brief Section 5: "[after 60 s] →
          // re-enable input + button" with "Rate-limit UI note: On 429,
          // disable button + input for 60 seconds then restore. Do NOT
          // count down visually — Just restore silently". The countdown
          // is the T-121 deferral; the silent 60s re-enable is in scope.
          setErrorKind('rate_limited');
          setRateLimitBlock(true);
          // Clear any prior timer so a second 429 within the window
          // doesn't shorten the wait by overlap.
          if (rateLimitTimerRef.current !== null) {
            clearTimeout(rateLimitTimerRef.current);
          }
          rateLimitTimerRef.current = setTimeout(() => {
            setRateLimitBlock(false);
            // Clear the error message too — silent restore per brief
            // ("Just restore silently after 60 s").
            setErrorKind((prev) => (prev === 'rate_limited' ? null : prev));
            rateLimitTimerRef.current = null;
          }, 60_000);
          return;
        }

        if (res.status >= 500) {
          setErrorKind('server');
          return;
        }

        // 400 → invalid / expired / used (backend uses single status
        // code, differentiates by body.error text).
        const kind = mapErrorMessage(body);
        setErrorKind(kind);
        // T-117 brief Section 5: clear the token field on permanent
        // errors (used / expired) — no point retaining a value that can
        // never succeed. Keep populated for `invalid` so the user can
        // edit one character and retry (often a paste-typo).
        if (kind === 'used' || kind === 'expired') {
          setToken('');
        }
      } catch (err) {
        // fetch only rejects on true network failure (DNS, offline,
        // CORS preflight abort).
        // ⚠ Do NOT log err.message here — token is in scope and a
        // poorly-worded server response could leak it. Generic UI
        // message instead.
        void err;
        setErrorKind('network');
      } finally {
        setSubmitting(false);
      }
    },
    [
      navigate,
      permanentBlock,
      rateLimitBlock,
      refreshMe,
      submitting,
      token,
      user?.email,
    ],
  );

  // ---------------------------------------------------------------------
  // Route guards inside the component (mirrors OnboardingPage.tsx pattern)
  // ---------------------------------------------------------------------
  if (bootstrap === 'pending') {
    return null;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  // If /me reports needsBetaInvite=false, the user has already redeemed
  // — bounce them to /onboarding (or the dashboard via OnboardingGuard if
  // they finished onboarding, but practically they will hit
  // CatchAllRedirect for the right destination).
  if (user && user.needsBetaInvite === false) {
    const target = user.onboardingRequired ? '/onboarding' : '/dashboard';
    return <Navigate to={target} replace />;
  }

  // T-117 brief Section 6 (WCAG 4.1.2) + Section 10 SubmitButton spec:
  // disabled state must use aria-disabled="true", NOT the HTML `disabled`
  // attribute, so the element stays keyboard-focusable and screen readers
  // announce "Redeem invite — button, unavailable" (HTML-disabled buttons
  // are skipped by Tab order on most AT/browser combos).
  const inputBlocked = submitting || permanentBlock || rateLimitBlock || success;
  const submitBlocked =
    submitting
    || permanentBlock
    || rateLimitBlock
    || success
    || token.trim().length === 0;
  const errorMessage =
    errorKind === 'empty' ? EMPTY_TOKEN_COPY : errorKind ? ERROR_COPY[errorKind] : null;
  // Button label switches through 3 transient states: idle → submitting →
  // success → (navigate). T-117 brief Section 4 idle/loading/success table.
  const submitLabel = success
    ? '✓ Token accepted'
    : submitting
      ? 'Verifying…'
      : 'Redeem invite';

  return (
    <div className="flex min-h-screen flex-col items-center justify-start gap-6 bg-bg px-4 pt-[12vh] pb-12">
      {/* Brand header — identical structure to OnboardingPage.tsx:310-318
          per T-117 brief Section 10. */}
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-white">
          <Shield className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-text">AccommodateAI</h1>
        <p className="text-xs uppercase tracking-wider text-text-muted">
          ADA / PWFA Accommodation Compliance
        </p>
      </header>

      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-2xl">Enter your invite token</CardTitle>
          <CardDescription>
            AccommodateAI is invite-only during Beta. Paste the token from your
            invite email to unlock your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            aria-busy={submitting}
            data-testid="redeem-form"
          >
            {user?.email && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-text-muted">
                  Signed in as
                </span>
                <span
                  className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-text"
                  data-testid="redeem-email"
                >
                  {user.email}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label
                htmlFor="redeem-token"
                className="text-sm font-medium text-text"
              >
                Invite token
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              </label>
              <Input
                ref={tokenInputRef}
                id="redeem-token"
                name="token"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                required
                maxLength={TOKEN_MAX}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                // T-117 brief WCAG 4.1.2: aria-disabled (not HTML disabled)
                // so screen readers announce the unavailable state. Also
                // make the input read-only when blocked so keystrokes do
                // not silently mutate state — onChange is still wired but
                // the field cannot be edited.
                aria-disabled={inputBlocked ? 'true' : 'false'}
                readOnly={inputBlocked}
                aria-invalid={errorKind && errorKind !== 'empty' ? 'true' : 'false'}
                aria-describedby={
                  errorKind ? 'redeem-error' : 'redeem-token-help'
                }
                data-testid="redeem-token-input"
              />
              <p
                id="redeem-token-help"
                className="text-xs text-text-muted"
              >
                Paste the token from your invite email.
              </p>
            </div>

            {errorMessage && (
              <div
                ref={errorRef}
                id="redeem-error"
                role="alert"
                tabIndex={-1}
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="redeem-form-error"
              >
                {errorMessage}
              </div>
            )}

            <Button
              type="submit"
              // T-117 brief Section 6 (WCAG 4.1.2) + Section 10: use
              // aria-disabled, NOT the HTML disabled attribute, so the
              // button stays keyboard-focusable AND announcable. The
              // click guard at handleSubmit:175 makes the no-op safe.
              aria-disabled={submitBlocked ? 'true' : 'false'}
              // Apply visually-disabled style ourselves since we are no
              // longer relying on the Button component's `disabled`
              // attribute (which would also trip the cva `disabled:`
              // variant). aria-disabled[true] selector is widely
              // supported and matches Button's existing opacity-50.
              className="mt-2 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              data-testid="redeem-submit"
            >
              {submitLabel}
            </Button>

            {submitting && (
              <p role="status" className="text-center text-xs text-text-muted">
                Verifying your token…
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Footer — "Don't have a token?" mailto + Log out (per scope lock,
          mailto only — no request-form route). */}
      <footer className="flex flex-col items-center gap-2 text-center text-sm">
        <a
          href={SUPPORT_MAILTO}
          className="rounded text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          data-testid="redeem-help-link"
        >
          Don&apos;t have a token? Email support@vollos.ai
        </a>
        <button
          type="button"
          onClick={handleLogout}
          // T-117 brief WCAG 4.1.2: aria-disabled keeps the log-out
          // button focusable + announcable for SR users. The handler
          // already guards on `loggingOut` so a click while disabled
          // is a no-op.
          aria-disabled={loggingOut ? 'true' : 'false'}
          className="rounded text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
          data-testid="redeem-logout"
        >
          {loggingOut ? 'Signing out…' : 'Log out'}
        </button>
      </footer>
    </div>
  );
}
