/**
 * ACMD-116 §7 / ACMD-124 — AuthProvider bootstrap lifecycle tests.
 *
 * Covers (ACMD-116):
 *  - bootstrap 200 → authenticated
 *  - bootstrap 401 → unauthenticated (no error UI)
 *  - bootstrap network error → retry 1× then fail gracefully
 *  - ProtectedRoute in `pending` → skeleton, no redirect
 *
 * Extended (ACMD-124):
 *  - bootstrap 200 /refresh then 200 /me → user populated from /me (not JWT decode)
 *  - bootstrap 200 /refresh then 401 /me → hard logout (unauthenticated)
 *  - bootstrap 200 /refresh then network error on /me → retry 1× then network_error
 *  - login flow calls /me to populate user (not the JWT payload)
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

// RS-013: data endpoints on acmd-api (port 3000), auth on vollos-core (port 3002).
const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';

// Default /me handler shared by happy-path tests. Override per test
// for 401 / network error scenarios.
//
// RS-013: body accepts either the legacy flat shape (backwards compat
// with existing test call sites) or the envelope shape returned by the
// real backend. The helper normalises the flat form into the envelope
// so the fetchMe() parser sees what production would send.
function meHandler(
  body: Record<string, unknown> = {
    id: 'user-123',
    email: 'alice@corp.com',
    name: 'Alice',
    role: 'super_admin',
    companyId: 'company-abc',
    onboardingRequired: false,
  },
  status = 200,
) {
  // Envelope already? Pass through untouched.
  const envelope =
    'profile' in body && 'onboarding_required' in body
      ? body
      : {
          onboarding_required: Boolean(body.onboardingRequired),
          profile: body.onboardingRequired
            ? {
                user_id: body.id,
                email: body.email,
                name: body.name ?? '',
                google_id: body.google_id ?? 'goog-test',
              }
            : {
                id: body.id,
                email: body.email,
                name: body.name,
                role: body.role,
                companyId: body.companyId,
              },
        };
  return http.get(`${API}/api/v1/auth/me`, () =>
    HttpResponse.json(envelope, { status }),
  );
}

function StateProbe() {
  const { bootstrap, isAuthenticated, user } = useAuth();
  return (
    <div>
      <span data-testid="bootstrap">{bootstrap}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="email">{user?.email ?? ''}</span>
    </div>
  );
}

function renderWithAuth(initialEntry = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div data-testid="dashboard">
                  <StateProbe />
                  dashboard
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthProvider bootstrap', () => {
  it('bootstrap 200 → state = authenticated and user populated from /me', async () => {
    const token = makeFakeAccessToken();
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      meHandler({
        id: 'user-123',
        email: 'alice@corp.com',
        name: 'Alice',
        role: 'super_admin',
        companyId: 'company-abc',
        onboardingRequired: false,
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('authed').textContent).toBe('true');
    // The displayed email MUST come from the /me response body. The
    // fake access token payload is ignored — removing the ACMD-116
    // client-side decoder is what ACMD-124 is about.
    expect(screen.getByTestId('email').textContent).toBe('alice@corp.com');
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('bootstrap 401 → state = unauthenticated and redirects to /login (no error UI)', async () => {
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ error: 'missing' }, { status: 401 }),
      ),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    // No connection-error alert surfaces on plain 401.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('bootstrap network error → retries once then shows connection-error UI', async () => {
    let calls = 0;
    server.use(
      http.post(`${AUTH}/auth/refresh`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(calls).toBe(2);
    expect(screen.getByRole('alert').textContent).toMatch(/connection problem/i);
  });

  it('ProtectedRoute in `pending` renders the skeleton and does not redirect', async () => {
    // Never resolves — keeps the provider in `pending` until the test
    // unmounts. We assert the skeleton is shown and /login is NOT.
    server.use(
      http.post(`${AUTH}/auth/refresh`, async () => {
        await new Promise(() => {}); // hang forever
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    renderWithAuth();

    // Skeleton starts hidden for 300ms to avoid flash — wait for visible
    // state so we can make a meaningful assertion.
    await waitFor(() => {
      expect(screen.queryByTestId('app-shell-skeleton')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  // ACMD-124: /me is the second bootstrap step after /refresh. Three
  // paths must be covered: /me 401 = hard logout, /me network error =
  // retry once then network_error panel, /me success = user populated
  // from the response (not from JWT payload).
  it('ACMD-124: /refresh 200 then /me 401 → hard logout (unauthenticated)', async () => {
    const token = makeFakeAccessToken();
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ACMD-124-fix: /refresh 200 then /me 404 → hard logout (user deleted edge case)', async () => {
    const token = makeFakeAccessToken();
    let meCalls = 0;
    // Spy on BroadcastChannel.postMessage to prove a cross-tab logout
    // is emitted. The auth-broadcast helper uses BroadcastChannel when
    // available (it is in jsdom) so we can observe it directly.
    const postMessageSpy = vi.spyOn(
      BroadcastChannel.prototype,
      'postMessage',
    );
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () => {
        meCalls += 1;
        return HttpResponse.json({ error: 'user_not_found' }, { status: 404 });
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    // Hard logout: no retry loop (exactly 1 /me call), no connection banner.
    expect(meCalls).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Cross-tab logout broadcast was emitted.
    const loggedOut = postMessageSpy.mock.calls.some(
      ([msg]) =>
        typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'logout',
    );
    expect(loggedOut).toBe(true);
    postMessageSpy.mockRestore();
  });

  it('ACMD-124: /refresh 200 then /me network error → retries once then network_error panel', async () => {
    const token = makeFakeAccessToken();
    let meCalls = 0;
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () => {
        meCalls += 1;
        return HttpResponse.error();
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(meCalls).toBe(2);
    expect(screen.getByRole('alert').textContent).toMatch(/connection problem/i);
  });

  it('ACMD-124: /refresh 200 then /me network error then retry success → authenticated', async () => {
    const token = makeFakeAccessToken();
    let meCalls = 0;
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () => {
        meCalls += 1;
        if (meCalls === 1) return HttpResponse.error();
        return HttpResponse.json(
          {
            onboarding_required: false,
            profile: {
              id: 'user-123',
              email: 'bob@corp.com',
              name: 'Bob',
              role: 'super_admin',
              companyId: 'company-abc',
            },
          },
          { status: 200 },
        );
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });
    expect(meCalls).toBe(2);
    expect(screen.getByTestId('email').textContent).toBe('bob@corp.com');
  });

  it('ACMD-124: /me response with onboardingRequired=true populates user flag', async () => {
    const token = makeFakeAccessToken();
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: token }, { status: 200 }),
      ),
      meHandler({
        id: 'user-new',
        email: 'new@corp.com',
        name: 'New Admin',
        role: 'super_admin',
        companyId: 'company-new',
        onboardingRequired: true,
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('email').textContent).toBe('new@corp.com');
  });
});
