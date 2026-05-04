/**
 * RedeemInvitePage component tests — T-118
 *
 * Coverage:
 *   - Auth bootstrap with /me { needs_beta_invite: true } populates
 *     user.needsBetaInvite + routes the user onto /redeem-invite via
 *     CatchAllRedirect (sanity check that the wiring matches the brief).
 *   - Page renders the chromeless layout (h1 brand + h2 card title +
 *     signed-in-as pill + token input + submit + footer).
 *   - Empty token → inline error (no network call).
 *   - 200 success → POST body shape `{ token, email }` (NO Authorization
 *     header — public endpoint per T-116) → refreshMe → navigate to
 *     /onboarding.
 *   - 400 invalid / expired / used differentiated by response body.
 *   - 202 capacity_full → permanent-block message + form disabled.
 *   - 429 rate_limited → permanent-block message + form disabled.
 *   - Network failure → "couldn't reach the server" error.
 *   - 500 → server-error copy.
 *   - Log out button calls logout() (POST /auth/logout).
 *   - Token input has accessibility attributes (label, aria-describedby,
 *     autoCapitalize, etc.).
 *
 * Mirrors the test harness from src/test/onboarding-page.test.tsx so the
 * MSW + AuthProvider + ProtectedRoute wiring is identical.
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { RedeemInvitePage } from '@/pages/RedeemInvitePage';
import { server } from '@/test/server';
import { makeFakeAccessToken } from '@/test/handlers';

const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';

// ---------------------------------------------------------------------------
// Test harness — same shape as onboarding-page.test.tsx so MSW + bootstrap
// + ProtectedRoute exercise the real flow.
// ---------------------------------------------------------------------------

function StateProbe() {
  const { bootstrap, isAuthenticated, user } = useAuth();
  return (
    <div>
      <span data-testid="bootstrap">{bootstrap}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="user-email">{user?.email ?? ''}</span>
      <span data-testid="user-needs-beta">
        {user ? String(user.needsBetaInvite ?? '') : 'null'}
      </span>
      <span data-testid="user-onboarding">
        {user ? String(user.onboardingRequired ?? '') : 'null'}
      </span>
    </div>
  );
}

function renderRedeemInvite() {
  return render(
    <MemoryRouter initialEntries={['/redeem-invite']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/redeem-invite"
            element={
              <ProtectedRoute>
                <>
                  <StateProbe />
                  <RedeemInvitePage />
                </>
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding"
            element={<div data-testid="onboarding-page">onboarding</div>}
          />
          <Route
            path="/dashboard"
            element={<div data-testid="dashboard">dashboard</div>}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * /me switcher — returns `bootstrap` body on first call, `afterRedeem` on
 * subsequent calls so a single test can drive bootstrap → submit →
 * refreshMe in one render.
 */
function mockBootstrapWithBetaInviteRequired(afterRedeem?: {
  onboarding_required: boolean;
  needs_beta_invite?: boolean;
  profile: Record<string, unknown>;
}) {
  const token = makeFakeAccessToken({ sub: 'user-beta-1' });
  let meCalls = 0;
  const bootstrapBody = {
    onboarding_required: true,
    needs_beta_invite: true,
    profile: {
      user_id: 'user-beta-1',
      email: 'beta.user@corp.com',
      name: '',
      google_id: 'goog-beta',
    },
  };
  server.use(
    http.post(`${AUTH}/auth/refresh`, () =>
      HttpResponse.json({ accessToken: token }, { status: 200 }),
    ),
    http.get(`${API}/api/v1/auth/me`, () => {
      meCalls += 1;
      if (meCalls === 1 || !afterRedeem) {
        return HttpResponse.json(bootstrapBody, { status: 200 });
      }
      return HttpResponse.json(afterRedeem, { status: 200 });
    }),
  );
  return token;
}

// ---------------------------------------------------------------------------
// auth-context: needs_beta_invite parsing
// ---------------------------------------------------------------------------

