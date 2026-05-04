/**
 * OnboardingPage — RS-013 Phase 3 / Task B
 *
 * Renders the one-time onboarding form shown to users whose JWT is valid but
 * who do not yet have a matching acmd_users row. The flow:
 *
 *   1. /me already returned `onboarding_required: true` and prefill hints
 *      (email, name, google_id). AuthProvider stores these as
 *      `onboardingHints` on the context.
 *   2. The user fills in `name` (required) and optionally `companyName`.
 *   3. Submit → POST /api/v1/onboarding { name, companyName? } using the
 *      context's authenticated client so 401 → refresh → retry is handled.
 *   4. On 201 success → call `refreshMe()` to pull the fresh /me response
 *      (which now returns onboarding_required=false) → navigate to
 *      /dashboard.
 *
 * Guards layered around this component (see App.tsx):
 *   - ProtectedRoute     → unauthenticated users are bounced to /login
 *                          BEFORE this component mounts.
 *   - OnboardingGuard    → intentionally NOT wrapped around /onboarding so
 *                          users who need onboarding do not redirect-loop.
 *   - useEffect in body  → users whose `onboardingRequired` is already
 *                          false (e.g. they typed /onboarding manually
 *                          after completing) are sent to /dashboard.
 *
 * SECURITY:
 *   - email / google_id / user_id come from the JWT on the server. The
 *     request body contains ONLY { name, companyName? } — sending
 *     additional identity fields would let a malicious client try to
 *     claim someone else's account on first hit.
 *   - No credentials / tokens are logged. Errors are mapped to
 *     user-friendly copy — raw server messages never reach the DOM
 *     outside of Zod issue strings which are already safe.
 *   - Submit button is disabled during the in-flight POST + an aria-busy
 *     flag guards against duplicate submissions (double-click,
 *     keyboard-repeat).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError, NetworkError, ONBOARDING_PATH } from '@/lib/api-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const NAME_MAX = 255;
const COMPANY_NAME_MAX = 255;

/**
 * Client-side form validation that mirrors the Zod schema on the server
 * (apps/api/src/routes/onboarding.ts):
 *   name: string().min(1).max(255)
 *   companyName: string().min(1).max(255).optional()
 *
 * The backend validates again — this check exists only to avoid a network
 * round-trip for obvious mistakes.
 */
function validate(
  name: string,
  companyName: string,
): { name?: string; companyName?: string } {
  const errors: { name?: string; companyName?: string } = {};
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    errors.name = 'Please enter your name.';
  } else if (trimmedName.length > NAME_MAX) {
    errors.name = `Name must be ${NAME_MAX} characters or fewer.`;
  }
  const trimmedCompany = companyName.trim();
  if (trimmedCompany.length > COMPANY_NAME_MAX) {
    errors.companyName = `Company name must be ${COMPANY_NAME_MAX} characters or fewer.`;
  }
  return errors;
}

interface OnboardingResponse {
  onboarding_required: boolean;
  profile: {
    id: string;
    email: string;
    name: string;
    role: string;
    companyId: string;
  };
}

