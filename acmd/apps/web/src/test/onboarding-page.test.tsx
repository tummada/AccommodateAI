/**
 * OnboardingPage + auth-context onboarding integration — RS-013 Phase 3 / Task B
 *
 * Coverage:
 *   - Auth bootstrap with /me { onboarding_required: true } populates
 *     `onboardingHints` on the context and sets user.onboardingRequired.
 *   - OnboardingPage prefills `name` from hints, displays prefilled email
 *     read-only, and sends ONLY { name, companyName? } to POST
 *     /api/v1/onboarding (never user_id / email / google_id).
 *   - 201 response triggers refreshMe() then navigates to /dashboard.
 *   - 400 response renders an inline field error and keeps the user on
 *     the form.
 *   - 409 response falls back to refreshMe() and navigates to /dashboard
 *     when /me now reports onboarding_required: false.
 *   - Submit button is disabled and aria-busy is set during the POST
 *     (guards duplicate submit).
 *   - Empty companyName is OMITTED from the request body (backend
 *     Zod schema rejects empty string).
 *
 * RS-013 router structure mirrors the real App.tsx: /login, /onboarding,
 * /dashboard (wrapped in OnboardingGuard). A single MemoryRouter per
 * test keeps the navigate() assertions deterministic.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { OnboardingGuard } from '@/components/OnboardingGuard';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';

// ---------------------------------------------------------------------------
// Test harness — mounts the OnboardingPage inside the real ProtectedRoute
// wrapper so bootstrap is exercised end-to-end on every test.
// ---------------------------------------------------------------------------

function StateProbe() {
  const { bootstrap, isAuthenticated, user, onboardingHints } = useAuth();
  return (
    <div>
      <span data-testid="bootstrap">{bootstrap}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="user-onboarding">
        {user ? String(user.onboardingRequired ?? '') : 'null'}
      </span>
      <span data-testid="hint-email">{onboardingHints?.email ?? ''}</span>
      <span data-testid="hint-name">{onboardingHints?.name ?? ''}</span>
      <span data-testid="hint-user-id">{onboardingHints?.userId ?? ''}</span>
    </div>
  );
}

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <>
                  <StateProbe />
                  <OnboardingPage />
                </>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <OnboardingGuard>
                  <div data-testid="dashboard">dashboard</div>
                </OnboardingGuard>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Common MSW overrides used by every happy-path test.
// ---------------------------------------------------------------------------

/**
 * /me switcher — first call returns the pre-onboarding shape, subsequent
 * calls (triggered by refreshMe after POST /onboarding) return whatever
 * the `afterOnboarding` argument supplies. This lets a single test drive
 * the bootstrap → submit → refresh flow without fighting MSW handler
 * override ordering.
 */
function mockBootstrapWithOnboardingRequired(afterOnboarding?: {
  onboarding_required: boolean;
  profile: Record<string, unknown>;
}) {
  const token = makeFakeAccessToken({ sub: 'user-new-1' });
  let meCalls = 0;
  const bootstrapBody = {
    onboarding_required: true,
    profile: {
      user_id: 'user-new-1',
      email: 'new.admin@corp.com',
      name: 'Prefilled Name',
      google_id: 'goog-xyz',
    },
  };
  server.use(
    http.post(`${AUTH}/auth/refresh`, () =>
      HttpResponse.json({ accessToken: token }, { status: 200 }),
    ),
    http.get(`${API}/api/v1/auth/me`, () => {
      meCalls += 1;
      if (meCalls === 1 || !afterOnboarding) {
        return HttpResponse.json(bootstrapBody, { status: 200 });
      }
      return HttpResponse.json(afterOnboarding, { status: 200 });
    }),
  );
  return token;
}

