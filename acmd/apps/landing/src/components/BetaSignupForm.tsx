import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { submitBetaSignup, WEB_LOGIN_URL, type BetaSignupResult } from '@/lib/api';

/**
 * Beta signup form — acmd-ux brief §5.4.
 *
 * Form contract:
 *  - Two visible fields: email + token
 *  - Both required, validated client-side and re-validated server-side
 *  - POST → ${VITE_API_URL}/api/v1/beta-signup (apps/api/src/routes/beta-signup.ts)
 *  - Submit button is **disabled and aria-busy** the moment fetch() starts
 *    and is only re-enabled after we have a response (success OR error) —
 *    prevents double-submit during slow networks (Frontend SKILL §Form Flow).
 *  - On 200 redeemed: replace form with thank-you, redirect to
 *    {accommodate-app.vollos.ai}/login after ~3s, focus moves to the message.
 *  - On 202 waitlisted: replace form with waitlist message — NO redirect.
 *  - On error: render an inline alert, focus moves to the alert, message is
 *    linked from the failing input via aria-describedby.
 *  - No alert(), no innerHTML, no console.log of user input.
 *
 * Accessibility (WCAG 2.2 AA):
 *  - All inputs have visible <label> elements (not placeholder-only).
 *  - Errors are announced via role="alert" + aria-live="polite".
 *  - Focus management: errored field receives focus on submit failure; the
 *    success/waitlist message is focusable (tabindex=-1) and receives focus
 *    on success.
 *  - Email field is type="email" with native validation as a fallback layer.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// RFC 4648 §5 base64url alphabet (letters, digits, hyphen, underscore).
// Backend accepts `z.string().min(1).max(256)` — this regex is a permissive
// client-side guardrail, NOT the source of truth. Do NOT toUpperCase: tokens
// are case-sensitive on the server (apps/api/src/routes/beta-signup.ts:L236).
const TOKEN_REGEX = /^[A-Za-z0-9_-]{4,64}$/;
const REDIRECT_DELAY_MS = 3000;

type FieldErrors = {
  email?: string;
  token?: string;
};

export function BetaSignupForm() {
  const emailId = useId();
  const tokenId = useId();
  const emailErrorId = `${emailId}-error`;
  const tokenErrorId = `${tokenId}-error`;
  const formErrorId = useId();

  const emailRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef<HTMLInputElement | null>(null);
  const formAlertRef = useRef<HTMLDivElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);

  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BetaSignupResult | null>(null);

  // Auto-redirect ONLY on full redemption (200). Waitlisted users (202) stay
  // on the page — they cannot sign in yet. Uses window.location.assign so
  // the dev host (different subdomain in prod) is reached via a full
  // navigation.
  useEffect(() => {
    if (result?.ok !== true || result.status !== 'redeemed') return;
    const timer = window.setTimeout(() => {
      window.location.assign(WEB_LOGIN_URL);
    }, REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  // Move focus when state changes for accessible flow.
  useEffect(() => {
    if (result?.ok === true) {
      successRef.current?.focus();
    } else if (result && !result.ok) {
      formAlertRef.current?.focus();
    }
  }, [result]);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!email.trim()) {
      errors.email = 'Email is required.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      errors.token = 'Beta token is required.';
    } else if (!TOKEN_REGEX.test(trimmedToken)) {
      errors.token =
        'Token should be letters, numbers, hyphens, or underscores (4-64 characters).';
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setResult(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Focus the first errored field for keyboard / screen-reader users.
      if (errors.email) {
        emailRef.current?.focus();
      } else if (errors.token) {
        tokenRef.current?.focus();
      }
      return;
    }

    setSubmitting(true);
    try {
      const apiResult = await submitBetaSignup({
        email: email.trim(),
        token: token.trim(),
      });
      setResult(apiResult);
    } finally {
      // Re-enable in finally so the button is never permanently stuck if a
      // future code path throws. Frontend SKILL §Form Flow item 7.
      setSubmitting(false);
    }
  }

  if (result?.ok && result.status === 'redeemed') {
    return (
      <section
        id="beta-signup"
        aria-labelledby="signup-success-heading"
        className="border-t border-border bg-surface py-20"
      >
        <div className="container">
          <div
            ref={successRef}
            tabIndex={-1}
            role="status"
            className="mx-auto max-w-xl rounded-lg border border-primary bg-bg p-8 text-center shadow-card outline-none"
          >
            <h2
              id="signup-success-heading"
              className="text-2xl font-bold tracking-tight text-text"
            >
              Thanks! Check your email for next steps.
            </h2>
            <p className="mt-3 text-base text-text-muted">
              We're redirecting you to sign in. If your browser doesn't redirect
              automatically, use the button below.
            </p>
            <a
              href={WEB_LOGIN_URL}
              className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Continue to sign in
              <span aria-hidden="true" className="ml-2">
                &rarr;
              </span>
            </a>
          </div>
        </div>
      </section>
    );
  }

  if (result?.ok && result.status === 'waitlisted') {
    return (
      <section
        id="beta-signup"
        aria-labelledby="signup-waitlist-heading"
        className="border-t border-border bg-surface py-20"
      >
        <div className="container">
          <div
            ref={successRef}
            tabIndex={-1}
            role="status"
            className="mx-auto max-w-xl rounded-lg border border-border bg-bg p-8 text-center shadow-card outline-none"
          >
            <h2
              id="signup-waitlist-heading"
              className="text-2xl font-bold tracking-tight text-text"
            >
              You're on the waitlist
            </h2>
            <p className="mt-3 text-base text-text-muted">
              {result.waitlistId
                ? `We saved your spot (#${result.waitlistId}). We'll email you when capacity opens.`
                : "We'll email you when capacity opens."}
            </p>
            <p className="mt-6 text-sm text-text-muted">
              Questions? Email{' '}
              <a
                href="mailto:beta@accommodate.vollos.ai"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                beta@accommodate.vollos.ai
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    );
  }

  const formError = result && !result.ok ? result.message : null;

  return (
    <section
      id="beta-signup"
      aria-labelledby="signup-heading"
      className="border-t border-border bg-surface py-20"
    >
      <div className="container">
        <div className="mx-auto max-w-xl">
          <div className="text-center">
            <h2
              id="signup-heading"
              className="text-3xl font-bold tracking-tight text-text md:text-4xl"
            >
              Request your Beta invite
            </h2>
            <p className="mt-3 text-base text-text-muted">
              Limited to 20 founding customers. Invite-only during Beta.
            </p>
          </div>

          <form
            noValidate
            onSubmit={handleSubmit}
            aria-describedby={formError ? formErrorId : undefined}
            className="mt-10 space-y-5"
          >
            <div>
              <label
                htmlFor={emailId}
                className="block text-sm font-medium text-text"
              >
                Email
              </label>
              <input
                ref={emailRef}
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) {
                    setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }
                }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? emailErrorId : `${emailId}-help`
                }
                className="mt-2 block h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-text shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p
                id={`${emailId}-help`}
                className="mt-2 text-sm text-text-muted"
              >
                We'll send your invite confirmation here.
              </p>
              {fieldErrors.email && (
                <p
                  id={emailErrorId}
                  role="alert"
                  className="mt-2 text-sm font-medium text-destructive"
                >
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={tokenId}
                className="block text-sm font-medium text-text"
              >
                Beta token
              </label>
              <input
                ref={tokenRef}
                id={tokenId}
                name="token"
                type="text"
                autoComplete="off"
                inputMode="text"
                spellCheck={false}
                required
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (fieldErrors.token) {
                    setFieldErrors((prev) => ({
                      ...prev,
                      token: undefined,
                    }));
                  }
                }}
                aria-invalid={Boolean(fieldErrors.token)}
                aria-describedby={
                  fieldErrors.token ? tokenErrorId : `${tokenId}-help`
                }
                className="mt-2 block h-11 w-full rounded-md border border-border bg-surface px-3 font-mono text-base text-text shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p
                id={`${tokenId}-help`}
                className="mt-2 text-sm text-text-muted"
              >
                Got an invite? Paste your token here. Don't have one? Email{' '}
                <a
                  href="mailto:beta@accommodate.vollos.ai"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  beta@accommodate.vollos.ai
                </a>
                .
              </p>
              {fieldErrors.token && (
                <p
                  id={tokenErrorId}
                  role="alert"
                  className="mt-2 text-sm font-medium text-destructive"
                >
                  {fieldErrors.token}
                </p>
              )}
            </div>

            {formError && (
              <div
                ref={formAlertRef}
                tabIndex={-1}
                id={formErrorId}
                role="alert"
                aria-live="polite"
                className="rounded-md border border-destructive bg-destructive/5 p-4 text-sm font-medium text-destructive outline-none"
              >
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground shadow-card hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  Submitting...
                </>
              ) : (
                'Request Beta Access'
              )}
            </button>

            <p className="text-center text-xs text-text-muted">
              By submitting, you agree to our{' '}
              <a
                href="/privacy"
                className="font-medium text-text underline-offset-2 hover:underline"
              >
                Privacy Policy
              </a>
              . We'll only email you about your Beta invite.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