export function OnboardingPage() {
  const {
    isAuthenticated,
    user,
    bootstrap,
    onboardingHints,
    client,
    refreshMe,
    logout,
  } = useAuth();
  const navigate = useNavigate();
  // T-049 / ACMD-UX / WCAG SC 2.4.5: a user who signed in with the wrong
  // Google account must be able to escape without opening devtools to
  // clear cookies. We hide the Topbar on this route so the Log-out
  // escape hatch has to live on the page itself.
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      // logout() already navigates state but ProtectedRoute + the
      // catch-all redirect will push us to /login; no explicit navigate
      // needed. We still reset the flag in case logout throws — the
      // user can retry.
      setLoggingOut(false);
    }
  }, [logout, loggingOut]);

  // Prefill state pulled from /me hints when the component mounts. We
  // seed lazily so the input remains user-editable once typing starts —
  // a naive `value={hints.name}` binding would clobber their edits if
  // the context re-rendered.
  const [name, setName] = useState<string>(() => onboardingHints?.name ?? '');
  const [companyName, setCompanyName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    companyName?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Focus mgmt — move focus to the error banner when one appears so
  // screen readers announce it (role="alert" + tabIndex=-1 + .focus()).
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (formError && errorRef.current) {
      errorRef.current.focus();
    }
  }, [formError]);

  // T-049 / WCAG SC 2.4.3: auto-focus the Name input on mount so a
  // keyboard / screen-reader user can start typing immediately. We wait
  // until bootstrap resolves + user is authenticated (matching the
  // render guards below) so focus() only fires when the input is
  // actually in the DOM. Using a ref (not `autoFocus` attribute) gives
  // us a stable hook for tests and avoids the React warning that
  // autoFocus is discouraged for a11y in some situations.
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (
      bootstrap !== 'pending'
      && isAuthenticated
      && user?.onboardingRequired !== false
      && nameInputRef.current
    ) {
      nameInputRef.current.focus();
    }
    // Only run once per mount for these conditions — re-focusing on
    // every re-render would steal focus from whatever the user is
    // doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, isAuthenticated]);

  // Derived prefill — visible to the user as the read-only email row.
  const prefillEmail = useMemo(
    () => onboardingHints?.email ?? user?.email ?? '',
    [onboardingHints, user],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Guard against double-fire (double-click, form re-submit) —
      // complements the disabled button for keyboard/repeat scenarios.
      if (submitting) return;

      // Client-side validation — mirrors the server Zod schema. Clears
      // any previously-displayed formError so the user gets a fresh
      // error state if they pressed submit with a fixed field.
      const errors = validate(name, companyName);
      setFieldErrors(errors);
      setFormError(null);
      if (Object.keys(errors).length > 0) return;

      setSubmitting(true);
      try {
        // Edge case #5 from task.md: backend schema uses
        // z.string().min(1) with .optional(), so an empty string fails
        // validation. We must OMIT the key entirely rather than send "".
        const body: { name: string; companyName?: string } = {
          name: name.trim(),
        };
        const trimmedCompany = companyName.trim();
        if (trimmedCompany.length > 0) {
          body.companyName = trimmedCompany;
        }

        // POST through the authenticated client so a 401 triggers the
        // refresh-and-retry dance instead of booting the user out of
        // the onboarding flow.
        await client.request<OnboardingResponse>(ONBOARDING_PATH, {
          method: 'POST',
          body,
        });

        // 201 → force /me refresh so OnboardingGuard releases us. We
        // await the refresh so `user.onboardingRequired` is already
        // false by the time navigate() fires — otherwise the guard
        // would bounce us back on /dashboard mount.
        await refreshMe();
        navigate('/dashboard', { replace: true });
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 400) {
            // Server-side validation failed — surface a field-level
            // message. The Zod issues array is not shown verbatim
            // (safety: could contain developer hints); we map by best
            // effort to the `name` field and fall back to the form
            // error line.
            setFieldErrors((prev) => ({
              ...prev,
              name:
                prev.name
                ?? 'Please double-check your name and company name, then try again.',
            }));
            setFormError(
              'We could not save your profile. Please check the highlighted fields.',
            );
          } else if (err.status === 409) {
            // Concurrent / duplicate submit — the user already has an
            // acmd_users row. Sync state from /me and send them on
            // their way; refreshMe will also clear the stale hints.
            try {
              const refreshed = await refreshMe();
              if (!refreshed.onboardingRequired) {
                navigate('/dashboard', { replace: true });
                return;
              }
            } catch {
              /* fallthrough to retry banner below */
            }
            setFormError(
              'Your account is already set up. Please refresh the page to continue.',
            );
          } else if (err.status === 429) {
            setFormError('Too many requests. Please wait a moment and try again.');
          } else {
            setFormError(err.message);
          }
        } else if (err instanceof NetworkError) {
          setFormError(
            'We could not reach the server. Please check your connection and try again.',
          );
        } else {
          setFormError('Something went wrong. Please try again.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [client, companyName, name, navigate, refreshMe, submitting],
  );

  // --- Route guards inside the component ----------------------------------
  // ProtectedRoute already gates on bootstrap status; we only need to
  // handle the two onboarding-specific cases the generic guard does not
  // cover.
  if (bootstrap === 'pending') {
    // ProtectedRoute will show AppShellSkeleton — keep this branch as a
    // defensive no-op so direct renders (e.g. unit tests that bypass
    // ProtectedRoute) do not flash an empty form.
    return null;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  // If /me already reports onboardingRequired:false, the user is done.
  // Send them to the dashboard. This also covers the back-button case
  // (user navigates back to /onboarding after a successful submit).
  if (user && user.onboardingRequired === false) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    // T-049: items-start + pt-[12vh] anchors the card in the upper reading
    // zone on tall external monitors; items-center alone floated the card
    // in dead space. motion-reduce: there are no enter/exit transitions on
    // this static layout, so no motion tokens need gating — any future
    // animation added here MUST use a `motion-reduce:` variant (per brief
    // §Accessibility).
    <div className="flex min-h-screen flex-col items-center justify-start gap-6 bg-bg px-4 pt-[12vh] pb-12">
      {/* Brand header — signals where the user is while the full app
          chrome (Sidebar + Topbar) is intentionally suppressed. Mirrors
          the brand density of LoginPage so a user recognises "same app,
          next step." <h1> is the page's top-level heading (SC 1.3.1);
          CardTitle below remains an <h3> (shadcn default), kept as the
          card's local heading. */}
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-white">
          <Shield className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-text">AccommodateAI</h1>
        <p className="text-xs uppercase tracking-wider text-text-muted">
          ADA / PWFA Accommodation Compliance
        </p>
      </header>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Complete your profile</CardTitle>
          <CardDescription>
            Tell us who you are so AccommodateAI can set up your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            aria-busy={submitting}
            data-testid="onboarding-form"
          >
            {prefillEmail && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-text-muted">
                  Signed in as
                </span>
                <span
                  className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-text"
                  data-testid="onboarding-email"
                >
                  {prefillEmail}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label
                htmlFor="onboarding-name"
                className="text-sm font-medium text-text"
              >
                Full name
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              </label>
              <Input
                ref={nameInputRef}
                id="onboarding-name"
                name="name"
                autoComplete="name"
                required
                maxLength={NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={
                  fieldErrors.name ? 'onboarding-name-error' : undefined
                }
                data-testid="onboarding-name-input"
              />
              {fieldErrors.name && (
                <p
                  id="onboarding-name-error"
                  className="text-sm text-destructive"
                  data-testid="onboarding-name-error"
                >
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="onboarding-company"
                className="text-sm font-medium text-text"
              >
                Company name
                <span className="ml-1 text-xs text-text-muted">(optional)</span>
              </label>
              <Input
                id="onboarding-company"
                name="companyName"
                autoComplete="organization"
                maxLength={COMPANY_NAME_MAX}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={submitting}
                aria-invalid={fieldErrors.companyName ? 'true' : 'false'}
                aria-describedby={
                  fieldErrors.companyName ? 'onboarding-company-error' : undefined
                }
                data-testid="onboarding-company-input"
              />
              {fieldErrors.companyName && (
                <p
                  id="onboarding-company-error"
                  className="text-sm text-destructive"
                  data-testid="onboarding-company-error"
                >
                  {fieldErrors.companyName}
                </p>
              )}
            </div>

            {formError && (
              <div
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="onboarding-form-error"
              >
                {formError}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="mt-2"
              data-testid="onboarding-submit"
            >
              {submitting ? 'Saving…' : 'Continue to dashboard'}
            </Button>

            {submitting && (
              <p role="status" className="text-center text-xs text-text-muted">
                Setting up your workspace…
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* T-049 / WCAG SC 2.4.5 Multiple Ways — since the Topbar is
          suppressed on /onboarding, provide an explicit escape hatch so a
          user who signed in with the wrong Google account can sign out
          without clearing cookies. Uses type=button (not the Button
          component styled as primary) to visually de-emphasise vs. the
          Continue action. */}
      <footer className="flex flex-col items-center gap-1 text-center text-sm">
        {prefillEmail && (
          <span className="text-text-muted" data-testid="onboarding-footer-email">
            Signed in as <span className="text-text">{prefillEmail}</span>
          </span>
        )}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          data-testid="onboarding-logout"
        >
          {loggingOut ? 'Signing out…' : 'Log out'}
        </button>
      </footer>
    </div>
  );
}
