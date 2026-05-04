/**
 * ACMD-116 §7 — logout resilience tests.
 *
 * Covers:
 *  - logout 200 → backend called + state cleared
 *  - logout 500 → state still cleared (offline-safe)
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

// RS-013: auth endpoints moved to vollos-core at port 3002.
const AUTH = 'http://localhost:3002';

function LogoutHarness({ onReady }: { onReady: (logout: () => Promise<void>) => void }) {
  const { bootstrap, isAuthenticated, logout, login } = useAuth();
  const loggedInOnce = useRef(false);
  // Bypass bootstrap by logging in synthetically ONCE after the provider
  // finishes its initial refresh probe. `loggedInOnce` prevents the
  // effect from re-logging-in after a subsequent logout (which is
  // precisely what the test is asserting).
  useEffect(() => {
    if (!loggedInOnce.current && bootstrap === 'unauthenticated' && !isAuthenticated) {
      loggedInOnce.current = true;
      login(makeFakeAccessToken(), false);
    }
  }, [bootstrap, isAuthenticated, login]);
  useEffect(() => {
    onReady(logout);
  }, [logout, onReady]);
  return (
    <div>
      <span data-testid="bootstrap">{bootstrap}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
    </div>
  );
}

function mountHarness() {
  let capturedLogout: () => Promise<void> = async () => {};
  server.use(
    http.post(`${AUTH}/auth/refresh`, () =>
      HttpResponse.json({ error: 'missing' }, { status: 401 }),
    ),
  );
  render(
    <MemoryRouter>
      <AuthProvider>
        <LogoutHarness
          onReady={(fn) => {
            capturedLogout = fn;
          }}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
  return () => capturedLogout();
}

describe('AuthProvider.logout()', () => {
  it('logout 200 → calls backend and clears local state', async () => {
    let logoutCalled = false;
    server.use(
      http.post(`${AUTH}/auth/logout`, () => {
        logoutCalled = true;
        return HttpResponse.json({ message: 'ok' }, { status: 200 });
      }),
    );

    const triggerLogout = mountHarness();

    await waitFor(() => {
      expect(screen.getByTestId('authed').textContent).toBe('true');
    });

    await act(async () => {
      await triggerLogout();
    });

    expect(logoutCalled).toBe(true);
    expect(screen.getByTestId('authed').textContent).toBe('false');
    expect(screen.getByTestId('bootstrap').textContent).toBe('unauthenticated');
  });

  it('logout 500 → still clears local state (resilience)', async () => {
    let logoutCalled = false;
    server.use(
      http.post(`${AUTH}/auth/logout`, () => {
        logoutCalled = true;
        return HttpResponse.json({ error: 'boom' }, { status: 500 });
      }),
    );

    const triggerLogout = mountHarness();

    await waitFor(() => {
      expect(screen.getByTestId('authed').textContent).toBe('true');
    });

    await act(async () => {
      await triggerLogout();
    });

    expect(logoutCalled).toBe(true);
    expect(screen.getByTestId('authed').textContent).toBe('false');
  });
});