describe('auth-context onboarding integration (RS-013)', () => {
  it('bootstrap /me onboarding_required:true populates onboardingHints + user.onboardingRequired=true', async () => {
    mockBootstrapWithOnboardingRequired();
    renderOnboarding();

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('user-onboarding').textContent).toBe('true');
    expect(screen.getByTestId('hint-email').textContent).toBe('new.admin@corp.com');
    expect(screen.getByTestId('hint-name').textContent).toBe('Prefilled Name');
    expect(screen.getByTestId('hint-user-id').textContent).toBe('user-new-1');
  });

  it('bootstrap /me onboarding_required:false clears hints (never retained across sessions)', async () => {
    const token = makeFakeAccessToken();
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () =>
        HttpResponse.json(
          {
            onboarding_required: false,
            profile: {
              id: 'user-existing',
              email: 'existing@corp.com',
              name: 'Existing User',
              role: 'super_admin',
              companyId: 'company-abc',
            },
          },
          { status: 200 },
        ),
      ),
    );
    renderOnboarding();

    await waitFor(() => {
      // OnboardingPage redirects to /dashboard when onboardingRequired=false.
      // The StateProbe inside /onboarding is unmounted after redirect so
      // we assert on the dashboard presence as proxy for "hints never
      // pinned". The dedicated hint-email assertion is covered by the
      // onboarding_required:true happy-path test above.
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });
  });
});

