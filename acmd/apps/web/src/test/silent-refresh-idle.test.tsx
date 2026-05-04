/**
 * ACMD-149 — Automated test: 16-minute idle silent refresh (Scenario 4).
 *
 * Simulates a user who logs in, goes idle for 16 minutes (access token has
 * a 15-minute expiry via `makeFakeAccessToken`), then returns and triggers
 * an API call. The app must silently refresh the session (401 -> POST
 * /refresh -> new token -> retry -> 200) without kicking the user to login.
 *
 * Uses `vi.useFakeTimers()` to fast-forward time so no real waiting occurs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { __resetRefreshCoordinatorForTests } from '@/lib/refresh-coordinator';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

// RS-013: split — data on acmd-api (port 3000), auth on vollos-core (port 3002).
const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';
const CASES_PATH = `${API}/api/v1/cases`;

const SIXTEEN_MINUTES_MS = 16 * 60 * 1000;

// Use distinct token strings so MSW handlers can distinguish them.
// makeFakeAccessToken is used for bootstrap (realistic JWT shape),
// but for the refreshed token we use a different sub so the string differs.
const BOOTSTRAP_TOKEN = makeFakeAccessToken({ sub: 'user-123' });
const REFRESHED_TOKEN = makeFakeAccessToken({ sub: 'user-123-refreshed' });

const ME_RESPONSE = {
  onboarding_required: false,
  profile: {
    id: 'user-123',
    email: 'hr@example.com',
    name: 'HR Admin',
    role: 'hr_admin',
    companyId: 'company-abc',
  },
};

/**
 * StateProbe — renders auth state into the DOM so tests can assert on it.
 * Also exposes a button that triggers an authenticated API call via
 * `useAuth().client.request`, simulating a user action after being idle.
 */
function StateProbe() {
  const { bootstrap, isAuthenticated, user, client } = useAuth();

  const handleFetchCases = async () => {
    try {
      const data = await client.request<{ items: string[] }>('/api/v1/cases');
      document.getElementById('api-result')!.textContent = JSON.stringify(data);
    } catch (err) {
      document.getElementById('api-result')!.textContent = `error:${(err as Error).message}`;
    }
  };

  return (
    <div>
      <span data-testid="bootstrap">{bootstrap}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="email">{user?.email ?? ''}</span>
      <button data-testid="fetch-cases" onClick={handleFetchCases}>
        Fetch Cases
      </button>
      <span data-testid="api-result" id="api-result" />
    </div>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div data-testid="dashboard">
                  <StateProbe />
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('ACMD-149: 16-minute idle silent refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    __resetRefreshCoordinatorForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bootstrap login -> idle 16 min -> API call -> 401 -> refresh -> retry 200 -> still authenticated', async () => {
    let refreshCallCount = 0;

    server.use(
      // Bootstrap + silent refresh: returns different tokens per call
      http.post(`${AUTH}/auth/refresh`, () => {
        refreshCallCount += 1;
        if (refreshCallCount === 1) {
          return HttpResponse.json({ accessToken: BOOTSTRAP_TOKEN }, { status: 200 });
        }
        // Silent refresh after 16-min idle
        return HttpResponse.json({ accessToken: REFRESHED_TOKEN }, { status: 200 });
      }),
      // /me always returns a valid profile
      http.get(`${API}/api/v1/auth/me`, () =>
        HttpResponse.json(ME_RESPONSE, { status: 200 }),
      ),
      // Protected endpoint: expired token -> 401, refreshed token -> 200
      http.get(CASES_PATH, ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        if (auth === `Bearer ${BOOTSTRAP_TOKEN}`) {
          return HttpResponse.json({ error: 'token_expired' }, { status: 401 });
        }
        if (auth === `Bearer ${REFRESHED_TOKEN}`) {
          return HttpResponse.json({ items: ['case-1', 'case-2'] }, { status: 200 });
        }
        return HttpResponse.json({ error: 'unknown_token' }, { status: 401 });
      }),
    );

    renderApp();

    // Wait for bootstrap to complete
    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });
    expect(screen.getByTestId('authed').textContent).toBe('true');
    expect(screen.getByTestId('email').textContent).toBe('hr@example.com');
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(refreshCallCount).toBe(1); // Only bootstrap refresh so far

    // --- Phase 2: Advance 16 minutes (access token expired) ---------------
    // Reset the refresh coordinator so the silent-refresh 401 handler
    // gets a clean slot (bootstrap's in-flight promise already resolved).
    __resetRefreshCoordinatorForTests();

    await vi.advanceTimersByTimeAsync(SIXTEEN_MINUTES_MS);

    // --- Phase 3: User comes back and triggers an API call ----------------
    const fetchBtn = screen.getByTestId('fetch-cases');
    fetchBtn.click();

    // The silent refresh cycle:
    // 1. client.request sends GET /cases with BOOTSTRAP_TOKEN (expired)
    // 2. Backend returns 401
    // 3. Client calls POST /refresh -> gets REFRESHED_TOKEN
    // 4. Client retries GET /cases with REFRESHED_TOKEN -> 200
    await waitFor(() => {
      const result = screen.getByTestId('api-result').textContent;
      expect(result).toBe(JSON.stringify({ items: ['case-1', 'case-2'] }));
    });

    // --- Phase 4: Assert final state --------------------------------------
    // Refresh was called twice: once for bootstrap, once for silent refresh
    expect(refreshCallCount).toBe(2);

    // User is STILL authenticated -- no redirect to login
    expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    expect(screen.getByTestId('authed').textContent).toBe('true');
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  it('after idle 16 min, refresh failure -> auth lost -> redirects to login', async () => {
    let refreshCallCount = 0;

    server.use(
      http.post(`${AUTH}/auth/refresh`, () => {
        refreshCallCount += 1;
        if (refreshCallCount === 1) {
          return HttpResponse.json({ accessToken: BOOTSTRAP_TOKEN }, { status: 200 });
        }
        // Silent refresh fails -- refresh token also expired
        return HttpResponse.json({ error: 'refresh_token_expired' }, { status: 401 });
      }),
      http.get(`${API}/api/v1/auth/me`, () =>
        HttpResponse.json(ME_RESPONSE, { status: 200 }),
      ),
      http.get(CASES_PATH, () =>
        HttpResponse.json({ error: 'token_expired' }, { status: 401 }),
      ),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap').textContent).toBe('authenticated');
    });

    // Advance 16 minutes
    __resetRefreshCoordinatorForTests();
    await vi.advanceTimersByTimeAsync(SIXTEEN_MINUTES_MS);

    // Trigger API call -- will fail because refresh also returns 401
    screen.getByTestId('fetch-cases').click();

    // onAuthLost fires -> unauthenticated -> redirect to /login
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(refreshCallCount).toBe(2);
  });
});