describe('auth-context needs_beta_invite parsing (T-118)', () => {
  it('bootstrap /me { needs_beta_invite: true } populates user.needsBetaInvite', async () => {
    mockBootstrapWithBetaInviteRequired();
    renderRedeemInvite();

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('user-needs-beta').textContent).toBe('true');
    expect(screen.getByTestId('user-email').textContent).toBe(
      'beta.user@corp.com',
    );
  });

  it('rejects /me responses with non-boolean needs_beta_invite (defensive)', async () => {
    const token = makeFakeAccessToken({ sub: 'user-x' });
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () =>
        HttpResponse.json(
          {
            onboarding_required: true,
            needs_beta_invite: 1, // wrong type
            profile: {
              user_id: 'user-x',
              email: 'x@x.com',
              name: '',
              google_id: 'g',
            },
          },
          { status: 200 },
        ),
      ),
    );
    renderRedeemInvite();
    // Bad envelope is treated as auth failure (network_error path);
    // ProtectedRoute renders the connection problem panel.
    await waitFor(() => {
      expect(screen.getByText(/Connection problem/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// RedeemInvitePage rendering
// ---------------------------------------------------------------------------

describe('RedeemInvitePage rendering', () => {
  it('renders brand header, card title, signed-in-as email, token input, footer', async () => {
    mockBootstrapWithBetaInviteRequired();
    renderRedeemInvite();

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument();
    });

    // brand header h1
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'AccommodateAI',
    );
    // card title
    expect(
      screen.getByText('Enter your invite token'),
    ).toBeInTheDocument();
    // signed-in-as
    expect(screen.getByTestId('redeem-email').textContent).toBe(
      'beta.user@corp.com',
    );
    // token input has correct a11y / mobile keyboard attrs
    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    expect(input.getAttribute('autoCapitalize')).toBe('characters');
    expect(input.getAttribute('autoCorrect')).toBe('off');
    expect(input.getAttribute('autoComplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.maxLength).toBe(256);
    // helper text linked via aria-describedby (when no error)
    expect(input.getAttribute('aria-describedby')).toBe('redeem-token-help');
    // submit + log out + help link
    expect(screen.getByTestId('redeem-submit')).toBeInTheDocument();
    expect(screen.getByTestId('redeem-help-link').getAttribute('href')).toBe(
      'mailto:support@vollos.ai',
    );
    expect(screen.getByTestId('redeem-logout')).toBeInTheDocument();
  });

  it('auto-focuses token input on mount', async () => {
    mockBootstrapWithBetaInviteRequired();
    renderRedeemInvite();

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument();
    });
    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it('submit button uses aria-disabled (NOT HTML disabled) when token is empty', async () => {
    // T-117 brief Section 6 / WCAG 4.1.2: aria-disabled keeps the button
    // keyboard-focusable AND announceable to screen readers as
    // "unavailable". HTML `disabled` would skip it entirely from Tab
    // order on most AT/browser combos.
    mockBootstrapWithBetaInviteRequired();
    renderRedeemInvite();

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument();
    });
    const submit = screen.getByTestId<HTMLButtonElement>('redeem-submit');
    // HTML disabled MUST be false — we use aria-disabled instead.
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute('aria-disabled')).toBe('true');

    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    fireEvent.change(input, { target: { value: 'TOKEN-XYZ' } });
    expect(submit.getAttribute('aria-disabled')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Submit happy path
// ---------------------------------------------------------------------------

describe('RedeemInvitePage submit happy path', () => {
  it('POST 200 → refreshMe → navigates to /onboarding', async () => {
    mockBootstrapWithBetaInviteRequired({
      onboarding_required: true,
      needs_beta_invite: false,
      profile: {
        user_id: 'user-beta-1',
        email: 'beta.user@corp.com',
        name: '',
        google_id: 'goog-beta',
      },
    });
    let capturedAuth: string | null = 'sentinel';
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API}/api/v1/beta-signup`, async ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            status: 'redeemed',
            message: 'Invite accepted — sign in with Google to finish setup',
          },
          { status: 200 },
        );
      }),
    );
    renderRedeemInvite();

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument();
    });

    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    // Type a token with leading/trailing whitespace to verify trim.
    fireEvent.change(input, { target: { value: '  ACMD-VALID-TOKEN  ' } });

    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-page')).toBeInTheDocument();
    });

    // T-116 invariant: NO Authorization header (public endpoint).
    expect(capturedAuth).toBeNull();
    // Body shape: { token (trimmed), email } — only these two fields.
    expect(capturedBody).toEqual({
      token: 'ACMD-VALID-TOKEN',
      email: 'beta.user@corp.com',
    });
  });
});

// ---------------------------------------------------------------------------
// Submit error mappings
// ---------------------------------------------------------------------------

describe('RedeemInvitePage submit error mappings', () => {
  it('empty token → inline error, no network call', async () => {
    mockBootstrapWithBetaInviteRequired();
    let called = false;
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () => {
        called = true;
        return HttpResponse.json({ status: 'redeemed' }, { status: 200 });
      }),
    );
    renderRedeemInvite();

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument();
    });
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('redeem-form-error').textContent).toContain(
      'Please enter your invite token',
    );
    expect(called).toBe(false);
  });

  it('400 + body { error: "Invalid invite token" } → invalid copy + token RETAINED', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () =>
        HttpResponse.json({ error: 'Invalid invite token' }, { status: 400 }),
      ),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    fireEvent.change(input, { target: { value: 'BOGUS' } });
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() => {
      expect(screen.getByTestId('redeem-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('redeem-form-error').textContent).toContain(
      "That token isn't valid",
    );
    // T-117 brief Section 5: invalid → "token input: re-enabled, stays
    // populated (user can edit)". Verify the typo-prone path.
    expect(input.value).toBe('BOGUS');
  });

  it('400 + body { error: "Invite token has expired" } → expired copy + token CLEARED', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () =>
        HttpResponse.json(
          { error: 'Invite token has expired' },
          { status: 400 },
        ),
      ),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    fireEvent.change(input, { target: { value: 'OLD' } });
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form-error').textContent).toContain(
        'This token expired',
      ),
    );
    // T-117 brief Section 5: expired → "token input: cleared". The token
    // is permanently invalid, no point retaining the value.
    expect(input.value).toBe('');
  });

  it('400 + body { error: "Invite token has already been used" } → used copy + token CLEARED', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () =>
        HttpResponse.json(
          { error: 'Invite token has already been used' },
          { status: 400 },
        ),
      ),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    fireEvent.change(input, { target: { value: 'CLAIMED' } });
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form-error').textContent).toContain(
        'This token has already been used',
      ),
    );
    // T-117 brief Section 5: used → "token input: cleared (token is
    // permanently invalid, no point retaining)".
    expect(input.value).toBe('');
  });

  it('202 capacity_full → waitlist message + form permanently disabled', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () =>
        HttpResponse.json(
          {
            status: 'waitlisted',
            message: 'Beta full — added to waitlist',
            waitlistId: 'w-1',
          },
          { status: 202 },
        ),
      ),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByTestId<HTMLInputElement>('redeem-token-input'),
      { target: { value: 'TOKEN' } },
    );
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form-error').textContent).toContain(
        'Beta is full',
      ),
    );
    expect(screen.getByTestId('redeem-form-error').textContent).toContain(
      'waitlist',
    );
    // Permanent-block: input + submit both aria-disabled (NOT HTML
    // disabled per WCAG 4.1.2). Input is also readOnly so keystrokes
    // cannot mutate state silently.
    const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(input.readOnly).toBe(true);
    const btn = screen.getByTestId<HTMLButtonElement>('redeem-submit');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    // No email-form is rendered (post-Beta T-121 — must NOT exist now).
    expect(
      screen.queryByRole('textbox', { name: /notify/i }),
    ).not.toBeInTheDocument();
  });

  it('429 rate_limited → simple "too many attempts" + form disabled (NO countdown)', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () =>
        HttpResponse.json(
          { error: 'Too many requests', retryAfter: 3600 },
          { status: 429 },
        ),
      ),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByTestId<HTMLInputElement>('redeem-token-input'),
      { target: { value: 'WHATEVER' } },
    );
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form-error').textContent).toContain(
        'Too many attempts',
      ),
    );
    // No countdown timer (per scope lock — post-Beta T-121).
    expect(
      screen.queryByText(/\d+\s*(second|seconds|s left)/i),
    ).not.toBeInTheDocument();
    // aria-disabled (not HTML disabled) per WCAG 4.1.2 — and rate-limit
    // is a *temporary* block, NOT permanent (silent re-enable after 60 s
    // per T-117 brief Section 5; tested in the next case).
    const btn = screen.getByTestId<HTMLButtonElement>('redeem-submit');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('429 rate_limited silently re-enables form after 60s (no countdown)', async () => {
    // T-117 brief Section 5 rate-limit UI note: "On 429, disable button +
    // input for 60 seconds then restore. Do NOT count down visually —
    // Just restore silently after 60 s." T-121 deferred ONLY the
    // countdown timer; the silent re-enable is in scope for T-118.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockBootstrapWithBetaInviteRequired();
      server.use(
        http.post(`${API}/api/v1/beta-signup`, () =>
          HttpResponse.json(
            { error: 'Too many requests', retryAfter: 3600 },
            { status: 429 },
          ),
        ),
      );
      renderRedeemInvite();

      await waitFor(() =>
        expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
      );
      const input = screen.getByTestId<HTMLInputElement>('redeem-token-input');
      fireEvent.change(input, { target: { value: 'WHATEVER' } });
      fireEvent.submit(screen.getByTestId('redeem-form'));

      await waitFor(() =>
        expect(screen.getByTestId('redeem-form-error').textContent).toContain(
          'Too many attempts',
        ),
      );
      expect(input.getAttribute('aria-disabled')).toBe('true');

      // Advance 60 seconds — the timer fires, rateLimitBlock flips off,
      // error banner clears silently. Use advanceTimersByTimeAsync so
      // React state flushes.
      await vi.advanceTimersByTimeAsync(60_000);

      await waitFor(() => {
        expect(input.getAttribute('aria-disabled')).toBe('false');
      });
      // Error banner removed (silent restore).
      expect(screen.queryByTestId('redeem-form-error')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('200 success briefly shows "✓ Token accepted" before navigating', async () => {
    // T-117 brief Section 4 + Section 5: 300 ms transient confirmation
    // state on the button before refreshMe + navigate. This gives the
    // user a beat of feedback so the route change feels intentional, not
    // jarring.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockBootstrapWithBetaInviteRequired({
        onboarding_required: true,
        needs_beta_invite: false,
        profile: {
          user_id: 'user-beta-1',
          email: 'beta.user@corp.com',
          name: '',
          google_id: 'goog-beta',
        },
      });
      server.use(
        http.post(`${API}/api/v1/beta-signup`, () =>
          HttpResponse.json({ status: 'redeemed' }, { status: 200 }),
        ),
      );
      renderRedeemInvite();

      await waitFor(() =>
        expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
      );
      fireEvent.change(
        screen.getByTestId<HTMLInputElement>('redeem-token-input'),
        { target: { value: 'GOOD-TOKEN' } },
      );
      fireEvent.submit(screen.getByTestId('redeem-form'));

      // Wait for the success transient label to appear on the button
      // (before the 300 ms timer fires + navigate runs).
      await waitFor(() => {
        expect(
          screen.getByTestId('redeem-submit').textContent,
        ).toContain('Token accepted');
      });

      // Advance the 300 ms timer + flush so navigate('/onboarding') runs.
      await vi.advanceTimersByTimeAsync(300);
      await waitFor(() =>
        expect(screen.getByTestId('onboarding-page')).toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('500 server error → server-error copy', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () =>
        HttpResponse.json({ error: 'Beta signup failed' }, { status: 500 }),
      ),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByTestId<HTMLInputElement>('redeem-token-input'),
      { target: { value: 'TOKEN' } },
    );
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form-error').textContent).toContain(
        'Something went wrong on our end',
      ),
    );
  });

  it('network failure → "couldn\'t reach the server" copy', async () => {
    mockBootstrapWithBetaInviteRequired();
    server.use(
      http.post(`${API}/api/v1/beta-signup`, () => HttpResponse.error()),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form')).toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByTestId<HTMLInputElement>('redeem-token-input'),
      { target: { value: 'TOKEN' } },
    );
    fireEvent.submit(screen.getByTestId('redeem-form'));

    await waitFor(() =>
      expect(screen.getByTestId('redeem-form-error').textContent).toContain(
        "couldn't reach the server",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Log out
// ---------------------------------------------------------------------------

describe('RedeemInvitePage log out', () => {
  it('clicking Log out calls POST /auth/logout', async () => {
    mockBootstrapWithBetaInviteRequired();
    let logoutHit = false;
    server.use(
      http.post(`${AUTH}/auth/logout`, () => {
        logoutHit = true;
        return HttpResponse.json({ message: 'Logged out' }, { status: 200 });
      }),
    );
    renderRedeemInvite();

    await waitFor(() =>
      expect(screen.getByTestId('redeem-logout')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('redeem-logout'));

    await waitFor(() => {
      expect(logoutHit).toBe(true);
    });
  });
});