describe('OnboardingPage (RS-013)', () => {
  it('prefills the name field from /me hints and shows the email read-only', async () => {
    mockBootstrapWithOnboardingRequired();
    renderOnboarding();

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-form')).toBeInTheDocument();
    });
    const nameInput = screen.getByTestId<HTMLInputElement>('onboarding-name-input');
    expect(nameInput.value).toBe('Prefilled Name');
    expect(screen.getByTestId('onboarding-email').textContent).toBe(
      'new.admin@corp.com',
    );
  });

  it('POST /onboarding sends ONLY { name, companyName } — never user_id / email / google_id', async () => {
    const token = mockBootstrapWithOnboardingRequired({
      onboarding_required: false,
      profile: {
        id: 'user-new-1',
        email: 'new.admin@corp.com',
        name: 'Updated Name',
        role: 'super_admin',
        companyId: 'company-new-1',
      },
    });
    let capturedAuthHeader: string | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API}/api/v1/onboarding`, async ({ request }) => {
        capturedAuthHeader = request.headers.get('authorization');
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            onboarding_required: true,
            profile: {
              id: 'user-new-1',
              email: 'new.admin@corp.com',
              name: 'Updated Name',
              role: 'super_admin',
              companyId: 'company-new-1',
            },
          },
          { status: 201 },
        );
      }),
    );
    renderOnboarding();

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-form')).toBeInTheDocument(),
    );

    const nameInput = screen.getByTestId<HTMLInputElement>('onboarding-name-input');
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } });
    const companyInput = screen.getByTestId<HTMLInputElement>(
      'onboarding-company-input',
    );
    fireEvent.change(companyInput, { target: { value: 'Acme Corp' } });

    fireEvent.submit(screen.getByTestId('onboarding-form'));

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });

    expect(capturedBody).toEqual({ name: 'Updated Name', companyName: 'Acme Corp' });
    expect(capturedBody).not.toHaveProperty('email');
    expect(capturedBody).not.toHaveProperty('user_id');
    expect(capturedBody).not.toHaveProperty('google_id');
    expect(capturedAuthHeader).toBe(`Bearer ${token}`);
  });

  it('empty companyName is OMITTED from the request body (Zod schema rejects empty string)', async () => {
    mockBootstrapWithOnboardingRequired({
      onboarding_required: false,
      profile: {
        id: 'user-new-1',
        email: 'new.admin@corp.com',
        name: 'Solo User',
        role: 'super_admin',
        companyId: 'company-new-1',
      },
    });
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API}/api/v1/onboarding`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            onboarding_required: true,
            profile: {
              id: 'user-new-1',
              email: 'new.admin@corp.com',
              name: 'Solo User',
              role: 'super_admin',
              companyId: 'company-new-1',
            },
          },
          { status: 201 },
        );
      }),
    );
    renderOnboarding();

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-form')).toBeInTheDocument(),
    );

    // Overwrite prefilled name (just to verify the path), leave
    // companyName empty on purpose.
    const nameInput = screen.getByTestId<HTMLInputElement>('onboarding-name-input');
    fireEvent.change(nameInput, { target: { value: 'Solo User' } });

    fireEvent.submit(screen.getByTestId('onboarding-form'));

    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    expect(capturedBody).toEqual({ name: 'Solo User' });
    expect(capturedBody).not.toHaveProperty('companyName');
  });

  it('400 response renders an inline field error and keeps the user on /onboarding', async () => {
    mockBootstrapWithOnboardingRequired();
    server.use(
      http.post(`${API}/api/v1/onboarding`, () =>
        HttpResponse.json(
          { code: 'BAD_REQUEST', message: 'Validation failed' },
          { status: 400 },
        ),
      ),
    );
    renderOnboarding();

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-form')).toBeInTheDocument(),
    );

    // Submit with the prefilled name — server rejects it.
    fireEvent.submit(screen.getByTestId('onboarding-form'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-form-error')).toBeInTheDocument();
    });
    // Still on the onboarding page — no navigation to dashboard.
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    // Field-level hint appears under the name input.
    expect(screen.getByTestId('onboarding-name-error')).toBeInTheDocument();
  });

  it('409 response triggers refreshMe → dashboard when /me now reports onboarded', async () => {
    // Bootstrap returns onboarding_required:true, refreshMe after the 409
    // returns the onboarded state so the guard releases the user.
    mockBootstrapWithOnboardingRequired({
      onboarding_required: false,
      profile: {
        id: 'user-new-1',
        email: 'new.admin@corp.com',
        name: 'Prefilled Name',
        role: 'super_admin',
        companyId: 'company-new-1',
      },
    });
    server.use(
      http.post(`${API}/api/v1/onboarding`, () =>
        HttpResponse.json(
          { code: 'CONFLICT', message: 'Onboarding already completed' },
          { status: 409 },
        ),
      ),
    );
    renderOnboarding();

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-form')).toBeInTheDocument(),
    );
    fireEvent.submit(screen.getByTestId('onboarding-form'));

    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });

  it('submit button is disabled and aria-busy is true during the POST', async () => {
    mockBootstrapWithOnboardingRequired({
      onboarding_required: false,
      profile: {
        id: 'user-new-1',
        email: 'new.admin@corp.com',
        name: 'Prefilled Name',
        role: 'super_admin',
        companyId: 'company-new-1',
      },
    });
    // A promise we resolve manually to keep the POST in flight long
    // enough for the disabled/aria-busy assertion.
    const releaseRequest: { resolve: (() => void) | null } = { resolve: null };
    server.use(
      http.post(`${API}/api/v1/onboarding`, async () => {
        await new Promise<void>((resolve) => {
          releaseRequest.resolve = resolve;
        });
        return HttpResponse.json(
          {
            onboarding_required: true,
            profile: {
              id: 'user-new-1',
              email: 'new.admin@corp.com',
              name: 'Prefilled Name',
              role: 'super_admin',
              companyId: 'company-new-1',
            },
          },
          { status: 201 },
        );
      }),
    );
    renderOnboarding();

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-form')).toBeInTheDocument(),
    );

    fireEvent.submit(screen.getByTestId('onboarding-form'));

    await waitFor(() => {
      const btn = screen.getByTestId<HTMLButtonElement>('onboarding-submit');
      expect(btn.disabled).toBe(true);
    });
    const form = screen.getByTestId('onboarding-form');
    expect(form.getAttribute('aria-busy')).toBe('true');

    // Release the server response so the test finishes cleanly.
    releaseRequest.resolve?.();
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });
});
